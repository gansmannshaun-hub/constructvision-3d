"""Auth routes: register, login, me."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from models.auth import AuthOut, LoginIn, RegisterIn
from utils import create_token, hash_password, now_iso, verify_password


def build_auth_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api/auth")

    @router.post("/register", response_model=AuthOut)
    async def register(payload: RegisterIn):
        existing = await db.users.find_one({"email": payload.email.lower()})
        if existing:
            raise HTTPException(400, "Email already registered")
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid,
            "email": payload.email.lower(),
            "name": payload.name,
            "password_hash": hash_password(payload.password),
            "created_at": now_iso(),
        })
        proj_id = str(uuid.uuid4())
        await db.projects.insert_one({
            "id": proj_id,
            "user_id": uid,
            "name": "My First Project",
            "description": "Default project — upload a blueprint to get started",
            "created_at": now_iso(),
        })
        await db.blueprints.insert_one({
            "id": str(uuid.uuid4()),
            "project_id": proj_id,
            "walls": [], "doors": [], "windows": [],
            "updated_at": now_iso(),
        })
        token = create_token(uid, payload.email.lower())
        return AuthOut(token=token, user={
            "id": uid, "email": payload.email.lower(), "name": payload.name, "is_admin": False,
            "needs_legal_acceptance": True,
        })

    @router.post("/login", response_model=AuthOut)
    async def login(payload: LoginIn):
        user = await db.users.find_one({"email": payload.email.lower()})
        if not user or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(401, "Invalid email or password")
        if user.get("suspended"):
            raise HTTPException(403, "Account suspended. Contact support.")
        from routes.legal import needs_acceptance
        token = create_token(user["id"], user["email"])
        return AuthOut(token=token, user={
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "is_admin": bool(user.get("is_admin")),
            "needs_legal_acceptance": needs_acceptance(user),
        })

    @router.get("/me")
    async def me(user: dict = Depends(get_current_user)):
        # Lazy-import to avoid circular dependency at module load
        from routes.legal import needs_acceptance
        out = {**user}
        out["needs_legal_acceptance"] = needs_acceptance(user)
        return out

    return router
