"""Iteration 23 — POST /api/projects/{id}/site/build-3d & DELETE.

These tests validate the contract/error paths that do NOT require live
Google Elevation API access (which requires user-side enablement in
Google Cloud Console). The happy path is verified manually via the UI
once the user enables the Maps Elevation API.
"""
from __future__ import annotations

import os
import uuid

import httpx
import pytest


API_BASE = os.environ.get("E2E_BASE_URL", "http://localhost:8001/api")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@atlas.app")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "Open0says3me#*03#*")


@pytest.fixture(scope="module")
def admin_token():
    r = httpx.post(f"{API_BASE}/auth/login",
                   json={"email": ADMIN_EMAIL, "password": ADMIN_PW},
                   timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def test_build_3d_requires_auth():
    r = httpx.post(f"{API_BASE}/projects/anyid/site/build-3d", timeout=10)
    assert r.status_code in (401, 403)


def test_clear_3d_requires_auth():
    r = httpx.delete(f"{API_BASE}/projects/anyid/site/build-3d", timeout=10)
    assert r.status_code in (401, 403)


def test_build_3d_404_for_unknown_project(admin_token):
    r = httpx.post(f"{API_BASE}/projects/does-not-exist/site/build-3d",
                   headers=_h(admin_token), timeout=10)
    assert r.status_code == 404


def test_build_3d_requires_captured_site(admin_token):
    """A new project with no satellite capture → 400 with helpful message."""
    name = f"iter23_nosite_{uuid.uuid4().hex[:6]}"
    r = httpx.post(f"{API_BASE}/projects",
                   json={"name": name, "address": "Test"},
                   headers=_h(admin_token), timeout=10)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]
    try:
        r = httpx.post(f"{API_BASE}/projects/{pid}/site/build-3d",
                       headers=_h(admin_token), timeout=10)
        assert r.status_code == 400
        assert "Capture a site first" in r.text
    finally:
        httpx.delete(f"{API_BASE}/projects/{pid}",
                     headers=_h(admin_token), timeout=10)


def test_clear_3d_is_idempotent(admin_token):
    """DELETE on a project with no terrain_3d should still return ok."""
    name = f"iter23_clear_{uuid.uuid4().hex[:6]}"
    r = httpx.post(f"{API_BASE}/projects",
                   json={"name": name, "address": "Test"},
                   headers=_h(admin_token), timeout=10)
    pid = r.json()["id"]
    try:
        r = httpx.delete(f"{API_BASE}/projects/{pid}/site/build-3d",
                         headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        assert r.json() == {"ok": True}
    finally:
        httpx.delete(f"{API_BASE}/projects/{pid}",
                     headers=_h(admin_token), timeout=10)


def test_build_3d_cross_user_isolation(admin_token):
    """User B cannot trigger build-3d on User A's project (404)."""
    # Create a project as admin
    name = f"iter23_iso_{uuid.uuid4().hex[:6]}"
    r = httpx.post(f"{API_BASE}/projects",
                   json={"name": name, "address": "Test"},
                   headers=_h(admin_token), timeout=10)
    pid = r.json()["id"]

    # Make a second user
    other_email = f"iter23_other_{uuid.uuid4().hex[:6]}@example.com"
    httpx.post(f"{API_BASE}/auth/register",
               json={"email": other_email, "password": "TestPass123!",
                     "name": "Iter23 Other"},
               timeout=10)
    other_token = httpx.post(f"{API_BASE}/auth/login",
                             json={"email": other_email, "password": "TestPass123!"},
                             timeout=10).json()["token"]
    try:
        r = httpx.post(f"{API_BASE}/projects/{pid}/site/build-3d",
                       headers=_h(other_token), timeout=10)
        assert r.status_code == 404
        r = httpx.delete(f"{API_BASE}/projects/{pid}/site/build-3d",
                         headers=_h(other_token), timeout=10)
        assert r.status_code == 404
    finally:
        httpx.delete(f"{API_BASE}/projects/{pid}",
                     headers=_h(admin_token), timeout=10)
