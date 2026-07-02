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
import math
import os
import re
import uuid
from typing import Optional

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from routes.collab import log_activity, require_role
from routes.documents import (
    ANALYSIS_PROMPT_HEADER, EXISTING_MATERIALS_TEMPLATE_NONE, ANALYSIS_PROMPT_FOOTER,
    _sanitize_fixture, _sanitize_label, _coord, _strip_code_fence,
)
from routes.projects import _create_sheet, _mirror_active_sheet_to_blueprint, get_or_create_blueprint
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

Layout rules:
- Use rectangular rooms aligned to the X/Y axes. NO diagonals.
- Total walls 8-20 (exterior + interior partitions).
- Place the front door on the south wall (lowest Y).
- Each label (BEDROOM 1, KITCHEN, BATH, etc.) goes at the geometric centroid of its room.
- wall_index references the wall a door/window cuts through (0-based).

BUILDING CODE COMPLIANCE — these are REQUIREMENTS, not preferences. Every output MUST:
1. **Egress doors**: minimum door width 2 ft 8 in (2.67 ft / 32"). FRONT door and any
   garage-to-house door at least 3 ft (36"). NEVER generate a door narrower than 2.67.
2. **Bedroom egress**: EVERY bedroom (any label starting with BEDROOM, BR, MASTER, GUEST)
   MUST have at least one window on an EXTERIOR wall. Window width minimum 3 ft.
   (Real net opening is 5.7 sqft IRC R310 — for our simple model: width ≥ 3 ft and place
   on the room's exterior wall.)
3. **Hallway width**: any corridor / hallway labeled CORRIDOR / HALL / HALLWAY must be
   at least 3 ft wide (residential R311.6). Translate that as the wall-to-wall spacing
   in the corridor direction.
4. **Minimum room areas** (IRC R304 + common bath ergonomics):
   - Bedroom ≥ 70 sqft, with smallest dimension ≥ 7 ft
   - Bathroom ≥ 35 sqft, with smallest dimension ≥ 5 ft
   - Kitchen ≥ 50 sqft
   - Living/Family ≥ 120 sqft (one habitable space ≥ 120 sqft is required by R304)
5. **At least one exterior door** clearly labeled or visually on the front (south) wall.
6. **No door on a structural-exterior corner**: doors must sit at least 1 ft from a wall
   endpoint (jamb / framing clearance).
7. **No bedroom window on an interior wall**: bedroom windows MUST cut through an
   exterior wall (a wall on the perimeter of the building rectangle).
8. **Door widths by room**: bedrooms 2.67 ft (32"), baths 2.5 ft (30") — HOWEVER 2.5 ft
   bath doors are only allowed if the bathroom has NO bathtub ≥ 60". For simplicity in
   this model use 2.67 ft for ALL doors so the layout is universally compliant.
9. **Window widths**: 3-5 ft each, place at least 1 per habitable room on an exterior wall.

Self-check before emitting JSON:
- Walk through each wall, door, window — does it satisfy every numbered rule above?
- If a door width or room dimension would violate a rule, ADJUST the layout BEFORE outputting
  (resize the room, move the door, etc.). Do not output a knowingly non-compliant plan.

Output JSON only. No markdown fences, no commentary.
"""


class FloorplanPromptIn(BaseModel):
    prompt: str = Field(min_length=4, max_length=600)
    replace: bool = Field(default=True, description="If true, the generated layout replaces existing walls. If false, appends.")


class TraceBlueprintIn(BaseModel):
    document_id: str
    page_index: int = Field(default=0, ge=0, le=19)
    replace: bool = Field(default=True, description="If true, blueprint geometry is replaced with the traced result. If false, appended.")


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


# ============================ Compliance check (server-side mirror) ============================
# Mirrors the rule constants from /app/frontend/src/lib/compliance.js so the AI
# output is validated server-side before being persisted. Surfaces warnings to
# the UI AND auto-retries once with violation feedback when critical issues exist.

_HALLWAY_KEYWORDS = ("corridor", "hall", "hallway", "passage")
_BEDROOM_KEYWORDS = ("bed", "br ", "bedroom", "master", "guest")
_BATH_KEYWORDS = ("bath", "wc", "restroom", "toilet")
_STAIR_KEYWORDS = ("stair", "stairs", "staircase", "stairway")
_SMOKE_KEYWORDS = ("smoke", "alarm", "detector", "co alarm")

_MIN_DOOR_WIDTH = 2.67       # 32"
_MIN_FRONT_DOOR = 3.0        # 36"
_MIN_WINDOW_WIDTH = 3.0      # 36" (IRC bedroom egress minimum width is ~3 ft)
_MIN_BEDROOM_AREA = 70       # sqft
_MIN_BATH_AREA = 35          # sqft
_MIN_DOOR_FROM_CORNER = 1.0  # 12" jamb framing clearance


def _label_matches(label_text: str, keywords) -> bool:
    t = (label_text or "").lower()
    return any(k in t for k in keywords)


def _wall_len(w: dict) -> float:
    s = w.get("start") or [0, 0]
    e = w.get("end") or [0, 0]
    return math.hypot(e[0] - s[0], e[1] - s[1])


def _is_exterior_wall(wall_idx: int, walls: list[dict], building: dict) -> bool:
    """A wall is 'exterior' if it sits on the building rectangle perimeter."""
    if not building or wall_idx < 0 or wall_idx >= len(walls):
        return False
    bw, bh = float(building.get("w", 0)), float(building.get("h", 0))
    w = walls[wall_idx]
    s, e = w.get("start") or [0, 0], w.get("end") or [0, 0]
    tol = 0.5
    # Check if both endpoints lie on the same building edge
    on_left = abs(s[0]) < tol and abs(e[0]) < tol
    on_right = abs(s[0] - bw) < tol and abs(e[0] - bw) < tol
    on_bottom = abs(s[1]) < tol and abs(e[1]) < tol
    on_top = abs(s[1] - bh) < tol and abs(e[1] - bh) < tol
    return on_left or on_right or on_bottom or on_top


def _check_compliance(plan: dict) -> list[dict]:
    """Run building-code rules over a sanitized floorplan dict.
    Returns a list of {severity, code, message} entries (empty if clean)."""
    warnings: list[dict] = []
    walls = plan.get("walls") or []
    doors = plan.get("doors") or []
    windows = plan.get("windows") or []
    labels = plan.get("labels") or []
    building = plan.get("building") or {}

    # 1. Door widths
    for i, d in enumerate(doors):
        width = float(d.get("width") or 0)
        if width < _MIN_DOOR_WIDTH:
            warnings.append({
                "severity": "critical",
                "code": "IRC-R311.2",
                "message": f"Door #{i + 1} width {width:.2f} ft is below the 2'-8\" (2.67 ft) minimum egress width.",
            })

    # 2. Door clearance from wall corners
    for i, d in enumerate(doors):
        wi = int(d.get("wall_index", -1))
        if not (0 <= wi < len(walls)):
            continue
        w = walls[wi]
        s = w.get("start") or [0, 0]
        e = w.get("end") or [0, 0]
        pos = d.get("position") or [0, 0]
        # distance from door position to each wall endpoint
        d1 = math.hypot(pos[0] - s[0], pos[1] - s[1])
        d2 = math.hypot(pos[0] - e[0], pos[1] - e[1])
        if min(d1, d2) < _MIN_DOOR_FROM_CORNER:
            warnings.append({
                "severity": "warn",
                "code": "FRAMING-CORNER",
                "message": f"Door #{i + 1} is within 12\" of a wall corner — relocate for jamb framing.",
            })

    # 3. Bedroom egress windows on exterior walls
    bedroom_labels = [lb for lb in labels if _label_matches(lb.get("text", ""), _BEDROOM_KEYWORDS)]
    for lb in bedroom_labels:
        # Find any window within room radius placed on an exterior wall
        lx, ly = (lb.get("position") or [0, 0])[:2]
        radius = 20  # search radius in ft
        found = False
        for win in windows:
            wp = win.get("position") or [0, 0]
            if math.hypot(wp[0] - lx, wp[1] - ly) > radius:
                continue
            wi = int(win.get("wall_index", -1))
            if not _is_exterior_wall(wi, walls, building):
                continue
            if float(win.get("width") or 0) >= _MIN_WINDOW_WIDTH:
                found = True
                break
        if not found:
            warnings.append({
                "severity": "critical",
                "code": "IRC-R310",
                "message": f"Bedroom '{lb.get('text','BEDROOM')}' has no compliant egress window (≥ 3 ft wide on an exterior wall).",
            })

    # 4. Front door exists & is ≥ 36"
    if doors:
        front_doors = [d for d in doors if (d.get("position") or [0, 0])[1] < 3.0]
        if not front_doors:
            # fall back to lowest-Y door
            front_doors = [min(doors, key=lambda d: (d.get("position") or [0, 0])[1])]
        max_front_w = max(float(d.get("width") or 0) for d in front_doors)
        if max_front_w < _MIN_FRONT_DOOR:
            warnings.append({
                "severity": "critical",
                "code": "IBC-1010.1.1",
                "message": f"Front door width {max_front_w:.2f} ft is below the 36\" (3 ft) minimum.",
            })
    else:
        warnings.append({
            "severity": "critical",
            "code": "IBC-EGRESS",
            "message": "No exterior door found — at least one egress door is required.",
        })

    # 5. Minimum living room area (one habitable space ≥ 120 sqft per IRC R304)
    has_living_120 = False
    living_labels = [lb for lb in labels if "living" in (lb.get("text", "").lower())
                     or "family" in (lb.get("text", "").lower())
                     or "great" in (lb.get("text", "").lower())]
    if living_labels and building:
        # heuristic: if a living-area label exists AND the smaller building dimension >= 12 ft, OK
        if min(float(building.get("w", 0)), float(building.get("h", 0))) >= 12:
            has_living_120 = True
    if not has_living_120:
        warnings.append({
            "severity": "warn",
            "code": "IRC-R304.1",
            "message": "No living/family room with min 120 sqft detected — IRC requires one habitable space ≥ 120 sqft.",
        })

    # 6. Smoke alarms — IRC R314.3 requires one in each bedroom + one outside
    # each sleeping area. We can't enforce physical placement, but we can
    # confirm the count of SMOKE labels matches expected coverage.
    smoke_labels = [lb for lb in labels if _label_matches(lb.get("text", ""), _SMOKE_KEYWORDS)]
    expected_smokes = max(0, len(bedroom_labels))
    if expected_smokes > 0 and len(smoke_labels) < expected_smokes:
        warnings.append({
            "severity": "warn",
            "code": "IRC-R314.3",
            "message": (f"IRC requires a smoke alarm in each of {expected_smokes} bedroom(s) plus "
                        f"one outside each sleeping area — only {len(smoke_labels)} 'SMOKE' label(s) placed."),
        })

    # 7. Stair sanity — if any STAIR label exists, hint that R311.7 rise/run
    # (max 7-3/4" rise, min 10" run) and a 36" min stair width must be observed
    # since the 2D model can't enforce 3D geometry directly.
    stair_labels = [lb for lb in labels if _label_matches(lb.get("text", ""), _STAIR_KEYWORDS)]
    for lb in stair_labels:
        warnings.append({
            "severity": "info",
            "code": "IRC-R311.7",
            "message": (f"Stair '{lb.get('text','STAIR')}' detected — confirm max rise 7-3/4\", "
                        f"min run 10\", min width 36\", and 6'-8\" headroom in 3D detailing."),
        })

    return warnings


def _critical_count(warnings: list[dict]) -> int:
    return sum(1 for w in warnings if w.get("severity") == "critical")


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

        # Code-compliance validation. If the first generation has CRITICAL violations,
        # re-prompt the AI once with the specific violations listed and accept whichever
        # result has fewer criticals.
        compliance = _check_compliance(plan)
        retried = False
        if _critical_count(compliance) > 0:
            retried = True
            critical_msgs = [w["message"] for w in compliance if w["severity"] == "critical"]
            retry_prompt = (
                payload.prompt
                + "\n\nIMPORTANT — fix these CODE VIOLATIONS in your next attempt: "
                + " | ".join(critical_msgs[:6])
                + "\nRespect every numbered building-code rule from the system instructions. Output JSON only."
            )
            try:
                raw2 = await _gen_floorplan(retry_prompt)
                plan2 = _sanitize_floorplan(raw2)
                if plan2["walls"]:
                    compliance2 = _check_compliance(plan2)
                    if _critical_count(compliance2) < _critical_count(compliance):
                        plan = plan2
                        compliance = compliance2
                        logger.info("ai_floorplan: retry reduced criticals %d -> %d",
                                    _critical_count(compliance), _critical_count(compliance2))
            except Exception as exc:  # noqa: BLE001
                logger.warning("ai_floorplan retry failed: %s", exc)

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

        # Re-run compliance on the MERGED final blueprint when append mode
        # (replace=False) merged new geometry into an existing layout.
        if not payload.replace:
            merged = {
                "walls": new_walls,
                "doors": new_doors,
                "windows": new_windows,
                "labels": new_labels,
                "building": plan.get("building"),
            }
            compliance = _check_compliance(merged)
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
            "compliance": {
                "warnings": compliance,
                "critical_count": _critical_count(compliance),
                "warn_count": sum(1 for w in compliance if w.get("severity") == "warn"),
                "retried": retried,
                "clean": len(compliance) == 0,
            },
        }

    # ---------- AI Blueprint Tracer ----------
    @router.post("/projects/{project_id}/ai/trace-blueprint")
    async def trace_blueprint(project_id: str, payload: TraceBlueprintIn,
                              user: dict = Depends(get_current_user)):
        """Re-analyze a previously uploaded document with GPT-4o Vision in
        exact-tracing mode and merge the resulting walls/doors/windows/labels/
        fixtures into the project blueprint."""
        await require_role(db, project_id, user, {"owner", "pm", "estimator"})

        # Validate document FIRST so a missing/typo document_id doesn't burn credits.
        doc = await db.documents.find_one({"id": payload.document_id, "project_id": project_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Document not found")
        b64 = doc.get("image_base64")
        if not b64:
            raise HTTPException(422, "This document has no cached image for re-tracing.")

        # Then enforce add-on credit for Free/Pro users (Studio bypasses).
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

        if not _llm_key():
            raise HTTPException(503, "LLM key unavailable")

        # Call GPT-4o Vision with the exact-tracing analysis prompt.
        chat = LlmChat(
            api_key=_llm_key(),
            session_id=f"trace-{uuid.uuid4()}",
            system_message="You are a construction blueprint tracing expert. Output valid JSON only.",
        ).with_model("openai", "gpt-4o")
        prompt = (
            ANALYSIS_PROMPT_HEADER
            + "\n\n"
            + EXISTING_MATERIALS_TEMPLATE_NONE  # tracing endpoint focuses on geometry, not materials dedup
            + ANALYSIS_PROMPT_FOOTER
        )
        try:
            msg = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
            raw = await asyncio.wait_for(chat.send_message(msg), timeout=90)
        except asyncio.TimeoutError:
            raise HTTPException(504, "AI tracer timed out — try again")
        except Exception as exc:  # noqa: BLE001
            logger.exception("trace_blueprint AI call failed")
            raise HTTPException(502, f"AI error: {str(exc)[:200]}")

        text = _strip_code_fence(raw if isinstance(raw, str) else str(raw))
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            m = re.search(r"\{[\s\S]*\}", text)
            if not m:
                raise HTTPException(502, "AI returned non-JSON")
            data = json.loads(m.group(0))

        # Sanitize walls / doors / windows / labels / fixtures.
        walls_out: list[dict] = []
        for w in (data.get("walls") or [])[:120]:
            s, e = _coord(w.get("start")), _coord(w.get("end"))
            if s and e:
                walls_out.append({
                    "id": str(uuid.uuid4()), "start": s, "end": e,
                    "thickness": float(w.get("thickness") or 0.5),
                })
        doors_out: list[dict] = []
        for d in (data.get("doors") or [])[:60]:
            pos = _coord(d.get("position"))
            if pos:
                try:
                    wi = int(d.get("wall_index") or 0)
                except (TypeError, ValueError):
                    wi = 0
                doors_out.append({
                    "id": str(uuid.uuid4()), "position": pos,
                    "width": float(d.get("width") or 3.0),
                    "wall_index": max(0, min(wi, len(walls_out) - 1)) if walls_out else 0,
                })
        windows_out: list[dict] = []
        for w in (data.get("windows") or [])[:60]:
            pos = _coord(w.get("position"))
            if pos:
                try:
                    wi = int(w.get("wall_index") or 0)
                except (TypeError, ValueError):
                    wi = 0
                windows_out.append({
                    "id": str(uuid.uuid4()), "position": pos,
                    "width": float(w.get("width") or 4.0),
                    "wall_index": max(0, min(wi, len(walls_out) - 1)) if walls_out else 0,
                })
        labels_out: list[dict] = []
        for lbl in (data.get("labels") or [])[:80]:
            cl = _sanitize_label(lbl)
            if cl:
                labels_out.append(cl)
        fixtures_out: list[dict] = []
        for fx in (data.get("fixtures") or [])[:120]:
            cf = _sanitize_fixture(fx)
            if cf:
                fixtures_out.append(cf)

        if not walls_out:
            raise HTTPException(422, "AI tracer returned no walls — the image may not be a clear floor plan")

        bf = data.get("building_ft") or {}
        try:
            bw, bh = float(bf.get("w") or 0), float(bf.get("h") or 0)
            building_ft = {"w": bw, "h": bh} if bw > 0 and bh > 0 else None
        except (TypeError, ValueError):
            building_ft = None
        scale_confidence = str(data.get("scale_confidence") or "medium")

        # Baseline blueprint + sheets.
        await get_or_create_blueprint(db, project_id)
        sheet_name = (doc.get("filename") or "Traced Sheet")[:80]

        if payload.replace:
            # Create a fresh sheet dedicated to this trace and make it active.
            floor_level = await db.blueprint_sheets.count_documents({"project_id": project_id})
            new_sheet = await _create_sheet(
                db, project_id,
                name=sheet_name,
                floor_level=floor_level,
                source_document_id=payload.document_id,
                geometry={
                    "walls":    walls_out,
                    "doors":    doors_out,
                    "windows":  windows_out,
                    "labels":   labels_out,
                    "fixtures": fixtures_out,
                },
                building_ft=building_ft,
                scale_confidence=scale_confidence,
            )
            await _mirror_active_sheet_to_blueprint(db, project_id, new_sheet["id"])
            result_sheet_id = new_sheet["id"]
        else:
            # Append to the currently active sheet (legacy "append" behavior).
            bp_doc = await db.blueprints.find_one({"project_id": project_id}, {"_id": 0}) or {}
            active_id = bp_doc.get("active_sheet_id")
            active_sheet = await db.blueprint_sheets.find_one(
                {"id": active_id, "project_id": project_id}, {"_id": 0}
            )
            if not active_sheet:
                raise HTTPException(500, "No active sheet to append to")
            offset = len(active_sheet.get("walls") or [])
            shifted_doors = [{**d, "wall_index": (d.get("wall_index") or 0) + offset} for d in doors_out]
            shifted_windows = [{**w, "wall_index": (w.get("wall_index") or 0) + offset} for w in windows_out]
            await db.blueprint_sheets.update_one(
                {"id": active_id, "project_id": project_id},
                {"$set": {
                    "walls":    (active_sheet.get("walls") or []) + walls_out,
                    "doors":    (active_sheet.get("doors") or []) + shifted_doors,
                    "windows":  (active_sheet.get("windows") or []) + shifted_windows,
                    "labels":   (active_sheet.get("labels") or []) + labels_out,
                    "fixtures": (active_sheet.get("fixtures") or []) + fixtures_out,
                    "updated_at": now_iso(),
                }},
            )
            await _mirror_active_sheet_to_blueprint(db, project_id, active_id)
            result_sheet_id = active_id

        await log_activity(db, project_id, user["email"], "ai.blueprint_traced",
                           target_type="document", target_id=payload.document_id,
                           target_name=doc.get("filename") or "blueprint")
        return {
            "summary": str(data.get("summary") or "")[:400],
            "doc_type": data.get("doc_type"),
            "building_ft": building_ft,
            "scale_confidence": scale_confidence,
            "sheet_id": result_sheet_id,
            "counts": {
                "walls": len(walls_out),
                "doors": len(doors_out),
                "windows": len(windows_out),
                "labels": len(labels_out),
                "fixtures": len(fixtures_out),
            },
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
