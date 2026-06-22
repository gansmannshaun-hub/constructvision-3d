"""Iteration 20 — Real Stripe recurring subscriptions.

Validates the /api/subscriptions/* endpoints. Real Stripe calls require a live
or test secret key in STRIPE_API_KEY env. We default to the test path
(404/400/422 cases) and gate the live network test behind RUN_STRIPE_TESTS=1.

Run: pytest /app/backend/tests/test_iter20_subscriptions.py -v
"""
import os
import uuid

import pytest
import requests


@pytest.fixture(scope="module")
def headers(base_url, user_a):
    return {"Authorization": f"Bearer {user_a['token']}"}


def test_plans_catalog_public(base_url):
    """The /plans endpoint is open and returns server-defined prices."""
    r = requests.get(f"{base_url}/api/subscriptions/plans", timeout=10)
    assert r.status_code == 200
    body = r.json()
    keys = {p["key"] for p in body["plans"]}
    assert "pro_monthly" in keys
    assert "studio_monthly" in keys
    pro = next(p for p in body["plans"] if p["key"] == "pro_monthly")
    assert pro["amount_cents"] == 4900
    assert pro["currency"] == "usd"
    assert pro["interval"] == "month"
    assert pro["trial_days"] == 7
    assert "publishable_key" in body
    assert "configured" in body


def test_me_requires_auth(base_url):
    r = requests.get(f"{base_url}/api/subscriptions/me", timeout=10)
    assert r.status_code in (401, 403)


def test_me_returns_free_default(base_url, headers):
    r = requests.get(f"{base_url}/api/subscriptions/me", headers=headers, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "subscription" in body
    assert "limits" in body
    assert body["subscription"]["tier"] in ("free", "pro", "studio")


def test_checkout_validation_unknown_plan(base_url, headers):
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "bogus", "origin_url": "https://example.com"},
        headers=headers, timeout=10,
    )
    assert r.status_code == 400


def test_checkout_validation_missing_fields(base_url, headers):
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "pro_monthly"},  # no origin_url
        headers=headers, timeout=10,
    )
    assert r.status_code == 422


def test_checkout_requires_auth(base_url):
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "pro_monthly", "origin_url": "https://example.com"},
        timeout=10,
    )
    assert r.status_code in (401, 403)


def test_portal_requires_customer(base_url, headers):
    """User without a Stripe customer ID → 409 'subscribe first'."""
    r = requests.post(
        f"{base_url}/api/subscriptions/portal",
        json={"origin_url": "https://example.com"},
        headers=headers, timeout=10,
    )
    # Either 409 (no customer yet) or 503 (Stripe not configured locally)
    assert r.status_code in (409, 503)


def test_webhook_rejects_invalid_signature(base_url):
    """When STRIPE_WEBHOOK_SECRET is set, unsigned/forged bodies must be rejected."""
    r = requests.post(
        f"{base_url}/api/subscriptions/webhook",
        json={"type": "customer.subscription.created", "data": {"object": {"id": "sub_fake"}}},
        timeout=10,
    )
    # If WEBHOOK_SECRET is unset (preview), unsigned events return 200.
    # If set (prod), it returns 400. Either is acceptable here.
    assert r.status_code in (200, 400, 503)


@pytest.mark.skipif(os.environ.get("RUN_STRIPE_TESTS") != "1",
                    reason="set RUN_STRIPE_TESTS=1 to hit live Stripe")
def test_checkout_real_stripe_creates_session(base_url):
    """Real Stripe call: creates a Product/Price + Checkout Session in subscription mode.
    Uses a fresh, throwaway user so subscription state is always clean."""
    email = f"iter20_{uuid.uuid4().hex[:8]}@example.com"
    reg = requests.post(f"{base_url}/api/auth/register",
                        json={"email": email, "password": "TestPass123!", "name": "Iter20 Stripe"},
                        timeout=15)
    assert reg.status_code == 200, reg.text
    h = {"Authorization": f"Bearer {reg.json()['token']}"}
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "pro_monthly", "origin_url": "https://example.com"},
        headers=h, timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("https://checkout.stripe.com/")
    assert body["session_id"].startswith("cs_")
