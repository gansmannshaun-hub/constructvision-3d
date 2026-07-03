"""Iter 39 — admin bulk-delete users endpoint tests."""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip().rstrip("/")

ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PASSWORD = "Open0says3me#*03#*"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    return r


def _register(email, password="TestPass123!", name="Test User"):
    r = requests.post(
        f"{BASE_URL}/api/auth/register",
        json={"email": email, "password": password, "name": name},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def admin_token():
    r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    body = r.json()
    return body["token"], body["user"]["id"]


@pytest.fixture()
def seeded_users():
    """Create 3 fresh non-admin users."""
    users = []
    for i in range(3):
        email = f"TEST_bulk_{uuid.uuid4().hex[:8]}@example.com"
        u = _register(email)
        users.append({"id": u["user"]["id"], "email": email, "token": u["token"]})
    return users


def test_bulk_delete_requires_auth():
    r = requests.post(f"{BASE_URL}/api/admin/users/bulk-delete",
                      json={"user_ids": ["nope"]}, timeout=30)
    assert r.status_code in (401, 403), r.text


def test_bulk_delete_non_admin_forbidden(seeded_users):
    non_admin = seeded_users[0]
    r = requests.post(
        f"{BASE_URL}/api/admin/users/bulk-delete",
        json={"user_ids": [seeded_users[1]["id"]]},
        headers={"Authorization": f"Bearer {non_admin['token']}"},
        timeout=30,
    )
    assert r.status_code == 403, r.text


def test_bulk_delete_multiple_and_cascade(admin_token, seeded_users):
    token, admin_id = admin_token
    ids = [u["id"] for u in seeded_users[:2]]
    # Seed a project for user0 to verify cascade
    r_login = _login(seeded_users[0]["email"], "TestPass123!")
    assert r_login.status_code == 200
    utok = r_login.json()["token"]
    # Register auto-seeds a default project; fetch it
    lp0 = requests.get(f"{BASE_URL}/api/projects",
                       headers={"Authorization": f"Bearer {utok}"}, timeout=30)
    assert lp0.status_code == 200, lp0.text
    assert lp0.json(), "expected seeded default project"
    proj_id = lp0.json()[0]["id"]

    r = requests.post(
        f"{BASE_URL}/api/admin/users/bulk-delete",
        json={"user_ids": ids, "include_admins": False},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["deleted"] == 2
    assert set(body["deleted_ids"]) == set(ids)
    assert body["skipped_admin_ids"] == []
    assert body["not_found"] == []
    assert body["skipped_self"] is False

    # Verify user removed
    for uid in ids:
        gr = requests.get(f"{BASE_URL}/api/admin/users/{uid}",
                          headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert gr.status_code == 404

    # Verify project cascaded (admin listing shouldn't include it)
    lp = requests.get(f"{BASE_URL}/api/admin/projects",
                      headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert lp.status_code == 200
    ids_found = [p["id"] for p in lp.json()]
    assert proj_id not in ids_found


def test_bulk_delete_skips_self(admin_token, seeded_users):
    token, admin_id = admin_token
    other = seeded_users[2]["id"]
    r = requests.post(
        f"{BASE_URL}/api/admin/users/bulk-delete",
        json={"user_ids": [admin_id, other], "include_admins": False},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["skipped_self"] is True
    assert admin_id not in body["deleted_ids"]
    assert other in body["deleted_ids"]

    # Admin still exists
    me = requests.get(f"{BASE_URL}/api/auth/me",
                      headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert me.status_code == 200


def test_bulk_delete_skips_admin_by_default(admin_token):
    token, admin_id = admin_token
    # Create a secondary admin user via register + admin promote
    email = f"TEST_admin2_{uuid.uuid4().hex[:6]}@example.com"
    u = _register(email)
    uid = u["user"]["id"]
    # promote via patch
    pr = requests.patch(f"{BASE_URL}/api/admin/users/{uid}",
                       json={"is_admin": True},
                       headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert pr.status_code == 200, pr.text

    r = requests.post(f"{BASE_URL}/api/admin/users/bulk-delete",
                      json={"user_ids": [uid], "include_admins": False},
                      headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert uid in body["skipped_admin_ids"]
    assert body["deleted"] == 0

    # Now with include_admins=True
    r2 = requests.post(f"{BASE_URL}/api/admin/users/bulk-delete",
                       json={"user_ids": [uid], "include_admins": True},
                       headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r2.status_code == 200
    b2 = r2.json()
    assert uid in b2["deleted_ids"]
    assert b2["skipped_admin_ids"] == []


def test_bulk_delete_not_found(admin_token):
    token, _ = admin_token
    bogus = str(uuid.uuid4())
    r = requests.post(f"{BASE_URL}/api/admin/users/bulk-delete",
                      json={"user_ids": [bogus]},
                      headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert bogus in body["not_found"]
    assert body["deleted"] == 0
