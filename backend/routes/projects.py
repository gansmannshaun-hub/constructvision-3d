"""Projects + Blueprint (multi-sheet) routes.

Architecture
------------
Each project has ONE `blueprints` doc (roof/color settings + `active_sheet_id`)
and 1..N `blueprint_sheets` docs (walls/doors/windows/labels/fixtures per
uploaded blueprint or hand-drawn layer).

Backward compatibility
----------------------
Downstream consumers (takeoff / pricing / share / renderer) still read the
`blueprints` doc directly for `bp.walls`, `bp.doors`, ... — so we MIRROR the
active sheet's geometry into the blueprints doc on every write.  This lets us
keep the sheet layer additive without touching every module that touched the
old single-blueprint shape.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

import billing as billing_mod
from models.blueprint import BlueprintIn
from models.sheet import SheetCreateIn, SheetGeometryIn, SheetPatchIn
from utils import clean, now_iso


# ---------- Sheet helpers ----------

EMPTY_SHEET_GEOM = {"walls": [], "doors": [], "windows": [], "labels": [], "fixtures": []}


async def _list_sheets(db, project_id: str) -> list[dict]:
    return await db.blueprint_sheets.find(
        {"project_id": project_id}, {"_id": 0}
    ).sort("order_index", 1).to_list(200)


async def _create_sheet(db, project_id: str, *, name: str, floor_level: int = 0,
                        order_index: Optional[int] = None,
                        source_document_id: Optional[str] = None,
                        source_page: Optional[int] = None,
                        geometry: Optional[dict] = None,
                        building_ft: Optional[dict] = None,
                        scale_confidence: Optional[str] = None,
                        view_type: Optional[str] = None,
                        assembly_data: Optional[dict] = None,
                        facing_override: Optional[str] = None) -> dict:
    if order_index is None:
        count = await db.blueprint_sheets.count_documents({"project_id": project_id})
        order_index = count
    geom = {**EMPTY_SHEET_GEOM, **(geometry or {})}
    sheet = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "name": name[:80],
        "floor_level": floor_level,
        "order_index": order_index,
        "source_document_id": source_document_id,
        "source_page": source_page,               # 1-based page number for multi-page PDF sheets
        "view_type": view_type or "floor_plan",
        "walls": geom["walls"],
        "doors": geom["doors"],
        "windows": geom["windows"],
        "labels": geom["labels"],
        "fixtures": geom["fixtures"],
        "building_ft": building_ft,
        "scale_confidence": scale_confidence,
        "assembly_data": assembly_data,          # elevation / roof-plan structured data (see documents.py)
        "facing_override": facing_override,       # user-chosen "front" | "back" | "left" | "right"
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.blueprint_sheets.insert_one(sheet)
    return clean(sheet)


async def _mirror_active_sheet_to_blueprint(db, project_id: str, sheet_id: str) -> None:
    """Mirror an active sheet's geometry into the parent blueprints doc so
    downstream `bp.walls` / `bp.doors` etc. consumers keep working."""
    sheet = await db.blueprint_sheets.find_one(
        {"id": sheet_id, "project_id": project_id}, {"_id": 0}
    )
    if not sheet:
        return
    await db.blueprints.update_one(
        {"project_id": project_id},
        {"$set": {
            "walls":    sheet.get("walls") or [],
            "doors":    sheet.get("doors") or [],
            "windows":  sheet.get("windows") or [],
            "labels":   sheet.get("labels") or [],
            "fixtures": sheet.get("fixtures") or [],
            "active_sheet_id": sheet_id,
            "updated_at": now_iso(),
        }},
        upsert=True,
    )


async def _migrate_legacy_blueprint(db, project_id: str, bp: dict) -> str:
    """If the project has geometry in the legacy `blueprints` doc but no
    `blueprint_sheets`, promote it to Sheet 1 and record `active_sheet_id`.
    Returns the active sheet id."""
    existing_count = await db.blueprint_sheets.count_documents({"project_id": project_id})
    if existing_count > 0:
        # Sheets already exist; ensure active_sheet_id is set.
        if not bp.get("active_sheet_id"):
            first = await db.blueprint_sheets.find_one(
                {"project_id": project_id}, {"_id": 0}, sort=[("order_index", 1)]
            )
            if first:
                await db.blueprints.update_one(
                    {"project_id": project_id},
                    {"$set": {"active_sheet_id": first["id"]}},
                )
                return first["id"]
        return bp.get("active_sheet_id") or ""

    # No sheets yet — migrate the legacy doc's geometry into a first sheet.
    geometry = {
        "walls":    bp.get("walls") or [],
        "doors":    bp.get("doors") or [],
        "windows":  bp.get("windows") or [],
        "labels":   bp.get("labels") or [],
        "fixtures": bp.get("fixtures") or [],
    }
    sheet = await _create_sheet(
        db, project_id,
        name="Sheet 1",
        floor_level=0,
        order_index=0,
        geometry=geometry,
    )
    await db.blueprints.update_one(
        {"project_id": project_id},
        {"$set": {"active_sheet_id": sheet["id"]}},
    )
    return sheet["id"]


async def get_or_create_blueprint(db, project_id: str) -> dict:
    """Return the aggregate blueprint (roof settings + ACTIVE sheet geometry +
    list of all sheets). Auto-migrates legacy single-blueprint projects."""
    bp = await db.blueprints.find_one({"project_id": project_id}, {"_id": 0})
    if not bp:
        bp = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "walls": [], "doors": [], "windows": [], "labels": [], "fixtures": [],
            "active_sheet_id": None,
            "updated_at": now_iso(),
        }
        await db.blueprints.insert_one(bp)

    # Ensure at least ONE sheet exists + a valid active_sheet_id.
    active_id = await _migrate_legacy_blueprint(db, project_id, bp)
    if not active_id:
        sheet = await _create_sheet(
            db, project_id, name="Sheet 1", floor_level=0, order_index=0,
        )
        active_id = sheet["id"]
        await db.blueprints.update_one(
            {"project_id": project_id},
            {"$set": {"active_sheet_id": active_id}},
        )

    # Backfill contract-shape.
    bp.setdefault("labels", [])
    bp.setdefault("fixtures", [])
    bp["active_sheet_id"] = active_id
    bp["sheets"] = await _list_sheets(db, project_id)
    return bp


# ---------- Router ----------

def build_projects_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def _require_project(project_id: str, user: dict) -> dict:
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        return proj

    @router.get("/projects")
    async def list_projects(user: dict = Depends(get_current_user)):
        return await db.projects.find(
            {"user_id": user["id"]}, {"_id": 0}
        ).sort("created_at", -1).to_list(100)

    @router.post("/projects")
    async def create_project(payload: dict, user: dict = Depends(get_current_user)):
        user = await billing_mod.ensure_user_subscription(db, user)
        existing_count = await db.projects.count_documents({"user_id": user["id"]})
        ok, reason = await billing_mod.can_create_project(db, user, existing_count)
        if not ok:
            raise HTTPException(402, reason)
        pid = str(uuid.uuid4())
        doc = {
            "id": pid,
            "user_id": user["id"],
            "name": payload.get("name", "Untitled Project"),
            "description": payload.get("description", ""),
            "created_at": now_iso(),
        }
        await db.projects.insert_one(doc)
        # Seed parent blueprints doc + a first empty Sheet 1.
        first_sheet = await _create_sheet(db, pid, name="Sheet 1", floor_level=0, order_index=0)
        await db.blueprints.insert_one({
            "id": str(uuid.uuid4()),
            "project_id": pid,
            "walls": [], "doors": [], "windows": [], "labels": [], "fixtures": [],
            "active_sheet_id": first_sheet["id"],
            "updated_at": now_iso(),
        })
        return clean(doc)

    @router.get("/projects/{project_id}/blueprint")
    async def get_blueprint(project_id: str, user: dict = Depends(get_current_user)):
        await _require_project(project_id, user)
        return await get_or_create_blueprint(db, project_id)

    @router.put("/projects/{project_id}/blueprint")
    async def save_blueprint(project_id: str, payload: BlueprintIn,
                             user: dict = Depends(get_current_user)):
        """Legacy endpoint — writes geometry into the ACTIVE sheet and mirrors
        it into the parent blueprints doc. Roof settings live on the parent."""
        await _require_project(project_id, user)
        bp = await get_or_create_blueprint(db, project_id)
        active_id = bp["active_sheet_id"]
        await db.blueprint_sheets.update_one(
            {"id": active_id, "project_id": project_id},
            {"$set": {
                "walls":    payload.walls,
                "doors":    payload.doors,
                "windows":  payload.windows,
                "labels":   payload.labels,
                "fixtures": payload.fixtures,
                "updated_at": now_iso(),
            }},
        )
        await db.blueprints.update_one(
            {"project_id": project_id},
            {"$set": {
                "walls":    payload.walls,
                "doors":    payload.doors,
                "windows":  payload.windows,
                "labels":   payload.labels,
                "fixtures": payload.fixtures,
                "roof_type": payload.roof_type,
                "roof_pitch_deg": payload.roof_pitch_deg,
                "wall_color": payload.wall_color,
                "roof_color": payload.roof_color,
                "wall_height_ft": payload.wall_height_ft,
                "manual_override": bool(payload.manual_override),
                "updated_at": now_iso(),
            }},
            upsert=True,
        )
        return await get_or_create_blueprint(db, project_id)

    # ---------- Sheet CRUD ----------

    @router.get("/projects/{project_id}/blueprint/sheets")
    async def list_sheets_route(project_id: str, user: dict = Depends(get_current_user)):
        await _require_project(project_id, user)
        # Ensure at least one sheet + active pointer.
        await get_or_create_blueprint(db, project_id)
        return await _list_sheets(db, project_id)

    @router.post("/projects/{project_id}/blueprint/sheets")
    async def create_sheet_route(project_id: str, payload: SheetCreateIn,
                                 user: dict = Depends(get_current_user)):
        await _require_project(project_id, user)
        await get_or_create_blueprint(db, project_id)  # ensure baseline
        sheet = await _create_sheet(
            db, project_id, name=payload.name, floor_level=payload.floor_level,
        )
        return sheet

    @router.patch("/projects/{project_id}/blueprint/sheets/{sheet_id}")
    async def patch_sheet_route(project_id: str, sheet_id: str, payload: SheetPatchIn,
                                user: dict = Depends(get_current_user)):
        await _require_project(project_id, user)
        update: dict = {"updated_at": now_iso()}
        if payload.name is not None:
            update["name"] = payload.name[:80]
        if payload.floor_level is not None:
            update["floor_level"] = payload.floor_level
        if payload.order_index is not None:
            update["order_index"] = payload.order_index
        if payload.facing_override is not None:
            update["facing_override"] = None if payload.facing_override == "clear" else payload.facing_override
        if payload.assembly_data is not None:
            update["assembly_data"] = payload.assembly_data
        result = await db.blueprint_sheets.update_one(
            {"id": sheet_id, "project_id": project_id},
            {"$set": update},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Sheet not found")
        return await db.blueprint_sheets.find_one(
            {"id": sheet_id, "project_id": project_id}, {"_id": 0}
        )

    @router.put("/projects/{project_id}/blueprint/sheets/{sheet_id}")
    async def save_sheet_geometry(project_id: str, sheet_id: str, payload: SheetGeometryIn,
                                  user: dict = Depends(get_current_user)):
        await _require_project(project_id, user)
        result = await db.blueprint_sheets.update_one(
            {"id": sheet_id, "project_id": project_id},
            {"$set": {
                "walls":    payload.walls,
                "doors":    payload.doors,
                "windows":  payload.windows,
                "labels":   payload.labels,
                "fixtures": payload.fixtures,
                "updated_at": now_iso(),
            }},
        )
        if result.matched_count == 0:
            raise HTTPException(404, "Sheet not found")
        # If this is the active sheet, mirror into the parent blueprint doc.
        bp = await db.blueprints.find_one({"project_id": project_id}, {"_id": 0}) or {}
        if bp.get("active_sheet_id") == sheet_id:
            await _mirror_active_sheet_to_blueprint(db, project_id, sheet_id)
        return await db.blueprint_sheets.find_one(
            {"id": sheet_id, "project_id": project_id}, {"_id": 0}
        )

    @router.delete("/projects/{project_id}/blueprint/sheets/{sheet_id}")
    async def delete_sheet_route(project_id: str, sheet_id: str,
                                 user: dict = Depends(get_current_user)):
        await _require_project(project_id, user)
        # Never allow deletion of the last remaining sheet — keep at least 1.
        count = await db.blueprint_sheets.count_documents({"project_id": project_id})
        if count <= 1:
            raise HTTPException(400, "Cannot delete the only remaining sheet")
        result = await db.blueprint_sheets.delete_one(
            {"id": sheet_id, "project_id": project_id}
        )
        if result.deleted_count == 0:
            raise HTTPException(404, "Sheet not found")
        # If active sheet was deleted, activate the first remaining sheet.
        bp = await db.blueprints.find_one({"project_id": project_id}, {"_id": 0}) or {}
        if bp.get("active_sheet_id") == sheet_id:
            first = await db.blueprint_sheets.find_one(
                {"project_id": project_id}, {"_id": 0}, sort=[("order_index", 1)]
            )
            if first:
                await _mirror_active_sheet_to_blueprint(db, project_id, first["id"])
        return {"deleted": True}

    @router.post("/projects/{project_id}/blueprint/active/{sheet_id}")
    async def set_active_sheet(project_id: str, sheet_id: str,
                               user: dict = Depends(get_current_user)):
        await _require_project(project_id, user)
        sheet = await db.blueprint_sheets.find_one(
            {"id": sheet_id, "project_id": project_id}, {"_id": 0}
        )
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        await _mirror_active_sheet_to_blueprint(db, project_id, sheet_id)
        return await get_or_create_blueprint(db, project_id)

    return router
