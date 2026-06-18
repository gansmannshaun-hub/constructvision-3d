"""Iteration 9: Site capture (Google Static Maps + GPT-4o vision) tests.

Endpoints:
- GET  /api/projects/{id}/site
- POST /api/projects/{id}/site
- DELETE /api/projects/{id}/site
"""
import base64
import math
import os
import time
import uuid

import pytest
import requests

# Googleplex — clear satellite imagery
TEST_LAT = 37.4221
TEST_LNG = -122.0841
TEST_ZOOM = 18


def _expected_world_meters(lat: float, zoom: int, size_px: int = 640) -> float:
    return size_px * 156543.03392 * math.cos(math.radians(lat)) / (2 ** zoom)


@pytest.fixture(scope="module")
def project_a(base_url, user_a):
    r = requests.post(
        f"{base_url}/api/projects",
        headers={"Authorization": f"Bearer {user_a['token']}"},
        json={"name": f"TEST_iter9_site_{uuid.uuid4().hex[:6]}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def project_b(base_url, user_b):
    # User B's project (Pro trial activation not required if not used elsewhere)
    requests.post(
        f"{base_url}/api/billing/start-trial",
        headers={"Authorization": f"Bearer {user_b['token']}"},
        json={},
        timeout=10,
    )
    r = requests.post(
        f"{base_url}/api/projects",
        headers={"Authorization": f"Bearer {user_b['token']}"},
        json={"name": f"TEST_iter9_site_b_{uuid.uuid4().hex[:6]}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestSiteAuth:
    def test_get_requires_auth(self, base_url, project_a):
        r = requests.get(f"{base_url}/api/projects/{project_a['id']}/site", timeout=10)
        assert r.status_code in (401, 403)

    def test_post_requires_auth(self, base_url, project_a):
        r = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            json={"lat": TEST_LAT, "lng": TEST_LNG, "zoom": TEST_ZOOM},
            timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_delete_requires_auth(self, base_url, project_a):
        r = requests.delete(f"{base_url}/api/projects/{project_a['id']}/site", timeout=10)
        assert r.status_code in (401, 403)


class TestSiteEmpty:
    def test_get_unset_site_returns_captured_false(self, base_url, project_a, auth_headers_a):
        r = requests.get(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["captured"] is False
        assert data["project_id"] == project_a["id"]


class TestSiteValidation:
    def test_lat_out_of_range(self, base_url, project_a, auth_headers_a):
        r = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            json={"lat": 90, "lng": 0, "zoom": 18},
            timeout=15,
        )
        assert r.status_code == 422

    def test_lng_out_of_range(self, base_url, project_a, auth_headers_a):
        r = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            json={"lat": 37.0, "lng": 200, "zoom": 18},
            timeout=15,
        )
        assert r.status_code == 422

    def test_zoom_out_of_range_low(self, base_url, project_a, auth_headers_a):
        r = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            json={"lat": 37.0, "lng": -122.0, "zoom": 5},
            timeout=15,
        )
        assert r.status_code == 422

    def test_zoom_out_of_range_high(self, base_url, project_a, auth_headers_a):
        r = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            json={"lat": 37.0, "lng": -122.0, "zoom": 25},
            timeout=15,
        )
        assert r.status_code == 422


class TestSiteCapture:
    """Full capture flow — real Google Static Maps + GPT-4o vision call."""

    @pytest.fixture(scope="class")
    def captured_site(self, base_url, project_a, user_a):
        r = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers={"Authorization": f"Bearer {user_a['token']}"},
            json={
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "zoom": TEST_ZOOM,
                "address": "1600 Amphitheatre Pkwy, Mountain View, CA",
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_capture_response_shape(self, captured_site, project_a):
        s = captured_site
        assert s["captured"] is True
        assert s["project_id"] == project_a["id"]
        assert s["lat"] == TEST_LAT
        assert s["lng"] == TEST_LNG
        assert s["zoom"] == TEST_ZOOM
        assert s["image_size_px"] == 640
        assert s["image_scale"] == 2
        assert isinstance(s["created_at"], str) and len(s["created_at"]) >= 10

    def test_capture_image_valid_png_b64(self, captured_site):
        b64 = captured_site["image_base64"]
        assert isinstance(b64, str)
        # decode and verify PNG header
        raw = base64.b64decode(b64)
        assert raw.startswith(b"\x89PNG"), "expected PNG magic bytes"
        assert len(raw) > 50_000, f"image too small: {len(raw)} bytes"

    def test_capture_world_meters_correct(self, captured_site):
        expected = _expected_world_meters(TEST_LAT, TEST_ZOOM)
        actual = captured_site["world_meters"]
        assert actual > 0
        assert abs(actual - expected) < 5, f"world_meters {actual} not within 5m of {expected}"
        # Sanity: ~303m at lat=37.42, zoom=18
        assert 295 < actual < 310

    def test_capture_analysis_present(self, captured_site):
        analysis = captured_site.get("analysis") or {}
        assert isinstance(analysis, dict)
        # summary should be a non-empty string (either real or fallback)
        assert isinstance(analysis.get("summary"), str)
        assert len(analysis["summary"]) > 0
        # features must be present (may be empty list on fallback)
        assert "features" in analysis or analysis.get("summary") == "AI analysis unavailable."
        # buildable_area.centroid (when real AI succeeds)
        if analysis.get("summary") != "AI analysis unavailable.":
            buildable = analysis.get("buildable_area")
            if buildable:
                centroid = buildable.get("centroid")
                assert isinstance(centroid, list) and len(centroid) == 2

    def test_get_after_capture_returns_same(self, base_url, project_a, auth_headers_a, captured_site):
        r = requests.get(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["captured"] is True
        assert data["lat"] == captured_site["lat"]
        assert data["lng"] == captured_site["lng"]
        assert data["zoom"] == captured_site["zoom"]
        assert data["image_base64"] == captured_site["image_base64"]

    def test_idempotent_upsert(self, base_url, project_a, auth_headers_a, captured_site):
        """Re-POST should upsert, not create a new doc."""
        r2 = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            json={
                "lat": TEST_LAT,
                "lng": TEST_LNG,
                "zoom": TEST_ZOOM,
                "address": "Idempotent retest",
            },
            timeout=90,
        )
        assert r2.status_code == 200
        # After two POSTs, only one site should exist (verify via GET still works + address updated)
        r3 = requests.get(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            timeout=15,
        )
        assert r3.status_code == 200
        assert r3.json().get("address") == "Idempotent retest"


class TestCrossUserIsolation:
    def test_user_b_cannot_get_user_a_site(self, base_url, project_a, auth_headers_b):
        r = requests.get(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_b,
            timeout=10,
        )
        assert r.status_code == 404

    def test_user_b_cannot_post_user_a_site(self, base_url, project_a, auth_headers_b):
        r = requests.post(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_b,
            json={"lat": TEST_LAT, "lng": TEST_LNG, "zoom": TEST_ZOOM},
            timeout=15,
        )
        assert r.status_code == 404

    def test_user_b_cannot_delete_user_a_site(self, base_url, project_a, auth_headers_b):
        r = requests.delete(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_b,
            timeout=10,
        )
        assert r.status_code == 404


class TestSiteDelete:
    def test_delete_removes_site(self, base_url, project_a, auth_headers_a):
        r = requests.delete(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            timeout=10,
        )
        assert r.status_code == 200
        # GET should return captured=false now
        g = requests.get(
            f"{base_url}/api/projects/{project_a['id']}/site",
            headers=auth_headers_a,
            timeout=10,
        )
        assert g.status_code == 200
        assert g.json()["captured"] is False


class TestCodePathInspection:
    """Static inspection of the route file — confirms error branches exist
    without actually unsetting env vars in the running server."""

    def test_missing_api_key_raises_503(self):
        src = open("/app/backend/routes/site.py", "r").read()
        assert "raise HTTPException(503" in src
        assert "Google Maps API key missing" in src

    def test_ai_failure_fallback_exists(self):
        src = open("/app/backend/routes/site.py", "r").read()
        assert "AI analysis unavailable." in src
        # The capture endpoint wraps _analyze_site in try/except so AI failure
        # never blocks the response.
        assert "asyncio.wait_for" in src
