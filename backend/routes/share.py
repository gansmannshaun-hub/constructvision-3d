"""Public sharing of read-only project views.

Each project can have a single share token. The owner can rotate (regenerate) or
revoke it. Anyone with the token can read project name, blueprint geometry,
materials list (including auto-computed utilities) and download a takeoff PDF/CSV.
No auth required for the public endpoints.
"""
from __future__ import annotations

import secrets
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from routes.projects import get_or_create_blueprint
from routes.takeoff import _build_combined_materials, _safe_name
from utils import now_iso


def _new_token() -> str:
    return secrets.token_urlsafe(18)


def build_share_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    # ---- Owner endpoints (auth) ----
    @router.get("/projects/{project_id}/share")
    async def get_share(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        return {
            "enabled": bool(proj.get("share_token")),
            "token": proj.get("share_token"),
            "created_at": proj.get("share_created_at"),
        }

    @router.post("/projects/{project_id}/share")
    async def enable_share(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        token = proj.get("share_token") or _new_token()
        await db.projects.update_one(
            {"id": project_id},
            {"$set": {"share_token": token, "share_created_at": now_iso()}},
        )
        return {"enabled": True, "token": token}

    @router.post("/projects/{project_id}/share/rotate")
    async def rotate_share(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        token = _new_token()
        await db.projects.update_one(
            {"id": project_id},
            {"$set": {"share_token": token, "share_created_at": now_iso()}},
        )
        return {"enabled": True, "token": token}

    @router.delete("/projects/{project_id}/share")
    async def disable_share(project_id: str, user: dict = Depends(get_current_user)):
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        await db.projects.update_one(
            {"id": project_id},
            {"$unset": {"share_token": "", "share_created_at": ""}},
        )
        return {"enabled": False}

    # ---- Public endpoints (no auth) ----
    async def _resolve_shared_project(token: str) -> dict:
        proj = await db.projects.find_one({"share_token": token}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Share link not found or revoked")
        return proj

    @router.get("/share/{token}")
    async def get_shared_project(token: str):
        proj = await _resolve_shared_project(token)
        # Owner contact (first name only) for branding
        owner = await db.users.find_one(
            {"id": proj["user_id"]},
            {"_id": 0, "name": 1, "email": 1, "entitlements": 1},
        ) or {}
        bp = await get_or_create_blueprint(db, proj["id"])
        mats = await _build_combined_materials(db, proj["id"])

        grand_total = sum(
            float(m.get("quantity") or 0) * float(m.get("unit_price") or 0) for m in mats
        )
        materials_public = [
            {
                "name": m.get("name"),
                "category": m.get("category"),
                "quantity": m.get("quantity"),
                "unit": m.get("unit"),
                "unit_price": m.get("unit_price"),
                "currency": m.get("currency", "USD"),
                "ai_extracted": bool(m.get("ai_extracted")),
                "auto_computed": bool(m.get("auto_computed")),
            }
            for m in mats
        ]
        return {
            "project": {
                "id": proj["id"],
                "name": proj["name"],
                "description": proj.get("description"),
                "created_at": proj.get("created_at"),
            },
            "owner": {"name": owner.get("name") or "", "email": owner.get("email") or ""},
            "blueprint": {
                "walls": bp.get("walls") or [],
                "doors": bp.get("doors") or [],
                "windows": bp.get("windows") or [],
                "labels": bp.get("labels") or [],
                "roof_type": bp.get("roof_type"),
                "roof_pitch_deg": bp.get("roof_pitch_deg"),
                "wall_color": bp.get("wall_color"),
                "roof_color": bp.get("roof_color"),
            },
            "materials": materials_public,
            "grand_total": round(grand_total, 2),
            "share_created_at": proj.get("share_created_at"),
        }

    @router.get("/share/{token}/takeoff.csv")
    async def shared_csv(token: str, request: Request):
        import csv
        proj = await _resolve_shared_project(token)
        mats = await _build_combined_materials(db, proj["id"])
        from io import StringIO
        sio = StringIO()
        w = csv.writer(sio)
        w.writerow(["Category", "Material", "Quantity", "Unit", "Unit Price (USD)", "Line Total (USD)", "Source"])
        grand = 0.0
        for m in sorted(mats, key=lambda x: (x.get("category") or "", x.get("name") or "")):
            qty = float(m.get("quantity") or 0)
            price = float(m.get("unit_price") or 0)
            line = qty * price
            grand += line
            src = "AUTO" if m.get("auto_computed") else ("AI" if m.get("ai_extracted") else "")
            w.writerow([m.get("category") or "Other", m.get("name") or "", f"{qty:g}",
                        m.get("unit") or "", f"{price:.2f}", f"{line:.2f}", src])
        w.writerow([])
        w.writerow(["", "", "", "", "GRAND TOTAL", f"{grand:.2f}", ""])
        out = sio.getvalue().encode("utf-8-sig")
        safe = _safe_name(proj["name"])
        return StreamingResponse(
            BytesIO(out),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="atlas_takeoff_{safe}.csv"'},
        )

    return router
