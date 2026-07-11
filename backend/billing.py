"""Billing module — plan/entitlement model + Stripe checkout integration.

Design:
- 3 plans: free / pro / studio.
- 7-day Pro trial available once per user (CC capture via Stripe checkout — for now we
  grant the trial in DB and the frontend collects CC on the Stripe page when the
  user upgrades; this is simple and swappable for true Stripe Billing later).
- Subscriptions are billed as monthly one-time charges that grant 30-day entitlements.
- Three a-la-carte add-ons:
    * uploads_25  — $9 → +25 bonus_credits
    * pdf_branding — $19 → permanent entitlement
    * rush         — $4 → +1 rush credit (priority re-analysis)
- All entitlements are idempotently applied on payment_status === 'paid' (looking up
  by session_id, only once).
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from emergentintegrations.payments.stripe.checkout import (
    CheckoutSessionRequest,
    StripeCheckout,
)

logger = logging.getLogger("billing")


# ---------- Plan + price config ----------
PLAN_FREE = "free"
PLAN_PRO = "pro"
PLAN_STUDIO = "studio"

# Per-month upload allowance; -1 = unlimited
PLAN_LIMITS = {
    PLAN_FREE: {
        "projects_max": 1,
        "ai_uploads_per_month": 5,
        "pdf_downloads_allowed": False,
        "watermarked_pdf": True,
        "priority_ai": False,
    },
    PLAN_PRO: {
        "projects_max": -1,
        "ai_uploads_per_month": 100,
        "pdf_downloads_allowed": True,
        "watermarked_pdf": False,
        "priority_ai": False,
    },
    PLAN_STUDIO: {
        "projects_max": -1,
        "ai_uploads_per_month": -1,
        "pdf_downloads_allowed": True,
        "watermarked_pdf": False,
        "priority_ai": True,
    },
}

# Server-defined catalog — frontend can NEVER set prices
CATALOG = {
    "pro_monthly": {
        "kind": "subscription",
        "tier": PLAN_PRO,
        "amount": 49.00,
        "currency": "usd",
        "label": "Pro — Monthly",
        "period_days": 30,
    },
    "studio_monthly": {
        "kind": "subscription",
        "tier": PLAN_STUDIO,
        "amount": 149.00,
        "currency": "usd",
        "label": "Studio — Monthly",
        "period_days": 30,
    },
    "addon_uploads_25": {
        "kind": "addon",
        "amount": 9.00,
        "currency": "usd",
        "label": "+25 AI Upload Credits",
        "effect": {"bonus_credits": 25},
    },
    "addon_pdf_branding": {
        "kind": "addon",
        "amount": 19.00,
        "currency": "usd",
        "label": "Premium PDF Branding (one-time)",
        "effect": {"pdf_premium_branding": True},
    },
    "addon_rush": {
        "kind": "addon",
        "amount": 4.00,
        "currency": "usd",
        "label": "Rush Priority Re-analysis",
        "effect": {"rush_credits": 1},
    },
    "addon_renders_5": {
        "kind": "addon",
        "amount": 19.00,
        "currency": "usd",
        "label": "Studio Render Pack · 5× 4K",
        "description": "Five high-resolution 4K renders to share with clients.",
        "effect": {"studio_render_credits": 5},
    },
    "addon_video_1": {
        "kind": "addon",
        "amount": 29.00,
        "currency": "usd",
        "label": "Walkthrough Video · 1080p MP4",
        "description": "One 60-second walkthrough video, render-quality MP4.",
        "effect": {"walkthrough_video_credits": 1},
    },
    "addon_videos_5": {
        "kind": "addon",
        "amount": 99.00,
        "currency": "usd",
        "label": "Walkthrough Video Pack · 5× 1080p (save ~32%)",
        "description": "Bundle: 5 walkthrough videos.",
        "effect": {"walkthrough_video_credits": 5},
    },
    "addon_payapps_10": {
        "kind": "addon",
        "amount": 39.00,
        "currency": "usd",
        "label": "AIA Pay App PDFs · 10-pack",
        "description": "Generate 10 G702/G703 payment-app PDFs.",
        "effect": {"payapp_pdf_credits": 10},
    },
    "addon_client_branding": {
        "kind": "addon",
        "amount": 25.00,
        "currency": "usd",
        "label": "Client Portal Branding",
        "description": "Custom logo + brand color + remove 'Powered by Atlas' footer on shared portals.",
        "effect": {"client_branding_unlocked": True},
    },
    "addon_floorplans_25": {
        "kind": "addon",
        "amount": 29.00,
        "currency": "usd",
        "label": "AI Floorplan Boost · 25 generations",
        "description": "25 GPT-4o text-to-floorplan generations on top of your plan limit.",
        "effect": {"ai_floorplan_credits": 25},
    },
}

TRIAL_DAYS = 7


def now() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now().isoformat()


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


# ---------- Entitlement / plan resolution ----------
def default_subscription() -> dict:
    return {
        "tier": PLAN_FREE,
        "status": "free",  # free | trialing | active | expired
        "trial_used": False,
        "trial_ends_at": None,
        "current_period_start": None,
        "current_period_end": None,
        "stripe_customer_id": None,
    }


def default_entitlements() -> dict:
    return {
        "bonus_credits": 0,
        "rush_credits": 0,
        "pdf_premium_branding": False,
        "lifetime_uploads": 0,
        "lifetime_pdfs": 0,
        "studio_render_credits": 0,
        "walkthrough_video_credits": 0,
        "payapp_pdf_credits": 0,
        "ai_floorplan_credits": 0,
        "client_branding_unlocked": False,
    }


def _current_period_key(d: Optional[datetime] = None) -> str:
    d = d or now()
    return d.strftime("%Y-%m")


async def ensure_user_subscription(db, user: dict) -> dict:
    """Return user with subscription/entitlements fields ensured."""
    needs_update = False
    if "subscription" not in user:
        user["subscription"] = default_subscription()
        needs_update = True
    if "entitlements" not in user:
        user["entitlements"] = default_entitlements()
        needs_update = True

    sub = user["subscription"]
    # Auto-expire trial / paid period
    tier = sub.get("tier") or PLAN_FREE
    if sub.get("status") == "trialing" and sub.get("trial_ends_at"):
        if datetime.fromisoformat(sub["trial_ends_at"]) < now():
            sub["status"] = "expired"
            sub["tier"] = PLAN_FREE
            needs_update = True
    if sub.get("status") == "active" and sub.get("current_period_end"):
        if datetime.fromisoformat(sub["current_period_end"]) < now():
            sub["status"] = "expired"
            sub["tier"] = PLAN_FREE
            needs_update = True
    _ = tier

    if needs_update:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "subscription": user["subscription"],
                "entitlements": user["entitlements"],
            }},
        )
    return user


def current_plan(user: dict) -> str:
    sub = user.get("subscription") or {}
    if sub.get("status") in {"trialing", "active"}:
        return sub.get("tier") or PLAN_FREE
    return PLAN_FREE


def plan_limits(user: dict) -> dict:
    return PLAN_LIMITS[current_plan(user)]


async def get_usage(db, user_id: str) -> dict:
    """Return current-month usage record, creating if absent."""
    period = _current_period_key()
    rec = await db.usage_periods.find_one(
        {"user_id": user_id, "period": period}, {"_id": 0}
    )
    if not rec:
        rec = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "period": period,
            "ai_uploads": 0,
            "rush_uploads": 0,
            "pdf_downloads": 0,
            "created_at": now_iso(),
        }
        await db.usage_periods.insert_one(rec)
        rec.pop("_id", None)
    return rec


async def incr_usage(db, user_id: str, field: str, by: int = 1) -> None:
    period = _current_period_key()
    await db.usage_periods.update_one(
        {"user_id": user_id, "period": period},
        {
            "$inc": {field: by},
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "period": period,
                "created_at": now_iso(),
            },
        },
        upsert=True,
    )


async def consume_addon_credit(db, user: dict, key: str) -> bool:
    """Decrement an addon credit counter by 1 if available. Returns True if consumed.

    Studio (and any tier with `<key>_unlimited` flag set in PLAN_LIMITS) bypasses
    the counter entirely.
    """
    ents = user.get("entitlements") or {}
    # Studio bypasses payapp/ai-floorplan credits
    tier = (user.get("subscription") or {}).get("tier") or PLAN_FREE
    if tier == PLAN_STUDIO:
        return True
    if int(ents.get(key) or 0) <= 0:
        return False
    res = await db.users.update_one(
        {"id": user["id"], f"entitlements.{key}": {"$gt": 0}},
        {"$inc": {f"entitlements.{key}": -1}},
    )
    return res.modified_count > 0


async def can_upload(db, user: dict) -> tuple[bool, str]:
    plan = current_plan(user)
    limits = PLAN_LIMITS[plan]
    quota = limits["ai_uploads_per_month"]
    if quota == -1:
        return True, "unlimited"
    usage = await get_usage(db, user["id"])
    used = int(usage.get("ai_uploads") or 0)
    bonus = int((user.get("entitlements") or {}).get("bonus_credits") or 0)
    if used < quota or bonus > 0:
        return True, f"{max(0, quota - used)} included + {bonus} bonus"
    return False, f"Monthly limit ({quota}) reached. Upgrade or buy credits."


async def consume_upload_credit(db, user: dict) -> None:
    """Decrement bonus_credits first if monthly quota is exhausted; else just track usage."""
    plan = current_plan(user)
    limits = PLAN_LIMITS[plan]
    quota = limits["ai_uploads_per_month"]
    if quota == -1:
        await incr_usage(db, user["id"], "ai_uploads")
        await db.users.update_one(
            {"id": user["id"]}, {"$inc": {"entitlements.lifetime_uploads": 1}}
        )
        return
    usage = await get_usage(db, user["id"])
    used = int(usage.get("ai_uploads") or 0)
    if used >= quota:
        # Consume a bonus credit
        bonus = int((user.get("entitlements") or {}).get("bonus_credits") or 0)
        if bonus > 0:
            await db.users.update_one(
                {"id": user["id"]},
                {"$inc": {"entitlements.bonus_credits": -1, "entitlements.lifetime_uploads": 1}},
            )
            return
    await incr_usage(db, user["id"], "ai_uploads")
    await db.users.update_one(
        {"id": user["id"]}, {"$inc": {"entitlements.lifetime_uploads": 1}}
    )


async def can_download_pdf(db, user: dict) -> tuple[bool, str]:
    limits = plan_limits(user)
    if limits["pdf_downloads_allowed"]:
        return True, "ok"
    return False, "PDF takeoff is a Pro feature. Upgrade to download."


async def can_create_project(db, user: dict, current_count: int) -> tuple[bool, str]:
    limits = plan_limits(user)
    mx = limits["projects_max"]
    if mx == -1 or current_count < mx:
        return True, "ok"
    return False, f"Free plan allows {mx} project. Upgrade for unlimited."


# ---------- Router ----------
class StartTrialIn(BaseModel):
    pass


class CheckoutIn(BaseModel):
    item: str = Field(..., description="Catalog key, e.g. pro_monthly / addon_uploads_25")
    origin_url: str = Field(..., description="window.location.origin from frontend")


def build_router(db, get_current_user) -> APIRouter:
    api = APIRouter(prefix="/api/billing")

    def _stripe(request: Request) -> StripeCheckout:
        api_key = os.environ.get("STRIPE_API_KEY", "")
        if not api_key:
            raise HTTPException(503, "Stripe is not configured")
        host_url = str(request.base_url).rstrip("/")
        webhook_url = f"{host_url}/api/webhook/stripe"
        return StripeCheckout(api_key=api_key, webhook_url=webhook_url)

    @api.get("/me")
    async def billing_me(user: dict = Depends(get_current_user)):
        user = await ensure_user_subscription(db, user)
        plan = current_plan(user)
        limits = PLAN_LIMITS[plan]
        usage = await get_usage(db, user["id"])
        return {
            "plan": plan,
            "subscription": user["subscription"],
            "entitlements": user["entitlements"],
            "limits": limits,
            "usage": {
                "period": usage["period"],
                "ai_uploads": usage.get("ai_uploads", 0),
                "pdf_downloads": usage.get("pdf_downloads", 0),
                "rush_uploads": usage.get("rush_uploads", 0),
            },
            "catalog": {
                k: {kk: vv for kk, vv in v.items() if kk != "effect"}
                for k, v in CATALOG.items()
            },
        }

    @api.post("/start-trial")
    async def start_trial(_: StartTrialIn = StartTrialIn(), user: dict = Depends(get_current_user)):
        user = await ensure_user_subscription(db, user)
        sub = user["subscription"]
        if sub.get("trial_used"):
            raise HTTPException(400, "Trial already used")
        if sub.get("status") in {"trialing", "active"}:
            raise HTTPException(400, "Already on a paid/trial plan")
        ends = now() + timedelta(days=TRIAL_DAYS)
        new_sub = {
            **sub,
            "tier": PLAN_PRO,
            "status": "trialing",
            "trial_used": True,
            "trial_ends_at": ends.isoformat(),
            "current_period_start": now_iso(),
            "current_period_end": ends.isoformat(),
        }
        await db.users.update_one({"id": user["id"]}, {"$set": {"subscription": new_sub}})
        return {"ok": True, "subscription": new_sub}

    @api.post("/checkout")
    async def create_checkout(payload: CheckoutIn, request: Request, user: dict = Depends(get_current_user)):
        if payload.item not in CATALOG:
            raise HTTPException(400, "Unknown product")
        item = CATALOG[payload.item]
        origin = payload.origin_url.rstrip("/")
        success_url = f"{origin}/billing?session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = f"{origin}/billing?canceled=1"

        stripe = _stripe(request)
        req = CheckoutSessionRequest(
            amount=float(item["amount"]),
            currency=item["currency"],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "user_id": user["id"],
                "user_email": user.get("email", ""),
                "item": payload.item,
                "kind": item["kind"],
            },
        )
        try:
            session = await stripe.create_checkout_session(req)
        except Exception as e:
            logger.exception("Stripe checkout creation failed")
            raise HTTPException(502, f"Stripe error: {e}")

        # Persist BEFORE returning URL
        await db.payment_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "session_id": session.session_id,
            "user_id": user["id"],
            "user_email": user.get("email"),
            "item": payload.item,
            "kind": item["kind"],
            "amount": float(item["amount"]),
            "currency": item["currency"],
            "metadata": req.metadata,
            "status": "initiated",
            "payment_status": "pending",
            "entitlements_applied": False,
            "created_at": now_iso(),
        })
        return {"url": session.url, "session_id": session.session_id}

    @api.get("/checkout/status/{session_id}")
    async def checkout_status(session_id: str, request: Request, user: dict = Depends(get_current_user)):
        tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        if not tx:
            raise HTTPException(404, "Unknown session")
        if tx["user_id"] != user["id"]:
            raise HTTPException(403, "Forbidden")

        # If already final, return cached
        if tx.get("payment_status") in {"paid", "failed", "expired"} and tx.get("entitlements_applied"):
            return {
                "status": tx.get("status"),
                "payment_status": tx.get("payment_status"),
                "item": tx.get("item"),
                "applied": True,
            }

        stripe = _stripe(request)
        try:
            chk = await stripe.get_checkout_status(session_id)
        except Exception as e:
            raise HTTPException(502, f"Stripe error: {e}")

        # Atomic transition: compare-and-set the guard flag FIRST, then
        # apply entitlements only if we won the race. This prevents the
        # webhook + status-poll from both applying the same entitlement
        # (double-granting add-on credits via $inc).
        if chk.payment_status == "paid":
            claim = await db.payment_transactions.update_one(
                {"session_id": session_id, "entitlements_applied": {"$ne": True}},
                {"$set": {
                    "status": chk.status,
                    "payment_status": chk.payment_status,
                    "amount_total": chk.amount_total,
                    "currency": chk.currency,
                    "entitlements_applied": True,
                    "completed_at": now_iso(),
                }},
            )
            if claim.modified_count:
                # We won — safe to apply.
                await _apply_entitlements(db, tx)
        else:
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {
                    "status": chk.status,
                    "payment_status": chk.payment_status,
                    "updated_at": now_iso(),
                }},
            )
        return {
            "status": chk.status,
            "payment_status": chk.payment_status,
            "item": tx.get("item"),
            "applied": chk.payment_status == "paid",
        }

    return api


async def _apply_entitlements(db, tx: dict) -> None:
    """Apply a paid transaction's entitlements to the user's account.

    WARNING: This function is NOT internally idempotent — it uses $inc on
    add-on counters, so calling it twice grants credits twice. All callers
    MUST guard invocation with a compare-and-set on
    `payment_transactions.entitlements_applied` (see status-poll and
    webhook handlers for the pattern) so exactly one caller wins the race
    and this runs exactly once per session_id."""
    item_key = tx.get("item")
    item = CATALOG.get(item_key)
    if not item:
        return
    user_id = tx["user_id"]
    user = await db.users.find_one({"id": user_id})
    if not user:
        return
    user = await ensure_user_subscription(db, user)

    if item["kind"] == "subscription":
        # Extend or start the period
        sub = user["subscription"]
        period_days = int(item.get("period_days") or 30)
        # If already on this tier and active, extend from current_period_end
        cpe_str = sub.get("current_period_end")
        start_from = now()
        if sub.get("status") in {"active", "trialing"} and cpe_str:
            try:
                cpe = datetime.fromisoformat(cpe_str)
                if cpe > now() and sub.get("tier") == item["tier"]:
                    start_from = cpe
            except Exception:
                pass
        new_end = start_from + timedelta(days=period_days)
        new_sub = {
            **sub,
            "tier": item["tier"],
            "status": "active",
            "current_period_start": (sub.get("current_period_start") or now_iso())
            if sub.get("status") in {"active", "trialing"} and sub.get("tier") == item["tier"]
            else now_iso(),
            "current_period_end": new_end.isoformat(),
        }
        await db.users.update_one({"id": user_id}, {"$set": {"subscription": new_sub}})
    elif item["kind"] == "addon":
        effect = item.get("effect", {})
        inc, sets = {}, {}
        for k, v in effect.items():
            if isinstance(v, bool):
                sets[f"entitlements.{k}"] = v
            elif isinstance(v, (int, float)):
                inc[f"entitlements.{k}"] = v
        update = {}
        if inc:
            update["$inc"] = inc
        if sets:
            update["$set"] = sets
        if update:
            await db.users.update_one({"id": user_id}, update)


def build_webhook_router(db) -> APIRouter:
    """Stripe webhook router (mounted at /api/webhook/stripe)."""
    router = APIRouter()

    @router.post("/api/webhook/stripe")
    async def stripe_webhook(request: Request):
        api_key = os.environ.get("STRIPE_API_KEY", "")
        if not api_key:
            return {"ok": False, "reason": "stripe not configured"}
        host_url = str(request.base_url).rstrip("/")
        webhook_url = f"{host_url}/api/webhook/stripe"
        stripe = StripeCheckout(api_key=api_key, webhook_url=webhook_url)
        body = await request.body()
        signature = request.headers.get("Stripe-Signature", "")
        try:
            event = await stripe.handle_webhook(body, signature)
        except Exception as e:
            logger.exception("Webhook verification failed")
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Webhook error: {e}")
        # Apply entitlements if this is a paid checkout session
        sid = getattr(event, "session_id", None)
        ps = getattr(event, "payment_status", "")
        if sid and ps == "paid":
            tx = await db.payment_transactions.find_one({"session_id": sid})
            if tx:
                # Compare-and-set the guard flag first; only apply if we won.
                claim = await db.payment_transactions.update_one(
                    {"session_id": sid, "entitlements_applied": {"$ne": True}},
                    {"$set": {
                        "entitlements_applied": True,
                        "payment_status": "paid",
                        "status": "complete",
                        "webhook_completed_at": now_iso(),
                    }},
                )
                if claim.modified_count:
                    await _apply_entitlements(db, tx)
        return {"ok": True}

    return router
