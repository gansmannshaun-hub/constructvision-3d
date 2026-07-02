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
from routes.projects import _create_sheet, _mirror_active_sheet_to_blueprint, get_or_create_blueprint
from utils import clean, now_iso

logger = logging.getLogger("documents")

MAX_PDF_PAGES = 20
PDF_RASTER_SCALE = 2.0  # 2x = ~144dpi, good balance of detail/AI cost


def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


ANALYSIS_PROMPT_HEADER = """You are an expert architectural CAD engineer.
Your mission: TRACE THE UPLOADED BLUEPRINT EXACTLY. Do not invent, embellish,
or "improve" the layout. If the user uploaded a floor plan, reproduce its walls,
doors, windows, room labels, and fixtures with the same proportions and positions
as the source drawing.

Return a STRICT JSON response — no prose, no markdown, only valid JSON — with this exact schema:

{
  "doc_type": "floor_plan" | "blueprint" | "site_plan" | "elevation" | "photo" | "other",
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
    """Render up to MAX_PDF_PAGES pages to base64-encoded PNGs (in order)."""
    pages_b64: list[str] = []
    pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    try:
        n = min(len(pdf), MAX_PDF_PAGES)
        for i in range(n):
            page = pdf[i]
            pil_image = page.render(scale=PDF_RASTER_SCALE).to_pil()
            buf = io.BytesIO()
            pil_image.save(buf, format="PNG", optimize=True)
            pages_b64.append(base64.b64encode(buf.getvalue()).decode("utf-8"))
            page.close()
    finally:
        pdf.close()
    return pages_b64


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
        # correctly.
        async with _project_lock(project_id):
            await _run_locked(doc_id, project_id, pages_b64, mime, _set_doc_status, _ai_with_retry)

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

                # Accumulate floorplan geometry from each page (in feet, wall_index is
                # scoped to THIS page — offset it when appending to the global list).
                if doc_type in {"floor_plan", "blueprint", "site_plan"}:
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
                    wall_offset = len(walls_all)
                    page_walls_added = 0
                    for w in analysis.get("walls") or []:
                        s, e = _coord(w.get("start")), _coord(w.get("end"))
                        if s and e:
                            walls_all.append({
                                "id": str(uuid.uuid4()), "start": s, "end": e,
                                "thickness": float(w.get("thickness") or 0.5),
                            })
                            page_walls_added += 1
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

            await _set_doc_status(
                doc_id, "saving",
                pages_total=total_pages, pages_done=total_pages,
                doc_type=first_doc_type,
            )

            synced = False
            sheet_id: str | None = None
            if walls_all or doors_all or windows_all or labels_all or fixtures_all:
                await _set_doc_status(doc_id, "syncing", doc_type=first_doc_type, materials_count=inserted)
                # Ensure baseline blueprint doc + sheets exist.
                await get_or_create_blueprint(db, project_id)
                # Auto-create a NEW sheet dedicated to this document so each
                # uploaded blueprint gets its own tab in the CAD editor.
                doc_meta = await db.documents.find_one({"id": doc_id}, {"_id": 0, "filename": 1}) or {}
                sheet_name = (doc_meta.get("filename") or "Sheet")[:80]
                # Determine floor_level = current sheet count (auto-stack).
                floor_level = await db.blueprint_sheets.count_documents({"project_id": project_id})
                new_sheet = await _create_sheet(
                    db, project_id,
                    name=sheet_name,
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
                )
                sheet_id = new_sheet["id"]
                # Make the new traced sheet active so the user sees it right away.
                await _mirror_active_sheet_to_blueprint(db, project_id, sheet_id)
                # Stamp all materials extracted from this doc with the sheet id
                # so the per-sheet materials view can filter cleanly.
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
    async def get_document_image(doc_id: str, user: dict = Depends(get_current_user)):
        doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Not found")
        proj = await db.projects.find_one({"id": doc["project_id"], "user_id": user["id"]})
        if not proj:
            raise HTTPException(403, "Forbidden")
        return {
            "id": doc["id"],
            "filename": doc.get("filename"),
            "mime_type": doc.get("mime_type"),
            "image_base64": doc.get("image_base64"),
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
        if len(content) > 16 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 16MB)")
        mime = file.content_type or "application/octet-stream"

        is_pdf = mime == "application/pdf" or (file.filename or "").lower().endswith(".pdf")
        is_image = mime.startswith("image/")
        if not (is_pdf or is_image):
            raise HTTPException(400, "Unsupported file type. Upload an image (PNG/JPG) or a PDF.")

        pages_b64: list[str] = []
        if is_pdf:
            try:
                pages_b64 = _rasterize_pdf_pages(content)
            except Exception as exc:
                logger.exception("PDF rasterize failed")
                raise HTTPException(400, f"Could not read PDF: {exc}") from exc
            if not pages_b64:
                raise HTTPException(400, "PDF has no pages.")
        else:
            pages_b64 = [base64.b64encode(content).decode("utf-8")]

        # First-page b64 used as the doc thumbnail
        thumb_b64 = pages_b64[0] if pages_b64 else None

        doc_id = str(uuid.uuid4())
        document = {
            "id": doc_id,
            "project_id": project_id,
            "filename": file.filename,
            "mime_type": mime,
            "size": len(content),
            "image_base64": thumb_b64,
            "status": "uploaded",
            "analysis": None,
            "materials_count": 0,
            "materials_merged": 0,
            "materials_skipped": 0,
            "synced_3d": False,
            "doc_type": None,
            "pages_total": len(pages_b64),
            "pages_done": 0,
            "is_pdf": is_pdf,
            "created_at": now_iso(),
        }
        await db.documents.insert_one(document)

        await billing_mod.consume_upload_credit(db, user)
        asyncio.create_task(run_pipeline(doc_id, project_id, pages_b64, mime))

        out = {k: v for k, v in document.items() if k != "image_base64"}
        return clean(out)

    return router
