"""Iteration 17 — Persist model placement transform on the satellite ground plane.

Run: pytest /app/backend/tests/test_iter17_site_transform.py -v
"""
import uuid
import pytest
import requests


@pytest.fixture(scope="module")
def project(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(
        f"{base_url}/api/projects",
        json={"name": f"iter17_{uuid.uuid4().hex[:6]}"},
        headers=headers, timeout=20,
    )
    pid = r.json()["id"]
    yield {"id": pid, "headers": headers}
    requests.delete(f"{base_url}/api/projects/{pid}", headers=headers, timeout=15)


def test_set_transform_creates_site_doc(base_url, project):
    """First call should upsert even when no satellite image is captured."""
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 12.5, "z": -8.0, "rotation_deg": 45.0, "scale": 1.5},
        headers=project["headers"], timeout=10,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["model_transform"]["x"] == 12.5
    assert body["model_transform"]["z"] == -8.0
    assert body["model_transform"]["rotation_deg"] == 45.0
    assert body["model_transform"]["scale"] == 1.5


def test_transform_persisted_on_get_site(base_url, project):
    site = requests.get(
        f"{base_url}/api/projects/{project['id']}/site",
        headers=project["headers"], timeout=10,
    ).json()
    assert site["model_transform"]["x"] == 12.5
    assert site["model_transform"]["rotation_deg"] == 45.0
    assert site["model_transform"]["scale"] == 1.5


def test_transform_scale_default_is_one(base_url, project):
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 0, "z": 0, "rotation_deg": 0},  # scale omitted
        headers=project["headers"], timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["model_transform"]["scale"] == 1.0


def test_transform_scale_validation_low(base_url, project):
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 0, "z": 0, "rotation_deg": 0, "scale": 0.01},
        headers=project["headers"], timeout=10,
    )
    assert r.status_code == 422  # below 0.1


def test_transform_scale_validation_high(base_url, project):
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 0, "z": 0, "rotation_deg": 0, "scale": 50},
        headers=project["headers"], timeout=10,
    )
    assert r.status_code == 422  # above 10


def test_transform_clamps_rotation_modulo_360(base_url, project):
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 0, "z": 0, "rotation_deg": 725},
        headers=project["headers"], timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["model_transform"]["rotation_deg"] == pytest.approx(5.0)


def test_transform_accepts_negative_rotation(base_url, project):
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 0, "z": 0, "rotation_deg": -30},
        headers=project["headers"], timeout=10,
    )
    assert r.status_code == 200
    # Python modulo gives a positive result for negative dividends
    assert r.json()["model_transform"]["rotation_deg"] == pytest.approx(330.0)


def test_transform_zero_defaults(base_url, project):
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={},
        headers=project["headers"], timeout=10,
    )
    assert r.status_code == 200
    t = r.json()["model_transform"]
    assert t["x"] == 0.0
    assert t["z"] == 0.0
    assert t["rotation_deg"] == 0.0
    assert t["scale"] == 1.0


def test_transform_404_on_unknown_project(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.patch(
        f"{base_url}/api/projects/{uuid.uuid4()}/site/transform",
        json={"x": 1, "z": 2, "rotation_deg": 90},
        headers=headers, timeout=10,
    )
    assert r.status_code == 404


def test_transform_requires_auth(base_url, project):
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 1, "z": 2, "rotation_deg": 90},
        timeout=10,
    )
    assert r.status_code in (401, 403)


def test_transform_non_owner_404(base_url, project, user_b):
    headers_b = {"Authorization": f"Bearer {user_b['token']}"}
    r = requests.patch(
        f"{base_url}/api/projects/{project['id']}/site/transform",
        json={"x": 1, "z": 2, "rotation_deg": 90},
        headers=headers_b, timeout=10,
    )
    assert r.status_code == 404
