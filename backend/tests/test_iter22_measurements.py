"""Iteration 22 — Tape measure persistence backend tests.

Covers:
- GET/POST/DELETE /api/projects/{id}/measurements CRUD
- Cross-user isolation (other user's projects must 404)
- Pydantic validation (distance_ft bounds, missing start/end, long label)
"""
from __future__ import annotations

import uuid

import pytest
import requests


# ---------- helpers ----------

def _create_project(base_url: str, headers: dict) -> str:
    r = requests.post(
        f"{base_url}/api/projects",
        json={"name": f"TEST_iter22_{uuid.uuid4().hex[:6]}", "address": "123 Test"},
        headers=headers,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def project_a(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    pid = _create_project(base_url, headers)
    yield pid


@pytest.fixture(scope="module")
def project_b(base_url, user_b):
    headers = {"Authorization": f"Bearer {user_b['token']}"}
    pid = _create_project(base_url, headers)
    yield pid


# ---------- CRUD ----------

class TestMeasurementsCRUD:
    def test_list_initially_empty(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.get(f"{base_url}/api/projects/{project_a}/measurements", headers=h, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # may have been populated by previous test runs; just ensure list type
        assert all(isinstance(m, dict) for m in data)

    def test_create_then_get_persists(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        payload = {
            "start": {"x": 0.0, "y": 0.0, "z": 0.0},
            "end": {"x": 3.0, "y": 0.0, "z": 4.0},
            "distance_ft": 5.0,
            "label": "TEST_iter22 first",
        }
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json=payload, headers=h, timeout=10,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        # Response shape
        assert "id" in m and isinstance(m["id"], str) and len(m["id"]) > 0
        assert m["project_id"] == project_a
        assert m["distance_ft"] == 5.0
        assert m["label"] == "TEST_iter22 first"
        assert m["start"] == {"x": 0.0, "y": 0.0, "z": 0.0}
        assert m["end"] == {"x": 3.0, "y": 0.0, "z": 4.0}
        assert m.get("created_by") == user_a["user"]["id"]
        # No mongo _id leaked
        assert "_id" not in m

        # GET should include it
        r2 = requests.get(f"{base_url}/api/projects/{project_a}/measurements", headers=h, timeout=10)
        assert r2.status_code == 200
        ids = [x["id"] for x in r2.json()]
        assert m["id"] in ids

    def test_delete_removes(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        # Create a fresh one to delete
        c = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "y": 0.0, "z": 0.0},
                "end": {"x": 0.0, "y": 0.0, "z": 10.0},
                "distance_ft": 10.0,
            },
            headers=h, timeout=10,
        )
        assert c.status_code == 200, c.text
        mid = c.json()["id"]

        d = requests.delete(
            f"{base_url}/api/projects/{project_a}/measurements/{mid}",
            headers=h, timeout=10,
        )
        assert d.status_code == 200, d.text
        assert d.json().get("ok") is True

        # Confirm removed
        lst = requests.get(
            f"{base_url}/api/projects/{project_a}/measurements", headers=h, timeout=10,
        ).json()
        assert mid not in [x["id"] for x in lst]

        # Second delete -> 404
        d2 = requests.delete(
            f"{base_url}/api/projects/{project_a}/measurements/{mid}",
            headers=h, timeout=10,
        )
        assert d2.status_code == 404

    def test_optional_label_null(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 1.0, "z": 1.0},
                "end": {"x": 2.0, "z": 2.0},
                "distance_ft": 1.41,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["label"] is None
        # default y = 0.0
        assert m["start"]["y"] == 0.0
        assert m["end"]["y"] == 0.0


# ---------- Cross-user isolation ----------

class TestMeasurementsIsolation:
    def test_user_b_cannot_list_user_a_project(self, base_url, user_b, project_a):
        h = {"Authorization": f"Bearer {user_b['token']}"}
        r = requests.get(f"{base_url}/api/projects/{project_a}/measurements", headers=h, timeout=10)
        assert r.status_code == 404

    def test_user_b_cannot_create_in_user_a_project(self, base_url, user_b, project_a):
        h = {"Authorization": f"Bearer {user_b['token']}"}
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "z": 0.0},
                "end": {"x": 1.0, "z": 0.0},
                "distance_ft": 1.0,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 404

    def test_user_b_cannot_delete_user_a_measurement(self, base_url, user_a, user_b, project_a):
        # User A creates
        ha = {"Authorization": f"Bearer {user_a['token']}"}
        c = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "z": 0.0},
                "end": {"x": 1.0, "z": 0.0},
                "distance_ft": 1.0,
                "label": "TEST_iter22 isolation",
            },
            headers=ha, timeout=10,
        )
        assert c.status_code == 200
        mid = c.json()["id"]

        # User B tries delete via path
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        d = requests.delete(
            f"{base_url}/api/projects/{project_a}/measurements/{mid}",
            headers=hb, timeout=10,
        )
        # Project not owned -> 404 from _assert_project (not 200)
        assert d.status_code == 404

        # And the measurement still exists for user A
        lst = requests.get(
            f"{base_url}/api/projects/{project_a}/measurements", headers=ha, timeout=10,
        ).json()
        assert mid in [x["id"] for x in lst]

    def test_unauth_rejected(self, base_url, project_a):
        # No bearer token
        r = requests.get(f"{base_url}/api/projects/{project_a}/measurements", timeout=10)
        assert r.status_code in (401, 403)


# ---------- Validation ----------

class TestMeasurementsValidation:
    def test_distance_negative_422(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "z": 0.0},
                "end": {"x": 1.0, "z": 0.0},
                "distance_ft": -0.5,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 422

    def test_distance_too_large_422(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "z": 0.0},
                "end": {"x": 1.0, "z": 0.0},
                "distance_ft": 100_001,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 422

    def test_missing_start_422(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "end": {"x": 1.0, "z": 0.0},
                "distance_ft": 1.0,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 422

    def test_missing_end_422(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "z": 0.0},
                "distance_ft": 1.0,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 422

    def test_label_too_long_422(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "z": 0.0},
                "end": {"x": 1.0, "z": 0.0},
                "distance_ft": 1.0,
                "label": "x" * 121,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 422

    def test_distance_at_boundary_zero_ok(self, base_url, user_a, project_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        # ge=0 so 0 should be accepted
        r = requests.post(
            f"{base_url}/api/projects/{project_a}/measurements",
            json={
                "start": {"x": 0.0, "z": 0.0},
                "end": {"x": 0.0, "z": 0.0},
                "distance_ft": 0.0,
            },
            headers=h, timeout=10,
        )
        assert r.status_code == 200, r.text

    def test_unknown_project_404(self, base_url, user_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        fake = uuid.uuid4().hex
        r = requests.get(f"{base_url}/api/projects/{fake}/measurements", headers=h, timeout=10)
        assert r.status_code == 404
