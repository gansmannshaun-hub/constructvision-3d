"""Iter 27: Legal Terms + Privacy gate tests."""
import os
import uuid
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")

CURRENT_VERSION = "2026-02-01"


# Fresh user fixture per module so we don't trip on auto-activation
@pytest.fixture(scope="module")
def fresh_user():
    email = f"legaltest_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "TestPass123!", "name": "Legal Test"},
                      timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "password": "TestPass123!", "token": d["token"], "user": d["user"]}


@pytest.fixture
def auth_headers(fresh_user):
    return {"Authorization": f"Bearer {fresh_user['token']}"}


# Public endpoint — current versions
def test_legal_current_public():
    r = requests.get(f"{BASE_URL}/api/legal/current", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["terms_version"] == CURRENT_VERSION
    assert data["privacy_version"] == CURRENT_VERSION


# Register response includes needs_legal_acceptance=True
def test_register_includes_needs_legal_true(fresh_user):
    assert fresh_user["user"].get("needs_legal_acceptance") is True


# Status endpoint for brand-new user
def test_legal_status_new_user(auth_headers):
    r = requests.get(f"{BASE_URL}/api/legal/status", headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["needs_acceptance"] is True
    assert data["current"]["terms_version"] == CURRENT_VERSION
    assert data["current"]["privacy_version"] == CURRENT_VERSION
    assert data["accepted"]["terms_version"] is None
    assert data["accepted"]["privacy_version"] is None


# Login (pre-accept) shows needs_legal_acceptance=True
def test_login_before_accept_needs_legal(fresh_user):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": fresh_user["email"], "password": fresh_user["password"]},
                      timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["needs_legal_acceptance"] is True


# Reject mismatched terms version
def test_accept_rejects_mismatched_terms_version(auth_headers):
    r = requests.post(f"{BASE_URL}/api/legal/accept", headers=auth_headers, json={
        "terms_version": "2025-01-01",
        "privacy_version": CURRENT_VERSION,
        "agreed_terms": True,
        "agreed_privacy": True,
    }, timeout=15)
    assert r.status_code == 400, r.text
    assert "version" in r.json()["detail"].lower()


# Reject mismatched privacy version
def test_accept_rejects_mismatched_privacy_version(auth_headers):
    r = requests.post(f"{BASE_URL}/api/legal/accept", headers=auth_headers, json={
        "terms_version": CURRENT_VERSION,
        "privacy_version": "2025-01-01",
        "agreed_terms": True,
        "agreed_privacy": True,
    }, timeout=15)
    assert r.status_code == 400, r.text


# Reject if agreed_terms=False
def test_accept_rejects_unchecked_terms(auth_headers):
    r = requests.post(f"{BASE_URL}/api/legal/accept", headers=auth_headers, json={
        "terms_version": CURRENT_VERSION,
        "privacy_version": CURRENT_VERSION,
        "agreed_terms": False,
        "agreed_privacy": True,
    }, timeout=15)
    assert r.status_code == 400, r.text


# Reject if agreed_privacy=False
def test_accept_rejects_unchecked_privacy(auth_headers):
    r = requests.post(f"{BASE_URL}/api/legal/accept", headers=auth_headers, json={
        "terms_version": CURRENT_VERSION,
        "privacy_version": CURRENT_VERSION,
        "agreed_terms": True,
        "agreed_privacy": False,
    }, timeout=15)
    assert r.status_code == 400, r.text


# Happy path: accept + status flips + me reflects
def test_accept_success_flow(auth_headers):
    r = requests.post(f"{BASE_URL}/api/legal/accept", headers=auth_headers, json={
        "terms_version": CURRENT_VERSION,
        "privacy_version": CURRENT_VERSION,
        "agreed_terms": True,
        "agreed_privacy": True,
    }, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["legal_acceptance"]["terms_version"] == CURRENT_VERSION
    assert body["legal_acceptance"]["privacy_version"] == CURRENT_VERSION
    assert body["legal_acceptance"].get("accepted_at")

    # Status should now flip
    s = requests.get(f"{BASE_URL}/api/legal/status", headers=auth_headers, timeout=15)
    assert s.status_code == 200
    sd = s.json()
    assert sd["needs_acceptance"] is False
    assert sd["accepted"]["terms_version"] == CURRENT_VERSION

    # /api/auth/me reflects
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=15)
    assert me.status_code == 200
    assert me.json()["needs_legal_acceptance"] is False


# Login post-accept reflects false
def test_login_post_accept_needs_legal_false(fresh_user):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": fresh_user["email"], "password": fresh_user["password"]},
                      timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["needs_legal_acceptance"] is False


# Force re-acceptance: set old version directly in DB, expect needs_legal_acceptance=True again
def test_force_reacceptance_via_db():
    # New user, accept, then mutate DB to old version
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    email = f"legaltest_force_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "TestPass123!", "name": "Force Re-accept"},
                      timeout=30)
    assert r.status_code == 200
    d = r.json()
    token = d["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # accept
    requests.post(f"{BASE_URL}/api/legal/accept", headers=headers, json={
        "terms_version": CURRENT_VERSION, "privacy_version": CURRENT_VERSION,
        "agreed_terms": True, "agreed_privacy": True,
    }, timeout=15)

    # confirm cleared
    me1 = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15).json()
    assert me1["needs_legal_acceptance"] is False

    # mutate DB to old version
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")
    # Read backend .env if env not set
    if not os.environ.get("MONGO_URL"):
        be_env = Path("/app/backend/.env")
        if be_env.exists():
            for line in be_env.read_text().splitlines():
                if line.startswith("MONGO_URL="):
                    mongo_url = line.split("=", 1)[1].strip().strip('"')
                if line.startswith("DB_NAME="):
                    db_name = line.split("=", 1)[1].strip().strip('"')

    async def _mutate():
        c = AsyncIOMotorClient(mongo_url)
        db = c[db_name]
        await db.users.update_one(
            {"email": email},
            {"$set": {"legal_acceptance": {
                "terms_version": "2020-01-01",
                "privacy_version": "2020-01-01",
                "accepted_at": "2020-01-01T00:00:00+00:00",
            }}},
        )
        c.close()

    asyncio.get_event_loop().run_until_complete(_mutate())

    me2 = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=15).json()
    assert me2["needs_legal_acceptance"] is True
