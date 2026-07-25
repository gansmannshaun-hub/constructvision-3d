"""Iteration 58 — Session 4 (Room polygons / floor material / ceiling height).

Backend contract test: verify that PUT /api/projects/{p}/blueprint/sheets/{s}
accepts and persists the new label fields (`floor_material`,
`ceiling_height_ft`, `name_override`) without losing other geometry fields
(walls/doors/windows/fixtures)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback for backend-only local runs
    BASE_URL = "http://localhost:8001"

ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PWD = "Open0says3me#*03#*"


@pytest.fixture(scope="module")
def auth_headers():
    # Try admin first; fall back to a fresh registered user.
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
    if r.status_code != 200:
        email = f"test_iter58_{uuid.uuid4().hex[:8]}@example.com"
        rr = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"email": email, "password": "TestPass123!",
                                 "name": "iter58"}, timeout=15)
        assert rr.status_code in (200, 201), rr.text
        token = rr.json().get("token") or rr.json().get("access_token")
    else:
        token = r.json().get("token") or r.json().get("access_token")
    assert token, "No token returned from login/register"
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def project_id(auth_headers):
    r = requests.post(f"{BASE_URL}/api/projects",
                      json={"name": f"TEST_iter58_{uuid.uuid4().hex[:6]}",
                            "location": "Test City"},
                      headers=auth_headers, timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("_id")
    assert pid
    yield pid
    # cleanup
    try:
        requests.delete(f"{BASE_URL}/api/projects/{pid}",
                        headers=auth_headers, timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module")
def active_sheet(auth_headers, project_id):
    # Ensures a blueprint + a sheet exist
    r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    sheets = r.json()
    assert isinstance(sheets, list) and len(sheets) >= 1, sheets
    return sheets[0]


class TestRoomLabelPersistence:
    """Session-4 label-field persistence"""

    def test_put_sheet_persists_new_label_fields(self, auth_headers, project_id, active_sheet):
        sheet_id = active_sheet["id"]

        walls = [
            {"id": "w1", "start": [0, 0], "end": [20, 0], "height_ft": 10},
            {"id": "w2", "start": [20, 0], "end": [20, 15], "height_ft": 10},
            {"id": "w3", "start": [20, 15], "end": [0, 15], "height_ft": 10},
            {"id": "w4", "start": [0, 15], "end": [0, 0], "height_ft": 10},
        ]
        doors = [{"id": "d1", "wall_index": 0, "position": [10, 0], "width_ft": 3}]
        windows = [{"id": "wi1", "wall_index": 2, "position": [10, 15], "width_ft": 4}]
        fixtures = [{"id": "f1", "position": [10, 7.5], "kind": "sink"}]
        labels = [
            {
                "position": [10, 7.5],
                "text": "LIVING ROOM",
                "floor_material": "hardwood",
                "ceiling_height_ft": 8.5,
                "name_override": "Great Room",
            },
            {"position": [5, 5], "text": "KITCHEN"},
        ]
        payload = {"walls": walls, "doors": doors, "windows": windows,
                   "labels": labels, "fixtures": fixtures}

        r = requests.put(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
            json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert len(saved["labels"]) == 2
        assert saved["labels"][0]["floor_material"] == "hardwood"
        assert saved["labels"][0]["ceiling_height_ft"] == 8.5
        assert saved["labels"][0]["name_override"] == "Great Room"
        assert saved["labels"][0]["text"] == "LIVING ROOM"
        # Sibling geometry preserved
        assert len(saved["walls"]) == 4
        assert len(saved["doors"]) == 1
        assert len(saved["windows"]) == 1
        assert len(saved["fixtures"]) == 1

    def test_get_blueprint_returns_extra_label_fields(self, auth_headers, project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint",
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        bp = r.json()
        # Blueprint has active-sheet mirroring OR sheets[] list
        sheets = bp.get("sheets")
        assert sheets, "Blueprint response missing sheets[]"
        # Find our label
        found = None
        for s in sheets:
            for lbl in (s.get("labels") or []):
                if lbl.get("text") == "LIVING ROOM":
                    found = lbl
                    break
        assert found, "LIVING ROOM label not returned via GET /blueprint"
        assert found.get("floor_material") == "hardwood"
        assert found.get("ceiling_height_ft") == 8.5
        assert found.get("name_override") == "Great Room"

    def test_clear_ceiling_height_persists_null(self, auth_headers, project_id, active_sheet):
        sheet_id = active_sheet["id"]
        # Fetch current sheet
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                         headers=auth_headers, timeout=15)
        sheet = next(s for s in r.json() if s["id"] == sheet_id)
        labels = sheet["labels"]
        labels[0]["ceiling_height_ft"] = None
        payload = {"walls": sheet["walls"], "doors": sheet["doors"],
                   "windows": sheet["windows"], "labels": labels,
                   "fixtures": sheet["fixtures"]}
        r = requests.put(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
            json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["labels"][0]["ceiling_height_ft"] is None
        # floor_material and name_override untouched
        assert saved["labels"][0]["floor_material"] == "hardwood"
        assert saved["labels"][0]["name_override"] == "Great Room"

    def test_change_floor_material_to_marble(self, auth_headers, project_id, active_sheet):
        sheet_id = active_sheet["id"]
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                         headers=auth_headers, timeout=15)
        sheet = next(s for s in r.json() if s["id"] == sheet_id)
        labels = sheet["labels"]
        labels[0]["floor_material"] = "marble"
        payload = {"walls": sheet["walls"], "doors": sheet["doors"],
                   "windows": sheet["windows"], "labels": labels,
                   "fixtures": sheet["fixtures"]}
        r = requests.put(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
            json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["labels"][0]["floor_material"] == "marble"
