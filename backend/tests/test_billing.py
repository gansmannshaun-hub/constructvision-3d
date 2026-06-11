"""Iteration 3 — Monetization / Stripe billing tests.

Covers:
- GET /api/billing/me (defaults, catalog, limits)
- POST /api/billing/start-trial (one-time, second call 400)
- Quota gates (projects, AI uploads, PDF takeoff)
- Stripe checkout (subscription + addon) + status + cross-user 403
- Webhook endpoint exists + returns 400 on bad signature

Uses fresh users per test class to avoid pollution.
"""
import io
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from PIL import Image
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")


def _backend_env(key):
    p = Path("/app/backend/.env")
    for line in p.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


MONGO_URL = _backend_env("MONGO_URL")
DB_NAME = _backend_env("DB_NAME")


def _register(name="User"):
    email = f"test_bill_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": name},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["token"], "user": data["user"], "headers": {"Authorization": f"Bearer {data['token']}"}}


def _png_bytes():
    img = Image.new("RGB", (200, 200), "white")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# -------- /billing/me --------
class TestBillingMe:
    def test_billing_me_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/billing/me", timeout=15)
        assert r.status_code == 401

    def test_billing_me_defaults_free(self):
        u = _register()
        r = requests.get(f"{BASE_URL}/api/billing/me", headers=u["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # plan + subscription
        assert data["plan"] == "free"
        sub = data["subscription"]
        assert sub["tier"] == "free"
        assert sub["status"] == "free"
        assert sub["trial_used"] is False
        assert sub.get("trial_ends_at") in (None, "")
        # limits
        lim = data["limits"]
        assert lim["projects_max"] == 1
        assert lim["ai_uploads_per_month"] == 5
        assert lim["pdf_downloads_allowed"] is False
        # usage
        usg = data["usage"]
        assert usg["ai_uploads"] == 0
        assert usg["pdf_downloads"] == 0
        # catalog
        cat = data["catalog"]
        for key in ("pro_monthly", "studio_monthly", "addon_uploads_25", "addon_pdf_branding", "addon_rush"):
            assert key in cat, f"catalog missing {key}"
        assert cat["pro_monthly"]["amount"] == 49.0
        assert cat["studio_monthly"]["amount"] == 149.0
        assert cat["addon_uploads_25"]["amount"] == 9.0
        assert cat["addon_pdf_branding"]["amount"] == 19.0
        assert cat["addon_rush"]["amount"] == 4.0
        # 'effect' must not be exposed (server-defined only)
        assert "effect" not in cat["addon_uploads_25"]


# -------- /billing/start-trial --------
class TestStartTrial:
    def test_start_trial_then_second_call_400(self):
        u = _register()
        r1 = requests.post(f"{BASE_URL}/api/billing/start-trial", headers=u["headers"], json={}, timeout=15)
        assert r1.status_code == 200, r1.text
        body = r1.json()
        assert body["ok"] is True
        sub = body["subscription"]
        assert sub["tier"] == "pro"
        assert sub["status"] == "trialing"
        assert sub["trial_used"] is True
        assert sub.get("trial_ends_at")

        # Verify /me now reflects trial
        me = requests.get(f"{BASE_URL}/api/billing/me", headers=u["headers"], timeout=15).json()
        assert me["plan"] == "pro"
        assert me["limits"]["ai_uploads_per_month"] == 100
        assert me["limits"]["pdf_downloads_allowed"] is True

        # Second call -> 400
        r2 = requests.post(f"{BASE_URL}/api/billing/start-trial", headers=u["headers"], json={}, timeout=15)
        assert r2.status_code == 400
        assert "trial" in r2.text.lower()

    def test_start_trial_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/billing/start-trial", json={}, timeout=15)
        assert r.status_code == 401


# -------- Quota gates --------
class TestProjectQuota:
    def test_free_user_second_project_returns_402(self):
        u = _register()
        # Free user already has 1 default project (from register).
        # Per spec, second POST /api/projects must return 402.
        r = requests.post(
            f"{BASE_URL}/api/projects",
            headers=u["headers"],
            json={"name": "TEST_second_project", "description": ""},
            timeout=15,
        )
        # Document actual behavior; spec requires 402.
        assert r.status_code == 402, f"Expected 402 (project quota), got {r.status_code}: {r.text}"
        body = r.json()
        msg = (body.get("detail") or body.get("message") or "").lower()
        assert "project" in msg or "limit" in msg or "upgrade" in msg


class TestUploadQuota:
    def test_free_user_sixth_upload_returns_402(self, mongo_db):
        u = _register()
        uid = u["user"]["id"]
        # List projects to get project_id (default project)
        projs = requests.get(f"{BASE_URL}/api/projects", headers=u["headers"], timeout=15).json()
        assert len(projs) >= 1
        pid = projs[0]["id"]

        # Fast path: bump usage_periods to quota (5) via direct DB write to avoid burning AI calls.
        period = time.strftime("%Y-%m")
        mongo_db.usage_periods.update_one(
            {"user_id": uid, "period": period},
            {
                "$set": {
                    "user_id": uid,
                    "period": period,
                    "ai_uploads": 5,
                },
                "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": "seed"},
            },
            upsert=True,
        )

        png = _png_bytes()
        files = {"file": ("p.png", png, "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/projects/{pid}/documents/upload",
            headers=u["headers"], files=files, timeout=30,
        )
        assert r.status_code == 402, f"Expected 402, got {r.status_code}: {r.text}"
        body = r.json()
        msg = (body.get("detail") or "").lower()
        assert "limit" in msg or "upgrade" in msg or "credit" in msg

    def test_trialing_pro_user_upload_allowed_after_quota_was_blocked(self, mongo_db):
        u = _register()
        uid = u["user"]["id"]
        projs = requests.get(f"{BASE_URL}/api/projects", headers=u["headers"], timeout=15).json()
        pid = projs[0]["id"]

        # Push usage to free-limit
        period = time.strftime("%Y-%m")
        mongo_db.usage_periods.update_one(
            {"user_id": uid, "period": period},
            {"$set": {"user_id": uid, "period": period, "ai_uploads": 5},
             "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": "seed"}},
            upsert=True,
        )

        # Upload should be blocked
        png = _png_bytes()
        r1 = requests.post(
            f"{BASE_URL}/api/projects/{pid}/documents/upload",
            headers=u["headers"], files={"file": ("p.png", png, "image/png")}, timeout=30,
        )
        assert r1.status_code == 402

        # Start trial -> Pro limits (100/mo)
        rt = requests.post(f"{BASE_URL}/api/billing/start-trial", headers=u["headers"], json={}, timeout=15)
        assert rt.status_code == 200

        # Now upload should be allowed (returns 200, triggers async AI)
        r2 = requests.post(
            f"{BASE_URL}/api/projects/{pid}/documents/upload",
            headers=u["headers"], files={"file": ("p.png", png, "image/png")}, timeout=30,
        )
        assert r2.status_code == 200, r2.text


class TestPdfGate:
    def test_free_user_pdf_returns_402(self):
        u = _register()
        projs = requests.get(f"{BASE_URL}/api/projects", headers=u["headers"], timeout=15).json()
        pid = projs[0]["id"]
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/takeoff.pdf", headers=u["headers"], timeout=15)
        assert r.status_code == 402, f"Expected 402 PDF gate, got {r.status_code}: {r.text}"
        body = r.json()
        msg = (body.get("detail") or "").lower()
        assert "pdf" in msg or "pro" in msg or "upgrade" in msg

    def test_pdf_cross_user_two_fresh_free_users_returns_404(self):
        """Iter-3 retest: ownership MUST be checked before PDF Pro-gate.
        Two FRESH free users (no trial). User B asking for User A's project PDF must get 404,
        NOT 402. This prevents an info-leak that would reveal a project exists for another user."""
        owner = _register(name="Owner")
        other = _register(name="Other")
        projs = requests.get(f"{BASE_URL}/api/projects", headers=owner["headers"], timeout=15).json()
        assert len(projs) >= 1
        pid = projs[0]["id"]
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/takeoff.pdf",
                         headers=other["headers"], timeout=15)
        assert r.status_code == 404, (
            f"Expected 404 (ownership check first), got {r.status_code}: {r.text}"
        )

    def test_trialing_user_pdf_returns_200(self):
        u = _register()
        # Start trial -> pro
        rt = requests.post(f"{BASE_URL}/api/billing/start-trial", headers=u["headers"], json={}, timeout=15)
        assert rt.status_code == 200
        projs = requests.get(f"{BASE_URL}/api/projects", headers=u["headers"], timeout=15).json()
        pid = projs[0]["id"]
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/takeoff.pdf", headers=u["headers"], timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"


# -------- Stripe checkout --------
class TestCheckout:
    def test_checkout_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/billing/checkout",
            json={"item": "pro_monthly", "origin_url": "https://example.com"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_checkout_unknown_item_400(self):
        u = _register()
        r = requests.post(
            f"{BASE_URL}/api/billing/checkout",
            headers=u["headers"],
            json={"item": "nope_unknown", "origin_url": "https://example.com"},
            timeout=15,
        )
        assert r.status_code == 400, r.text

    def test_checkout_pro_monthly_creates_session(self, mongo_db):
        u = _register()
        r = requests.post(
            f"{BASE_URL}/api/billing/checkout",
            headers=u["headers"],
            json={"item": "pro_monthly", "origin_url": "https://example.com"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "url" in data and "session_id" in data
        assert "stripe.com" in data["url"]
        sid = data["session_id"]
        # Persisted as 'initiated'/'pending'
        tx = mongo_db.payment_transactions.find_one({"session_id": sid})
        assert tx is not None
        assert tx["status"] == "initiated"
        assert tx["payment_status"] == "pending"
        assert tx["entitlements_applied"] is False
        assert tx["kind"] == "subscription"
        assert tx["amount"] == 49.0
        assert tx["user_id"] == u["user"]["id"]

    def test_checkout_addon_uploads_25(self, mongo_db):
        u = _register()
        r = requests.post(
            f"{BASE_URL}/api/billing/checkout",
            headers=u["headers"],
            json={"item": "addon_uploads_25", "origin_url": "https://example.com"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "stripe.com" in data["url"]
        sid = data["session_id"]
        tx = mongo_db.payment_transactions.find_one({"session_id": sid})
        assert tx is not None
        assert tx["kind"] == "addon"
        assert tx["amount"] == 9.0
        assert tx["currency"] == "usd"
        assert tx["item"] == "addon_uploads_25"


# -------- Checkout status --------
class TestCheckoutStatus:
    def test_status_in_flight_returns_fields(self):
        u = _register()
        r = requests.post(
            f"{BASE_URL}/api/billing/checkout",
            headers=u["headers"],
            json={"item": "pro_monthly", "origin_url": "https://example.com"},
            timeout=30,
        )
        assert r.status_code == 200
        sid = r.json()["session_id"]

        rs = requests.get(
            f"{BASE_URL}/api/billing/checkout/status/{sid}",
            headers=u["headers"], timeout=30,
        )
        assert rs.status_code == 200, rs.text
        body = rs.json()
        assert "status" in body
        assert "payment_status" in body
        assert body["item"] == "pro_monthly"
        # In-flight session should not be 'paid' yet
        assert body.get("applied") in (False, None)

    def test_status_cross_user_403(self):
        owner = _register()
        other = _register()
        r = requests.post(
            f"{BASE_URL}/api/billing/checkout",
            headers=owner["headers"],
            json={"item": "addon_rush", "origin_url": "https://example.com"},
            timeout=30,
        )
        sid = r.json()["session_id"]

        rs = requests.get(
            f"{BASE_URL}/api/billing/checkout/status/{sid}",
            headers=other["headers"], timeout=30,
        )
        assert rs.status_code == 403, rs.text


# -------- Webhook --------
class TestWebhook:
    def test_webhook_exists_and_400_on_bad_signature(self):
        r = requests.post(
            f"{BASE_URL}/api/webhook/stripe",
            data=b'{"type":"checkout.session.completed"}',
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        # Must NOT be 404 (route exists)
        assert r.status_code != 404, "Webhook route missing"
        # Bad/missing signature -> 400 expected
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"


# -------- Regression: core endpoints still work --------
class TestRegression:
    def test_register_login_me(self):
        u = _register()
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=u["headers"], timeout=10)
        assert r.status_code == 200
        me = r.json()
        assert me["email"] == u["email"]

        lg = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": u["email"], "password": "TestPass123!"},
            timeout=10,
        )
        assert lg.status_code == 200

    def test_projects_list_and_blueprint_crud(self):
        u = _register()
        projs = requests.get(f"{BASE_URL}/api/projects", headers=u["headers"], timeout=10).json()
        assert len(projs) >= 1
        pid = projs[0]["id"]

        bp = requests.get(f"{BASE_URL}/api/projects/{pid}/blueprint", headers=u["headers"], timeout=10)
        assert bp.status_code == 200

        upd = requests.put(
            f"{BASE_URL}/api/projects/{pid}/blueprint",
            headers=u["headers"],
            json={"walls": [{"x1": 0, "y1": 0, "x2": 10, "y2": 0}], "doors": [], "windows": []},
            timeout=10,
        )
        assert upd.status_code == 200

    def test_materials_list_empty(self):
        u = _register()
        projs = requests.get(f"{BASE_URL}/api/projects", headers=u["headers"], timeout=10).json()
        pid = projs[0]["id"]
        m = requests.get(f"{BASE_URL}/api/projects/{pid}/materials", headers=u["headers"], timeout=10)
        assert m.status_code == 200
        assert isinstance(m.json(), list)
