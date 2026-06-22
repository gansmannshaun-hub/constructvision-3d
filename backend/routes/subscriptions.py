"""Real Stripe recurring subscriptions.

Replaces the one-time-charge-per-month emulation in billing.py with proper
Stripe Subscriptions:
  - Stripe Products + Prices auto-created (idempotently) on first checkout
  - mode="subscription" Checkout sessions with 7-day Pro trial
  - Stripe Customer Portal for self-serve cancel / update card / view invoices
  - Webhook mirror for subscription state into db.users.subscription

Endpoints:
  POST /api/subscriptions/checkout    create checkout session for a tier
  POST /api/subscriptions/portal      open Stripe Customer Portal
  GET  /api/subscriptions/me          current sub + plan limits
  POST /api/subscriptions/webhook     Stripe webhook (signature-verified)

Env:
  STRIPE_API_KEY              sk_live_… or sk_test_…
  STRIPE_WEBHOOK_SECRET       (optional, but strongly recommended in prod)

Mongo collections:
  stripe_products    {tier, product_id, price_id, currency, amount}
  users              ...users.subscription = {tier, status, current_period_end,
                                              stripe_customer_id, stripe_subscription_id}
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from billing import (
    PLAN_FREE, PLAN_PRO, PLAN_STUDIO, PLAN_LIMITS,
    default_subscription, default_entitlements, ensure_user_subscription,
)

logger = logging.getLogger("subscriptions")

TRIAL_DAYS = 7

# Server-defined plan catalogue. Frontend cannot tamper with prices.
PLANS = {
    "pro_monthly": {
        "tier": PLAN_PRO,
        "label": "Pro",
        "amount_cents": 4900,
        "currency": "usd",
        "interval": "month",
        "trial_days": TRIAL_DAYS,
        "description": "Unlimited projects, 100 AI uploads/mo, watermark-free PDFs.",
    },
    "studio_monthly": {
        "tier": PLAN_STUDIO,
        "label": "Studio",
        "amount_cents": 14900,
        "currency": "usd",
        "interval": "month",
        "trial_days": 0,  # Studio is upgrade-only, no second trial
        "description": "Unlimited AI uploads, priority queue, white-label everything.",
    },
}


# ============================ Stripe setup ============================

def _api_key() -> str:
    return os.environ.get("STRIPE_API_KEY", "").strip()


def _webhook_secret() -> str:
    return os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()


def _publishable() -> str:
    return os.environ.get("STRIPE_PUBLISHABLE_KEY", "").strip()


def _ensure_key() -> str:
    k = _api_key()
    if not k or not k.startswith(("sk_test_", "sk_live_")):
        raise HTTPException(503, "Stripe is not configured on this server")
    stripe.api_key = k
    return k


# ============================ Product + Price provisioning ============================

async def _get_or_create_price(db, plan_key: str) -> dict:
    """Lazily create the Stripe Product and recurring Price for a plan, then cache it."""
    plan = PLANS[plan_key]
    cached = await db.stripe_products.find_one({"plan_key": plan_key}, {"_id": 0})
    if cached and cached.get("price_id"):
        return cached

    # Create product
    product = stripe.Product.create(
        name=f"Atlas Construction · {plan['label']}",
        description=plan["description"],
        metadata={"plan_key": plan_key, "tier": plan["tier"]},
    )
    # Create recurring price
    price = stripe.Price.create(
        product=product.id,
        unit_amount=plan["amount_cents"],
        currency=plan["currency"],
        recurring={"interval": plan["interval"]},
        metadata={"plan_key": plan_key, "tier": plan["tier"]},
    )
    doc = {
        "plan_key": plan_key,
        "product_id": product.id,
        "price_id": price.id,
        "currency": plan["currency"],
        "amount_cents": plan["amount_cents"],
        "interval": plan["interval"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.stripe_products.update_one(
        {"plan_key": plan_key},
        {"$set": doc},
        upsert=True,
    )
    logger.info("Created Stripe Product %s / Price %s for %s",
                product.id, price.id, plan_key)
    return doc


async def _get_or_create_customer(db, user: dict) -> str:
    sub = user.get("subscription") or {}
    if sub.get("stripe_customer_id"):
        return sub["stripe_customer_id"]
    cust = stripe.Customer.create(
        email=user["email"],
        name=user.get("name") or user["email"],
        metadata={"user_id": user["id"]},
    )
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"subscription.stripe_customer_id": cust.id}},
    )
    return cust.id


# ============================ Webhook → DB mirror ============================

def _iso(ts: Optional[int]) -> Optional[str]:
    if not ts:
        return None
    return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()


async def _apply_subscription(db, sub_obj: dict) -> None:
    """Mirror a Stripe Subscription object into db.users.subscription."""
    customer_id = sub_obj.get("customer")
    if not customer_id:
        return
    user = await db.users.find_one({"subscription.stripe_customer_id": customer_id},
                                   {"_id": 0})
    if not user:
        logger.warning("Webhook for unknown customer %s", customer_id)
        return

    items = (sub_obj.get("items", {}) or {}).get("data", []) or []
    price = items[0].get("price") if items else {}
    plan_key = (price or {}).get("metadata", {}).get("plan_key", "")
    tier = (price or {}).get("metadata", {}).get("tier", PLAN_FREE)

    status = sub_obj.get("status", "")
    cancel_at_period_end = sub_obj.get("cancel_at_period_end", False)
    canceled_at = sub_obj.get("canceled_at")

    update = {
        "subscription.tier": tier if status in ("active", "trialing") else PLAN_FREE,
        "subscription.status": status,
        "subscription.stripe_subscription_id": sub_obj.get("id"),
        "subscription.plan_key": plan_key,
        "subscription.current_period_start": _iso(sub_obj.get("current_period_start")),
        "subscription.current_period_end": _iso(sub_obj.get("current_period_end")),
        "subscription.trial_ends_at": _iso(sub_obj.get("trial_end")),
        "subscription.cancel_at_period_end": cancel_at_period_end,
        "subscription.canceled_at": _iso(canceled_at),
    }
    if status == "trialing":
        update["subscription.trial_used"] = True
    await db.users.update_one({"id": user["id"]}, {"$set": update})
    logger.info("Mirrored subscription %s → %s (status=%s, tier=%s)",
                sub_obj.get("id"), user["email"], status, tier)


# ============================ Pydantic ============================

class CheckoutIn(BaseModel):
    plan_key: str = Field(min_length=3, max_length=40)
    origin_url: str = Field(min_length=4, max_length=200)


class PortalIn(BaseModel):
    origin_url: str = Field(min_length=4, max_length=200)


# ============================ Router ============================

def build_subscriptions_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api/subscriptions")

    @router.get("/plans")
    async def list_plans():
        """Public catalogue — frontend renders these."""
        return {
            "plans": [
                {
                    "key": k,
                    "label": p["label"],
                    "tier": p["tier"],
                    "amount_cents": p["amount_cents"],
                    "amount_usd": p["amount_cents"] / 100,
                    "currency": p["currency"],
                    "interval": p["interval"],
                    "trial_days": p["trial_days"],
                    "description": p["description"],
                    "limits": PLAN_LIMITS.get(p["tier"], {}),
                }
                for k, p in PLANS.items()
            ],
            "publishable_key": _publishable(),
            "configured": bool(_api_key()),
        }

    @router.get("/me")
    async def my_subscription(user: dict = Depends(get_current_user)):
        user = await ensure_user_subscription(db, user)
        sub = user.get("subscription") or default_subscription()
        ents = user.get("entitlements") or default_entitlements()
        limits = PLAN_LIMITS.get(sub.get("tier") or PLAN_FREE, {})
        return {"subscription": sub, "entitlements": ents, "limits": limits}

    @router.post("/checkout")
    async def create_checkout(payload: CheckoutIn,
                              user: dict = Depends(get_current_user)):
        if payload.plan_key not in PLANS:
            raise HTTPException(400, "Unknown plan")
        _ensure_key()

        # Resolve current user (so we have the latest subscription doc)
        user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        user = await ensure_user_subscription(db, user)
        plan = PLANS[payload.plan_key]

        # Block re-subscribing while already active.
        sub = user.get("subscription") or {}
        if sub.get("status") in ("active", "trialing") and sub.get("tier") == plan["tier"]:
            raise HTTPException(409, "You already have an active subscription for this tier")

        price_doc = await _get_or_create_price(db, payload.plan_key)
        customer_id = await _get_or_create_customer(db, user)

        # Trial only if user hasn't used theirs AND this plan offers one.
        trial_days = plan["trial_days"] if not sub.get("trial_used") else 0

        origin = payload.origin_url.rstrip("/")
        try:
            session = stripe.checkout.Session.create(
                mode="subscription",
                customer=customer_id,
                line_items=[{"price": price_doc["price_id"], "quantity": 1}],
                success_url=f"{origin}/billing?session_id={{CHECKOUT_SESSION_ID}}&status=success",
                cancel_url=f"{origin}/billing?status=cancelled",
                subscription_data={
                    "trial_period_days": trial_days,
                    "metadata": {
                        "user_id": user["id"],
                        "plan_key": payload.plan_key,
                        "tier": plan["tier"],
                    },
                } if trial_days else {
                    "metadata": {
                        "user_id": user["id"],
                        "plan_key": payload.plan_key,
                        "tier": plan["tier"],
                    },
                },
                allow_promotion_codes=True,
                metadata={
                    "user_id": user["id"],
                    "plan_key": payload.plan_key,
                    "kind": "subscription_checkout",
                },
            )
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            logger.exception("Stripe checkout failed")
            raise HTTPException(502, f"Stripe error: {e.user_message or str(e)[:200]}")

        # Pending transaction row
        await db.payment_transactions.insert_one({
            "session_id": session.id,
            "user_id": user["id"],
            "user_email": user["email"],
            "plan_key": payload.plan_key,
            "amount_cents": plan["amount_cents"],
            "currency": plan["currency"],
            "kind": "subscription_checkout",
            "status": "initiated",
            "trial_days": trial_days,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return {"url": session.url, "session_id": session.id}

    @router.post("/portal")
    async def open_portal(payload: PortalIn, user: dict = Depends(get_current_user)):
        _ensure_key()
        user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
        cust_id = (user.get("subscription") or {}).get("stripe_customer_id")
        if not cust_id:
            raise HTTPException(409, "No Stripe customer for this user yet — subscribe first")
        try:
            portal = stripe.billing_portal.Session.create(
                customer=cust_id,
                return_url=f"{payload.origin_url.rstrip('/')}/billing",
            )
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            logger.exception("Stripe portal failed")
            raise HTTPException(502, f"Stripe error: {e.user_message or str(e)[:200]}")
        return {"url": portal.url}

    @router.post("/webhook")
    async def stripe_webhook(request: Request):
        """Stripe sends subscription events here. Signature-verified when
        STRIPE_WEBHOOK_SECRET is configured."""
        _ensure_key()
        payload = await request.body()
        sig = request.headers.get("Stripe-Signature", "")
        whsec = _webhook_secret()

        try:
            if whsec:
                event = stripe.Webhook.construct_event(payload, sig, whsec)
            else:
                # Dev mode — accept unsigned events (NEVER in production).
                import json as _json
                event = _json.loads(payload.decode("utf-8"))
        except (ValueError, stripe.error.SignatureVerificationError) as e:  # type: ignore[attr-defined]
            logger.warning("Webhook verification failed: %s", e)
            raise HTTPException(400, "Invalid Stripe signature")

        etype = event.get("type") if isinstance(event, dict) else event["type"]
        obj = (event.get("data") or {}).get("object") if isinstance(event, dict) else event["data"]["object"]

        if etype in ("customer.subscription.created",
                     "customer.subscription.updated",
                     "customer.subscription.deleted"):
            await _apply_subscription(db, obj)
        elif etype == "invoice.payment_succeeded":
            sub_id = obj.get("subscription")
            if sub_id:
                try:
                    sub_obj = stripe.Subscription.retrieve(sub_id)
                    await _apply_subscription(db, sub_obj.to_dict_recursive() if hasattr(sub_obj, "to_dict_recursive") else dict(sub_obj))
                except Exception:  # noqa: BLE001
                    logger.exception("Failed to refresh sub after invoice.payment_succeeded")
        elif etype == "invoice.payment_failed":
            sub_id = obj.get("subscription")
            if sub_id:
                user = await db.users.find_one(
                    {"subscription.stripe_subscription_id": sub_id},
                    {"_id": 0, "id": 1, "email": 1},
                )
                if user:
                    await db.users.update_one(
                        {"id": user["id"]},
                        {"$set": {"subscription.last_payment_failed_at":
                                  datetime.now(timezone.utc).isoformat()}},
                    )
                    logger.warning("Payment failed for %s sub=%s", user["email"], sub_id)
        else:
            logger.debug("Ignored Stripe event: %s", etype)

        return {"received": True}

    return router
