"""Background AI analysis pipeline for uploaded documents.

`_build_pipeline(db)` returns a coroutine `run(doc_id, project_id, pages_b64, mime)`
that is scheduled as an asyncio task by the upload route. The pipeline:
  1. Runs GPT-4o Vision per page (semaphore-gated, retries, per-project lock)
  2. Traces walls (AI + OpenCV) for floor-plan-like doc types
  3. Deduplicates materials against prior docs
  4. Creates blueprint sheets (one per page for multi-page PDFs)
  5. Mirrors the active sheet to the blueprint doc
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from routes.opencv_tracer import trace_walls_from_image
from routes.projects import _create_sheet, _mirror_active_sheet_to_blueprint, get_or_create_blueprint
from utils import now_iso

from .ai_vision import _analyze_image_with_ai, _analyze_view_structure, _llm_key
from .sanitize import (
    VALID_CATEGORIES,
    _coord,
    _norm_key,
    _sanitize_fixture,
    _sanitize_label,
)


logger = logging.getLogger("documents.pipeline")


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
