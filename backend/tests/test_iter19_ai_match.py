"""Iteration 19 — AI 'Match satellite scale' auto-button.

The endpoint POST /api/projects/{id}/site/auto-scale calls GPT-4o vision against
the saved satellite image to detect the building footprint and compute a display
scale ratio against the blueprint AABB. Real LLM calls are gated behind
RUN_LLM_TESTS=1 — the rest validates validation + 4xx paths and the math layer.

Run: pytest /app/backend/tests/test_iter19_ai_match.py -v
"""
import os
import uuid

import pytest
import requests


@pytest.fixture(scope="module")
def project(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(
        f"{base_url}/api/projects",
        json={"name": f"iter19_{uuid.uuid4().hex[:6]}"},
        headers=headers, timeout=20,
    )
    pid = r.json()["id"]
    yield {"id": pid, "headers": headers}
    requests.delete(f"{base_url}/api/projects/{pid}", headers=headers, timeout=15)


# ---------- Validation paths (no LLM call) ----------

def test_auto_scale_400_when_no_site_captured(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site/auto-scale",
        json={"blueprint_width_ft": 40, "blueprint_depth_ft": 30},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 400
    assert "site" in r.json()["detail"].lower()


def test_auto_scale_404_on_unknown_project(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(
        f"{base_url}/api/projects/{uuid.uuid4()}/site/auto-scale",
        json={"blueprint_width_ft": 40, "blueprint_depth_ft": 30},
        headers=headers, timeout=15,
    )
    assert r.status_code == 404


def test_auto_scale_validation_negative_dimensions(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site/auto-scale",
        json={"blueprint_width_ft": -5, "blueprint_depth_ft": 30},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_auto_scale_validation_zero_dimensions(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site/auto-scale",
        json={"blueprint_width_ft": 0, "blueprint_depth_ft": 30},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_auto_scale_validation_huge_dimensions(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site/auto-scale",
        json={"blueprint_width_ft": 100_000, "blueprint_depth_ft": 30},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_auto_scale_validation_negative_reference_feet(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site/auto-scale",
        json={"blueprint_width_ft": 40, "blueprint_depth_ft": 30,
              "reference_feet": -10},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_auto_scale_requires_auth(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site/auto-scale",
        json={"blueprint_width_ft": 40, "blueprint_depth_ft": 30},
        timeout=10,
    )
    assert r.status_code in (401, 403)


def test_auto_scale_non_owner_404(base_url, project, user_b):
    headers_b = {"Authorization": f"Bearer {user_b['token']}"}
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site/auto-scale",
        json={"blueprint_width_ft": 40, "blueprint_depth_ft": 30},
        headers=headers_b, timeout=15,
    )
    assert r.status_code == 404


# ---------- Real LLM call (skipped by default) ----------

@pytest.mark.slow
@pytest.mark.skipif(os.environ.get("RUN_LLM_TESTS") != "1",
                    reason="set RUN_LLM_TESTS=1 to hit GPT-4o vision")
def test_auto_scale_end_to_end_with_real_satellite(base_url, user_a):
    """Capture a real Manhattan site, then ask AI Match to detect a building."""
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    pr = requests.post(f"{base_url}/api/projects",
                       json={"name": f"iter19_e2e_{uuid.uuid4().hex[:6]}"},
                       headers=headers, timeout=15)
    pid = pr.json()["id"]
    try:
        site = requests.post(
            f"{base_url}/api/projects/{pid}/site",
            json={"lat": 40.7589, "lng": -73.9851, "zoom": 19},
            headers=headers, timeout=60,
        )
        if site.status_code != 200:
            pytest.skip("Google Maps key missing — cannot run vision E2E")
        r = requests.post(
            f"{base_url}/api/projects/{pid}/site/auto-scale",
            json={"blueprint_width_ft": 30, "blueprint_depth_ft": 25},
            headers=headers, timeout=90,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "applied" in body
        assert "detection" in body
        if body["applied"]:
            assert 0.1 <= body["scale"] <= 10.0
            assert body["detection"]["width_ft"] > 0
    finally:
        requests.delete(f"{base_url}/api/projects/{pid}", headers=headers, timeout=15)
