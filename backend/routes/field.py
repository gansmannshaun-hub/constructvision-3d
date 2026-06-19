"""Field-execution routes: daily logs with auto-weather, site photo progress
tracking via AI vision, and LiDAR USDZ scan upload (stored as reference asset).
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone

import httpx
from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from routes.collab import log_activity, require_role
from utils import now_iso

logger = logging.getLogger("field")

PHASE_LABELS = [
    "Site Prep", "Excavation", "Foundation", "Framing", "Roofing",
    "MEP Rough-in", "Insulation", "Drywall", "Exterior Finish", "Interior Finish", "Trim/Punch",
]

PROGRESS_PROMPT = """You are a construction superintendent reviewing a JOB-SITE PROGRESS PHOTO.
Estimate the completion percentage of each major construction phase. Return STRICT JSON:

{
  "summary": "1-2 sentence description of current state",
  "phases": [
    {"phase": "Foundation", "percent": 100, "evidence": "concrete slab visible"},
    {"phase": "Framing",    "percent": 60,  "evidence": "wall studs up, no roof"}
  ],
  "issues": ["any visible safety/quality issues"]
}

Phase names MUST be from: """ + ", ".join(PHASE_LABELS) + """. Only include phases for
which there's visual evidence (omit phases not yet started). Percent is 0..100 integer.
Output JSON only.
"""


class DailyLogIn(BaseModel):
    log_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).date().isoformat())
    notes: str = Field(default="", max_length=2000)
    crew_size: int = Field(default=0, ge=0, le=200)
    fetch_weather: bool = True


def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


def _strip_fence(t: str) -> str:
    t = t.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t); t = re.sub(r"\n?```$", "", t)
    return t.strip()


async def _fetch_noaa_weather(lat: float, lng: float) -> dict:
    """NOAA Weather API: 2-step lookup. Free, no key. Returns today's forecast snapshot."""
    try:
        async with httpx.AsyncClient(timeout=12, headers={"User-Agent": "Atlas Construction (atlas.app)"}) as c:
            r = await c.get(f"https://api.weather.gov/points/{lat},{lng}")
            if r.status_code != 200:
                return {"error": f"NOAA points HTTP {r.status_code}"}
            props = r.json().get("properties", {})
            forecast_url = props.get("forecast")
            if not forecast_url:
                return {"error": "no forecast url"}
            f = await c.get(forecast_url)
            if f.status_code != 200:
                return {"error": f"forecast HTTP {f.status_code}"}
            periods = f.json().get("properties", {}).get("periods", [])
            if not periods:
                return {"error": "no periods"}
            p = periods[0]
            return {
                "name": p.get("name"),
                "temperature_f": p.get("temperature"),
                "wind": p.get("windSpeed"),
                "wind_direction": p.get("windDirection"),
                "short_forecast": p.get("shortForecast"),
                "icon": p.get("icon"),
                "fetched_at": now_iso(),
                "source": "NOAA Weather API",
            }
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)[:200]}


async def _analyze_progress(b64: str) -> dict:
    if not _llm_key():
        return {"summary": "AI unavailable.", "phases": []}
    try:
        chat = LlmChat(api_key=_llm_key(), session_id=f"prog-{uuid.uuid4()}",
                       system_message="Construction progress analyst. Output JSON only.").with_model("openai", "gpt-4o")
        msg = UserMessage(text=PROGRESS_PROMPT, file_contents=[ImageContent(image_base64=b64)])
        raw = await asyncio.wait_for(chat.send_message(msg), timeout=40)
        text = _strip_fence(raw if isinstance(raw, str) else str(raw))
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{[\s\S]*\}", text)
            return json.loads(m.group(0)) if m else {"summary": "Parse error", "phases": []}
    except Exception as exc:  # noqa: BLE001
        return {"summary": f"AI failed: {exc}", "phases": []}


def build_field_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    # ---------- Daily Logs ----------

    @router.get("/projects/{project_id}/daily-logs")
    async def list_logs(project_id: str, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator", "viewer"})
        return await db.daily_logs.find(
            {"project_id": project_id}, {"_id": 0},
        ).sort("log_date", -1).limit(200).to_list(200)

    @router.post("/projects/{project_id}/daily-logs")
    async def create_log(project_id: str, payload: DailyLogIn, user: dict = Depends(get_current_user)):
        role = await require_role(db, project_id, user, {"owner", "pm", "estimator"})
        weather = None
        if payload.fetch_weather:
            site = await db.sites.find_one({"project_id": project_id}, {"_id": 0, "lat": 1, "lng": 1})
            if site:
                weather = await _fetch_noaa_weather(site["lat"], site["lng"])
        doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "log_date": payload.log_date,
            "notes": payload.notes,
            "crew_size": payload.crew_size,
            "weather": weather,
            "author_email": user["email"],
            "author_name": user.get("name") or user["email"],
            "author_role": role,
            "photo_ids": [],
            "created_at": now_iso(),
        }
        await db.daily_logs.insert_one(doc); doc.pop("_id", None)
        await log_activity(db, project_id, user["email"], "daily_log.created",
                           target_type="daily_log", target_id=doc["id"], target_name=payload.log_date)
        return doc

    @router.delete("/daily-logs/{log_id}")
    async def delete_log(log_id: str, user: dict = Depends(get_current_user)):
        log_doc = await db.daily_logs.find_one({"id": log_id}, {"_id": 0})
        if not log_doc:
            raise HTTPException(404, "Not found")
        await require_role(db, log_doc["project_id"], user, {"owner", "pm"})
        # delete attached photos
        await db.site_photos.delete_many({"daily_log_id": log_id})
        await db.daily_logs.delete_one({"id": log_id})
        return {"ok": True}

    # ---------- Site progress photos ----------

    @router.post("/projects/{project_id}/site-photos")
    async def upload_progress_photo(
        project_id: str,
        file: UploadFile = File(...),
        daily_log_id: str = Form(""),
        caption: str = Form(""),
        user: dict = Depends(get_current_user),
    ):
        await require_role(db, project_id, user, {"owner", "pm", "estimator"})
        mime = file.content_type or ""
        if not mime.startswith("image/"):
            raise HTTPException(400, "Must be an image")
        content = await file.read()
        if len(content) > 8 * 1024 * 1024:
            raise HTTPException(400, "Photo too large (max 8MB)")
        b64 = base64.b64encode(content).decode("utf-8")
        analysis = await _analyze_progress(b64)
        photo_id = str(uuid.uuid4())
        await db.site_photos.insert_one({
            "id": photo_id,
            "project_id": project_id,
            "daily_log_id": daily_log_id or None,
            "filename": file.filename,
            "mime_type": mime,
            "image_base64": b64,
            "caption": caption[:240],
            "analysis": analysis,
            "uploaded_by": user["email"],
            "created_at": now_iso(),
        })
        if daily_log_id:
            await db.daily_logs.update_one(
                {"id": daily_log_id},
                {"$addToSet": {"photo_ids": photo_id}},
            )
        await log_activity(db, project_id, user["email"], "site_photo.uploaded",
                           target_type="site_photo", target_id=photo_id,
                           target_name=file.filename or "site photo")
        return {"id": photo_id, "analysis": analysis}

    @router.get("/projects/{project_id}/site-photos")
    async def list_photos(project_id: str, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator", "viewer"})
        return await db.site_photos.find(
            {"project_id": project_id}, {"_id": 0, "image_base64": 0},
        ).sort("created_at", -1).to_list(500)

    @router.get("/site-photos/{photo_id}/image")
    async def get_photo(photo_id: str, user: dict = Depends(get_current_user)):
        p = await db.site_photos.find_one({"id": photo_id}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Not found")
        await require_role(db, p["project_id"], user, {"owner", "pm", "estimator", "viewer"})
        return {"id": p["id"], "image_base64": p.get("image_base64"), "mime_type": p.get("mime_type")}

    @router.get("/projects/{project_id}/progress-summary")
    async def progress_summary(project_id: str, user: dict = Depends(get_current_user)):
        """Aggregate phase % across all site photos (max % seen wins per phase)."""
        await require_role(db, project_id, user, {"owner", "pm", "estimator", "viewer"})
        photos = await db.site_photos.find(
            {"project_id": project_id}, {"_id": 0, "analysis": 1, "created_at": 1},
        ).to_list(500)
        by_phase: dict[str, dict] = {}
        for p in photos:
            for ph in (p.get("analysis") or {}).get("phases") or []:
                name = ph.get("phase")
                pct = int(ph.get("percent") or 0)
                if not name:
                    continue
                cur = by_phase.get(name)
                if not cur or pct > cur["percent"]:
                    by_phase[name] = {"phase": name, "percent": pct,
                                       "last_seen": p.get("created_at"),
                                       "evidence": ph.get("evidence", "")}
        order = {n: i for i, n in enumerate(PHASE_LABELS)}
        return {
            "phases": sorted(by_phase.values(), key=lambda x: order.get(x["phase"], 99)),
            "photos_analyzed": len(photos),
        }

    # ---------- LiDAR USDZ upload (scaffolding) ----------

    @router.post("/projects/{project_id}/lidar")
    async def upload_lidar(
        project_id: str,
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        await require_role(db, project_id, user, {"owner", "pm", "estimator"})
        name = (file.filename or "").lower()
        if not (name.endswith(".usdz") or name.endswith(".usd") or name.endswith(".obj") or name.endswith(".gltf") or name.endswith(".glb")):
            raise HTTPException(400, "Supported formats: .usdz .usd .obj .gltf .glb")
        content = await file.read()
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 50MB)")
        b64 = base64.b64encode(content).decode("utf-8")
        scan_id = str(uuid.uuid4())
        await db.lidar_scans.insert_one({
            "id": scan_id, "project_id": project_id,
            "filename": file.filename, "size": len(content),
            "format": name.rsplit(".", 1)[-1],
            "data_base64": b64, "uploaded_by": user["email"],
            "created_at": now_iso(),
            "geometry_extracted": False,  # future: parse and pull walls
        })
        await log_activity(db, project_id, user["email"], "lidar.uploaded",
                           target_type="lidar", target_id=scan_id, target_name=file.filename or "scan")
        return {"id": scan_id, "filename": file.filename, "size": len(content),
                "format": name.rsplit(".", 1)[-1],
                "note": "Stored. Wall-extraction pipeline ships in a follow-up sprint — "
                        "for now the scan is downloadable as a reference asset."}

    @router.get("/projects/{project_id}/lidar")
    async def list_lidar(project_id: str, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator", "viewer"})
        return await db.lidar_scans.find(
            {"project_id": project_id}, {"_id": 0, "data_base64": 0},
        ).sort("created_at", -1).to_list(50)

    @router.get("/lidar/{scan_id}/download")
    async def download_lidar(scan_id: str, user: dict = Depends(get_current_user)):
        from fastapi.responses import StreamingResponse
        from io import BytesIO
        scan = await db.lidar_scans.find_one({"id": scan_id}, {"_id": 0})
        if not scan:
            raise HTTPException(404, "Not found")
        await require_role(db, scan["project_id"], user, {"owner", "pm", "estimator", "viewer"})
        data = base64.b64decode(scan["data_base64"])
        return StreamingResponse(BytesIO(data),
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{scan["filename"]}"'})

    return router
