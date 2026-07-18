"""Documents routes and the AI vision analysis pipeline."""
from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import re
import uuid
from typing import Any

import pypdfium2 as pdfium
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage

import billing as billing_mod
from routes.opencv_tracer import trace_walls_from_image
from routes.projects import _create_sheet, _mirror_active_sheet_to_blueprint, get_or_create_blueprint
from utils import clean, now_iso

logger = logging.getLogger("documents")

MAX_PDF_PAGES = 20
PDF_RASTER_SCALE = 2.0  # 2x = ~144dpi, good balance of detail/AI cost
# Cap the longest side of any stored blueprint image at 1600 px and re-encode
# as JPEG so the resulting base64 fits well within MongoDB's 16 MB BSON
# document limit and GPT-4o Vision's per-image budget. Large architectural
# sheets (24×36 Arch-D) at 2x scale can be > 20 MB PNG which used to blow up
# the DocumentTooLarge error and silently kill batch uploads.
MAX_IMAGE_DIM = 1600
JPEG_QUALITY = 85
# Any base64 payload larger than this is refused before hitting Mongo (16 MB
# is Mongo's hard cap; we keep a safety margin for other fields on the doc).
MAX_STORED_B64_BYTES = 6 * 1024 * 1024


def _shrink_and_encode(img) -> str:
    """Downscale a PIL image to fit within MAX_IMAGE_DIM and return base64 JPEG."""
    from PIL import Image  # local import to avoid startup cost
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > MAX_IMAGE_DIM:
        scale = MAX_IMAGE_DIM / float(max(w, h))
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    # If we're STILL over the safety cap (shouldn't happen for 1600px JPEG q85),
    # step the quality down until we fit.
    q = JPEG_QUALITY
    while len(b64) > MAX_STORED_B64_BYTES and q > 40:
        q -= 15
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=q, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return b64


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

EXISTING_MATERIALS_TEMPLATE_NONE = "EXISTING MATERIALS IN THIS PROJECT: (none — this is the first document)"

ANALYSIS_PROMPT_FOOTER = "\n\nReturn ONLY the JSON object, no surrounding text.\n"


def _format_existing_materials_for_prompt(existing: list[dict]) -> str:
    if not existing:
        return EXISTING_MATERIALS_TEMPLATE_NONE
    lines = [
        "EXISTING MATERIALS IN THIS PROJECT (already counted from prior documents — do NOT double-count):"
    ]
    for i, m in enumerate(existing, start=1):
        lines.append(
            f"  [{i}] {m.get('name', '')} · {m.get('category', '')} · "
            f"{m.get('quantity', 0)} {m.get('unit', '')}"
        )
    return "\n".join(lines)


def _norm_key(name: str, category: str, unit: str) -> str:
    """Normalised key for fuzzy fallback dedup: lowercase, strip punctuation."""
    norm_name = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    norm_cat = (category or "").lower()
    norm_unit = re.sub(r"[^a-z0-9]+", "", (unit or "").lower())
    return f"{norm_cat}|{norm_name}|{norm_unit}"

VALID_CATEGORIES = {
    "Structural", "Framing", "Electrical", "Plumbing", "Finishes",
    "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other",
}


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


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


def _coord(p):
    if isinstance(p, list) and len(p) >= 2:
        return [float(p[0]), float(p[1])]
    return None


VALID_FIXTURE_KINDS = {
    "toilet", "sink", "shower", "tub", "vanity", "stove", "oven",
    "refrigerator", "dishwasher", "washer", "dryer", "island", "counter",
    "closet", "stairs", "bed", "sofa", "dining_table", "desk", "fireplace",
    "hvac_unit", "water_heater", "column", "other",
}


def _sanitize_fixture(fx: dict) -> dict | None:
    pos = _coord(fx.get("position"))
    if not pos:
        return None
    kind = str(fx.get("kind") or "other").lower().replace("-", "_").replace(" ", "_")
    if kind not in VALID_FIXTURE_KINDS:
        kind = "other"
    size = fx.get("size") or [2.0, 2.0]
    try:
        sw = float(size[0])
        sh = float(size[1])
    except (TypeError, ValueError, IndexError):
        sw, sh = 2.0, 2.0
    sw = max(0.5, min(sw, 40.0))
    sh = max(0.5, min(sh, 40.0))
    try:
        rot = float(fx.get("rotation_deg") or 0)
    except (TypeError, ValueError):
        rot = 0.0
    return {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "position": pos,
        "size": [sw, sh],
        "rotation_deg": rot % 360,
    }


def _sanitize_label(lbl: dict) -> dict | None:
    pos = _coord(lbl.get("position"))
    text = (lbl.get("text") or "").strip()[:60]
    if not pos or not text:
        return None
    return {"id": str(uuid.uuid4()), "position": pos, "text": text}


def _rasterize_pdf_pages(pdf_bytes: bytes) -> list[str]:
    """Render up to MAX_PDF_PAGES pages, downscale, JPEG-encode, base64."""
    pages_b64: list[str] = []
    pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    try:
        n = min(len(pdf), MAX_PDF_PAGES)
        for i in range(n):
            page = pdf[i]
            pil_image = page.render(scale=PDF_RASTER_SCALE).to_pil()
            pages_b64.append(_shrink_and_encode(pil_image))
            page.close()
    finally:
        pdf.close()
    return pages_b64


def _shrink_image_bytes_to_b64(content: bytes) -> str:
    """Downscale a raw uploaded image file (PNG/JPG/WEBP) and return base64 JPEG."""
    from PIL import Image
    img = Image.open(io.BytesIO(content))
    return _shrink_and_encode(img)


def _build_pipeline(db):
    # ---- Concurrency controls ----
    # `_project_locks` serializes ALL pipeline runs within one project so
    # concurrent uploads to the same project don't race on:
    #   • blueprint_sheets order_index / floor_level computation
    #   • db.blueprints active_sheet_id mirror
    #   • the "existing materials" read (each doc should see the prior doc's
    #     inserted materials so dedup logic works across batch uploads)
    # `_llm_semaphore` caps concurrent GPT-4o vision calls across ALL projects
    # to prevent OpenAI rate-limit 429s that would silently mark docs as errored.
    _project_locks: dict[str, asyncio.Lock] = {}
    _llm_semaphore = asyncio.Semaphore(3)

    def _project_lock(project_id: str) -> asyncio.Lock:
        lock = _project_locks.get(project_id)
        if lock is None:
            lock = asyncio.Lock()
            _project_locks[project_id] = lock
        return lock

    async def _set_doc_status(doc_id: str, status_val: str, **extras: Any) -> None:
        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {"status": status_val, "updated_at": now_iso(), **extras}},
        )

    async def _ai_with_retry(b64: str, working_existing: list[dict]) -> dict:
        """GPT-4o call gated by the global LLM semaphore, with retry on transient
        errors (rate-limit, timeout). Raises on unrecoverable failure."""
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                async with _llm_semaphore:
                    return await asyncio.wait_for(
                        _analyze_image_with_ai(b64, working_existing),
                        timeout=90,
                    )
            except asyncio.TimeoutError as e:
                last_err = e
                logger.warning(f"AI page timeout, attempt {attempt + 1}/3")
            except Exception as e:  # noqa: BLE001
                msg = str(e).lower()
                if any(k in msg for k in ("rate", "429", "timeout", "503", "502", "temporarily")):
                    last_err = e
                    logger.warning(f"AI transient error attempt {attempt + 1}/3: {e}")
                    await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s
                    continue
                raise
            await asyncio.sleep(1.5 * (attempt + 1))
        raise last_err or RuntimeError("AI retries exhausted")

    async def run(doc_id: str, project_id: str, pages_b64: list[str], mime: str) -> None:
        # Serialize per-project pipelines so batch uploads dedup + sheet-order
        # correctly — but with a lock-acquisition timeout so ONE stuck task
        # can't freeze the whole batch (this was the observed production bug).
        lock = _project_lock(project_id)
        try:
            await asyncio.wait_for(lock.acquire(), timeout=180)  # 3 min queue wait
        except asyncio.TimeoutError:
            logger.error(f"Pipeline lock acquisition timeout for {doc_id}")
            await _set_doc_status(doc_id, "error", error="Another upload on this project appears stuck. Click RETRY to try again.")
            return
        try:
            # Cap total pipeline runtime so a single hung AI call can't
            # block the queue slot indefinitely (15 minutes is well over
            # the sum of _ai_with_retry timeouts for a 5-page PDF).
            await asyncio.wait_for(
                _run_locked(doc_id, project_id, pages_b64, mime, _set_doc_status, _ai_with_retry),
                timeout=15 * 60,
            )
        except asyncio.TimeoutError:
            logger.error(f"Pipeline exceeded 15-min ceiling for {doc_id}")
            await _set_doc_status(doc_id, "error", error="Pipeline exceeded 15-minute timeout. Click RETRY to re-run.")
        except Exception as exc:
            logger.exception(f"Pipeline top-level failure for {doc_id}")
            await _set_doc_status(doc_id, "error", error=str(exc)[:300])
        finally:
            try:
                lock.release()
            except Exception:
                pass

    async def _run_locked(doc_id: str, project_id: str, pages_b64: list[str], mime: str,
                          _set_doc_status, _ai_with_retry) -> None:
        try:
            await asyncio.sleep(0.1)
            total_pages = len(pages_b64)
            await _set_doc_status(doc_id, "analyzing", pages_total=total_pages, pages_done=0)
            if not _llm_key():
                await _set_doc_status(doc_id, "error", error="EMERGENT_LLM_KEY missing")
                return

            existing_materials = await db.materials.find(
                {"project_id": project_id},
                {"_id": 0, "id": 1, "name": 1, "category": 1, "quantity": 1, "unit": 1},
            ).sort("created_at", 1).to_list(500)
            working_existing = list(existing_materials)
            ref_to_id = {i + 1: m["id"] for i, m in enumerate(working_existing)}
            existing_keys = {
                _norm_key(m.get("name", ""), m.get("category", ""), m.get("unit", "")): m["id"]
                for m in working_existing
            }

            inserted = 0
            merged = 0
            skipped = 0
            dedup_audit: list[dict] = []
            # Aggregate accumulators (used only for the final analysis payload
            # + single-page fallback). Multi-page PDFs now create ONE SHEET
            # PER PAGE via `per_page_geometry`.
            walls_all: list[dict] = []
            doors_all: list[dict] = []
            windows_all: list[dict] = []
            labels_all: list[dict] = []
            fixtures_all: list[dict] = []
            building_ft: dict | None = None
            scale_confidence: str | None = None
            page_summaries: list[dict] = []
            first_doc_type: str | None = None
            first_summary: str | None = None
            all_rooms: list[dict] = []
            all_notes: list[str] = []
            # NEW — per-page geometry snapshot for multi-page PDFs. Each entry:
            #   {page, doc_type, walls, doors, windows, labels, fixtures,
            #    building_ft, scale_confidence, is_reference}
            # We create one blueprint sheet per non-empty entry so a
            # multi-page PDF becomes N sheets instead of one merged blob.
            per_page_geometry: list[dict] = []

            for page_idx, b64 in enumerate(pages_b64):
                await _set_doc_status(
                    doc_id, "analyzing",
                    pages_total=total_pages, pages_done=page_idx,
                    current_page=page_idx + 1,
                )
                analysis = await _ai_with_retry(b64, working_existing)
                doc_type = analysis.get("doc_type")
                if first_doc_type is None:
                    first_doc_type = doc_type
                    first_summary = analysis.get("summary")
                for r in analysis.get("rooms") or []:
                    if isinstance(r, dict):
                        all_rooms.append(r)
                for n in analysis.get("structural_notes") or []:
                    all_notes.append(str(n)[:240])
                page_summaries.append({
                    "page": page_idx + 1,
                    "doc_type": doc_type,
                    "summary": str(analysis.get("summary") or "")[:400],
                })

                for mat in analysis.get("materials") or []:
                    if not isinstance(mat, dict) or not mat.get("name"):
                        continue
                    cat = mat.get("category") or "Other"
                    if cat not in VALID_CATEGORIES:
                        cat = "Other"
                    try:
                        price = float(mat.get("unit_price_usd") or 0)
                    except (TypeError, ValueError):
                        price = 0.0
                    try:
                        labor_price = float(mat.get("labor_unit_price_usd") or 0)
                    except (TypeError, ValueError):
                        labor_price = 0.0
                    qty = float(mat.get("quantity") or 0)
                    unit = str(mat.get("unit") or "ea")[:24]
                    name = str(mat.get("name"))[:120]

                    dedup = str(mat.get("dedup") or "new").lower()
                    ref = mat.get("ref")
                    try:
                        target_id = ref_to_id.get(int(ref)) if ref is not None else None
                    except (TypeError, ValueError):
                        target_id = None

                    if dedup == "new":
                        fuzzy_id = existing_keys.get(_norm_key(name, cat, unit))
                        if fuzzy_id:
                            dedup = "merge"
                            target_id = fuzzy_id

                    if dedup == "skip" and target_id:
                        skipped += 1
                        dedup_audit.append({
                            "name": name, "decision": "skip", "page": page_idx + 1,
                            "merged_into": target_id,
                            "rationale": str(mat.get("rationale") or "")[:200],
                        })
                        continue

                    if dedup == "merge" and target_id:
                        await db.materials.update_one(
                            {"id": target_id},
                            {
                                "$inc": {"quantity": qty},
                                "$set": {"updated_at": now_iso()},
                                "$addToSet": {"source_documents": doc_id},
                            },
                        )
                        merged += 1
                        dedup_audit.append({
                            "name": name, "decision": "merge", "page": page_idx + 1,
                            "merged_into": target_id, "added_quantity": qty,
                            "rationale": str(mat.get("rationale") or "")[:200],
                        })
                        # also reflect updated qty in working_existing for next page's prompt
                        for m in working_existing:
                            if m["id"] == target_id:
                                m["quantity"] = float(m.get("quantity") or 0) + qty
                                break
                        continue

                    new_id = str(uuid.uuid4())
                    await db.materials.insert_one({
                        "id": new_id,
                        "project_id": project_id,
                        "document_id": doc_id,
                        "source_documents": [doc_id],
                        "name": name,
                        "category": cat,
                        "quantity": qty,
                        "unit": unit,
                        "unit_price": round(max(price, 0.0), 2),
                        "labor_unit_price": round(max(labor_price, 0.0), 2),
                        "currency": "USD",
                        "ai_extracted": True,
                        "source_page": page_idx + 1,
                        "created_at": now_iso(),
                    })
                    existing_keys[_norm_key(name, cat, unit)] = new_id
                    new_record = {"id": new_id, "name": name, "category": cat, "quantity": qty, "unit": unit}
                    working_existing.append(new_record)
                    ref_to_id[len(working_existing)] = new_id
                    inserted += 1
                    dedup_audit.append({"name": name, "decision": "new", "page": page_idx + 1})

                # Every "drawing" doc type gets its geometry traced so the
                # user sees the AI-extracted lines overlaying the underlay,
                # regardless of view_type. The `view_type` field still steers
                # the 3D renderer (reference sheets don't stack as floors).
                DRAWING_TYPES = {
                    "floor_plan", "blueprint", "site_plan", "foundation_plan",
                    "framing_plan", "roof_plan", "sheathing_plan", "elevation",
                    "electrical_plan", "plumbing_plan", "hvac_plan", "detail",
                }
                # Only these view types have TOP-DOWN interior layouts where
                # dense Hough-line wall tracing produces meaningful walls.
                # Running OpenCV wall tracing on an elevation (a side view of
                # the facade) turns every siding line, window trim, and shadow
                # into a "wall" — producing hundreds of garbage segments and
                # visually destroying the blueprint tab.
                HOUGH_TRACE_TYPES = {
                    "floor_plan", "blueprint", "foundation_plan",
                }
                # Defensive cap — any AI response with more walls than this
                # is almost certainly a mis-classified view; drop the excess.
                MAX_WALLS_PER_SHEET = 200
                if doc_type in DRAWING_TYPES:
                    if building_ft is None:
                        bf = analysis.get("building_ft") or {}
                        try:
                            bw = float(bf.get("w") or 0)
                            bh = float(bf.get("h") or 0)
                            if bw > 0 and bh > 0:
                                building_ft = {"w": bw, "h": bh}
                                scale_confidence = str(analysis.get("scale_confidence") or "medium")
                        except (TypeError, ValueError):
                            pass
                    # Track this page's building_ft separately so each sheet
                    # created for a multi-page PDF gets its own scale.
                    page_bf = analysis.get("building_ft") or {}
                    try:
                        page_bw = float(page_bf.get("w") or 0)
                        page_bh = float(page_bf.get("h") or 0)
                        this_page_building_ft = {"w": page_bw, "h": page_bh} if (page_bw > 0 and page_bh > 0) else building_ft
                    except (TypeError, ValueError):
                        this_page_building_ft = building_ft
                    this_page_scale_conf = str(analysis.get("scale_confidence") or "medium")
                    # Snapshot boundaries so we can slice out this page's data.
                    walls_start = len(walls_all)
                    doors_start = len(doors_all)
                    windows_start = len(windows_all)
                    labels_start = len(labels_all)
                    fixtures_start = len(fixtures_all)
                    wall_offset = len(walls_all)
                    page_walls_added = 0
                    # Add GPT-4o's walls first (usually few but high-quality
                    # room boundaries).
                    for w in analysis.get("walls") or []:
                        s, e = _coord(w.get("start")), _coord(w.get("end"))
                        if s and e:
                            walls_all.append({
                                "id": str(uuid.uuid4()), "start": s, "end": e,
                                "thickness": float(w.get("thickness") or 0.5),
                            })
                            page_walls_added += 1

                    # OpenCV Hough-line tracing — deterministic dense wall
                    # extraction. Runs in a worker thread so we don't block
                    # the async loop. Uses AI-provided building_ft when
                    # available (else auto-scales). GATED on floor-plan-like
                    # doc types so elevations don't spawn wall spaghetti.
                    if doc_type in HOUGH_TRACE_TYPES:
                        try:
                            cv_result = await asyncio.to_thread(
                                trace_walls_from_image, b64,
                                building_ft_w=(building_ft or {}).get("w"),
                                building_ft_h=(building_ft or {}).get("h"),
                            )
                            for w in cv_result.get("walls") or []:
                                walls_all.append({
                                    "id": str(uuid.uuid4()),
                                    "start": w["start"],
                                    "end": w["end"],
                                    "thickness": float(w.get("thickness") or 0.4),
                                    "source": "opencv",
                                })
                                page_walls_added += 1
                            # If AI didn't provide building_ft, inherit from the
                            # OpenCV auto-scale so the underlay lines up.
                            if not building_ft and cv_result.get("building_ft"):
                                building_ft = cv_result["building_ft"]
                                scale_confidence = "opencv-auto"
                            logger.info(
                                f"OpenCV traced {cv_result.get('count', 0)} walls from doc {doc_id} page {page_idx + 1}"
                            )
                        except Exception:
                            logger.exception("OpenCV wall trace failed (non-fatal)")
                    else:
                        logger.info(
                            f"Skipped OpenCV wall tracing for doc_type={doc_type} (non-floor-plan) on doc {doc_id} page {page_idx + 1}"
                        )
                    # Runaway-guard: if the AI hallucinated >MAX_WALLS_PER_SHEET
                    # (usually a mis-classified elevation or a busy schematic),
                    # trim to the cap so the CAD editor doesn't drown in noise.
                    if page_walls_added > MAX_WALLS_PER_SHEET:
                        overflow = page_walls_added - MAX_WALLS_PER_SHEET
                        logger.warning(
                            f"Wall cap tripped for doc {doc_id} page {page_idx + 1}: "
                            f"trimming {overflow} of {page_walls_added} extracted walls"
                        )
                        # Keep the FIRST MAX_WALLS (AI ones came first, then
                        # OpenCV — AI walls are almost always the good ones).
                        walls_all = walls_all[: wall_offset + MAX_WALLS_PER_SHEET]
                        page_walls_added = MAX_WALLS_PER_SHEET
                    for d_item in analysis.get("doors") or []:
                        pos = _coord(d_item.get("position"))
                        if pos:
                            try:
                                wi_local = int(d_item.get("wall_index") or 0)
                            except (TypeError, ValueError):
                                wi_local = 0
                            wi = wall_offset + wi_local if 0 <= wi_local < page_walls_added else wall_offset
                            doors_all.append({
                                "id": str(uuid.uuid4()), "position": pos,
                                "width": float(d_item.get("width") or 3.0),
                                "wall_index": wi,
                            })
                    for w_item in analysis.get("windows") or []:
                        pos = _coord(w_item.get("position"))
                        if pos:
                            try:
                                wi_local = int(w_item.get("wall_index") or 0)
                            except (TypeError, ValueError):
                                wi_local = 0
                            wi = wall_offset + wi_local if 0 <= wi_local < page_walls_added else wall_offset
                            windows_all.append({
                                "id": str(uuid.uuid4()), "position": pos,
                                "width": float(w_item.get("width") or 4.0),
                                "wall_index": wi,
                            })
                    for lbl in (analysis.get("labels") or [])[:150]:
                        clean_lbl = _sanitize_label(lbl)
                        if clean_lbl:
                            labels_all.append(clean_lbl)
                    for fx in (analysis.get("fixtures") or [])[:200]:
                        clean_fx = _sanitize_fixture(fx)
                        if clean_fx:
                            fixtures_all.append(clean_fx)
                    # ---------- Per-page geometry snapshot ----------
                    # Slice each accumulator between the start-index (captured
                    # before we extracted this page) and its current length —
                    # yielding exactly this page's contribution. Wall indices
                    # in doors/windows are page-relative (0-based) so they
                    # re-anchor cleanly when we mount them on their own sheet.
                    page_walls = walls_all[walls_start:]
                    page_doors = [
                        {**d, "wall_index": max(0, (d.get("wall_index") or walls_start) - walls_start)}
                        for d in doors_all[doors_start:]
                    ]
                    page_windows = [
                        {**w, "wall_index": max(0, (w.get("wall_index") or walls_start) - walls_start)}
                        for w in windows_all[windows_start:]
                    ]
                    page_labels = labels_all[labels_start:]
                    page_fixtures = fixtures_all[fixtures_start:]
                    per_page_geometry.append({
                        "page": page_idx + 1,
                        "b64": b64,                     # kept only for possible per-page assembly extraction
                        "doc_type": doc_type,
                        "walls": page_walls,
                        "doors": page_doors,
                        "windows": page_windows,
                        "labels": page_labels,
                        "fixtures": page_fixtures,
                        "building_ft": this_page_building_ft,
                        "scale_confidence": this_page_scale_conf,
                        "is_reference": doc_type in {
                            "framing_plan", "roof_plan", "sheathing_plan",
                            "electrical_plan", "plumbing_plan", "hvac_plan",
                            "elevation", "detail",
                        },
                    })

            await _set_doc_status(
                doc_id, "saving",
                pages_total=total_pages, pages_done=total_pages,
                doc_type=first_doc_type,
            )

            synced = False
            sheet_id: str | None = None
            # Reference sheet types produce no walls but STILL get a sheet so
            # the underlay image is visible in the CAD editor (e.g. framing
            # plans are useful as a background reference on floor sheets).
            is_reference_only = first_doc_type in {
                "framing_plan", "roof_plan", "sheathing_plan",
                "electrical_plan", "plumbing_plan", "hvac_plan",
                "elevation", "detail",
            }
            # Non-floor-plan views that carry 3D-assembly data: run a targeted
            # second AI pass to extract heights / roof shape / opening layout
            # so the 3D renderer can piece the building together across sheets.
            assembly_data: dict | None = None
            auto_facing: str | None = None
            if first_doc_type in {"elevation", "roof_plan"}:
                try:
                    assembly_data = await _analyze_view_structure(b64, first_doc_type)
                    logger.info(
                        f"assembly extraction ok for doc {doc_id} type={first_doc_type}"
                    )
                except Exception:
                    logger.exception("assembly extraction failed (non-fatal)")
                # Auto-detect front-or-side axis by comparing the elevation
                # width to the project's existing floor-plan footprint.
                if assembly_data and first_doc_type == "elevation":
                    try:
                        el_w = float(assembly_data.get("building_width_ft") or 0)
                    except (TypeError, ValueError):
                        el_w = 0.0
                    if el_w > 0:
                        # Grab any existing floor_plan sheet's footprint as
                        # the reference building dimensions.
                        ref = await db.blueprint_sheets.find_one(
                            {"project_id": project_id, "view_type": {"$in": [None, "floor_plan", "blueprint"]}},
                            {"_id": 0, "building_ft": 1},
                            sort=[("order_index", 1)],
                        )
                        bft = (ref or {}).get("building_ft") or {}
                        try:
                            fw = float(bft.get("w") or 0)
                            fh = float(bft.get("h") or 0)
                        except (TypeError, ValueError):
                            fw = fh = 0.0
                        if fw > 0 and fh > 0:
                            # Within 15% match to a footprint side = that axis
                            tol = 0.15
                            match_long  = fw > 0 and abs(el_w - fw) / fw < tol
                            match_short = fh > 0 and abs(el_w - fh) / fh < tol
                            if match_long and not match_short:
                                auto_facing = "front"  # default long-side elevation
                            elif match_short and not match_long:
                                auto_facing = "left"
                            elif match_long and match_short:
                                # Square-ish footprint — leave unknown
                                auto_facing = None
                    if assembly_data:
                        assembly_data["auto_facing"] = auto_facing
            if walls_all or doors_all or windows_all or labels_all or fixtures_all or is_reference_only:
                await _set_doc_status(doc_id, "syncing", doc_type=first_doc_type, materials_count=inserted)
                # Ensure baseline blueprint doc + sheets exist.
                await get_or_create_blueprint(db, project_id)
                doc_meta = await db.documents.find_one({"id": doc_id}, {"_id": 0, "filename": 1}) or {}
                base_name = (doc_meta.get("filename") or "Sheet")[:80]

                # -------- Sheet creation strategy --------
                # Multi-page PDF → one sheet per page (each page usually
                # represents a distinct blueprint sheet: floor 1, floor 2,
                # foundation, elevations, etc). Preserves the multi-page
                # information the user uploaded.
                # Single-page → one sheet (existing behavior). Also fallback
                # for legacy code paths that produce accumulated `walls_all`
                # but didn't populate `per_page_geometry` (e.g. if the loop
                # short-circuits).
                created_sheet_ids: list[str] = []
                use_per_page = len(per_page_geometry) > 1
                if use_per_page:
                    page_count = len(per_page_geometry)
                    # Existing sheet count baseline — new stacking indices
                    # append after any pre-existing sheets in the project.
                    existing_sheet_count = await db.blueprint_sheets.count_documents({"project_id": project_id})
                    ref_floor_counter = 0
                    for pg in per_page_geometry:
                        pg_is_ref = pg["is_reference"]
                        sheet_name = f"{base_name} · p{pg['page']}/{page_count}"[:80]
                        floor_level = -99 - ref_floor_counter if pg_is_ref else existing_sheet_count
                        if pg_is_ref:
                            ref_floor_counter += 1
                        else:
                            existing_sheet_count += 1
                        # Run per-page assembly extraction only for
                        # elevation/roof_plan pages (needed for 3D stacking).
                        pg_assembly: dict | None = None
                        if pg["doc_type"] in {"elevation", "roof_plan"}:
                            try:
                                pg_assembly = await _analyze_view_structure(pg["b64"], pg["doc_type"])
                            except Exception:
                                logger.exception(f"per-page assembly extraction failed for page {pg['page']} (non-fatal)")
                        new_sheet = await _create_sheet(
                            db, project_id,
                            name=sheet_name,
                            floor_level=floor_level,
                            source_document_id=doc_id,
                            source_page=pg["page"],
                            geometry={
                                "walls":    pg["walls"],
                                "doors":    pg["doors"],
                                "windows":  pg["windows"],
                                "labels":   pg["labels"],
                                "fixtures": pg["fixtures"],
                            },
                            building_ft=pg["building_ft"],
                            scale_confidence=pg["scale_confidence"],
                            view_type=pg["doc_type"],
                            assembly_data=pg_assembly,
                            page_image_base64=pg["b64"],
                        )
                        created_sheet_ids.append(new_sheet["id"])
                    # First created sheet becomes active so the user sees
                    # the first page immediately (they can tab through the
                    # rest via SheetTabBar).
                    sheet_id = created_sheet_ids[0]
                else:
                    # Single-page path — mirrors the pre-refactor behavior.
                    floor_level = -99 if is_reference_only else await db.blueprint_sheets.count_documents({"project_id": project_id})
                    new_sheet = await _create_sheet(
                        db, project_id,
                        name=base_name,
                        floor_level=floor_level,
                        source_document_id=doc_id,
                        geometry={
                            "walls":    walls_all,
                            "doors":    doors_all,
                            "windows":  windows_all,
                            "labels":   labels_all,
                            "fixtures": fixtures_all,
                        },
                        building_ft=building_ft,
                        scale_confidence=scale_confidence,
                        view_type=first_doc_type,
                        assembly_data=assembly_data,
                    )
                    sheet_id = new_sheet["id"]
                    created_sheet_ids.append(sheet_id)
                # Make the FIRST created sheet active so the user sees it right away.
                await _mirror_active_sheet_to_blueprint(db, project_id, sheet_id)
                # Stamp all materials extracted from this doc with the sheet id
                # so the per-sheet materials view can filter cleanly. (For
                # multi-page uploads all materials tag to the first sheet;
                # per-page material mapping would require tracking source_page
                # on inserts too — that's a follow-on enhancement.)
                await db.materials.update_many(
                    {"project_id": project_id, "document_id": doc_id},
                    {"$set": {"sheet_id": sheet_id}},
                )
                synced = True

            await _set_doc_status(
                doc_id, "done",
                analysis={
                    "doc_type": first_doc_type,
                    "summary": first_summary,
                    "rooms": all_rooms,
                    "structural_notes": all_notes,
                    "page_summaries": page_summaries,
                    "building_ft": building_ft,
                    "scale_confidence": scale_confidence,
                    "traced_counts": {
                        "walls": len(walls_all),
                        "doors": len(doors_all),
                        "windows": len(windows_all),
                        "labels": len(labels_all),
                        "fixtures": len(fixtures_all),
                    },
                },
                doc_type=first_doc_type,
                materials_count=inserted,
                materials_merged=merged,
                materials_skipped=skipped,
                dedup_audit=dedup_audit,
                synced_3d=synced,
                sheet_id=sheet_id,
                pages_total=total_pages,
                pages_done=total_pages,
            )
            logger.info(
                f"Pipeline done for {doc_id}: pages={total_pages} type={first_doc_type} "
                f"materials new={inserted} merged={merged} skipped={skipped} "
                f"traced walls={len(walls_all)} fixtures={len(fixtures_all)} synced={synced}"
            )
        except Exception as exc:
            logger.exception(f"Pipeline failed for {doc_id}")
            await _set_doc_status(doc_id, "error", error=str(exc)[:300])

    return run


def build_documents_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")
    run_pipeline = _build_pipeline(db)

    # -----------------------------------------------------------------
    # Boot-time recovery: any doc left in a transient state
    # (queued / uploaded / analyzing / syncing) is from a previous pod
    # that died mid-processing. Flag them as errored so the UI can offer
    # a RETRY. Runs once at import time.
    # -----------------------------------------------------------------
    async def _recover_stuck_docs() -> None:
        try:
            transient = ["queued", "uploaded", "analyzing", "syncing"]
            res = await db.documents.update_many(
                {"status": {"$in": transient}},
                {"$set": {
                    "status": "error",
                    "analysis": {"summary": "Processing was interrupted. Click RETRY to re-run the AI pipeline."},
                    "updated_at": now_iso(),
                }},
            )
            if res.modified_count:
                logger.warning(f"Recovered {res.modified_count} stuck documents on startup")
        except Exception:
            logger.exception("stuck-doc recovery failed")
    asyncio.create_task(_recover_stuck_docs())

    @router.delete("/documents/{doc_id}")
    async def delete_document(doc_id: str, user: dict = Depends(get_current_user)):
        doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Document not found")
        proj = await db.projects.find_one(
            {"id": doc["project_id"], "user_id": user["id"]},
            {"_id": 0},
        )
        if not proj:
            raise HTTPException(403, "Forbidden")
        # Remove materials that were created solely from this document.
        # (Materials that were merged into pre-existing rows keep their accumulated
        #  quantity — we surface a warning in the UI for those.)
        mat_res = await db.materials.delete_many({"document_id": doc_id})
        # Also strip the doc id from any merged-into materials' source_documents arrays.
        await db.materials.update_many(
            {"source_documents": doc_id},
            {"$pull": {"source_documents": doc_id}},
        )
        await db.documents.delete_one({"id": doc_id})
        return {
            "deleted": True,
            "materials_removed": mat_res.deleted_count,
        }

    @router.get("/projects/{project_id}/documents")
    async def list_documents(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        return await db.documents.find(
            {"project_id": project_id},
            {"_id": 0, "image_base64": 0},
        ).sort("created_at", -1).to_list(200)

    @router.get("/documents/{doc_id}/image")
    async def get_document_image(doc_id: str, page: int | None = None, user: dict = Depends(get_current_user)):
        """Return a document's cached image.

        - Default (page=None): returns the doc-level thumbnail (page 1 for
          PDFs, the image itself for images).
        - `?page=N` (multi-page PDFs): returns page N's rendered image
          fetched from its matching `blueprint_sheets` row via
          `source_page`. Falls back to the doc-level thumbnail if a
          per-page image wasn't stored (older data).
        """
        doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Not found")
        proj = await db.projects.find_one({"id": doc["project_id"], "user_id": user["id"]})
        if not proj:
            raise HTTPException(403, "Forbidden")
        image_b64 = doc.get("image_base64")
        if page and page > 1:
            sheet = await db.blueprint_sheets.find_one(
                {"source_document_id": doc_id, "source_page": page},
                {"_id": 0, "page_image_base64": 1},
            )
            per_page = (sheet or {}).get("page_image_base64")
            if per_page:
                image_b64 = per_page
        return {
            "id": doc["id"],
            "filename": doc.get("filename"),
            "mime_type": "image/jpeg",
            "image_base64": image_b64,
            "page": page or 1,
        }

    @router.post("/projects/{project_id}/documents/upload")
    async def upload_document(
        project_id: str,
        file: UploadFile = File(...),
        user: dict = Depends(get_current_user),
    ):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")

        user = await billing_mod.ensure_user_subscription(db, user)
        ok, reason = await billing_mod.can_upload(db, user)
        if not ok:
            raise HTTPException(402, reason)

        content = await file.read()
        if len(content) > 32 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 32MB)")
        mime = file.content_type or "application/octet-stream"

        is_pdf = mime == "application/pdf" or (file.filename or "").lower().endswith(".pdf")
        is_image = mime.startswith("image/")
        if not (is_pdf or is_image):
            raise HTTPException(400, "Unsupported file type. Upload an image (PNG/JPG/WEBP/HEIC) or a PDF.")

        # Insert a placeholder doc IMMEDIATELY so the client gets a fast 200
        # response. All heavy work (PDF rasterize, downscale, JPEG encode) is
        # offloaded to a background thread + pipeline task so the ingress
        # doesn't time out and the async event loop stays responsive to
        # concurrent uploads.
        doc_id = str(uuid.uuid4())
        document = {
            "id": doc_id,
            "project_id": project_id,
            "filename": file.filename,
            "mime_type": mime,
            "size": len(content),
            "image_base64": None,
            "status": "queued",
            "analysis": None,
            "materials_count": 0,
            "materials_merged": 0,
            "materials_skipped": 0,
            "synced_3d": False,
            "doc_type": None,
            "pages_total": 0,
            "pages_done": 0,
            "is_pdf": is_pdf,
            "created_at": now_iso(),
        }
        await db.documents.insert_one(document)
        await billing_mod.consume_upload_credit(db, user)

        # Kick off the async prepare + pipeline task. It does:
        #   1. Rasterize (PDF) or shrink (image) in a worker thread
        #   2. Update the doc with `pages_total` + first-page thumbnail
        #   3. Run the analysis pipeline (AI, sheet creation, etc.)
        asyncio.create_task(_prepare_and_run(doc_id, project_id, content, is_pdf, mime))

        out = {k: v for k, v in document.items() if k != "image_base64"}
        return clean(out)

    async def _prepare_and_run(doc_id: str, project_id: str, content: bytes,
                               is_pdf: bool, mime: str) -> None:
        """Offloaded prep — rasterize/downscale in a thread so the upload
        HTTP request returns immediately and the ingress doesn't 504 during
        CPU-heavy work on large files."""
        try:
            def _prep() -> list[str]:
                if is_pdf:
                    return _rasterize_pdf_pages(content)
                return [_shrink_image_bytes_to_b64(content)]

            pages_b64 = await asyncio.to_thread(_prep)
            if not pages_b64:
                await db.documents.update_one(
                    {"id": doc_id},
                    {"$set": {"status": "error", "analysis": {"summary": "File had no pages / could not decode."}, "updated_at": now_iso()}},
                )
                return
            thumb_b64 = pages_b64[0]
            await db.documents.update_one(
                {"id": doc_id},
                {"$set": {
                    "status": "uploaded",
                    "image_base64": thumb_b64,
                    "pages_total": len(pages_b64),
                    "updated_at": now_iso(),
                }},
            )
            await run_pipeline(doc_id, project_id, pages_b64, mime)
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"prepare_and_run failed for doc {doc_id}")
            try:
                await db.documents.update_one(
                    {"id": doc_id},
                    {"$set": {"status": "error", "analysis": {"summary": f"Prep failed: {str(exc)[:200]}"}, "updated_at": now_iso()}},
                )
            except Exception:
                pass

    async def _purge_prior_run_artifacts(doc_id: str) -> None:
        """Wipe materials + blueprint sheets that a doc created on a
        previous pipeline run so that a retry doesn't double-count.

        - Deletes materials where `document_id == doc_id` (single-source rows).
        - Pulls `doc_id` from `source_documents` arrays on any merged-into
          materials (leaves the accumulated quantity intact — same policy
          as delete_document).
        - Deletes any `blueprint_sheets` created from this doc so the
          re-run doesn't spawn a duplicate.
        """
        await db.materials.delete_many({"document_id": doc_id})
        await db.materials.update_many(
            {"source_documents": doc_id},
            {"$pull": {"source_documents": doc_id}},
        )
        await db.blueprint_sheets.delete_many({"source_document_id": doc_id})

    @router.post("/documents/{doc_id}/retry")
    async def retry_document(doc_id: str, user: dict = Depends(get_current_user)):
        """Re-run the analysis pipeline for a document whose earlier run
        errored or was interrupted. Only rehydrates pages_b64 from the
        stored thumbnail (single-page docs) unless the original file is
        still cached; for multi-page PDFs the user needs to re-upload the
        original file (we don't hold the raw bytes past processing)."""
        doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Document not found")
        proj = await db.projects.find_one({"id": doc["project_id"], "user_id": user["id"]})
        if not proj:
            raise HTTPException(403, "Forbidden")
        # Only allow retry on terminal / stuck states — never on a doc that's
        # already actively processing (would spawn a duplicate pipeline).
        allowed_from = {"error", "queued", "uploaded", "analyzing", "syncing", "done"}
        if doc.get("status") not in allowed_from:
            raise HTTPException(400, f"Cannot retry from status={doc.get('status')}")
        thumb = doc.get("image_base64")
        if not thumb:
            raise HTTPException(400, "Original page data no longer cached. Please re-upload the file.")
        # For PDFs we only kept a single-page thumbnail; a retry on a PDF
        # will therefore only re-analyze the first page. Log a warning so
        # the user knows to re-upload if they need multi-page re-analysis.
        if doc.get("is_pdf") and (doc.get("pages_total") or 1) > 1:
            logger.warning(f"Retrying multi-page PDF {doc_id} — only first page will be re-analyzed")
        # Purge any materials / sheets left behind by the previous run so
        # the re-analysis doesn't double-count via $inc merges.
        await _purge_prior_run_artifacts(doc_id)
        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {
                "status": "queued",
                "analysis": None,
                "materials_count": 0,
                "materials_merged": 0,
                "materials_skipped": 0,
                "synced_3d": False,
                "pages_done": 0,
                "updated_at": now_iso(),
            }},
        )
        asyncio.create_task(run_pipeline(doc_id, doc["project_id"], [thumb], doc.get("mime_type") or "image/jpeg"))
        return {"ok": True, "retrying": True, "doc_id": doc_id}

    @router.post("/projects/{project_id}/documents/retry-all-errored")
    async def retry_all_errored_docs(project_id: str, user: dict = Depends(get_current_user)):
        """Bulk-retry every errored doc in a project that still has a
        cached thumbnail. Handy after a pod restart flips a batch of docs
        to error state via the boot-time recovery.

        Loads doc thumbs one-at-a-time (never all at once) so a project
        with dozens of errored uploads doesn't blow past the ingress
        response-size / timeout budget — that was causing 500s in prod.
        """
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        # First pass: just fetch the ids of errored docs. Cheap, small payload.
        errored_ids = await db.documents.find(
            {"project_id": project_id, "status": "error"},
            {"_id": 0, "id": 1},
        ).to_list(1000)
        # Cap per-call so a project with hundreds of errored docs
        # doesn't spawn hundreds of pipeline tasks in one shot. Users
        # can click Retry-all again once the first batch clears.
        BATCH_CAP = 25
        errored_ids = errored_ids[:BATCH_CAP]
        retried = 0
        skipped_no_thumb = 0
        skipped_error = 0
        for row in errored_ids:
            doc_id = row["id"]
            try:
                # Fetch one full doc at a time so we never hold >1 thumb in memory.
                d = await db.documents.find_one(
                    {"id": doc_id},
                    {"_id": 0, "id": 1, "mime_type": 1, "image_base64": 1},
                )
                if not d:
                    continue
                thumb = d.get("image_base64")
                if not thumb:
                    skipped_no_thumb += 1
                    continue
                # Purge prior-run artifacts before re-queueing so retries
                # don't double-count materials or spawn duplicate sheets.
                await _purge_prior_run_artifacts(doc_id)
                await db.documents.update_one(
                    {"id": doc_id},
                    {"$set": {
                        "status": "queued",
                        "analysis": None,
                        "materials_count": 0,
                        "materials_merged": 0,
                        "materials_skipped": 0,
                        "synced_3d": False,
                        "pages_done": 0,
                        "updated_at": now_iso(),
                    }},
                )
                asyncio.create_task(run_pipeline(doc_id, project_id, [thumb], d.get("mime_type") or "image/jpeg"))
                retried += 1
            except Exception:
                logger.exception(f"retry-all: skipping doc {doc_id} due to error")
                skipped_error += 1
        return {
            "ok": True,
            "retried": retried,
            "skipped_no_thumb": skipped_no_thumb,
            "skipped_error": skipped_error,
            "total_errored": len(errored_ids),
            "batch_capped": len(errored_ids) >= BATCH_CAP,
        }

    return router
