"""Legal acceptance tracking — Terms of Service + Privacy Policy.

The version strings live ALSO on the frontend (src/legal/documents.js).
The backend is the source of truth for "current version" because the auth/me
flow uses it to decide whether to gate access.

To force re-acceptance after editing legal text:
1. Bump CURRENT_TERMS_VERSION and/or CURRENT_PRIVACY_VERSION here
2. Bump the same constants in /app/frontend/src/legal/documents.js
3. Redeploy
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("legal")

# Bump these to force users to re-accept.
CURRENT_TERMS_VERSION = "2026-02-01"
CURRENT_PRIVACY_VERSION = "2026-02-01"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def needs_acceptance(user: dict | None) -> bool:
    if not user:
        return False
    accepted = user.get("legal_acceptance") or {}
    return (
        accepted.get("terms_version") != CURRENT_TERMS_VERSION
        or accepted.get("privacy_version") != CURRENT_PRIVACY_VERSION
    )


class AcceptIn(BaseModel):
    terms_version: str = Field(min_length=1, max_length=40)
    privacy_version: str = Field(min_length=1, max_length=40)
    agreed_terms: bool
    agreed_privacy: bool


def build_legal_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api/legal")

    @router.get("/current")
    async def current_versions():
        """Public — anyone can read the current version strings."""
        return {
            "terms_version": CURRENT_TERMS_VERSION,
            "privacy_version": CURRENT_PRIVACY_VERSION,
        }

    @router.get("/status")
    async def my_status(user: dict = Depends(get_current_user)):
        accepted = user.get("legal_acceptance") or {}
        return {
            "needs_acceptance": needs_acceptance(user),
            "current": {
                "terms_version": CURRENT_TERMS_VERSION,
                "privacy_version": CURRENT_PRIVACY_VERSION,
            },
            "accepted": {
                "terms_version": accepted.get("terms_version"),
                "privacy_version": accepted.get("privacy_version"),
                "accepted_at": accepted.get("accepted_at"),
            },
        }

    @router.post("/accept")
    async def accept(payload: AcceptIn,
                     request: Request,
                     user: dict = Depends(get_current_user)):
        if not (payload.agreed_terms and payload.agreed_privacy):
            raise HTTPException(400, "Both Terms and Privacy must be accepted")
        if payload.terms_version != CURRENT_TERMS_VERSION:
            raise HTTPException(400, "Terms version is out of date — refresh and try again")
        if payload.privacy_version != CURRENT_PRIVACY_VERSION:
            raise HTTPException(400, "Privacy version is out of date — refresh and try again")

        ip = ""
        try:
            ip = request.client.host if request.client else ""
            # honor common proxy headers
            xff = request.headers.get("x-forwarded-for")
            if xff:
                ip = xff.split(",")[0].strip()
        except Exception:  # noqa: BLE001
            pass

        record = {
            "terms_version": CURRENT_TERMS_VERSION,
            "privacy_version": CURRENT_PRIVACY_VERSION,
            "accepted_at": _now_iso(),
            "ip": ip[:64],
        }
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"legal_acceptance": record}},
        )
        return {"ok": True, "legal_acceptance": record}

    return router
