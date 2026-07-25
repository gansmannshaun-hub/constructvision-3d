"""Iteration 59 — Sessions 5+6+7 (fixtures/openings/trim tags).

Backend contract test: verify PUT /api/projects/{p}/blueprint/sheets/{s}
still accepts and round-trips arbitrary extra keys on:
  • walls    → trim_baseboard, trim_crown, trim_chair_rail booleans
  • doors    → id, position, width, wall_index
  • windows  → id, position, width, wall_index
  • fixtures → kind, position, rotation_deg, size

And GET /api/projects/{p}/blueprint returns them unchanged.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "http://localhost:8001"

ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PWD = "Open0says3me#*03#*"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
    if r.status_code != 200:
        # fallback: alternate admin password from test_credentials.md
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL,
                                "password": "jPgPX2Hok$VkMIKgaZXa"}, timeout=15)
    if r.status_code != 200:
        email = f"test_iter59_{uuid.uuid4().hex[:8]}@example.com"
        rr = requests.post(f"{BASE_URL}/api/auth/register",
                           json={"email": email, "password": "TestPass123!",
                                 "name": "iter59"}, timeout=15)
        assert rr.status_code in (200, 201), rr.text
        token = rr.json().get("token") or rr.json().get("access_token")
    else:
        token = r.json().get("token") or r.json().get("access_token")
    assert token, "No token returned"
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def project_id(auth_headers):
    r = requests.post(f"{BASE_URL}/api/projects",
                      json={"name": f"TEST_iter59_{uuid.uuid4().hex[:6]}",
                            "location": "Test City"},
                      headers=auth_headers, timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("_id")
    assert pid
    yield pid
    try:
        requests.delete(f"{BASE_URL}/api/projects/{pid}",
                        headers=auth_headers, timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module")
def active_sheet(auth_headers, project_id):
    r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                     headers=auth_headers, timeout=15)
    assert r.status_code == 200, r.text
    sheets = r.json()
    assert isinstance(sheets, list) and len(sheets) >= 1
    return sheets[0]


class TestSessions567Persistence:
    """Sessions 5 (fixtures), 6 (openings), 7 (trim) full round-trip"""

    def test_put_persists_all_extra_keys(self, auth_headers, project_id, active_sheet):
        sheet_id = active_sheet["id"]
        walls = [
            {"id": "w1", "start": [0, 0], "end": [20, 0], "height_ft": 10,
             "trim_baseboard": True, "trim_crown": True, "trim_chair_rail": False},
            {"id": "w2", "start": [20, 0], "end": [20, 15], "height_ft": 10,
             "trim_baseboard": True, "trim_crown": False, "trim_chair_rail": True},
            {"id": "w3", "start": [20, 15], "end": [0, 15], "height_ft": 10,
             "trim_baseboard": False, "trim_crown": True, "trim_chair_rail": False},
            {"id": "w4", "start": [0, 15], "end": [0, 0], "height_ft": 10},
        ]
        doors = [
            {"id": "d-iter59-1", "position": [10, 0], "width": 3.25, "wall_index": 0},
            {"id": "d-iter59-2", "position": [20, 7.5], "width": 2.5, "wall_index": 1},
        ]
        windows = [
            {"id": "wi-iter59-1", "position": [10, 15], "width": 4.5, "wall_index": 2},
        ]
        fixtures = [
            {"id": "f-iter59-1", "kind": "toilet", "position": [3, 3],
             "rotation_deg": 90, "size": [2, 2.5]},
            {"id": "f-iter59-2", "kind": "sink", "position": [7, 3],
             "rotation_deg": 45, "size": [2, 1.5]},
            {"id": "f-iter59-3", "kind": "refrigerator", "position": [12, 12],
             "rotation_deg": 0, "size": [3, 3]},
        ]
        labels = [
            {"position": [10, 7.5], "text": "LIVING ROOM",
             "floor_material": "hardwood", "name_override": "Great Room"},
        ]
        payload = {"walls": walls, "doors": doors, "windows": windows,
                   "labels": labels, "fixtures": fixtures}

        r = requests.put(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
            json=payload, headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        saved = r.json()

        # Walls with trim booleans preserved
        assert len(saved["walls"]) == 4
        assert saved["walls"][0]["trim_baseboard"] is True
        assert saved["walls"][0]["trim_crown"] is True
        assert saved["walls"][0]["trim_chair_rail"] is False
        assert saved["walls"][1]["trim_chair_rail"] is True
        assert saved["walls"][2]["trim_crown"] is True

        # Doors with width + wall_index
        assert len(saved["doors"]) == 2
        assert saved["doors"][0]["id"] == "d-iter59-1"
        assert saved["doors"][0]["width"] == 3.25
        assert saved["doors"][0]["wall_index"] == 0
        assert saved["doors"][1]["width"] == 2.5

        # Windows
        assert len(saved["windows"]) == 1
        assert saved["windows"][0]["id"] == "wi-iter59-1"
        assert saved["windows"][0]["width"] == 4.5
        assert saved["windows"][0]["wall_index"] == 2

        # Fixtures - kind, rotation_deg, size, position
        assert len(saved["fixtures"]) == 3
        f1 = next(f for f in saved["fixtures"] if f["id"] == "f-iter59-1")
        assert f1["kind"] == "toilet"
        assert f1["rotation_deg"] == 90
        assert f1["size"] == [2, 2.5]
        assert f1["position"] == [3, 3]
        f2 = next(f for f in saved["fixtures"] if f["id"] == "f-iter59-2")
        assert f2["kind"] == "sink"
        assert f2["rotation_deg"] == 45

    def test_get_blueprint_returns_all_extra_keys(self, auth_headers, project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint",
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        bp = r.json()
        sheets = bp.get("sheets") or []
        assert sheets, "Blueprint returned no sheets"
        # find the sheet with our fixtures
        target = None
        for s in sheets:
            fixtures = s.get("fixtures") or []
            if any(f.get("id") == "f-iter59-1" for f in fixtures):
                target = s
                break
        assert target, "iter59 fixtures not found in GET /blueprint sheets"

        # Trim booleans on walls survive
        w0 = target["walls"][0]
        assert w0.get("trim_baseboard") is True
        assert w0.get("trim_crown") is True
        assert w0.get("trim_chair_rail") is False

        # Doors survive
        d1 = next(d for d in target["doors"] if d["id"] == "d-iter59-1")
        assert d1["width"] == 3.25
        assert d1["wall_index"] == 0

        # Windows survive
        wi1 = next(w for w in target["windows"] if w["id"] == "wi-iter59-1")
        assert wi1["width"] == 4.5

        # Fixtures survive with all extras
        f1 = next(f for f in target["fixtures"] if f["id"] == "f-iter59-1")
        assert f1["kind"] == "toilet"
        assert f1["rotation_deg"] == 90
        assert f1["size"] == [2, 2.5]

    def test_toggle_wall_trim_persists(self, auth_headers, project_id, active_sheet):
        """Simulate the UI toggling trim_baseboard on a wall via PUT."""
        sheet_id = active_sheet["id"]
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                         headers=auth_headers, timeout=15)
        sheet = next(s for s in r.json() if s["id"] == sheet_id)
        walls = sheet["walls"]
        # Toggle trim_baseboard on wall[3] (was unset)
        walls[3] = {**walls[3], "trim_baseboard": True, "trim_crown": True}
        payload = {"walls": walls, "doors": sheet["doors"],
                   "windows": sheet["windows"], "labels": sheet["labels"],
                   "fixtures": sheet["fixtures"]}
        r = requests.put(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
            json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        assert saved["walls"][3]["trim_baseboard"] is True
        assert saved["walls"][3]["trim_crown"] is True

    def test_add_and_delete_fixture(self, auth_headers, project_id, active_sheet):
        """Simulate delete + create fixture via PUT round-trip."""
        sheet_id = active_sheet["id"]
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                         headers=auth_headers, timeout=15)
        sheet = next(s for s in r.json() if s["id"] == sheet_id)
        # Remove first fixture, add a new stove
        fixtures = [f for f in sheet["fixtures"] if f["id"] != "f-iter59-1"]
        fixtures.append({"id": "f-iter59-stove", "kind": "stove",
                         "position": [15, 3], "rotation_deg": 180, "size": [2.5, 2.5]})
        payload = {"walls": sheet["walls"], "doors": sheet["doors"],
                   "windows": sheet["windows"], "labels": sheet["labels"],
                   "fixtures": fixtures}
        r = requests.put(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
            json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        ids = [f["id"] for f in saved["fixtures"]]
        assert "f-iter59-1" not in ids
        assert "f-iter59-stove" in ids
        stove = next(f for f in saved["fixtures"] if f["id"] == "f-iter59-stove")
        assert stove["kind"] == "stove"
        assert stove["rotation_deg"] == 180

    def test_update_opening_width(self, auth_headers, project_id, active_sheet):
        """Change door width — verify PUT persists."""
        sheet_id = active_sheet["id"]
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                         headers=auth_headers, timeout=15)
        sheet = next(s for s in r.json() if s["id"] == sheet_id)
        doors = [dict(d) for d in sheet["doors"]]
        for d in doors:
            if d["id"] == "d-iter59-1":
                d["width"] = 6.0
        payload = {"walls": sheet["walls"], "doors": doors,
                   "windows": sheet["windows"], "labels": sheet["labels"],
                   "fixtures": sheet["fixtures"]}
        r = requests.put(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
            json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        saved = r.json()
        d1 = next(d for d in saved["doors"] if d["id"] == "d-iter59-1")
        assert d1["width"] == 6.0
