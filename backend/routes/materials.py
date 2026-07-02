"""Materials routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from models.materials import MaterialPatchIn
from utils import now_iso


def build_materials_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/projects/{project_id}/materials")
    async def list_materials(project_id: str, sheet_id: str | None = None,
                             user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        query: dict = {"project_id": project_id}
        if sheet_id:
            query["sheet_id"] = sheet_id
        return await db.materials.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)

    @router.patch("/materials/{material_id}")
    async def update_material(material_id: str, payload: MaterialPatchIn, user: dict = Depends(get_current_user)):
        mat = await db.materials.find_one({"id": material_id}, {"_id": 0})
        if not mat:
            raise HTTPException(404, "Material not found")
        proj = await db.projects.find_one({"id": mat["project_id"], "user_id": user["id"]})
        if not proj:
            raise HTTPException(403, "Forbidden")
        update = {}
        if payload.unit_price is not None:
            update["unit_price"] = round(max(float(payload.unit_price), 0.0), 2)
        if payload.labor_unit_price is not None:
            update["labor_unit_price"] = round(max(float(payload.labor_unit_price), 0.0), 2)
        if payload.quantity is not None:
            update["quantity"] = max(float(payload.quantity), 0.0)
        if payload.name is not None and payload.name.strip():
            update["name"] = payload.name.strip()[:120]
        if not update:
            raise HTTPException(400, "Nothing to update")
        update["updated_at"] = now_iso()
        await db.materials.update_one({"id": material_id}, {"$set": update})
        return await db.materials.find_one({"id": material_id}, {"_id": 0})

    @router.delete("/materials/{material_id}")
    async def delete_material(material_id: str, user: dict = Depends(get_current_user)):
        mat = await db.materials.find_one({"id": material_id}, {"_id": 0})
        if not mat:
            raise HTTPException(404, "Material not found")
        proj = await db.projects.find_one({"id": mat["project_id"], "user_id": user["id"]})
        if not proj:
            raise HTTPException(403, "Forbidden")
        await db.materials.delete_one({"id": material_id})
        return {"ok": True}

    return router
