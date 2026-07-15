"""Public waitlist endpoint — captures interest for apps that aren't yet
deployed (Vision-CAD, Site-Vision, future placeholders).

- POST /api/waitlist/join — public, no auth. Body: {email, app_id, note?}
- GET  /api/admin/waitlist — admin-only. Returns all signups, most recent first.

Design:
- Emails are normalized (lowercased, trimmed) so `(email, app_id)` is a
  natural dedupe key.
- We use an upsert with `$setOnInsert` on `created_at` so re-submitting the
  same email for the same app doesn't grow the collection.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WaitlistJoinIn(BaseModel):
    email: EmailStr
    app_id: str = Field(min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=500)


def build_waitlist_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.post("/waitlist/join")
    async def join_waitlist(payload: WaitlistJoinIn):
        email = payload.email.strip().lower()
        if not EMAIL_RE.match(email):
            raise HTTPException(422, "Invalid email")
        app_id = payload.app_id.strip().lower()
        now_iso = datetime.now(timezone.utc).isoformat()
        await db.waitlist.update_one(
            {"email": email, "app_id": app_id},
            {
                "$set": {"updated_at": now_iso, "note": payload.note or None},
                "$setOnInsert": {"email": email, "app_id": app_id, "created_at": now_iso},
            },
            upsert=True,
        )
        return {"ok": True, "app_id": app_id}

    @router.get("/admin/waitlist")
    async def list_waitlist(user: dict = Depends(get_current_user)):
        if not user.get("is_admin"):
            raise HTTPException(403, "Admin only")
        rows = await db.waitlist.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        # Group counts by app for a quick summary
        counts: dict[str, int] = {}
        for r in rows:
            counts[r.get("app_id", "unknown")] = counts.get(r.get("app_id", "unknown"), 0) + 1
        return {"total": len(rows), "by_app": counts, "signups": rows}

    return router
