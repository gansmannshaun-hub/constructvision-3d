"""Autonomous blueprint-to-3D pipeline with self-correcting extraction loop.

Endpoint: POST /api/projects/{id}/autonomous/extract
  Body: { "image_base64": "<jpg data>", "filename?": "..." }
  Response:
    {
      "attempts": 1-3,
      "layout": {
        "walls":   [{"id","start":[x,y],"end":[x,y],"thickness_ft"}],
        "excavation_zones": [{"id","polygon":[[x,y],...],"depth_ft","soil_type"}],
        "building_ft": {"w","h"},
        "labels": [{...}]
      },
      "earthwork": {
        "zones": [{
          "id",
          "area_sqft","depth_ft",
          "bank_cy","loose_cy","compacted_cy",
          "swell_multiplier": 1.25, "shrinkage_multiplier": 0.85
        }],
        "totals": {"bank_cy","loose_cy","compacted_cy"}
      },
      "validation_errors": []
    }
  On failure after 3 attempts: HTTP 422 with the last validation errors.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent

import billing as billing_mod

logger = logging.getLogger("autonomous")

# ---- Earthwork constants (industry-standard for common earth) ----
SWELL_MULTIPLIER = 1.25       # bank -> loose (haul) volume
SHRINKAGE_MULTIPLIER = 0.85   # bank -> compacted (fill) volume
CU_FT_PER_CU_YARD = 27.0

# ---- Extraction prompt with strict schema ----
EXTRACTION_PROMPT = """You extract structural layout data from a construction blueprint image.

Return ONLY valid JSON in this EXACT schema (all coordinates in feet, origin top-left):
{
  "walls": [
    {"id": "w1", "start": [x_ft, y_ft], "end": [x_ft, y_ft], "thickness_ft": 0.5}
  ],
  "excavation_zones": [
    {
      "id": "e1",
      "polygon": [[x,y], [x,y], [x,y], ...],
      "depth_ft": 4.0,
      "soil_type": "common_earth" | "clay" | "sand" | "gravel" | "rock"
    }
  ],
  "building_ft": { "w": number, "h": number },
  "labels": [ { "position": [x, y], "text": "..." } ]
}

Hard requirements — your output MUST satisfy ALL of these:
- Every wall has start != end (nonzero length).
- Every wall has thickness_ft > 0 (typical 0.33-1.0 ft).
- Wall endpoints should connect to at least one other wall (form a closed or nearly-closed footprint).
- Each excavation_zone polygon has at least 3 vertices.
- Each excavation_zone has depth_ft > 0.
- building_ft.w and building_ft.h are > 0.
- All numeric values are numbers (never strings).

Return ONLY the JSON. No prose, no markdown fences."""

CORRECTION_PROMPT_TEMPLATE = """Your previous extraction failed validation with these errors:

{errors}

Faulty JSON was:
{faulty_json}

Analyze the image AGAIN and produce a CORRECTED JSON that fixes every listed error. Same strict schema as before. Return ONLY JSON."""


class AutonomousExtractIn(BaseModel):
    image_base64: str = Field(..., min_length=100)
    filename: str | None = None
    max_attempts: int = Field(default=3, ge=1, le=5)


# ---- Validation ----
def validate_layout(layout: Any) -> list[str]:
    """Return a list of human-readable error strings. Empty list = valid."""
    errors: list[str] = []
    if not isinstance(layout, dict):
        return ["Root JSON must be an object."]

    walls = layout.get("walls")
    if not isinstance(walls, list) or not walls:
        errors.append("`walls` must be a non-empty array.")
    else:
        endpoints: list[tuple[float, float]] = []
        for i, w in enumerate(walls):
            if not isinstance(w, dict):
                errors.append(f"walls[{i}] not an object.")
                continue
            s, e = w.get("start"), w.get("end")
            if not (isinstance(s, list) and isinstance(e, list) and len(s) == 2 and len(e) == 2):
                errors.append(f"walls[{i}] missing/malformed start/end [x,y].")
                continue
            try:
                sx, sy = float(s[0]), float(s[1])
                ex, ey = float(e[0]), float(e[1])
            except (TypeError, ValueError):
                errors.append(f"walls[{i}] start/end not numeric.")
                continue
            if abs(sx - ex) < 0.01 and abs(sy - ey) < 0.01:
                errors.append(f"walls[{i}] has zero length (start == end).")
            th = w.get("thickness_ft")
            try:
                thn = float(th) if th is not None else 0
            except (TypeError, ValueError):
                thn = 0
            if thn <= 0:
                errors.append(f"walls[{i}] has zero or missing thickness_ft.")
            endpoints.append((sx, sy))
            endpoints.append((ex, ey))
        # Connectivity: every endpoint should be within 1 ft of at least one other
        if len(endpoints) >= 4:
            unconnected = 0
            for i, p in enumerate(endpoints):
                nearest = min(
                    ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5
                    for j, q in enumerate(endpoints) if j != i
                )
                if nearest > 1.0:
                    unconnected += 1
            if unconnected > 2:
                errors.append(f"{unconnected} wall endpoints do not connect to any neighbor (walls should form a closed footprint).")

    zones = layout.get("excavation_zones")
    if not isinstance(zones, list):
        errors.append("`excavation_zones` must be an array (may be empty).")
    else:
        for i, z in enumerate(zones):
            if not isinstance(z, dict):
                errors.append(f"excavation_zones[{i}] not an object.")
                continue
            poly = z.get("polygon")
            if not isinstance(poly, list) or len(poly) < 3:
                errors.append(f"excavation_zones[{i}] polygon needs at least 3 vertices.")
            depth = z.get("depth_ft")
            try:
                dn = float(depth) if depth is not None else 0
            except (TypeError, ValueError):
                dn = 0
            if dn <= 0:
                errors.append(f"excavation_zones[{i}] missing or zero depth_ft.")

    bft = layout.get("building_ft") or {}
    if not (isinstance(bft, dict) and float(bft.get("w") or 0) > 0 and float(bft.get("h") or 0) > 0):
        errors.append("`building_ft.w` and `building_ft.h` must both be > 0.")

    return errors


# ---- Earthwork math ----
def _polygon_area_sqft(poly: list[list[float]]) -> float:
    """Shoelace formula. Returns absolute area in sq-ft."""
    n = len(poly)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = float(poly[i][0]), float(poly[i][1])
        x2, y2 = float(poly[(i + 1) % n][0]), float(poly[(i + 1) % n][1])
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def compute_earthwork(zones: list[dict]) -> dict:
    """For each excavation zone: bank/loose/compacted cubic yards."""
    out_zones: list[dict] = []
    tot_bank = tot_loose = tot_comp = 0.0
    for z in zones or []:
        area = _polygon_area_sqft(z.get("polygon") or [])
        depth = float(z.get("depth_ft") or 0)
        bank_cf = area * depth
        bank_cy = bank_cf / CU_FT_PER_CU_YARD
        loose_cy = bank_cy * SWELL_MULTIPLIER
        comp_cy = bank_cy * SHRINKAGE_MULTIPLIER
        tot_bank += bank_cy
        tot_loose += loose_cy
        tot_comp += comp_cy
        out_zones.append({
            "id": z.get("id") or f"z{len(out_zones)+1}",
            "area_sqft": round(area, 2),
            "depth_ft": round(depth, 2),
            "soil_type": z.get("soil_type") or "common_earth",
            "bank_cy":  round(bank_cy,  2),
            "loose_cy": round(loose_cy, 2),
            "compacted_cy": round(comp_cy, 2),
            "swell_multiplier": SWELL_MULTIPLIER,
            "shrinkage_multiplier": SHRINKAGE_MULTIPLIER,
        })
    return {
        "zones": out_zones,
        "totals": {
            "bank_cy":  round(tot_bank,  2),
            "loose_cy": round(tot_loose, 2),
            "compacted_cy": round(tot_comp, 2),
        },
    }


# ---- LLM helpers ----
def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY") or ""


def _strip_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.MULTILINE)
    return s.strip()


async def _call_vision(prompt: str, image_b64: str) -> dict:
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"auto-{uuid.uuid4()}",
        system_message="You extract construction blueprint layouts. Output only valid JSON.",
    ).with_model("openai", "gpt-4o")
    resp = await asyncio.wait_for(
        chat.send_message(UserMessage(text=prompt, file_contents=[ImageContent(image_base64=image_b64)])),
        timeout=90,
    )
    raw = resp if isinstance(resp, str) else str(resp)
    cleaned = _strip_fence(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if not m:
            raise ValueError(f"AI returned non-JSON: {raw[:200]}")
        return json.loads(m.group(0))


async def run_autonomous_extract(image_b64: str, max_attempts: int = 3) -> dict:
    """Self-correcting extraction loop. Returns {layout, attempts, validation_errors}
    on success. Raises HTTPException(422) on final failure."""
    if not _llm_key():
        raise HTTPException(500, "EMERGENT_LLM_KEY missing")

    faulty_json: str | None = None
    errors: list[str] = []
    layout: dict | None = None
    attempts_made = 0

    for attempt in range(1, max_attempts + 1):
        attempts_made = attempt
        try:
            if attempt == 1:
                layout = await _call_vision(EXTRACTION_PROMPT, image_b64)
            else:
                correction = CORRECTION_PROMPT_TEMPLATE.format(
                    errors="\n".join(f"- {e}" for e in errors),
                    faulty_json=(faulty_json or "{}")[:2500],
                )
                layout = await _call_vision(correction, image_b64)
        except Exception as e:
            logger.warning(f"Autonomous extract attempt {attempt} raised: {e}")
            errors = [f"LLM call failed: {str(e)[:200]}"]
            faulty_json = "{}"
            continue

        errors = validate_layout(layout)
        if not errors:
            logger.info(f"Autonomous extract validated on attempt {attempt}")
            return {"layout": layout, "attempts": attempt, "validation_errors": []}
        faulty_json = json.dumps(layout)[:5000]
        logger.warning(f"Attempt {attempt} failed validation ({len(errors)} errors); retrying")

    raise HTTPException(
        status_code=422,
        detail={
            "message": f"Autonomous extraction failed after {attempts_made} attempts.",
            "attempts": attempts_made,
            "last_validation_errors": errors,
            "last_layout": layout,
        },
    )


# ---- Router ----
def build_autonomous_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.post("/projects/{project_id}/autonomous/extract")
    async def autonomous_extract(project_id: str, payload: AutonomousExtractIn,
                                 user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        # Gate on the same upload-credit budget as regular document uploads
        # so this expensive multi-attempt vision loop can't burn LLM spend
        # for free-tier users past their quota. Each successful extraction
        # consumes one upload credit — regardless of how many attempts
        # the self-correcting loop actually needed.
        user = await billing_mod.ensure_user_subscription(db, user)
        ok, reason = await billing_mod.can_upload(db, user)
        if not ok:
            raise HTTPException(402, reason or "Upload quota exceeded")
        # 1. Self-correcting extraction
        result = await run_autonomous_extract(payload.image_base64, max_attempts=payload.max_attempts)
        # Only consume the credit once extraction actually succeeded — the
        # LLM helper raises 422 on repeated validation failure.
        await billing_mod.consume_upload_credit(db, user)
        # 2. Earthwork math
        earthwork = compute_earthwork(result["layout"].get("excavation_zones") or [])
        # 3. Persist for the frontend to pick up (attached to the project)
        record = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "attempts": result["attempts"],
            "layout": result["layout"],
            "earthwork": earthwork,
            "filename": payload.filename,
        }
        await db.autonomous_extractions.insert_one({**record, "created_at": __import__("datetime").datetime.utcnow().isoformat()})
        return {
            "attempts": result["attempts"],
            "layout": result["layout"],
            "earthwork": earthwork,
            "validation_errors": [],
        }

    @router.get("/projects/{project_id}/autonomous/latest")
    async def latest_extraction(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        doc = await db.autonomous_extractions.find_one(
            {"project_id": project_id}, {"_id": 0}, sort=[("created_at", -1)]
        )
        return doc or {"empty": True}

    return router
