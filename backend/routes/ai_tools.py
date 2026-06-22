"""AI-assisted CAD tools and Schedule/Gantt generator.

- POST /api/projects/{id}/ai/floorplan
    GPT-4o text prompt -> walls/doors/windows JSON sketched on a fresh layout.
- POST /api/projects/{id}/ai/schedule
    Compute a forward-pass schedule for the 15 construction phases with
    duration heuristics keyed off building square footage and crew size.
    Returns Gantt-ready data (start/end day, duration, dependencies, critical
    path flags).

Compliance checks (IBC corridors, doors, ceilings, egress) live on the
frontend in /app/frontend/src/lib/compliance.js — pure, deterministic logic
that runs live as the CAD editor changes.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from typing import Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from routes.collab import log_activity, require_role
from billing import consume_addon_credit, ensure_user_subscription
from utils import now_iso

logger = logging.getLogger("ai-tools")


# ============================ AI Floorplan ============================

FLOORPLAN_PROMPT = """You are a residential architect drafting a SIMPLE rectangular floor plan
from a natural-language brief. Output STRICT JSON only.

Coordinate system:
- 1 unit = 1 foot
- Origin (0,0) at the bottom-left of the lot.
- Axes: +x = east, +y = north.

Schema:
{
  "summary": "1-sentence layout description",
  "lot": {"w": 40, "h": 80},
  "building": {"w": 30, "h": 40},
  "walls": [{"start": [x1,y1], "end": [x2,y2], "thickness": 0.5}],
  "doors": [{"position": [x,y], "width": 3, "wall_index": 0}],
  "windows": [{"position": [x,y], "width": 4, "wall_index": 0}],
  "labels": [{"position": [x,y], "text": "BEDROOM 1"}]
}

Rules:
- Use rectangular rooms aligned to the X/Y axes. NO diagonals.
- Total walls 8-20 (exterior + interior partitions).
- Place the front door on the south wall (lowest Y).
- Door widths: bedrooms 2.67 ft (32"), baths 2.5 ft (30"), front/garage 3 ft (36").
- Window widths: 3-5 ft each, place 1 per habitable room on an exterior wall.
- Each label (BEDROOM 1, KITCHEN, BATH, etc.) goes at the geometric centroid of its room.
- wall_index references the wall a door/window cuts through (0-based).
- Output JSON only. No markdown fences, no commentary.
"""


class FloorplanPromptIn(BaseModel):
    prompt: str = Field(min_length=4, max_length=600)
    replace: bool = Field(default=True, description="If true, the generated layout replaces existing walls. If false, appends.")


# ============================ Schedule / Gantt ============================

# 15 construction phases — must match sceneBuilder.js PHASES.
# `crew_factor` = how many days a 4-person crew needs per 1000 sqft.
# `depends_on`  = ids of prerequisite phases (forward-pass scheduling).
PHASE_PLAN = [
    {"id": 0,  "label": "Site Prep",        "crew_days_per_ksf": 1.5, "depends_on": []},
    {"id": 1,  "label": "Underground Util", "crew_days_per_ksf": 2.0, "depends_on": [0]},
    {"id": 2,  "label": "Septic / Sewer",   "crew_days_per_ksf": 1.5, "depends_on": [0]},
    {"id": 3,  "label": "Foundation",       "crew_days_per_ksf": 3.5, "depends_on": [1, 2]},
    {"id": 4,  "label": "Columns",          "crew_days_per_ksf": 1.0, "depends_on": [3]},
    {"id": 5,  "label": "Frame",            "crew_days_per_ksf": 4.5, "depends_on": [4]},
    {"id": 6,  "label": "Plumbing R-In",    "crew_days_per_ksf": 2.5, "depends_on": [5]},
    {"id": 7,  "label": "Electrical R-In",  "crew_days_per_ksf": 2.5, "depends_on": [5]},
    {"id": 8,  "label": "Wall Girts",       "crew_days_per_ksf": 1.5, "depends_on": [5]},
    {"id": 9,  "label": "Roof Purlins",     "crew_days_per_ksf": 1.5, "depends_on": [5]},
    {"id": 10, "label": "Roof Sheet",       "crew_days_per_ksf": 2.0, "depends_on": [9]},
    {"id": 11, "label": "Wall Sheet",       "crew_days_per_ksf": 2.0, "depends_on": [6, 7, 8]},
    {"id": 12, "label": "Doors / Windows",  "crew_days_per_ksf": 1.5, "depends_on": [11]},
    {"id": 13, "label": "Trim / Flashing",  "crew_days_per_ksf": 2.0, "depends_on": [10, 12]},
    {"id": 14, "label": "Finished",         "crew_days_per_ksf": 5.0, "depends_on": [13]},
]


class ScheduleConfigIn(BaseModel):
    sqft: float = Field(default=1500, ge=100, le=200_000)
    crew_size: int = Field(default=4, ge=1, le=50)
    start_date: Optional[str] = None  # YYYY-MM-DD; defaults to today on the client


def _round(v: float, p: int = 2) -> float:
    return float(f"{v:.{p}f}")


def compute_schedule(sqft: float, crew_size: int) -> dict:
    """Forward-pass critical-path schedule.

    Days per phase = crew_days_per_ksf * (sqft/1000) * (4/crew_size), floored at 1.
    A phase starts at max(predecessor end). Critical path = nodes whose late
    finish == early finish (computed via backward-pass).
    """
    ksf = max(sqft, 100) / 1000.0
    crew_mult = 4.0 / max(crew_size, 1)

    # forward
    phases = []
    for p in PHASE_PLAN:
        dur = max(1.0, p["crew_days_per_ksf"] * ksf * crew_mult)
        deps = p["depends_on"]
        start = 0.0 if not deps else max(phases[d]["end_day"] for d in deps)
        phases.append({
            "id": p["id"],
            "label": p["label"],
            "depends_on": deps,
            "duration_days": _round(dur, 2),
            "start_day": _round(start, 2),
            "end_day": _round(start + dur, 2),
        })

    project_end = max(ph["end_day"] for ph in phases)

    # backward — compute late_finish, late_start
    late = {ph["id"]: project_end for ph in phases}
    # build successor index
    successors: dict[int, list[int]] = {ph["id"]: [] for ph in phases}
    for p in PHASE_PLAN:
        for d in p["depends_on"]:
            successors[d].append(p["id"])

    for ph in reversed(phases):
        succs = successors[ph["id"]]
        if succs:
            late[ph["id"]] = min(phases[s]["start_day"] for s in succs)  # late finish
        # else: terminal node — stays at project_end

    # mark critical: slack = late_finish - early_finish ~ 0
    for ph in phases:
        slack = late[ph["id"]] - ph["end_day"]
        ph["late_finish"] = _round(late[ph["id"]], 2)
        ph["slack_days"] = _round(slack, 2)
        ph["critical"] = abs(slack) < 0.01

    return {
        "sqft": sqft,
        "crew_size": crew_size,
        "phases": phases,
        "project_duration_days": _round(project_end, 2),
        "project_duration_weeks": _round(project_end / 5.0, 1),  # 5-day work week
        "critical_path": [p["id"] for p in phases if p["critical"]],
    }


# ============================ Router ============================

def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


def _strip_fence(t: str) -> str:
    t = t.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
        t = re.sub(r"\n?```$", "", t)
    return t.strip()


async def _gen_floorplan(prompt: str) -> dict:
    if not _llm_key():
        raise HTTPException(503, "LLM key unavailable")
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"plan-{uuid.uuid4()}",
        system_message="Residential floor-plan generator. Output strict JSON only.",
    ).with_model("openai", "gpt-4o")
    msg = UserMessage(text=FLOORPLAN_PROMPT + "\n\nBRIEF:\n" + prompt)
    raw = await asyncio.wait_for(chat.send_message(msg), timeout=60)
    text = _strip_fence(raw if isinstance(raw, str) else str(raw))
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            raise HTTPException(502, "AI returned non-JSON")
        return json.loads(m.group(0))


def _sanitize_floorplan(data: dict) -> dict:
    """Coerce GPT output into the strict wall/door/window schema used everywhere."""
    walls_raw = data.get("walls") or []
    walls = []
    for w in walls_raw[:60]:
        s = w.get("start") or []
        e = w.get("end") or []
        if len(s) != 2 or len(e) != 2:
            continue
        try:
            walls.append({
                "start": [float(s[0]), float(s[1])],
                "end":   [float(e[0]), float(e[1])],
                "thickness": float(w.get("thickness") or 0.5),
            })
        except (TypeError, ValueError):
            continue

    doors = []
    for d in (data.get("doors") or [])[:40]:
        pos = d.get("position") or []
        if len(pos) != 2:
            continue
        try:
            doors.append({
                "position": [float(pos[0]), float(pos[1])],
                "width": float(d.get("width") or 3.0),
                "wall_index": int(d.get("wall_index") or 0),
            })
        except (TypeError, ValueError):
            continue

    windows = []
    for w in (data.get("windows") or [])[:40]:
        pos = w.get("position") or []
        if len(pos) != 2:
            continue
        try:
            windows.append({
                "position": [float(pos[0]), float(pos[1])],
                "width": float(w.get("width") or 4.0),
                "wall_index": int(w.get("wall_index") or 0),
            })
        except (TypeError, ValueError):
            continue

    labels = []
    for lbl in (data.get("labels") or [])[:30]:
        pos = lbl.get("position") or []
        text = (lbl.get("text") or "").strip()[:60]
        if len(pos) != 2 or not text:
            continue
        try:
            labels.append({
                "position": [float(pos[0]), float(pos[1])],
                "text": text,
            })
        except (TypeError, ValueError):
            continue

    return {
        "summary": (data.get("summary") or "")[:200],
        "lot": data.get("lot") or {},
        "building": data.get("building") or {},
        "walls": walls,
        "doors": doors,
        "windows": windows,
        "labels": labels,
    }


def build_ai_tools_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    # ---------- AI floorplan ----------
    @router.post("/projects/{project_id}/ai/floorplan")
    async def ai_floorplan(project_id: str, payload: FloorplanPromptIn, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator"})
        # Enforce add-on credit for Free/Pro users; Studio bypasses.
        full_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        full_user = await ensure_user_subscription(db, full_user)
        sub_tier = (full_user.get("subscription") or {}).get("tier")
        if sub_tier != "studio":
            ok = await consume_addon_credit(db, full_user, "ai_floorplan_credits")
            if not ok:
                raise HTTPException(402, {
                    "code": "floorplan_credit_required",
                    "message": "Out of AI Floorplan credits. Buy the 25-pack on the Billing page (or upgrade to Studio for unlimited).",
                })
        try:
            raw = await _gen_floorplan(payload.prompt)
        except asyncio.TimeoutError:
            raise HTTPException(504, "AI timed out — try a shorter prompt")
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("ai_floorplan failed")
            raise HTTPException(502, f"AI error: {str(exc)[:200]}")

        plan = _sanitize_floorplan(raw)
        if not plan["walls"]:
            raise HTTPException(422, "AI returned no walls — refine your prompt")

        # Merge / replace into the blueprint
        bp = await db.blueprints.find_one({"project_id": project_id}, {"_id": 0}) or {}
        existing_walls = [] if payload.replace else (bp.get("walls") or [])
        existing_doors = [] if payload.replace else (bp.get("doors") or [])
        existing_windows = [] if payload.replace else (bp.get("windows") or [])
        existing_labels = [] if payload.replace else (bp.get("labels") or [])

        new_walls = existing_walls + plan["walls"]
        # remap door / window wall_index when appending
        offset = len(existing_walls)

        def _shift(item: dict, key: str = "wall_index") -> dict:
            return {**item, key: item.get(key, 0) + offset}

        new_doors = existing_doors + [_shift(d) for d in plan["doors"]]
        new_windows = existing_windows + [_shift(w) for w in plan["windows"]]
        new_labels = existing_labels + plan["labels"]

        await db.blueprints.update_one(
            {"project_id": project_id},
            {"$set": {
                "walls": new_walls,
                "doors": new_doors,
                "windows": new_windows,
                "labels": new_labels,
                "updated_at": now_iso(),
            }},
            upsert=True,
        )
        await log_activity(db, project_id, user["email"], "ai.floorplan_generated",
                           target_type="blueprint", target_id=project_id,
                           target_name=payload.prompt[:80])
        return {
            "summary": plan["summary"],
            "lot": plan["lot"],
            "building": plan["building"],
            "counts": {"walls": len(plan["walls"]),
                       "doors": len(plan["doors"]),
                       "windows": len(plan["windows"]),
                       "labels": len(plan["labels"])},
            "replaced": payload.replace,
        }

    # ---------- Schedule / Gantt ----------
    @router.post("/projects/{project_id}/ai/schedule")
    async def schedule(project_id: str, payload: ScheduleConfigIn,
                       user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator", "viewer"})
        result = compute_schedule(payload.sqft, payload.crew_size)
        # Save snapshot for reproducibility
        snap = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "sqft": payload.sqft,
            "crew_size": payload.crew_size,
            "start_date": payload.start_date or "",
            "result": result,
            "created_by": user["email"],
            "created_at": now_iso(),
        }
        await db.schedules.update_one(
            {"project_id": project_id},
            {"$set": snap},
            upsert=True,
        )
        return result

    @router.get("/projects/{project_id}/ai/schedule")
    async def get_schedule(project_id: str, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator", "viewer"})
        snap = await db.schedules.find_one({"project_id": project_id}, {"_id": 0})
        return snap or {"project_id": project_id, "saved": False}

    return router
