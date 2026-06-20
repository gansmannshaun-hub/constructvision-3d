"""Collaboration routes: project members + roles, activity feed, comments,
and white-label branding for the public share link.

Roles (most → least privilege):
- owner     : full access, billing, member management
- pm        : project manager, can edit everything, manage members
- estimator : can edit materials, pricing, bids; read documents/blueprint/3D
- viewer    : read-only across all tabs

The project's `user_id` (the user who created it) is always the implicit owner.
Other members live in db.project_members.
"""
from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from utils import now_iso

ROLES = ("owner", "pm", "estimator", "viewer")
EDIT_ROLES = {"owner", "pm", "estimator"}
MANAGE_ROLES = {"owner", "pm"}


async def get_role(db, project_id: str, user: dict) -> Optional[str]:
    """Return the user's role on a project, or None if not a member."""
    proj = await db.projects.find_one({"id": project_id}, {"_id": 0, "user_id": 1})
    if not proj:
        return None
    if proj["user_id"] == user["id"]:
        return "owner"
    m = await db.project_members.find_one(
        {"project_id": project_id, "user_email": user["email"], "accepted": True},
        {"_id": 0, "role": 1},
    )
    return m["role"] if m else None


async def require_role(db, project_id: str, user: dict, allowed: set[str]) -> str:
    role = await get_role(db, project_id, user)
    if role is None:
        raise HTTPException(404, "Project not found")
    if role not in allowed:
        raise HTTPException(403, f"Requires role: {', '.join(sorted(allowed))}")
    return role


async def log_activity(db, project_id: str, user_email: str, action: str,
                       target_type: str = "", target_id: str = "", target_name: str = "") -> None:
    await db.activity_log.insert_one({
        "id": str(uuid.uuid4()),
        "project_id": project_id,
        "user_email": user_email,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "target_name": target_name[:120],
        "created_at": now_iso(),
    })


# ---------- Pydantic ----------

class MemberInviteIn(BaseModel):
    email: EmailStr
    role: str = Field(default="estimator")


class MemberPatchIn(BaseModel):
    role: str


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=1500)
    target_type: str = Field(pattern=r"^(general|document|material|blueprint)$")
    target_id: str = ""


class BrandingIn(BaseModel):
    company_name: Optional[str] = Field(default=None, max_length=80)
    accent_color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    logo_data_url: Optional[str] = None  # data:image/...;base64,...
    tagline: Optional[str] = Field(default=None, max_length=160)


def build_collab_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    # ============ MEMBERS ============

    @router.get("/projects/{project_id}/members")
    async def list_members(project_id: str, user: dict = Depends(get_current_user)):
        role = await require_role(db, project_id, user, set(ROLES))
        proj = await db.projects.find_one({"id": project_id}, {"_id": 0, "user_id": 1})
        owner = await db.users.find_one({"id": proj["user_id"]}, {"_id": 0, "email": 1, "name": 1}) or {}
        members = await db.project_members.find(
            {"project_id": project_id}, {"_id": 0},
        ).sort("invited_at", -1).to_list(100)
        return {
            "your_role": role,
            "owner": {"email": owner.get("email"), "name": owner.get("name"), "role": "owner"},
            "members": members,
        }

    @router.post("/projects/{project_id}/members")
    async def invite_member(project_id: str, payload: MemberInviteIn, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, MANAGE_ROLES)
        role = payload.role.lower()
        if role not in ROLES or role == "owner":
            raise HTTPException(400, "Invalid role")
        email = payload.email.lower()
        # Already invited?
        existing = await db.project_members.find_one(
            {"project_id": project_id, "user_email": email}, {"_id": 0},
        )
        if existing:
            raise HTTPException(400, "Already invited")
        # Existing user with this email auto-accepts on invite
        target_user = await db.users.find_one({"email": email}, {"_id": 0, "id": 1})
        doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "user_email": email,
            "role": role,
            "invited_by": user["email"],
            "invited_at": now_iso(),
            "accepted": bool(target_user),
            "accepted_at": now_iso() if target_user else None,
        }
        await db.project_members.insert_one(doc)
        doc.pop("_id", None)
        await log_activity(db, project_id, user["email"], "member.invited",
                           target_type="member", target_id=email, target_name=f"{email} as {role}")
        return doc

    @router.patch("/projects/{project_id}/members/{member_email}")
    async def change_role(project_id: str, member_email: str, payload: MemberPatchIn,
                          user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, MANAGE_ROLES)
        role = payload.role.lower()
        if role not in ROLES or role == "owner":
            raise HTTPException(400, "Invalid role")
        res = await db.project_members.update_one(
            {"project_id": project_id, "user_email": member_email.lower()},
            {"$set": {"role": role, "updated_at": now_iso()}},
        )
        if res.matched_count == 0:
            raise HTTPException(404, "Member not found")
        await log_activity(db, project_id, user["email"], "member.role_changed",
                           target_type="member", target_id=member_email, target_name=f"{member_email} → {role}")
        return {"ok": True, "role": role}

    @router.delete("/projects/{project_id}/members/{member_email}")
    async def remove_member(project_id: str, member_email: str, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, MANAGE_ROLES)
        res = await db.project_members.delete_one(
            {"project_id": project_id, "user_email": member_email.lower()},
        )
        if res.deleted_count == 0:
            raise HTTPException(404, "Member not found")
        await log_activity(db, project_id, user["email"], "member.removed",
                           target_type="member", target_id=member_email, target_name=member_email)
        return {"ok": True}

    @router.get("/projects-shared-with-me")
    async def projects_shared(user: dict = Depends(get_current_user)):
        rows = await db.project_members.find(
            {"user_email": user["email"], "accepted": True}, {"_id": 0},
        ).to_list(100)
        if not rows:
            return []
        project_ids = [r["project_id"] for r in rows]
        projects = await db.projects.find(
            {"id": {"$in": project_ids}}, {"_id": 0},
        ).to_list(len(project_ids))
        pmap = {p["id"]: p for p in projects}
        out = []
        for r in rows:
            p = pmap.get(r["project_id"])
            if p:
                out.append({**p, "role": r["role"]})
        return out

    # ============ ACTIVITY FEED ============

    @router.get("/projects/{project_id}/activity")
    async def activity(project_id: str, limit: int = 50, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, set(ROLES))
        return await db.activity_log.find(
            {"project_id": project_id}, {"_id": 0},
        ).sort("created_at", -1).limit(max(1, min(limit, 200))).to_list(200)

    # ============ COMMENTS ============

    MENTION_RE = re.compile(r"@([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})")

    @router.get("/projects/{project_id}/comments")
    async def list_comments(project_id: str, target_type: str = "", target_id: str = "",
                            user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, set(ROLES))
        q: dict = {"project_id": project_id}
        if target_type:
            q["target_type"] = target_type
        if target_id:
            q["target_id"] = target_id
        return await db.comments.find(q, {"_id": 0}).sort("created_at", 1).to_list(500)

    @router.post("/projects/{project_id}/comments")
    async def create_comment(project_id: str, payload: CommentIn, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, EDIT_ROLES | {"viewer"})  # viewers can comment too
        mentions = list(set(MENTION_RE.findall(payload.body)))
        doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "target_type": payload.target_type,
            "target_id": payload.target_id,
            "body": payload.body.strip(),
            "author_email": user["email"],
            "author_name": user.get("name") or user["email"],
            "mentions": mentions,
            "created_at": now_iso(),
        }
        await db.comments.insert_one(doc)
        doc.pop("_id", None)
        target_name = f"{payload.target_type}:{payload.target_id[:8]}" if payload.target_id else payload.target_type
        await log_activity(db, project_id, user["email"], "comment.added",
                           target_type="comment", target_id=doc["id"], target_name=target_name)
        return doc

    @router.delete("/comments/{comment_id}")
    async def delete_comment(comment_id: str, user: dict = Depends(get_current_user)):
        c = await db.comments.find_one({"id": comment_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Comment not found")
        # Author can delete their own; PM/owner can delete any
        role = await get_role(db, c["project_id"], user)
        if c["author_email"] != user["email"] and role not in MANAGE_ROLES:
            raise HTTPException(403, "Not allowed")
        await db.comments.delete_one({"id": comment_id})
        return {"ok": True}

    # ============ BRANDING (white-label share link) ============

    @router.get("/projects/{project_id}/branding")
    async def get_branding(project_id: str, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, set(ROLES))
        b = await db.project_branding.find_one({"project_id": project_id}, {"_id": 0})
        return b or {"project_id": project_id, "company_name": "", "accent_color": "#0055FF",
                     "logo_data_url": "", "tagline": ""}

    @router.put("/projects/{project_id}/branding")
    async def set_branding(project_id: str, payload: BrandingIn, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, MANAGE_ROLES)
        update: dict = {"updated_at": now_iso(), "project_id": project_id}
        for f in ("company_name", "accent_color", "tagline"):
            v = getattr(payload, f)
            if v is not None:
                update[f] = v
        if payload.logo_data_url is not None:
            if payload.logo_data_url and not payload.logo_data_url.startswith("data:image/"):
                raise HTTPException(400, "logo_data_url must be a data:image/... URL")
            if len(payload.logo_data_url) > 600_000:
                raise HTTPException(400, "Logo too large (max ~450KB after base64)")
            update["logo_data_url"] = payload.logo_data_url
        await db.project_branding.update_one(
            {"project_id": project_id}, {"$set": update}, upsert=True,
        )
        await log_activity(db, project_id, user["email"], "branding.updated")
        return await db.project_branding.find_one({"project_id": project_id}, {"_id": 0})

    # ============ INVITE LANDING ============

    @router.get("/invites/{token}")
    async def get_invite(token: str):
        """Public preview of an invite — used by /invite/{token} landing page."""
        member = await db.project_members.find_one({"id": token}, {"_id": 0})
        if not member:
            raise HTTPException(404, "Invite not found or expired")
        proj = await db.projects.find_one({"id": member["project_id"]}, {"_id": 0, "name": 1})
        inviter = await db.users.find_one(
            {"email": member.get("invited_by")},
            {"_id": 0, "name": 1, "email": 1},
        ) or {}
        existing_user = await db.users.find_one(
            {"email": member["user_email"]}, {"_id": 0, "id": 1},
        )
        return {
            "token": token,
            "email": member["user_email"],
            "role": member["role"],
            "project_id": member["project_id"],
            "project_name": (proj or {}).get("name", "(unknown project)"),
            "invited_by_name": inviter.get("name") or inviter.get("email") or "A teammate",
            "accepted": member.get("accepted", False),
            "needs_signup": existing_user is None,
        }

    @router.post("/invites/{token}/accept")
    async def accept_invite(token: str, user: dict = Depends(get_current_user)):
        """Authenticated user accepts. Must match the invite's email."""
        member = await db.project_members.find_one({"id": token}, {"_id": 0})
        if not member:
            raise HTTPException(404, "Invite not found")
        if member["user_email"].lower() != user["email"].lower():
            raise HTTPException(403, "This invite was sent to a different email")
        if member.get("accepted"):
            return {"ok": True, "already_accepted": True, "project_id": member["project_id"]}
        await db.project_members.update_one(
            {"id": token},
            {"$set": {"accepted": True, "accepted_at": now_iso()}},
        )
        await log_activity(db, member["project_id"], user["email"], "member.accepted",
                           target_type="member", target_id=user["email"],
                           target_name=f"{user['email']} as {member['role']}")
        return {"ok": True, "already_accepted": False, "project_id": member["project_id"]}

    return router
