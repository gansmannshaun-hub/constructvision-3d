"""HTTP routes for the documents API — upload / list / image / retry.

The heavy AI pipeline itself lives in `.pipeline`; this module wires it
up to FastAPI endpoints and owns the auxiliary flows (per-doc retry,
bulk retry-all, stuck-doc boot recovery, prior-run artifact purge).
"""
from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile

import billing as billing_mod
from models.sheet import SheetReanalyzeIn
from utils import clean, now_iso

from .ai_vision import _reanalyze_with_walls
from .pipeline import _build_pipeline
from .rasterize import _rasterize_pdf_pages, _shrink_image_bytes_to_b64


logger = logging.getLogger("documents.routes")


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
        fallback_used = True
        # Look up a per-page image whenever `page` is provided. Even page=1
        # may have a distinct rendered image once retries or re-analysis
        # regenerate it — falling back to the doc-level thumbnail only
        # when no per-page row exists preserves backward compatibility.
        if page and page >= 1:
            sheet = await db.blueprint_sheets.find_one(
                {"source_document_id": doc_id, "source_page": page},
                {"_id": 0, "page_image_base64": 1},
            )
            per_page = (sheet or {}).get("page_image_base64")
            if per_page:
                image_b64 = per_page
                fallback_used = False
        return {
            "id": doc["id"],
            "filename": doc.get("filename"),
            "mime_type": "image/jpeg",
            "image_base64": image_b64,
            "page": page or 1,
            "fallback": fallback_used,   # true when we served doc thumbnail instead of a per-page image
        }

    @router.post("/projects/{project_id}/documents/upload")
    async def upload_document(
        project_id: str,
        file: UploadFile = File(...),
        sheet_label_hint: str | None = Form(default=None),
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
        # Whitelist the label hint to the known view_type enum so a malicious
        # or typo'd value can't derail the AI prompt.
        VALID_HINTS = {
            "floor_plan", "blueprint", "site_plan", "elevation",
            "framing_plan", "roof_plan", "sheathing_plan", "electrical_plan",
            "plumbing_plan", "hvac_plan", "foundation_plan", "detail",
            "photo", "other",
        }
        normalized_hint = None
        if sheet_label_hint and sheet_label_hint in VALID_HINTS:
            normalized_hint = sheet_label_hint
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
            "sheet_label_hint": normalized_hint,
            "created_at": now_iso(),
        }
        await db.documents.insert_one(document)
        await billing_mod.consume_upload_credit(db, user)

        # Kick off the async prepare + pipeline task. It does:
        #   1. Rasterize (PDF) or shrink (image) in a worker thread
        #   2. Update the doc with `pages_total` + first-page thumbnail
        #   3. Run the analysis pipeline (AI, sheet creation, etc.)
        asyncio.create_task(_prepare_and_run(doc_id, project_id, content, is_pdf, mime, normalized_hint))

        out = {k: v for k, v in document.items() if k != "image_base64"}
        return clean(out)

    async def _prepare_and_run(doc_id: str, project_id: str, content: bytes,
                               is_pdf: bool, mime: str,
                               sheet_label_hint: str | None = None) -> None:
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
            await run_pipeline(doc_id, project_id, pages_b64, mime, sheet_label_hint)
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

    @router.post("/blueprint_sheets/{sheet_id}/reanalyze-with-walls")
    async def reanalyze_sheet_with_walls(
        sheet_id: str,
        payload: SheetReanalyzeIn = Body(...),
        user: dict = Depends(get_current_user),
    ):
        """Manual-trace re-analyze. User has drawn walls on the sheet — GPT-4o
        keeps those walls unchanged and extracts matching doors, windows,
        labels, and fixtures. Materials are not touched (use the standard
        `/documents/{id}/retry` for a full re-run).
        """
        sheet = await db.blueprint_sheets.find_one({"id": sheet_id}, {"_id": 0})
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        proj = await db.projects.find_one(
            {"id": sheet["project_id"], "user_id": user["id"]}, {"_id": 0},
        )
        if not proj:
            raise HTTPException(403, "Forbidden")

        # Sanitize + gate the incoming walls list.
        raw_walls = payload.walls or []
        if len(raw_walls) > 400:
            raise HTTPException(400, "Too many walls (max 400)")
        walls: list[dict] = []
        for w in raw_walls:
            start = w.get("start")
            end = w.get("end")
            if not (isinstance(start, list) and isinstance(end, list) and len(start) == 2 and len(end) == 2):
                continue
            try:
                walls.append({
                    "id": w.get("id") or str(uuid.uuid4()),
                    "start": [float(start[0]), float(start[1])],
                    "end": [float(end[0]), float(end[1])],
                    "thickness": float(w.get("thickness") or 0.5),
                    "source": "manual",
                })
            except (TypeError, ValueError):
                continue
        if not walls:
            raise HTTPException(400, "No valid walls provided")

        # Fetch the sheet's page image (falls back to the doc thumbnail).
        b64 = sheet.get("page_image_base64")
        if not b64 and sheet.get("source_document_id"):
            src_doc = await db.documents.find_one(
                {"id": sheet["source_document_id"]}, {"_id": 0, "image_base64": 1},
            )
            b64 = (src_doc or {}).get("image_base64")
        if not b64:
            raise HTTPException(400, "Original page image not cached. Please re-upload the source document.")

        try:
            result = await _reanalyze_with_walls(b64, walls)
        except Exception as exc:
            logger.exception(f"Reanalyze failed for sheet {sheet_id}")
            raise HTTPException(502, f"AI re-analysis failed: {str(exc)[:200]}")

        # Sanitize the AI response before persisting.
        doors_out: list[dict] = []
        for d in (result.get("doors") or [])[:200]:
            pos = d.get("position")
            if not (isinstance(pos, list) and len(pos) == 2):
                continue
            try:
                wi = int(d.get("wall_index") or 0)
            except (TypeError, ValueError):
                wi = 0
            wi = max(0, min(wi, len(walls) - 1))
            try:
                doors_out.append({
                    "id": str(uuid.uuid4()),
                    "position": [float(pos[0]), float(pos[1])],
                    "width": float(d.get("width") or 3.0),
                    "wall_index": wi,
                })
            except (TypeError, ValueError):
                continue
        windows_out: list[dict] = []
        for w in (result.get("windows") or [])[:200]:
            pos = w.get("position")
            if not (isinstance(pos, list) and len(pos) == 2):
                continue
            try:
                wi = int(w.get("wall_index") or 0)
            except (TypeError, ValueError):
                wi = 0
            wi = max(0, min(wi, len(walls) - 1))
            try:
                windows_out.append({
                    "id": str(uuid.uuid4()),
                    "position": [float(pos[0]), float(pos[1])],
                    "width": float(w.get("width") or 4.0),
                    "wall_index": wi,
                })
            except (TypeError, ValueError):
                continue

        # Reuse the sanitizers from the pipeline for labels/fixtures.
        from .sanitize import _sanitize_fixture, _sanitize_label
        labels_out = [x for x in (_sanitize_label(lbl) for lbl in (result.get("labels") or [])[:150]) if x]
        fixtures_out = [x for x in (_sanitize_fixture(fx) for fx in (result.get("fixtures") or [])[:200]) if x]

        # Compute building_ft from walls if AI didn't provide sane values.
        bft = result.get("building_ft") or sheet.get("building_ft") or {}
        try:
            bft_w = float(bft.get("w") or 0)
            bft_h = float(bft.get("h") or 0)
        except (TypeError, ValueError):
            bft_w = bft_h = 0.0
        if bft_w <= 0 or bft_h <= 0:
            max_x = max((w["end"][0] for w in walls), default=0)
            max_x = max(max_x, max((w["start"][0] for w in walls), default=0))
            max_y = max((w["end"][1] for w in walls), default=0)
            max_y = max(max_y, max((w["start"][1] for w in walls), default=0))
            bft_w = max(max_x, 1.0)
            bft_h = max(max_y, 1.0)

        await db.blueprint_sheets.update_one(
            {"id": sheet_id},
            {"$set": {
                "walls": walls,
                "doors": doors_out,
                "windows": windows_out,
                "labels": labels_out,
                "fixtures": fixtures_out,
                "building_ft": {"w": bft_w, "h": bft_h},
                "scale_confidence": "manual",
                "manual_walls_locked": True,
                "updated_at": now_iso(),
            }},
        )
        # Mirror into the parent blueprint if this is the active sheet.
        bp = await db.blueprints.find_one({"project_id": sheet["project_id"]}, {"_id": 0}) or {}
        if bp.get("active_sheet_id") == sheet_id:
            from routes.projects import _mirror_active_sheet_to_blueprint
            await _mirror_active_sheet_to_blueprint(db, sheet["project_id"], sheet_id)
        return await db.blueprint_sheets.find_one({"id": sheet_id}, {"_id": 0})

    return router
