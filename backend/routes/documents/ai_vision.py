"""GPT-4o Vision prompts + wrapper calls for blueprint analysis.

Two entry points:
- `_analyze_image_with_ai(b64, existing_materials)` → primary per-page
  analysis returning the full doc-type + geometry + materials JSON.
- `_analyze_view_structure(b64, view_type)` → targeted second pass for
  elevations / roof plans returning 3D-assembly data.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage

from .sanitize import (
    _format_existing_materials_for_prompt,
    _strip_code_fence,
)


logger = logging.getLogger("documents.ai_vision")


def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


ANALYSIS_PROMPT_HEADER = """You are an expert architectural CAD engineer.
Your mission: TRACE THE UPLOADED BLUEPRINT EXACTLY. Do not invent, embellish,
or "improve" the layout. If the user uploaded a floor plan, reproduce its walls,
doors, windows, room labels, and fixtures with the same proportions and positions
as the source drawing.

Return a STRICT JSON response — no prose, no markdown, only valid JSON — with this exact schema:

{
  "doc_type": "floor_plan" | "blueprint" | "site_plan" | "elevation" | "framing_plan" | "roof_plan" | "sheathing_plan" | "electrical_plan" | "plumbing_plan" | "hvac_plan" | "foundation_plan" | "detail" | "photo" | "other",
  "summary": "2-3 sentence summary of what's in the image",
  "building_ft": {"w": 40.0, "h": 30.0},
  "scale_confidence": "high" | "medium" | "low",
  "rooms": [{"name": "Living Room", "approx_area_sqft": 320}],
  "structural_notes": ["..."],
  "materials": [
    {"name": "2x4 Lumber", "category": "Framing", "quantity": 50, "unit": "pcs", "unit_price_usd": 8.5, "labor_unit_price_usd": 3.2, "dedup": "new"},
    {"name": "Concrete (slab)", "category": "Structural", "quantity": 4, "unit": "cu yd", "unit_price_usd": 165.0, "labor_unit_price_usd": 60.0, "dedup": "merge", "ref": 2, "rationale": "Additional wing of the same slab seen in doc #2"}
  ],
  "walls": [{"start": [x, y], "end": [x, y], "thickness": 0.5}],
  "doors": [{"position": [x, y], "width": 3, "wall_index": 0}],
  "windows": [{"position": [x, y], "width": 4, "wall_index": 0}],
  "labels": [{"position": [x, y], "text": "MASTER BEDROOM"}],
  "fixtures": [{"kind": "toilet", "position": [x, y], "rotation_deg": 0, "size": [2, 2.5]}]
}

DOC_TYPE CLASSIFICATION (this is critical — the frontend routes on this field):
Classify by CONTENT, not by MEDIUM. A phone photo of a printed drawing keeps
the drawing's content classification.

- `floor_plan`      = Top-down view of interior ROOM LAYOUT with walls, doors,
                      windows, room labels. Hand-drawn sketches, phone photos
                      of printed plans, CAD screenshots. TRACE walls.
- `blueprint`       = Any formal architectural sheet with room walls (like
                      `floor_plan` but professionally drafted). TRACE walls.
- `site_plan`       = Top-down of the LOT — building footprint, driveway,
                      setbacks. TRACE the footprint.
- `foundation_plan` = Top-down structural footings / slab / stem-wall layout.
                      TRACE the foundation walls only, NOT room partitions.
- `framing_plan`    = Top-down structural joists / rafters / studs / trusses.
                      Do NOT trace walls — return EMPTY walls/doors/windows.
                      DO extract structural_notes and materials (joist size,
                      spacing, span). This is a construction detail, not a
                      floor plan.
- `roof_plan`       = Top-down of roof surfaces / slopes / ridges. EMPTY walls.
                      Notes: pitch, materials, drainage.
- `sheathing_plan`  = Panel / sheeting layout for walls or roof. EMPTY walls.
                      Return materials + structural_notes only.
- `elevation`       = Exterior side view. EMPTY walls/doors/windows.
                      Materials + labels only.
- `electrical_plan` / `plumbing_plan` / `hvac_plan` = MEP overlays.
                      EMPTY walls/doors/windows. Return system materials only.
- `detail`          = Small-scale construction detail (wall section, corner
                      detail, connection detail). EMPTY walls. Materials only.
- `photo`           = Camera photo of an actual site / building — NOT a photo
                      of a drawing. EMPTY walls. Materials from what's visible.
- `other`           = Anything else (spec sheet, invoice, contract).

If in doubt between `photo` and `floor_plan`/`blueprint`, prefer the drawing
classification — under-tracing is much worse for the user than over-tracing.
When you see repeated parallel lines with joist/truss/rafter callouts, that is
almost always a `framing_plan` / `roof_plan` — do NOT trace those as walls.

COORDINATE SYSTEM (this is critical — read carefully):
- ALL coordinates are in REAL WORLD FEET.
- Origin (0,0) is the TOP-LEFT corner of the source drawing/image (SVG-style axis).
- +x = right, +y = down. Do NOT flip Y.
- `building_ft.w` / `building_ft.h` is the overall building bounding box width and height in feet.
- Every wall/door/window/label/fixture position MUST fall inside [0, building_ft.w] × [0, building_ft.h].
- This convention lets the frontend overlay the AI vectors directly on top of the original blueprint image with no coordinate transform.

HOW TO DETERMINE SCALE (in this exact priority order):
1. If a printed scale ratio is visible (e.g. `1/4"=1'-0"`, `Scale 1:50`), use it.
2. If dimension callouts are visible (`24'-0"`, `12ft`, `3600mm`), measure from those.
3. If a scale bar / ruler graphic is drawn, use it.
4. If none of the above, INFER from typical residential proportions:
   - Standard bedroom ~ 10-14 ft on the shortest side.
   - Standard door leaf ~ 2.67-3 ft.
   - Standard interior corridor ~ 3-4 ft.
   Set `scale_confidence` = "low" when inferring.

TRACING FIDELITY (the reason the user uploaded this drawing):
- Reproduce EVERY wall segment you can identify. Do NOT simplify by merging corridors.
  Aim for 40-200 wall segments on a typical residential floor plan. Trace every jog,
  bump-out, closet, and interior partition. If the drawing shows a wall break for a
  door/window, output TWO wall segments (one on each side of the opening).
- Include EVERY exterior wall including any porches, decks, garages, and roof outlines
  drawn on the plan. Include the site plan property line if visible.
- Snap each wall endpoint to a 0.25 ft grid (finer than usual — we want fidelity).
- Preserve orthogonal (X/Y axis-aligned) walls as axis-aligned. Emit diagonal segments
  faithfully when the source is diagonal (e.g. bay windows, angled walls).
- Every door / window MUST reference the wall it cuts through by `wall_index`
  (0-based into `walls`). Place `position` on that wall segment.
- Extract EVERY room label / callout you can read (e.g. `MASTER BEDROOM`, `KITCHEN`,
  `BATH 2`, `WIC`, `LAUNDRY`, `GARAGE`, `PORCH`, `DECK`). Place its `position` at the
  room's centroid. If dimension callouts are visible (e.g. `12'-0"`, `18'-6"`), include
  them as labels at the point where they appear.
- Extract fixtures — see next section.
- If the drawing has multiple floors on one page, trace ONLY the floor that is the
  primary focus (largest / most detailed) and set `summary` accordingly.

FIXTURES (extract ALL you can see in the source drawing):
- `kind` MUST be one of:
  `toilet`, `sink`, `shower`, `tub`, `vanity`, `stove`, `oven`, `refrigerator`,
  `dishwasher`, `washer`, `dryer`, `island`, `counter`, `closet`, `stairs`,
  `bed`, `sofa`, `dining_table`, `desk`, `fireplace`, `hvac_unit`, `water_heater`,
  `column`, `other`.
- `position` = [x, y] in FEET, centered on the fixture.
- `rotation_deg` = clockwise rotation from east-facing (0 = points east, 90 = points north).
- `size` = [width_ft, depth_ft] of the fixture footprint.
- Use conventional US residential sizes when the drawing doesn't specify:
  toilet 2x2.5, sink 2x1.5, shower 3x3, tub 5x2.5, vanity 4x2, stove 2.5x2,
  refrigerator 3x2.5, dishwasher 2x2, island 6x3, stairs 3x10, bed(queen) 5x6.5.

Coordinate rules for non-floorplan docs:
- Only return walls/doors/windows/fixtures if `doc_type` is "floor_plan",
  "blueprint", or "site_plan". Otherwise return empty arrays.

Materials category MUST be one of: "Structural", "Framing", "Electrical", "Plumbing",
"Finishes", "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other".
- If you cannot identify materials with confidence, still return 3-6 plausible inferred materials.
- unit_price_usd MUST be a realistic 2026 US construction trade rate.
- labor_unit_price_usd is the installed labor cost per unit at US average rates.

DEDUPLICATION RULES (read carefully — this is critical):
You will be given a list of materials ALREADY counted in this project from prior documents. The current image may show the SAME structures from a different angle, elevation, or detail view. You MUST avoid double-counting.

For every material in the current image, set the "dedup" field to one of:
  - "new"   = This is a genuinely new material not represented in the existing list. (Default.)
  - "skip"  = This material is the SAME physical item already in the list (e.g. the same concrete slab, the same roof truss system, the same exterior wall) seen from a different vantage. Also set "ref" to the [index] of the existing item it matches. Quantity will be ignored.
  - "merge" = This material is an ADDITIONAL amount of an existing item (e.g. the new view reveals more rooms, another wing, a second floor of the same framing). Set "ref" to the [index] of the existing item, and set "quantity" to ONLY the DELTA quantity to add. Do not restate the existing quantity.

When in doubt between "skip" and "new", prefer "skip" — it is better to under-count than to double-count. The estimator can manually adjust later.
"""

ANALYSIS_PROMPT_FOOTER = "\n\nReturn ONLY the JSON object, no surrounding text.\n"


ELEVATION_PROMPT = """You are a construction expert. This blueprint image shows an EXTERIOR ELEVATION view of a building (a straight-on view of one side / face). Extract the vertical / height data needed to assemble the building in 3D.

Return ONLY valid JSON with this exact schema (units in feet, no strings):
{
  "view_kind": "elevation",
  "facing_hint": "front" | "back" | "left" | "right" | "unknown",
  "building_width_ft": number,   // horizontal span visible in the elevation
  "overall_height_ft": number,   // ground to ridge / roof peak
  "wall_top_ft": number,         // ground to top-of-wall (bottom of roof)
  "floor_heights_ft": [number],  // list of floor-to-floor heights, ground-up (e.g. [10] single story, [10,9] two-story)
  "roof_pitch_deg": number,      // 0 for flat, else pitch angle in degrees (e.g. 26.6 for 6:12)
  "roof_shape": "gable" | "hip" | "shed" | "flat" | "gambrel" | "unknown",
  "openings": [
    { "type": "door" | "window", "x_ft": number, "sill_ft": number, "width_ft": number, "height_ft": number }
    // x_ft = horizontal position from the LEFT edge of the elevation
    // sill_ft = vertical position of the bottom of the opening from ground
  ],
  "confidence": "high" | "medium" | "low"
}

Rules:
- If a dimension is not visible/inferable, use 0 for numbers and "unknown" for the string.
- Prefer explicit dimension callouts over pixel measurement.
- floor_heights_ft must sum to <= wall_top_ft.
- Guess facing_hint only if a label/note (e.g. 'FRONT ELEV', 'NORTH ELEV', 'A-201') makes it obvious; otherwise "unknown".
Return ONLY the JSON, no prose."""


ROOF_PLAN_PROMPT = """You are a construction expert. This blueprint image shows a ROOF PLAN — a top-down view of the roof (NOT the floor below it). Extract roof-assembly data.

Return ONLY valid JSON:
{
  "view_kind": "roof_plan",
  "building_width_ft": number,      // roof footprint width
  "building_depth_ft": number,      // roof footprint depth
  "roof_shape": "gable" | "hip" | "shed" | "flat" | "gambrel" | "unknown",
  "primary_slope_deg": number,      // main pitch in degrees (0 if flat)
  "overhang_ft": number,            // eave overhang beyond wall (typical 1-2 ft)
  "ridge_lines": [                  // in roof-plan coord space (0,0) = top-left
    { "start": [x_ft, y_ft], "end": [x_ft, y_ft] }
  ],
  "confidence": "high" | "medium" | "low"
}

Return ONLY JSON, no prose."""


async def _analyze_image_with_ai(b64: str, existing_materials: list[dict]) -> dict:
    chat = LlmChat(
        api_key=_llm_key(),
        session_id=f"analyze-{uuid.uuid4()}",
        system_message="You are a construction blueprint analysis expert. You output only valid JSON.",
    ).with_model("openai", "gpt-4o")
    prompt = (
        ANALYSIS_PROMPT_HEADER
        + "\n\n"
        + _format_existing_materials_for_prompt(existing_materials)
        + ANALYSIS_PROMPT_FOOTER
    )
    message = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
    response = await chat.send_message(message)
    raw = response if isinstance(response, str) else str(response)
    cleaned = _strip_code_fence(raw)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise ValueError(f"AI did not return valid JSON: {raw[:300]}")
        return json.loads(match.group(0))


async def _analyze_view_structure(b64: str, view_type: str) -> dict | None:
    """Second, targeted AI call for non-floor-plan drawing views that carry
    3D assembly data (elevations, roof plans). Returns None on failure — the
    pipeline should treat assembly_data as optional."""
    if view_type == "elevation":
        prompt = ELEVATION_PROMPT
        sys_msg = "You are a construction elevation-view extraction expert. Output only valid JSON."
    elif view_type == "roof_plan":
        prompt = ROOF_PLAN_PROMPT
        sys_msg = "You are a construction roof-plan extraction expert. Output only valid JSON."
    else:
        return None
    try:
        chat = LlmChat(
            api_key=_llm_key(),
            session_id=f"assembly-{uuid.uuid4()}",
            system_message=sys_msg,
        ).with_model("openai", "gpt-4o")
        message = UserMessage(text=prompt, file_contents=[ImageContent(image_base64=b64)])
        response = await chat.send_message(message)
        raw = response if isinstance(response, str) else str(response)
        cleaned = _strip_code_fence(raw)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", cleaned)
            return json.loads(match.group(0)) if match else None
    except Exception:
        logger.exception(f"assembly extraction failed for view_type={view_type}")
        return None
