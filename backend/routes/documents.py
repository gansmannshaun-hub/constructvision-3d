"""Documents routes and the AI vision analysis pipeline."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage

import billing as billing_mod
from routes.projects import get_or_create_blueprint
from utils import clean, now_iso

logger = logging.getLogger("documents")


def _llm_key() -> str:
    return os.environ.get("EMERGENT_LLM_KEY", "")


ANALYSIS_PROMPT_HEADER = """You are an expert architectural and construction AI assistant.
Analyze the provided image (which may be a blueprint, floor plan, site plan, construction photo, or other document) and return a STRICT JSON response — no prose, no markdown, only valid JSON — with this exact schema:

{
  "doc_type": "floor_plan" | "blueprint" | "site_plan" | "elevation" | "photo" | "other",
  "summary": "2-3 sentence summary of what's in the image",
  "rooms": [{"name": "Living Room", "approx_area_sqft": 320}],
  "structural_notes": ["..."],
  "materials": [
    {"name": "2x4 Lumber", "category": "Framing", "quantity": 50, "unit": "pcs", "unit_price_usd": 8.5, "dedup": "new"},
    {"name": "Concrete (slab)", "category": "Structural", "quantity": 4, "unit": "cu yd", "unit_price_usd": 165.0, "dedup": "merge", "ref": 2, "rationale": "Additional wing of the same slab seen in doc #2"}
  ],
  "walls": [{"start": [x, y], "end": [x, y], "thickness": 0.2}],
  "doors": [{"position": [x, y], "width": 3, "wall_index": 0}],
  "windows": [{"position": [x, y], "width": 4, "wall_index": 0}]
}

Coordinate rules:
- All coordinates are normalized in the range 0-100 where (0,0) is top-left of the image and (100,100) is bottom-right.
- Only return walls/doors/windows if doc_type is "floor_plan", "blueprint", or "site_plan".
- For "photo" or "other", return empty arrays for walls/doors/windows.
- Materials category MUST be one of: "Structural", "Framing", "Electrical", "Plumbing", "Finishes", "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other".
- If you cannot identify materials with confidence, still return at least 3-6 plausible inferred materials based on the building type.
- unit_price_usd MUST be a realistic 2026 US construction trade rate (e.g. 2x4x8 lumber ~$6-9/pc, concrete ~$160-180/cu yd, drywall ~$15/sheet, copper wire ~$1.50/ft, PEX pipe ~$0.50/ft). Always include a non-zero estimate.

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


def _build_pipeline(db):
    async def _set_doc_status(doc_id: str, status_val: str, **extras: Any) -> None:
        await db.documents.update_one(
            {"id": doc_id},
            {"$set": {"status": status_val, "updated_at": now_iso(), **extras}},
        )

    async def run(doc_id: str, project_id: str, b64: str, mime: str) -> None:
        try:
            await asyncio.sleep(0.3)
            await _set_doc_status(doc_id, "analyzing")
            if not _llm_key():
                await _set_doc_status(doc_id, "error", error="EMERGENT_LLM_KEY missing")
                return

            existing_materials = await db.materials.find(
                {"project_id": project_id},
                {"_id": 0, "id": 1, "name": 1, "category": 1, "quantity": 1, "unit": 1},
            ).sort("created_at", 1).to_list(500)
            # ref index in the prompt is 1-based; map back to actual id
            ref_to_id = {i + 1: m["id"] for i, m in enumerate(existing_materials)}
            existing_keys = {
                _norm_key(m.get("name", ""), m.get("category", ""), m.get("unit", "")): m["id"]
                for m in existing_materials
            }

            analysis = await _analyze_image_with_ai(b64, existing_materials)
            await _set_doc_status(doc_id, "saving", doc_type=analysis.get("doc_type"))

            materials = analysis.get("materials") or []
            inserted = 0
            merged = 0
            skipped = 0
            dedup_audit = []

            for mat in materials:
                if not isinstance(mat, dict) or not mat.get("name"):
                    continue
                cat = mat.get("category") or "Other"
                if cat not in VALID_CATEGORIES:
                    cat = "Other"
                try:
                    price = float(mat.get("unit_price_usd") or 0)
                except (TypeError, ValueError):
                    price = 0.0
                qty = float(mat.get("quantity") or 0)
                unit = str(mat.get("unit") or "ea")[:24]
                name = str(mat.get("name"))[:120]

                dedup = str(mat.get("dedup") or "new").lower()
                ref = mat.get("ref")
                target_id = ref_to_id.get(int(ref)) if isinstance(ref, (int, float)) else None

                # If the AI marked new but a fuzzy key match already exists, demote to merge.
                if dedup == "new":
                    fuzzy_id = existing_keys.get(_norm_key(name, cat, unit))
                    if fuzzy_id:
                        dedup = "merge"
                        target_id = fuzzy_id

                if dedup == "skip" and target_id:
                    skipped += 1
                    dedup_audit.append({
                        "name": name, "decision": "skip",
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
                        "name": name, "decision": "merge",
                        "merged_into": target_id, "added_quantity": qty,
                        "rationale": str(mat.get("rationale") or "")[:200],
                    })
                    continue

                # "new" path
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
                    "currency": "USD",
                    "ai_extracted": True,
                    "created_at": now_iso(),
                })
                # Add the just-inserted item so subsequent items in the same response
                # don't double-count against itself.
                existing_keys[_norm_key(name, cat, unit)] = new_id
                inserted += 1
                dedup_audit.append({"name": name, "decision": "new"})

            synced = False
            doc_type = analysis.get("doc_type")
            if doc_type in {"floor_plan", "blueprint", "site_plan"}:
                await _set_doc_status(doc_id, "syncing", doc_type=doc_type, materials_count=inserted)
                walls, doors, windows = [], [], []
                for w in analysis.get("walls") or []:
                    s, e = _coord(w.get("start")), _coord(w.get("end"))
                    if s and e:
                        walls.append({
                            "id": str(uuid.uuid4()), "start": s, "end": e,
                            "thickness": float(w.get("thickness") or 0.2),
                        })
                for d_item in analysis.get("doors") or []:
                    pos = _coord(d_item.get("position"))
                    if pos:
                        doors.append({
                            "id": str(uuid.uuid4()), "position": pos,
                            "width": float(d_item.get("width") or 3.0),
                            "wall_index": int(d_item.get("wall_index") or 0),
                        })
                for w_item in analysis.get("windows") or []:
                    pos = _coord(w_item.get("position"))
                    if pos:
                        windows.append({
                            "id": str(uuid.uuid4()), "position": pos,
                            "width": float(w_item.get("width") or 4.0),
                            "wall_index": int(w_item.get("wall_index") or 0),
                        })
                if walls or doors or windows:
                    existing = await get_or_create_blueprint(db, project_id)
                    merged_walls = (existing.get("walls") or []) + walls if existing.get("walls") else walls
                    merged_doors = (existing.get("doors") or []) + doors if existing.get("doors") else doors
                    merged_windows = (existing.get("windows") or []) + windows if existing.get("windows") else windows
                    await db.blueprints.update_one(
                        {"project_id": project_id},
                        {"$set": {
                            "walls": merged_walls,
                            "doors": merged_doors,
                            "windows": merged_windows,
                            "updated_at": now_iso(),
                            "last_source_document_id": doc_id,
                        }},
                        upsert=True,
                    )
                    synced = True

            await _set_doc_status(
                doc_id, "done",
                analysis={
                    "doc_type": analysis.get("doc_type"),
                    "summary": analysis.get("summary"),
                    "rooms": analysis.get("rooms") or [],
                    "structural_notes": analysis.get("structural_notes") or [],
                },
                doc_type=doc_type,
                materials_count=inserted,
                materials_merged=merged,
                materials_skipped=skipped,
                dedup_audit=dedup_audit,
                synced_3d=synced,
            )
            logger.info(
                f"Pipeline done for {doc_id}: type={doc_type} "
                f"materials new={inserted} merged={merged} skipped={skipped} synced={synced}"
            )
        except Exception as exc:
            logger.exception(f"Pipeline failed for {doc_id}")
            await _set_doc_status(doc_id, "error", error=str(exc)[:300])

    return run


def build_documents_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")
    run_pipeline = _build_pipeline(db)

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
        if len(content) > 8 * 1024 * 1024:
            raise HTTPException(400, "File too large (max 8MB)")
        mime = file.content_type or "application/octet-stream"
        b64 = base64.b64encode(content).decode("utf-8")

        doc_id = str(uuid.uuid4())
        document = {
            "id": doc_id,
            "project_id": project_id,
            "filename": file.filename,
            "mime_type": mime,
            "size": len(content),
            "image_base64": b64 if mime.startswith("image/") else None,
            "status": "uploaded",
            "analysis": None,
            "materials_count": 0,
            "synced_3d": False,
            "doc_type": None,
            "created_at": now_iso(),
        }
        await db.documents.insert_one(document)

        if mime.startswith("image/"):
            await billing_mod.consume_upload_credit(db, user)
            asyncio.create_task(run_pipeline(doc_id, project_id, b64, mime))

        out = {k: v for k, v in document.items() if k != "image_base64"}
        return clean(out)

    return router
