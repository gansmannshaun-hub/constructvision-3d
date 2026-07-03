"""Admin + User-Settings module.

Adds:
- Seeded admin (env ADMIN_EMAIL) — created on first boot if missing.
- /api/admin/* endpoints (admin-only): users / projects / billing / settings / ai / audit
- /api/user/* endpoints (current user): profile / password / preferences / notifications / sessions / export / delete

System settings are stored in a single `system_settings` doc (id='global') and override
the in-code CATALOG / PLAN_LIMITS / AI prompt defaults.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import string
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

import billing as billing_mod

logger = logging.getLogger("admin")

SETTINGS_DOC_ID = "global"
ADMIN_EMAIL_DEFAULT = "admin@atlas.app"


def now() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now().isoformat()


def _hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _gen_password(n: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(alphabet) for _ in range(n))


async def _seed_default_project(db, user_id: str) -> str:
    pid = str(uuid.uuid4())
    await db.projects.insert_one({
        "id": pid, "user_id": user_id,
        "name": "My First Project",
        "description": "Default project — upload a blueprint to get started",
        "created_at": now_iso(),
    })
    await db.blueprints.insert_one({
        "id": str(uuid.uuid4()), "project_id": pid,
        "walls": [], "doors": [], "windows": [],
        "updated_at": now_iso(),
    })
    return pid


async def _cascade_delete_user(db, user_id: str) -> None:
    """Remove a user and every downstream document (projects, blueprints,
    sheets, materials, documents, usage, payments, sessions). Called by
    both the single-delete and bulk-delete endpoints."""
    project_ids = [
        p["id"] for p in await db.projects.find({"user_id": user_id}, {"id": 1}).to_list(2000)
    ]
    if project_ids:
        await db.documents.delete_many({"project_id": {"$in": project_ids}})
        await db.materials.delete_many({"project_id": {"$in": project_ids}})
        await db.blueprints.delete_many({"project_id": {"$in": project_ids}})
        await db.blueprint_sheets.delete_many({"project_id": {"$in": project_ids}})
    await db.projects.delete_many({"user_id": user_id})
    await db.usage_periods.delete_many({"user_id": user_id})
    await db.payment_transactions.delete_many({"user_id": user_id})
    await db.sessions.delete_many({"user_id": user_id})
    await db.users.delete_one({"id": user_id})




async def seed_admin(db) -> Optional[dict]:
    """Ensure admin user exists. Returns (email, password) if newly created, else None."""
    admin_email = (os.environ.get("ADMIN_EMAIL") or ADMIN_EMAIL_DEFAULT).lower()
    existing = await db.users.find_one({"email": admin_email})
    if existing:
        # Make sure flag is set even on legacy rows
        if not existing.get("is_admin"):
            await db.users.update_one({"id": existing["id"]}, {"$set": {"is_admin": True}})
        # Ensure default project
        proj_count = await db.projects.count_documents({"user_id": existing["id"]})
        if proj_count == 0:
            await _seed_default_project(db, existing["id"])
        return None

    password = _gen_password()
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid,
        "email": admin_email,
        "name": "Atlas Admin",
        "password_hash": _hash_password(password),
        "is_admin": True,
        "created_at": now_iso(),
        "subscription": billing_mod.default_subscription() | {
            "tier": billing_mod.PLAN_STUDIO,
            "status": "active",
            "current_period_start": now_iso(),
            "current_period_end": "2999-12-31T00:00:00+00:00",
        },
        "entitlements": billing_mod.default_entitlements() | {"pdf_premium_branding": True},
        "preferences": _default_preferences(),
        "notifications": _default_notifications(),
    })
    await _seed_default_project(db, uid)
    # Persist credentials for first-time admin recovery
    creds_path = "/app/memory/test_credentials.md"
    try:
        os.makedirs(os.path.dirname(creds_path), exist_ok=True)
        # Append admin creds without disturbing existing content
        sep = (
            "\n\n## Seeded Admin (do not commit to git)\n"
            f"- URL: `/admin` (after login)\n"
            f"- Email: `{admin_email}`\n"
            f"- Password: `{password}`\n"
            f"- Created at: {now_iso()}\n"
        )
        with open(creds_path, "a") as f:
            f.write(sep)
    except Exception as e:
        logger.warning(f"Could not write admin creds to {creds_path}: {e}")
    logger.info("=" * 60)
    logger.info("SEEDED ADMIN ACCOUNT")
    logger.info(f"  Email:    {admin_email}")
    logger.info(f"  Password: {password}")
    logger.info("  (saved to /app/memory/test_credentials.md)")
    logger.info("=" * 60)
    return {"email": admin_email, "password": password}


def _default_preferences() -> dict:
    return {
        "currency": "USD",
        "units": "imperial",   # imperial | metric
        "date_format": "MMM D, YYYY",
        "theme": "dark",
    }


def _default_notifications() -> dict:
    return {
        "email_trial_ending": True,
        "email_low_credits": True,
        "email_payment_receipts": True,
        "email_product_updates": False,
        "email_daily_digest": True,
    }


# ---------- System Settings ----------
async def get_system_settings(db) -> dict:
    doc = await db.system_settings.find_one({"id": SETTINGS_DOC_ID}, {"_id": 0})
    if not doc:
        doc = {
            "id": SETTINGS_DOC_ID,
            "catalog_overrides": {},
            "plan_limits_overrides": {},
            "ai_model": "gpt-4o",
            "ai_provider": "openai",
            "ai_system_prompt_override": None,
            "updated_at": now_iso(),
        }
        await db.system_settings.insert_one(doc)
        doc.pop("_id", None)
    return doc


async def get_effective_catalog(db) -> dict:
    settings = await get_system_settings(db)
    catalog = {k: dict(v) for k, v in billing_mod.CATALOG.items()}
    for key, override in (settings.get("catalog_overrides") or {}).items():
        if key in catalog and isinstance(override, dict):
            catalog[key].update(override)
    return catalog


async def get_effective_plan_limits(db) -> dict:
    settings = await get_system_settings(db)
    limits = {k: dict(v) for k, v in billing_mod.PLAN_LIMITS.items()}
    for tier, override in (settings.get("plan_limits_overrides") or {}).items():
        if tier in limits and isinstance(override, dict):
            limits[tier].update(override)
    return limits


# ---------- Audit ----------
async def audit(db, actor_id: str, action: str, target: Optional[str] = None, meta: Optional[dict] = None) -> None:
    await db.audit_log.insert_one({
        "id": str(uuid.uuid4()),
        "actor_id": actor_id,
        "action": action,
        "target": target,
        "meta": meta or {},
        "created_at": now_iso(),
    })


# ---------- Admin guard ----------
def require_admin_dep(get_current_user):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if not user.get("is_admin"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
        return user
    return _dep


# ---------- Pydantic models ----------
class UpdateUserIn(BaseModel):
    plan_tier: Optional[str] = None    # free | pro | studio
    plan_status: Optional[str] = None  # active | trialing | free | expired | suspended
    bonus_credits: Optional[int] = None
    rush_credits: Optional[int] = None
    pdf_premium_branding: Optional[bool] = None
    is_admin: Optional[bool] = None
    suspended: Optional[bool] = None
    name: Optional[str] = None


class BulkDeleteIn(BaseModel):
    user_ids: List[str]
    include_admins: bool = False   # safety — must explicitly opt in to delete admin accounts


class UpdateSystemSettingsIn(BaseModel):
    catalog_overrides: Optional[dict] = None
    plan_limits_overrides: Optional[dict] = None
    ai_model: Optional[str] = None
    ai_provider: Optional[str] = None
    ai_system_prompt_override: Optional[str] = None


class ProfileIn(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class PreferencesIn(BaseModel):
    currency: Optional[str] = None
    units: Optional[str] = None         # imperial | metric
    date_format: Optional[str] = None
    theme: Optional[str] = None


class NotificationsIn(BaseModel):
    email_trial_ending: Optional[bool] = None
    email_low_credits: Optional[bool] = None
    email_payment_receipts: Optional[bool] = None
    email_product_updates: Optional[bool] = None
    email_daily_digest: Optional[bool] = None


# ---------- Admin Router ----------
def build_admin_router(db, get_current_user) -> APIRouter:
    require_admin = require_admin_dep(get_current_user)
    api = APIRouter(prefix="/api/admin")

    @api.get("/overview")
    async def overview(admin: dict = Depends(require_admin)):
        total_users = await db.users.count_documents({})
        admin_count = await db.users.count_documents({"is_admin": True})
        pro = await db.users.count_documents({"subscription.tier": "pro", "subscription.status": {"$in": ["active", "trialing"]}})
        studio = await db.users.count_documents({"subscription.tier": "studio", "subscription.status": {"$in": ["active", "trialing"]}})
        trialing = await db.users.count_documents({"subscription.status": "trialing"})
        projects = await db.projects.count_documents({})
        docs = await db.documents.count_documents({})
        materials = await db.materials.count_documents({})
        # revenue
        paid_txns = await db.payment_transactions.find(
            {"payment_status": "paid"}, {"_id": 0, "amount": 1, "currency": 1, "completed_at": 1, "kind": 1, "item": 1}
        ).to_list(2000)
        revenue = sum(float(t.get("amount") or 0) for t in paid_txns)
        return {
            "users": {
                "total": total_users,
                "admins": admin_count,
                "free": total_users - pro - studio,
                "pro": pro,
                "studio": studio,
                "trialing": trialing,
            },
            "projects": projects,
            "documents": docs,
            "materials": materials,
            "revenue": {
                "currency": "USD",
                "total_paid": round(revenue, 2),
                "transactions_count": len(paid_txns),
            },
        }

    @api.get("/users")
    async def list_users(q: str = "", limit: int = 100, admin: dict = Depends(require_admin)):
        flt = {}
        if q:
            flt = {"$or": [
                {"email": {"$regex": q, "$options": "i"}},
                {"name": {"$regex": q, "$options": "i"}},
            ]}
        users = await db.users.find(flt, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(limit)
        # Augment each with project counts — batched via aggregation (O(1) round-trips).
        if users:
            user_ids = [u["id"] for u in users]
            counts = await db.projects.aggregate([
                {"$match": {"user_id": {"$in": user_ids}}},
                {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
            ]).to_list(None)
            count_map = {c["_id"]: c["count"] for c in counts}
            for u in users:
                u["project_count"] = count_map.get(u["id"], 0)
        return users

    @api.get("/users/{user_id}")
    async def get_user(user_id: str, admin: dict = Depends(require_admin)):
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        if not u:
            raise HTTPException(404, "User not found")
        u["project_count"] = await db.projects.count_documents({"user_id": user_id})
        usage = await db.usage_periods.find({"user_id": user_id}, {"_id": 0}).sort("period", -1).to_list(6)
        u["recent_usage"] = usage
        return u

    @api.patch("/users/{user_id}")
    async def update_user(user_id: str, payload: UpdateUserIn, admin: dict = Depends(require_admin)):
        u = await db.users.find_one({"id": user_id})
        if not u:
            raise HTTPException(404, "User not found")
        sub = u.get("subscription") or billing_mod.default_subscription()
        ent = u.get("entitlements") or billing_mod.default_entitlements()
        sets = {}

        if payload.plan_tier is not None:
            if payload.plan_tier not in {"free", "pro", "studio"}:
                raise HTTPException(400, "Invalid tier")
            sub["tier"] = payload.plan_tier
        if payload.plan_status is not None:
            if payload.plan_status not in {"free", "trialing", "active", "expired", "suspended"}:
                raise HTTPException(400, "Invalid status")
            sub["status"] = payload.plan_status
        if payload.plan_tier is not None or payload.plan_status is not None:
            sets["subscription"] = sub

        if payload.bonus_credits is not None:
            ent["bonus_credits"] = max(0, int(payload.bonus_credits))
        if payload.rush_credits is not None:
            ent["rush_credits"] = max(0, int(payload.rush_credits))
        if payload.pdf_premium_branding is not None:
            ent["pdf_premium_branding"] = bool(payload.pdf_premium_branding)
        if any([payload.bonus_credits is not None, payload.rush_credits is not None, payload.pdf_premium_branding is not None]):
            sets["entitlements"] = ent

        if payload.is_admin is not None:
            sets["is_admin"] = bool(payload.is_admin)
        if payload.suspended is not None:
            sets["suspended"] = bool(payload.suspended)
        if payload.name is not None and payload.name.strip():
            sets["name"] = payload.name.strip()[:80]

        if not sets:
            raise HTTPException(400, "Nothing to update")
        sets["updated_at"] = now_iso()
        await db.users.update_one({"id": user_id}, {"$set": sets})
        await audit(db, admin["id"], "admin.user.update", target=user_id, meta={"fields": list(sets.keys())})
        u2 = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        return u2

    @api.delete("/users/{user_id}")
    async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
        if user_id == admin["id"]:
            raise HTTPException(400, "Cannot delete yourself")
        u = await db.users.find_one({"id": user_id})
        if not u:
            raise HTTPException(404, "User not found")
        await _cascade_delete_user(db, user_id)
        await audit(db, admin["id"], "admin.user.delete", target=user_id, meta={"email": u.get("email")})
        return {"ok": True}

    @api.post("/users/bulk-delete")
    async def bulk_delete_users(payload: BulkDeleteIn, admin: dict = Depends(require_admin)):
        ids = [uid for uid in (payload.user_ids or []) if uid and uid != admin["id"]]
        if not ids:
            return {"ok": True, "deleted": 0, "skipped_self": (admin["id"] in (payload.user_ids or [])), "not_found": []}
        # Prevent deleting other admins unless explicitly opted-in.
        found = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "email": 1, "is_admin": 1}).to_list(len(ids))
        found_ids = {u["id"] for u in found}
        not_found = [uid for uid in ids if uid not in found_ids]
        skipped_admin = []
        if not payload.include_admins:
            skipped_admin = [u["id"] for u in found if u.get("is_admin")]
        deletable_ids = [u["id"] for u in found if u["id"] not in skipped_admin]
        for uid in deletable_ids:
            await _cascade_delete_user(db, uid)
        await audit(db, admin["id"], "admin.user.bulk_delete", target=None, meta={
            "requested": len(payload.user_ids or []),
            "deleted": len(deletable_ids),
            "skipped_admin_ids": skipped_admin,
            "not_found": not_found,
        })
        return {
            "ok": True,
            "deleted": len(deletable_ids),
            "deleted_ids": deletable_ids,
            "skipped_admin_ids": skipped_admin,
            "not_found": not_found,
            "skipped_self": (admin["id"] in (payload.user_ids or [])),
        }


    @api.get("/projects")
    async def list_all_projects(limit: int = 200, admin: dict = Depends(require_admin)):
        projs = await db.projects.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
        if not projs:
            return projs
        # Join user email
        user_ids = list({p["user_id"] for p in projs})
        users = await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "email": 1, "name": 1}).to_list(len(user_ids))
        umap = {u["id"]: u for u in users}
        # Batched per-project counts via aggregation — avoids N+1.
        pids = [p["id"] for p in projs]
        doc_counts = await db.documents.aggregate([
            {"$match": {"project_id": {"$in": pids}}},
            {"$group": {"_id": "$project_id", "count": {"$sum": 1}}},
        ]).to_list(None)
        mat_counts = await db.materials.aggregate([
            {"$match": {"project_id": {"$in": pids}}},
            {"$group": {"_id": "$project_id", "count": {"$sum": 1}}},
        ]).to_list(None)
        doc_map = {d["_id"]: d["count"] for d in doc_counts}
        mat_map = {m["_id"]: m["count"] for m in mat_counts}
        for p in projs:
            u = umap.get(p["user_id"]) or {}
            p["user_email"] = u.get("email")
            p["user_name"] = u.get("name")
            p["doc_count"] = doc_map.get(p["id"], 0)
            p["material_count"] = mat_map.get(p["id"], 0)
        return projs

    @api.get("/billing/summary")
    async def billing_summary(admin: dict = Depends(require_admin)):
        # MRR estimate: count active pro/studio
        pro = await db.users.count_documents({"subscription.tier": "pro", "subscription.status": "active"})
        studio = await db.users.count_documents({"subscription.tier": "studio", "subscription.status": "active"})
        trialing = await db.users.count_documents({"subscription.status": "trialing"})
        mrr = pro * 49.0 + studio * 149.0
        # Conversion: trials_started vs converted
        trials_started = await db.users.count_documents({"subscription.trial_used": True})
        converted = await db.users.count_documents({"subscription.trial_used": True, "subscription.status": "active"})
        conv_rate = (converted / trials_started * 100) if trials_started else 0
        total_paid = await db.payment_transactions.aggregate([
            {"$match": {"payment_status": "paid"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "n": {"$sum": 1}}},
        ]).to_list(1)
        return {
            "mrr_usd": round(mrr, 2),
            "pro_subscribers": pro,
            "studio_subscribers": studio,
            "trialing": trialing,
            "trials_started": trials_started,
            "trial_converted": converted,
            "trial_conversion_pct": round(conv_rate, 1),
            "total_paid_usd": round(float(total_paid[0]["total"]) if total_paid else 0, 2),
            "paid_transactions": (total_paid[0]["n"] if total_paid else 0),
        }

    @api.get("/billing/transactions")
    async def list_transactions(limit: int = 100, admin: dict = Depends(require_admin)):
        txns = await db.payment_transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
        return txns

    @api.get("/settings")
    async def get_settings(admin: dict = Depends(require_admin)):
        s = await get_system_settings(db)
        return {
            "settings": s,
            "default_catalog": billing_mod.CATALOG,
            "default_plan_limits": billing_mod.PLAN_LIMITS,
            "effective_catalog": await get_effective_catalog(db),
            "effective_plan_limits": await get_effective_plan_limits(db),
        }

    @api.put("/settings")
    async def update_settings(payload: UpdateSystemSettingsIn, admin: dict = Depends(require_admin)):
        sets = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
        if not sets:
            raise HTTPException(400, "Nothing to update")
        sets["updated_at"] = now_iso()
        await db.system_settings.update_one(
            {"id": SETTINGS_DOC_ID}, {"$set": sets}, upsert=True,
        )
        await audit(db, admin["id"], "admin.settings.update", meta={"fields": list(sets.keys())})
        return await get_system_settings(db)

    @api.get("/ai-settings")
    async def get_ai_settings(admin: dict = Depends(require_admin)):
        s = await get_system_settings(db)
        # Token usage = sum of analyses (approximate via documents.status=='done')
        analyzed = await db.documents.count_documents({"status": "done"})
        return {
            "ai_model": s.get("ai_model") or "gpt-4o",
            "ai_provider": s.get("ai_provider") or "openai",
            "ai_system_prompt_override": s.get("ai_system_prompt_override"),
            "default_system_prompt": "You are a construction blueprint analysis expert. You output only valid JSON.",
            "available_models": [
                {"id": "gpt-4o", "provider": "openai", "label": "GPT-4o (vision)"},
                {"id": "gpt-5.2", "provider": "openai", "label": "GPT-5.2 (vision)"},
                {"id": "gemini-3-pro", "provider": "gemini", "label": "Gemini 3 Pro (vision)"},
                {"id": "claude-sonnet-4.5", "provider": "anthropic", "label": "Claude Sonnet 4.5 (text only)"},
            ],
            "analyzed_documents_count": analyzed,
        }

    @api.get("/audit-log")
    async def audit_log(limit: int = 100, admin: dict = Depends(require_admin)):
        rows = await db.audit_log.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
        # Join actor email
        ids = list({r["actor_id"] for r in rows if r.get("actor_id")})
        users = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "email": 1}).to_list(len(ids))
        umap = {u["id"]: u for u in users}
        for r in rows:
            r["actor_email"] = (umap.get(r.get("actor_id")) or {}).get("email")
        return rows

    return api


# ---------- User Settings Router ----------
def build_user_router(db, get_current_user) -> APIRouter:
    api = APIRouter(prefix="/api/user")

    @api.put("/profile")
    async def update_profile(payload: ProfileIn, user: dict = Depends(get_current_user)):
        sets = {}
        if payload.name is not None and payload.name.strip():
            sets["name"] = payload.name.strip()[:80]
        if payload.email is not None:
            new_email = payload.email.lower()
            if new_email != user["email"]:
                existing = await db.users.find_one({"email": new_email})
                if existing:
                    raise HTTPException(400, "Email already in use")
                sets["email"] = new_email
        if not sets:
            raise HTTPException(400, "Nothing to update")
        sets["updated_at"] = now_iso()
        await db.users.update_one({"id": user["id"]}, {"$set": sets})
        await audit(db, user["id"], "user.profile.update", meta={"fields": list(sets.keys())})
        return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})

    @api.put("/password")
    async def update_password(payload: PasswordIn, user: dict = Depends(get_current_user)):
        u = await db.users.find_one({"id": user["id"]})
        if not u or not _verify_password(payload.current_password, u["password_hash"]):
            raise HTTPException(400, "Current password is incorrect")
        if payload.current_password == payload.new_password:
            raise HTTPException(400, "New password must be different")
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"password_hash": _hash_password(payload.new_password), "updated_at": now_iso()}},
        )
        await audit(db, user["id"], "user.password.update")
        return {"ok": True}

    @api.get("/preferences")
    async def get_prefs(user: dict = Depends(get_current_user)):
        u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "preferences": 1})
        return (u or {}).get("preferences") or _default_preferences()

    @api.put("/preferences")
    async def update_prefs(payload: PreferencesIn, user: dict = Depends(get_current_user)):
        u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "preferences": 1})
        prefs = (u or {}).get("preferences") or _default_preferences()
        for k, v in payload.model_dump(exclude_unset=True).items():
            if v is not None:
                prefs[k] = v
        await db.users.update_one({"id": user["id"]}, {"$set": {"preferences": prefs}})
        return prefs

    @api.get("/notifications")
    async def get_notifs(user: dict = Depends(get_current_user)):
        u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "notifications": 1})
        return (u or {}).get("notifications") or _default_notifications()

    @api.put("/notifications")
    async def update_notifs(payload: NotificationsIn, user: dict = Depends(get_current_user)):
        u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "notifications": 1})
        notifs = (u or {}).get("notifications") or _default_notifications()
        for k, v in payload.model_dump(exclude_unset=True).items():
            if v is not None:
                notifs[k] = v
        await db.users.update_one({"id": user["id"]}, {"$set": {"notifications": notifs}})
        return notifs

    @api.get("/sessions")
    async def list_sessions(user: dict = Depends(get_current_user)):
        rows = await db.sessions.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        return rows

    @api.delete("/sessions/{session_id}")
    async def revoke_session(session_id: str, user: dict = Depends(get_current_user)):
        r = await db.sessions.delete_one({"id": session_id, "user_id": user["id"]})
        if not r.deleted_count:
            raise HTTPException(404, "Session not found")
        return {"ok": True}

    @api.delete("/sessions")
    async def revoke_all(user: dict = Depends(get_current_user)):
        r = await db.sessions.delete_many({"user_id": user["id"]})
        return {"ok": True, "revoked": r.deleted_count}

    @api.get("/export")
    async def export_data(user: dict = Depends(get_current_user)):
        u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
        projects = await db.projects.find({"user_id": user["id"]}, {"_id": 0}).to_list(1000)
        pids = [p["id"] for p in projects]
        docs = await db.documents.find({"project_id": {"$in": pids}}, {"_id": 0, "image_base64": 0}).to_list(5000)
        mats = await db.materials.find({"project_id": {"$in": pids}}, {"_id": 0}).to_list(5000)
        bps = await db.blueprints.find({"project_id": {"$in": pids}}, {"_id": 0}).to_list(2000)
        usage = await db.usage_periods.find({"user_id": user["id"]}, {"_id": 0}).to_list(60)
        txns = await db.payment_transactions.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
        bundle = {
            "exported_at": now_iso(),
            "user": u,
            "projects": projects,
            "documents": docs,
            "materials": mats,
            "blueprints": bps,
            "usage_periods": usage,
            "payment_transactions": txns,
        }

        async def _stream():
            yield json.dumps(bundle, indent=2, default=str).encode("utf-8")

        return StreamingResponse(
            _stream(),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="atlas_export_{user["id"][:8]}.json"'},
        )

    @api.delete("/account")
    async def delete_account(user: dict = Depends(get_current_user)):
        if user.get("is_admin"):
            raise HTTPException(400, "Admin accounts can only be deleted by another admin via the admin panel.")
        uid = user["id"]
        pids = [p["id"] for p in await db.projects.find({"user_id": uid}, {"id": 1}).to_list(1000)]
        await db.documents.delete_many({"project_id": {"$in": pids}})
        await db.materials.delete_many({"project_id": {"$in": pids}})
        await db.blueprints.delete_many({"project_id": {"$in": pids}})
        await db.blueprint_sheets.delete_many({"project_id": {"$in": pids}})
        await db.projects.delete_many({"user_id": uid})
        await db.usage_periods.delete_many({"user_id": uid})
        await db.payment_transactions.delete_many({"user_id": uid})
        await db.sessions.delete_many({"user_id": uid})
        await db.users.delete_one({"id": uid})
        await audit(db, uid, "user.account.delete")
        return {"ok": True}

    return api
