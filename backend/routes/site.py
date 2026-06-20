"""Site-context routes: fetches a Google Static Maps satellite image of the
build location, runs GPT-4o vision to identify features + a recommended
buildable area, and stores the image so the 3D renderer can use it as a
textured ground plane.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import os
import re
import uuid

import httpx
from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from utils import now_iso

logger = logging.getLogger("site")

# Static Maps default capture: 640×640 @ scale=2 (returns 1280×1280 px)
STATIC_SIZE_PX = 640
STATIC_SCALE = 2
EARTH_PIXEL_BASE = 156543.03392  # at zoom 0 at the equator (meters/pixel)


def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


def _maps_key() -> str:
    return os.environ.get("GOOGLE_MAPS_API_KEY", "")


def meters_per_pixel(lat_deg: float, zoom: int) -> float:
    return EARTH_PIXEL_BASE * math.cos(math.radians(lat_deg)) / (2 ** zoom)


def world_meters_for_capture(lat_deg: float, zoom: int, size_px: int = STATIC_SIZE_PX) -> float:
    """World size in meters covered by the unscaled image dimension."""
    return size_px * meters_per_pixel(lat_deg, zoom)


SITE_PROMPT = """You are an expert site analyst studying a satellite image of a potential
construction site. The image is square and centered on (lat={lat}, lng={lng}) covering
approximately {world_m:.0f} meters per side at zoom {zoom}.

Return STRICT JSON ONLY (no prose, no markdown), with this exact schema:

{{
  "summary": "1-2 sentence site description",
  "features": [
    {{"kind": "tree" | "trees" | "water" | "road" | "driveway" | "building" | "vegetation" | "rock" | "slope" | "other",
      "label": "short label",
      "x": <0..1 normalised image x>, "y": <0..1 normalised image y>,
      "radius": <0..0.5 normalised radius approximation>}}
  ],
  "buildable_area": {{
    "polygon": [[x, y], [x, y], ...],   // 4-8 points, normalised 0..1 image coords
    "centroid": [x, y],
    "approx_sqft": <integer>,
    "rationale": "Why this patch is the best build location"
  }},
  "recommended_orientation_deg": <0..359, building's long-axis bearing clockwise from north>,
  "lot_estimate_sqft": <integer estimate of the entire visible lot or open space>
}}

Rules:
- Image origin is top-left; x increases right, y increases down.
- buildable_area must be a CLOSED polygon covering ground that is FLAT, FREE of trees / water / existing
  buildings / roads, large enough for a 30x40 ft footprint at minimum.
- If the image is mostly road / water / unbuildable, return an empty buildable_area.polygon ([]) and
  centroid = [0.5, 0.5].
- Output JSON only, no explanation."""


async def _fetch_static_maps(lat: float, lng: float, zoom: int) -> bytes:
    key = _maps_key()
    if not key:
        raise HTTPException(503, "Google Maps API key missing on server")
    url = "https://maps.googleapis.com/maps/api/staticmap"
    params = {
        "center": f"{lat},{lng}",
        "zoom": str(zoom),
        "size": f"{STATIC_SIZE_PX}x{STATIC_SIZE_PX}",
        "scale": str(STATIC_SCALE),
        "maptype": "satellite",
        "key": key,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params)
    if r.status_code != 200 or not r.content.startswith(b"\x89PNG"):
        body = r.text[:300] if r.text else "<binary>"
        raise HTTPException(502, f"Google Static Maps failed: HTTP {r.status_code} — {body}")
    return r.content


def _strip_code_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


async def _analyze_site(b64: str, lat: float, lng: float, zoom: int, world_m: float) -> dict:
    if not _llm_key():
        return {}
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"site-{uuid.uuid4()}",
        system_message="You are a site / civil analyst that outputs only valid JSON.",
    ).with_model("openai", "gpt-4o")
    prompt = SITE_PROMPT.format(lat=lat, lng=lng, zoom=zoom, world_m=world_m)
    msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
    raw = await chat.send_message(msg)
    text = raw if isinstance(raw, str) else str(raw)
    cleaned = _strip_code_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if not m:
            return {"summary": "AI analysis unavailable.", "features": []}
        try:
            return json.loads(m.group(0))
        except Exception:
            return {"summary": "AI analysis unavailable.", "features": []}


class SiteCaptureIn(BaseModel):
    lat: float = Field(ge=-85, le=85)
    lng: float = Field(ge=-180, le=180)
    zoom: int = Field(ge=10, le=21, default=18)
    address: str | None = None


class ModelTransformIn(BaseModel):
    x: float = 0.0
    z: float = 0.0
    rotation_deg: float = 0.0
    scale: float = Field(default=1.0, ge=0.1, le=10.0)


class AutoScaleIn(BaseModel):
    blueprint_width_ft: float = Field(gt=0, le=10_000)
    blueprint_depth_ft: float = Field(gt=0, le=10_000)
    reference_label: str | None = Field(default=None, max_length=80)
    reference_feet: float | None = Field(default=None, gt=0, le=10_000)


AUTOSCALE_PROMPT = """You are analyzing a satellite image to detect a building footprint and
estimate its real-world size, so the user can match a 3D model to it.

CONTEXT:
- The image is square and covers approximately {world_m:.1f} meters per side (≈{world_ft:.0f} feet).
- Image origin is top-left; x increases right, y increases down. Normalised coordinates are 0..1.
{ref_block}

TASK:
Find the user-intended building. If they specified a label or reference, prioritise that;
otherwise pick the most prominent / centered building footprint. If the image has multiple buildings,
pick the LARGEST visible rectangle.

Estimate:
  - the building's bounding box in normalised image coords (x0,y0,x1,y1)
  - its actual real-world dimensions in FEET (width and depth in feet)
  - a confidence score 0..1 (0.7+ means you're sure, < 0.4 means very uncertain)

Output STRICT JSON:
{{
  "found": true | false,
  "bbox_norm": [x0, y0, x1, y1],
  "width_ft": <feet>,
  "depth_ft": <feet>,
  "confidence": <0..1>,
  "rationale": "1 sentence why"
}}

Rules:
- If no building is visible, return {{"found": false, "bbox_norm":[0,0,0,0], "width_ft":0, "depth_ft":0, "confidence":0, "rationale":"no building visible"}}.
- Use the field-of-view (≈{world_ft:.0f} ft per side) to estimate feet; a building spanning 10% of the image
  width is about {ten_pct_ft:.0f} ft wide.
- If the user gave a reference dimension, scale your estimate to that hint.
- Output JSON only, no markdown, no commentary."""


async def _detect_building_dimensions(b64: str, world_m: float,
                                      reference_label: str | None,
                                      reference_feet: float | None) -> dict:
    if not _llm_key():
        raise HTTPException(503, "AI not configured on server")
    world_ft = world_m * 3.28083989501
    ref_block = ""
    if reference_label or reference_feet:
        bits = []
        if reference_label:
            bits.append(f"target building/feature: '{reference_label}'")
        if reference_feet:
            bits.append(f"known reference dimension: {reference_feet:.1f} ft (e.g. front wall length)")
        ref_block = "USER HINTS:\n- " + "\n- ".join(bits)
    prompt = AUTOSCALE_PROMPT.format(
        world_m=world_m, world_ft=world_ft,
        ten_pct_ft=world_ft * 0.1,
        ref_block=ref_block,
    )
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"autoscale-{uuid.uuid4()}",
        system_message="You measure buildings from satellite imagery and output strict JSON.",
    ).with_model("openai", "gpt-4o")
    msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
    raw = await asyncio.wait_for(chat.send_message(msg), timeout=45)
    text = raw if isinstance(raw, str) else str(raw)
    cleaned = _strip_code_fence(text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if not m:
            raise HTTPException(502, "AI returned no usable JSON")
        data = json.loads(m.group(0))
    return data


def build_site_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/projects/{project_id}/site")
    async def get_site(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        site = await db.sites.find_one({"project_id": project_id}, {"_id": 0})
        return site or {"project_id": project_id, "captured": False}

    @router.post("/projects/{project_id}/site")
    async def capture_site(project_id: str, payload: SiteCaptureIn, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")

        img_bytes = await _fetch_static_maps(payload.lat, payload.lng, payload.zoom)
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        world_m = world_meters_for_capture(payload.lat, payload.zoom)

        # AI analysis (best-effort — never block the capture itself)
        try:
            analysis = await asyncio.wait_for(
                _analyze_site(b64, payload.lat, payload.lng, payload.zoom, world_m),
                timeout=45,
            )
        except (asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
            logger.warning(f"site AI analysis failed: {exc}")
            analysis = {"summary": "AI analysis unavailable.", "features": []}

        site_doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "captured": True,
            "lat": payload.lat,
            "lng": payload.lng,
            "zoom": payload.zoom,
            "address": payload.address,
            "image_base64": b64,
            "image_size_px": STATIC_SIZE_PX,
            "image_scale": STATIC_SCALE,
            "world_meters": world_m,
            "analysis": analysis,
            "created_at": now_iso(),
        }
        await db.sites.update_one(
            {"project_id": project_id},
            {"$set": site_doc},
            upsert=True,
        )
        return site_doc

    @router.delete("/projects/{project_id}/site")
    async def clear_site(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        await db.sites.delete_one({"project_id": project_id})
        return {"ok": True}

    @router.patch("/projects/{project_id}/site/transform")
    async def set_model_transform(project_id: str, payload: ModelTransformIn,
                                  user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        # Clamp rotation to [0, 360)
        rot = payload.rotation_deg % 360
        scale = max(0.1, min(10.0, payload.scale))
        await db.sites.update_one(
            {"project_id": project_id},
            {"$set": {"model_transform": {
                "x": payload.x,
                "z": payload.z,
                "rotation_deg": rot,
                "scale": scale,
            }}},
            upsert=True,
        )
        return {"ok": True, "model_transform": {
            "x": payload.x, "z": payload.z, "rotation_deg": rot, "scale": scale,
        }}

    @router.post("/projects/{project_id}/site/auto-scale")
    async def auto_scale(project_id: str, payload: AutoScaleIn,
                         user: dict = Depends(get_current_user)):
        """Use GPT-4o vision to estimate the satellite-image building's real-world dimensions,
        then compute a display-scale ratio that maps the user's blueprint AABB onto it."""
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        site = await db.sites.find_one({"project_id": project_id}, {"_id": 0})
        if not site or not site.get("image_base64") or not site.get("world_meters"):
            raise HTTPException(400, "Capture a satellite site first (Pick Site From Map)")
        try:
            detection = await _detect_building_dimensions(
                site["image_base64"],
                float(site["world_meters"]),
                payload.reference_label,
                payload.reference_feet,
            )
        except asyncio.TimeoutError:
            raise HTTPException(504, "AI took too long — try again")
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("auto_scale failed")
            raise HTTPException(502, f"AI error: {str(exc)[:200]}")

        if not detection.get("found"):
            return {
                "applied": False,
                "scale": 1.0,
                "detection": detection,
                "message": detection.get("rationale", "No building detected"),
            }

        # If the user gave a known reference, override AI's feet estimate to that exact value.
        det_w = float(detection.get("width_ft") or 0)
        det_d = float(detection.get("depth_ft") or 0)
        if payload.reference_feet and det_w > 0:
            # User says "the longest side is N ft" — rescale AI estimate to that ratio.
            det_long = max(det_w, det_d)
            if det_long > 0:
                factor = payload.reference_feet / det_long
                det_w *= factor
                det_d *= factor

        # Compute scale ratio against blueprint long side.
        ai_long = max(det_w, det_d)
        bp_long = max(payload.blueprint_width_ft, payload.blueprint_depth_ft)
        if ai_long <= 0 or bp_long <= 0:
            raise HTTPException(422, "Detection or blueprint dimensions invalid")
        ratio = ai_long / bp_long
        ratio = max(0.1, min(10.0, ratio))

        return {
            "applied": True,
            "scale": ratio,
            "detection": {
                "found": True,
                "bbox_norm": detection.get("bbox_norm", []),
                "width_ft": round(det_w, 1),
                "depth_ft": round(det_d, 1),
                "confidence": float(detection.get("confidence") or 0),
                "rationale": detection.get("rationale", ""),
            },
            "blueprint": {
                "width_ft": payload.blueprint_width_ft,
                "depth_ft": payload.blueprint_depth_ft,
            },
            "message": f"Sized to AI-detected building (~{round(det_w,0)} × {round(det_d,0)} ft).",
        }

    return router
