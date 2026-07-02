"""Projects + Blueprint routes."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

import billing as billing_mod
from models.blueprint import BlueprintIn
from utils import clean, now_iso


async def get_or_create_blueprint(db, project_id: str) -> dict:
    bp = await db.blueprints.find_one({"project_id": project_id}, {"_id": 0})
    if bp:
        return bp
    bp = {
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "walls": [], "doors": [], "windows": [],
        "updated_at": now_iso(),
    }
    await db.blueprints.insert_one(bp)
    return clean(bp)


def build_projects_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

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
        await db.blueprints.insert_one({
            "id": str(uuid.uuid4()),
            "project_id": pid,
            "walls": [], "doors": [], "windows": [],
            "updated_at": now_iso(),
        })
        return clean(doc)

    @router.get("/projects/{project_id}/blueprint")
    async def get_blueprint(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        return await get_or_create_blueprint(db, project_id)

    @router.put("/projects/{project_id}/blueprint")
    async def save_blueprint(project_id: str, payload: BlueprintIn, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]})
        if not proj:
            raise HTTPException(404, "Project not found")
        await db.blueprints.update_one(
            {"project_id": project_id},
            {"$set": {
                "walls": payload.walls,
                "doors": payload.doors,
                "windows": payload.windows,
                "labels": payload.labels,
                "fixtures": payload.fixtures,
                "roof_type": payload.roof_type,
                "roof_pitch_deg": payload.roof_pitch_deg,
                "wall_color": payload.wall_color,
                "roof_color": payload.roof_color,
                "updated_at": now_iso(),
            }},
            upsert=True,
        )
        return await get_or_create_blueprint(db, project_id)

    return router
