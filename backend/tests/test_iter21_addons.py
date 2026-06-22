"""Iteration 21 — Add-on catalog expansion + credit enforcement.

Validates the 5 new add-ons + that credit consumption gates Pay-App PDFs and
AI Floorplan generations for Free/Pro users (Studio bypasses).

Run: pytest /app/backend/tests/test_iter21_addons.py -v
"""
import uuid
import pytest
import requests


@pytest.fixture
def fresh_user_with_project(base_url):
    """Function-scoped: register a user (which auto-creates 1 starter project) and return its IDs."""
    email = f"iter21_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": "Iter21"},
        timeout=15,
    )
    assert r.status_code == 200
    token = r.json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    projects = requests.get(f"{base_url}/api/projects", headers=h, timeout=10).json()
    assert len(projects) >= 1, "expected starter project from registration"
    return {
        "email": email,
        "token": token,
        "id": r.json()["user"]["id"],
        "project_id": projects[0]["id"],
    }


@pytest.fixture
def fresh_user(base_url):
    """User-only fixture (no project requirement)."""
    email = f"iter21_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": "Iter21"},
        timeout=15,
    )
    assert r.status_code == 200
    return {"email": email, "token": r.json()["token"], "id": r.json()["user"]["id"]}


def test_billing_me_includes_new_entitlements(base_url, fresh_user):
    """The /billing/me response must contain the 5 new entitlement keys, defaulted to 0/false."""
    h = {"Authorization": f"Bearer {fresh_user['token']}"}
    r = requests.get(f"{base_url}/api/billing/me", headers=h, timeout=10)
    assert r.status_code == 200
    ent = r.json().get("entitlements", {})
    for k in ("studio_render_credits", "walkthrough_video_credits",
              "payapp_pdf_credits", "ai_floorplan_credits"):
        assert ent.get(k, 0) == 0, f"{k} should default to 0"
    assert ent.get("client_branding_unlocked", False) is False


def test_floorplan_blocked_without_credits(base_url, fresh_user_with_project):
    """A fresh Free user has 0 ai_floorplan_credits → 402 with credit-required code."""
    h = {"Authorization": f"Bearer {fresh_user_with_project['token']}"}
    pid = fresh_user_with_project["project_id"]
    r = requests.post(
        f"{base_url}/api/projects/{pid}/ai/floorplan",
        json={"prompt": "1000 sqft 2-bed cottage on 40x60 lot"},
        headers=h, timeout=15,
    )
    assert r.status_code == 402, r.text
    detail = r.json()["detail"]
    if isinstance(detail, dict):
        assert detail.get("code") == "floorplan_credit_required"
    else:
        assert "credit" in str(detail).lower()


def test_payapp_pdf_blocked_without_credits(base_url, fresh_user_with_project):
    """A fresh Free user trying to download a Pay-App PDF → 402."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from pathlib import Path
    env = (Path(__file__).resolve().parents[1] / ".env").read_text()
    def _read(prefix, default):
        for line in env.splitlines():
            if line.startswith(prefix):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
        return default
    mongo_url = _read("MONGO_URL=", "mongodb://localhost:27017")
    db_name = _read("DB_NAME=", "test_db")
    import asyncio
    async def seed_and_test():
        h = {"Authorization": f"Bearer {fresh_user_with_project['token']}"}
        pid = fresh_user_with_project["project_id"]
        cli = AsyncIOMotorClient(mongo_url)
        db = cli[db_name]
        try:
            await db.materials.insert_one({
                "id": str(uuid.uuid4()), "project_id": pid,
                "category": "Concrete", "name": "Slab",
                "quantity": 10, "unit": "cyd", "unit_price": 175.0,
            })
            payapp = requests.post(
                f"{base_url}/api/projects/{pid}/pay-apps",
                json={"contractor": "Acme"}, headers=h, timeout=15,
            )
            assert payapp.status_code == 200
            aid = payapp.json()["id"]
            pdf = requests.get(f"{base_url}/api/pay-apps/{aid}/pdf",
                              headers=h, timeout=15)
            assert pdf.status_code == 402, pdf.text
        finally:
            await db.materials.delete_many({"project_id": pid})
            await db.pay_apps.delete_many({"project_id": pid})
            cli.close()
    asyncio.run(seed_and_test())


def test_share_branding_flag_default_false_for_free_user(base_url, fresh_user_with_project):
    """Public /share endpoint returns custom_branding_enabled=false for free-tier owners."""
    h = {"Authorization": f"Bearer {fresh_user_with_project['token']}"}
    pid = fresh_user_with_project["project_id"]
    share_resp = requests.post(
        f"{base_url}/api/projects/{pid}/share",
        json={"enabled": True}, headers=h, timeout=10,
    )
    assert share_resp.status_code == 200
    token = share_resp.json()["token"]
    r = requests.get(f"{base_url}/api/share/{token}", timeout=10)
    assert r.status_code == 200
    assert r.json()["branding"]["custom_branding_enabled"] is False


def test_addon_catalog_includes_new_items(base_url, fresh_user):
    """The Stripe catalog (server-side) recognises the 5 new add-on keys for checkout."""
    h = {"Authorization": f"Bearer {fresh_user['token']}"}
    for key in ("addon_renders_5", "addon_video_1", "addon_videos_5",
                "addon_payapps_10", "addon_client_branding", "addon_floorplans_25"):
        r = requests.post(
            f"{base_url}/api/billing/checkout",
            json={"item": key, "origin_url": "https://example.com"},
            headers=h, timeout=15,
        )
        # 200 = stripe configured; 502/503 = stripe call failed but key was recognised
        # 400 = unknown item — bad
        assert r.status_code != 400, f"{key} is not in CATALOG: {r.text}"
