"""Iteration 24 — Subscription diagnostic / regression tests.

Production bug context: Non-admin user on app-gonzo.com got
"Stripe is not configured on this server" while selecting Pro Monthly.
RCA: Production deploy is missing STRIPE_API_KEY env var. Preview HAS the key.

We:
  1) Verify preview backend reports configured=true and exposes both plans.
  2) Verify happy-path /checkout works for BOTH admin AND a freshly-registered
     non-admin user (proves no admin-only branching; non-admin failure on prod
     is purely an env config issue, not a code regression).
  3) Verify the validation paths (unknown plan -> 400, no auth -> 401/403).
  4) Inspect /app/backend/routes/subscriptions.py:_ensure_key static text to
     confirm the new diagnostic message strings are present (so when a prod
     admin sees the 503 they get clear guidance).
  5) Verify GET /me works for admin + fresh non-admin.

Run:
  pytest /app/backend/tests/test_iter24_subscriptions_diagnostic.py -v \
    --junitxml=/app/test_reports/pytest/pytest_iter24_main.xml
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
import requests

ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PASSWORD = "Open0says3me#*03#*"

SUBS_FILE = Path("/app/backend/routes/subscriptions.py")


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def admin_token(base_url):
    r = requests.post(
        f"{base_url}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def fresh_user(base_url):
    """Register a brand-new non-admin user."""
    email = f"iter24_nonadmin_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": "Iter24 NonAdmin"},
        timeout=20,
    )
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"email": email, "token": data["token"], "user": data["user"]}


# ---------- 1) Public plans catalog ----------

def test_plans_public_configured_true_and_has_both_plans(base_url):
    r = requests.get(f"{base_url}/api/subscriptions/plans", timeout=10)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("configured") is True, (
        f"Preview must have STRIPE_API_KEY configured; configured={body.get('configured')}"
    )
    keys = {p["key"] for p in body["plans"]}
    assert {"pro_monthly", "studio_monthly"}.issubset(keys), f"plans missing: {keys}"
    # Sanity: pro_monthly is $49/mo with 7-day trial
    pro = next(p for p in body["plans"] if p["key"] == "pro_monthly")
    assert pro["amount_cents"] == 4900
    assert pro["interval"] == "month"
    assert pro["trial_days"] == 7
    # Publishable key present
    assert body.get("publishable_key", "").startswith(("pk_live_", "pk_test_"))


# ---------- 2) Happy path: non-admin can checkout ----------

def test_non_admin_checkout_pro_monthly_returns_url(base_url, fresh_user):
    """This is the EXACT user-reported failure path on production.
    On preview (with STRIPE_API_KEY set) it MUST return 200 + checkout URL,
    NOT 503 'Stripe is not configured on this server'."""
    h = {"Authorization": f"Bearer {fresh_user['token']}"}
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "pro_monthly", "origin_url": "https://example.com"},
        headers=h, timeout=30,
    )
    # Diagnostic: surface the body if it's a 503 so the report is actionable.
    assert r.status_code == 200, (
        f"Expected 200 for non-admin checkout (Stripe is configured on preview). "
        f"Got {r.status_code}: {r.text[:400]}"
    )
    body = r.json()
    assert body.get("url", "").startswith("https://checkout.stripe.com/"), body
    assert body.get("session_id", "").startswith("cs_"), body


def test_admin_checkout_pro_monthly_returns_url(base_url, admin_token):
    """Same path with the admin account — proves no admin-only branching."""
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "pro_monthly", "origin_url": "https://example.com"},
        headers=h, timeout=30,
    )
    # Admin may have already subscribed to pro_monthly on a prior test run → 409.
    # That is ALSO proof there's no "Stripe not configured" regression.
    assert r.status_code in (200, 409), (
        f"Admin checkout unexpected: {r.status_code} {r.text[:400]}"
    )
    if r.status_code == 200:
        body = r.json()
        assert body.get("url", "").startswith("https://checkout.stripe.com/"), body
        assert body.get("session_id", "").startswith("cs_"), body
    else:
        assert "active subscription" in r.text.lower() or "already" in r.text.lower()


def test_admin_checkout_studio_monthly_returns_url(base_url, admin_token):
    """Studio plan exercise — also verifies no 503 for admin."""
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "studio_monthly", "origin_url": "https://example.com"},
        headers=h, timeout=30,
    )
    assert r.status_code in (200, 409), (
        f"Admin studio checkout unexpected: {r.status_code} {r.text[:400]}"
    )
    if r.status_code == 200:
        assert r.json().get("url", "").startswith("https://checkout.stripe.com/")


# ---------- 3) Validation paths ----------

def test_checkout_unknown_plan_returns_400(base_url, fresh_user):
    h = {"Authorization": f"Bearer {fresh_user['token']}"}
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "premium_ultra", "origin_url": "https://example.com"},
        headers=h, timeout=10,
    )
    assert r.status_code == 400, r.text
    assert "unknown plan" in r.text.lower()


def test_checkout_without_auth_returns_401_or_403(base_url):
    r = requests.post(
        f"{base_url}/api/subscriptions/checkout",
        json={"plan_key": "pro_monthly", "origin_url": "https://example.com"},
        timeout=10,
    )
    assert r.status_code in (401, 403), r.text


# ---------- 4) Diagnostic message regression ----------

def test_ensure_key_diagnostic_messages_present_in_source():
    """The whole point of this iteration: when STRIPE_API_KEY is missing OR
    malformed, the 503 body must contain a clear, action-oriented message
    so prod admins know exactly what to fix.

    We verify by static inspection because the preview env DOES have the key,
    so we can't trigger the 503 at runtime without mutating shared env."""
    assert SUBS_FILE.exists(), f"{SUBS_FILE} missing"
    raw = SUBS_FILE.read_text()
    # Collapse Python adjacent-string-literal joins: `" "\n            "` -> ``.
    # This lets us search the runtime-rendered message even though it's split
    # across multiple lines in source.
    import re
    collapsed = re.sub(r'"\s*\n\s*"', "", raw)

    # Missing-key branch
    assert "STRIPE_API_KEY env var is missing" in collapsed, (
        "Missing-key diagnostic string not found in _ensure_key"
    )
    # Malformed-key branch
    assert ("must start with 'sk_test_' or 'sk_live_'" in collapsed
            or 'must start with "sk_test_" or "sk_live_"' in collapsed), (
        "Malformed-key diagnostic string not found in _ensure_key"
    )
    # Both branches still raise 503 (regression guard on status code)
    assert "503" in raw, "Expected 503 raise in _ensure_key"


# ---------- 5) /me works for both ----------

def test_me_works_for_admin(base_url, admin_token):
    r = requests.get(
        f"{base_url}/api/subscriptions/me",
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "subscription" in body
    assert "entitlements" in body
    assert "limits" in body
    assert body["subscription"].get("tier") in ("free", "pro", "studio")


def test_me_works_for_fresh_non_admin(base_url, fresh_user):
    r = requests.get(
        f"{base_url}/api/subscriptions/me",
        headers={"Authorization": f"Bearer {fresh_user['token']}"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "subscription" in body
    assert "entitlements" in body
    assert "limits" in body
    # Fresh user defaults to free tier
    assert body["subscription"].get("tier") == "free"


def test_me_without_auth_returns_401_or_403(base_url):
    r = requests.get(f"{base_url}/api/subscriptions/me", timeout=10)
    assert r.status_code in (401, 403)
