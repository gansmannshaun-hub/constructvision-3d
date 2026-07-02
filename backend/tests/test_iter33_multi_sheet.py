"""Tests for multi-sheet blueprint architecture (iter 33).

Covers:
- GET /api/projects/{id}/blueprint returns sheets[] + active_sheet_id (auto-Sheet 1).
- POST /blueprint/sheets creates a new sheet; PATCH renames + reorders + refloor.
- PUT /blueprint/sheets/{id} saves geometry, mirrors into parent when active.
- DELETE rejects the last sheet, reassigns active if deleted was active.
- POST /blueprint/active/{sheet_id} switches active sheet & mirrors geometry.
- Legacy PUT /blueprint writes into active sheet + mirrors bp.walls.
- Legacy migration: existing bp.walls on read gets promoted into Sheet 1.
- GET /materials?sheet_id=... filters by sheet.
"""
import asyncio
import os
import uuid
from pathlib import Path

import pytest
import requests

_burl = os.environ.get("REACT_APP_BACKEND_URL")
if not _burl:
    _p = Path("/app/frontend/.env")
    if _p.exists():
        for _line in _p.read_text().splitlines():
            if _line.startswith("REACT_APP_BACKEND_URL="):
                _burl = _line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (_burl or "").rstrip("/")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def token():
    email = f"iter33_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "TestPass123!", "name": "Sheet Tester"},
                      timeout=30)
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text[:200]}"
    tok = r.json()["token"]
    requests.post(f"{BASE_URL}/api/billing/start-trial",
                  headers={"Authorization": f"Bearer {tok}"}, json={}, timeout=10)
    return tok


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def project_id(headers):
    r = requests.post(f"{BASE_URL}/api/projects",
                      json={"name": f"TEST_iter33_{uuid.uuid4().hex[:6]}", "address": "1 Sheet St"},
                      headers=headers, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _get_bp(pid, headers):
    r = requests.get(f"{BASE_URL}/api/projects/{pid}/blueprint", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. Baseline: fresh project has exactly one Sheet 1 ----------
class TestBaselineSheet:
    def test_new_project_has_one_sheet(self, project_id, headers):
        bp = _get_bp(project_id, headers)
        assert "sheets" in bp, f"missing sheets[] in bp keys={list(bp.keys())}"
        assert "active_sheet_id" in bp
        assert isinstance(bp["sheets"], list)
        assert len(bp["sheets"]) == 1, f"expected 1 sheet, got {len(bp['sheets'])}"
        s = bp["sheets"][0]
        assert s["name"] == "Sheet 1"
        assert s["floor_level"] == 0
        assert s["order_index"] == 0
        for key in ("id", "walls", "doors", "windows", "labels", "fixtures",
                    "source_document_id", "building_ft", "scale_confidence"):
            assert key in s, f"sheet missing {key}: {list(s.keys())}"
        assert bp["active_sheet_id"] == s["id"]


# ---------- 2. Sheet CRUD ----------
class TestSheetCRUD:
    def test_create_sheet(self, project_id, headers):
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                          json={"name": "Second Floor", "floor_level": 1},
                          headers=headers, timeout=30)
        assert r.status_code in (200, 201), r.text
        s = r.json()
        assert s["name"] == "Second Floor"
        assert s["floor_level"] == 1
        pytest.new_sheet_id = s["id"]

        bp = _get_bp(project_id, headers)
        ids = [x["id"] for x in bp["sheets"]]
        assert pytest.new_sheet_id in ids

    def test_patch_sheet_rename_and_floor(self, project_id, headers):
        sid = pytest.new_sheet_id
        r = requests.patch(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sid}",
                           json={"name": "Upper Level", "floor_level": 2},
                           headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["name"] == "Upper Level"
        assert s["floor_level"] == 2

    def test_patch_sheet_order_index(self, project_id, headers):
        sid = pytest.new_sheet_id
        r = requests.patch(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sid}",
                           json={"order_index": 5},
                           headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["order_index"] == 5

    def test_put_sheet_geometry(self, project_id, headers):
        sid = pytest.new_sheet_id
        payload = {
            "walls": [{"id": "w1", "start": [0, 0], "end": [10, 0], "thickness": 0.5}],
            "doors": [], "windows": [],
            "labels": [{"id": "l1", "text": "Loft", "position": [5, 2]}],
            "fixtures": [{"id": "f1", "type": "sink", "position": [3, 3], "w": 2, "h": 1, "rotation": 0}],
        }
        r = requests.put(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sid}",
                         json=payload, headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        assert len(s["walls"]) == 1
        assert len(s["fixtures"]) == 1

    def test_activate_sheet_mirrors_walls(self, project_id, headers):
        sid = pytest.new_sheet_id
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/blueprint/active/{sid}",
                          headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        bp = r.json()
        assert bp["active_sheet_id"] == sid
        # bp.walls now mirrors the sheet's walls
        assert len(bp["walls"]) == 1, f"expected mirrored 1 wall, got {len(bp.get('walls', []))}"

    def test_delete_only_sheet_forbidden(self, project_id, headers):
        # Create a fresh project with only Sheet 1 to isolate
        r = requests.post(f"{BASE_URL}/api/projects",
                          json={"name": f"TEST_iter33_del_{uuid.uuid4().hex[:6]}", "address": "x"},
                          headers=headers, timeout=30)
        assert r.status_code in (200, 201)
        pid2 = r.json()["id"]
        bp = _get_bp(pid2, headers)
        only_sid = bp["sheets"][0]["id"]
        d = requests.delete(f"{BASE_URL}/api/projects/{pid2}/blueprint/sheets/{only_sid}",
                            headers=headers, timeout=30)
        assert d.status_code == 400, f"expected 400 for last sheet, got {d.status_code} {d.text}"

    def test_delete_active_sheet_reassigns(self, project_id, headers):
        # In `project_id`, we have Sheet 1 + Upper Level (=active). Delete active → Sheet 1 becomes active.
        bp = _get_bp(project_id, headers)
        active_before = bp["active_sheet_id"]
        assert len(bp["sheets"]) >= 2
        d = requests.delete(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{active_before}",
                            headers=headers, timeout=30)
        assert d.status_code == 200, d.text
        bp2 = _get_bp(project_id, headers)
        assert bp2["active_sheet_id"] != active_before
        assert bp2["active_sheet_id"] in [x["id"] for x in bp2["sheets"]]


# ---------- 3. Legacy PUT /blueprint writes into active sheet + mirrors ----------
class TestLegacyPutBlueprint:
    def test_legacy_put_mirrors_active_sheet(self, project_id, headers):
        payload = {
            "walls": [{"id": "wA", "start": [0, 0], "end": [5, 5], "thickness": 0.5}],
            "doors": [], "windows": [], "labels": [], "fixtures": [],
        }
        r = requests.put(f"{BASE_URL}/api/projects/{project_id}/blueprint",
                         json=payload, headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        bp = r.json()
        assert len(bp["walls"]) == 1
        active = bp["active_sheet_id"]
        # Check the active sheet inside sheets[] also has the walls
        active_sheet = next(s for s in bp["sheets"] if s["id"] == active)
        assert len(active_sheet["walls"]) == 1


# ---------- 4. Legacy migration ----------
class TestLegacyMigration:
    def test_legacy_project_migrates_to_sheet_1(self, headers):
        """Create project via direct Mongo without any blueprint_sheets, then GET/blueprint."""
        import motor.motor_asyncio  # type: ignore

        async def seed():
            _mu = os.environ.get("MONGO_URL")
            _dn = os.environ.get("DB_NAME")
            if not _mu:
                _bp = Path("/app/backend/.env")
                if _bp.exists():
                    for _ln in _bp.read_text().splitlines():
                        if _ln.startswith("MONGO_URL="):
                            _mu = _ln.split("=", 1)[1].strip().strip('"')
                        if _ln.startswith("DB_NAME="):
                            _dn = _ln.split("=", 1)[1].strip().strip('"')
            client = motor.motor_asyncio.AsyncIOMotorClient(_mu)
            db = client[_dn]
            # Look up test user by header
            token = headers["Authorization"].split()[1]
            import jwt
            payload = jwt.decode(token, options={"verify_signature": False})
            uid = payload["sub"] if "sub" in payload else payload.get("user_id")
            pid = str(uuid.uuid4())
            await db.projects.insert_one({
                "id": pid, "user_id": uid, "name": "TEST_iter33_legacy",
                "description": "", "created_at": "2025-01-01T00:00:00Z",
            })
            await db.blueprints.insert_one({
                "id": str(uuid.uuid4()),
                "project_id": pid,
                "walls": [{"id": "legacy1", "start": [1, 1], "end": [9, 1], "thickness": 0.5}],
                "doors": [], "windows": [], "labels": [], "fixtures": [],
                "updated_at": "2025-01-01T00:00:00Z",
            })
            client.close()
            return pid

        pid = asyncio.new_event_loop().run_until_complete(seed())
        bp = _get_bp(pid, headers)
        assert len(bp["sheets"]) == 1
        s = bp["sheets"][0]
        assert s["name"] == "Sheet 1"
        assert len(s["walls"]) == 1, f"legacy walls not migrated: {s}"
        assert bp["active_sheet_id"] == s["id"]


# ---------- 5. Materials sheet_id filter ----------
class TestMaterialsFilter:
    def test_materials_filter_by_sheet_id(self, project_id, headers):
        # Seed two materials with different sheet_ids via Mongo, then filter.
        import motor.motor_asyncio  # type: ignore

        bp = _get_bp(project_id, headers)
        sheet_a = bp["sheets"][0]["id"]
        sheet_b = None
        # Ensure two sheets
        if len(bp["sheets"]) < 2:
            r = requests.post(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                              json={"name": "MatSheet", "floor_level": 1},
                              headers=headers, timeout=30)
            sheet_b = r.json()["id"]
        else:
            sheet_b = bp["sheets"][1]["id"]

        async def seed_mats():
            _mu = os.environ.get("MONGO_URL")
            _dn = os.environ.get("DB_NAME")
            if not _mu:
                _bp = Path("/app/backend/.env")
                if _bp.exists():
                    for _ln in _bp.read_text().splitlines():
                        if _ln.startswith("MONGO_URL="):
                            _mu = _ln.split("=", 1)[1].strip().strip('"')
                        if _ln.startswith("DB_NAME="):
                            _dn = _ln.split("=", 1)[1].strip().strip('"')
            client = motor.motor_asyncio.AsyncIOMotorClient(_mu)
            db = client[_dn]
            for name, sid in [("TEST_mat_A", sheet_a), ("TEST_mat_B", sheet_b)]:
                await db.materials.insert_one({
                    "id": str(uuid.uuid4()), "project_id": project_id,
                    "sheet_id": sid, "name": name, "quantity": 1,
                    "unit_price": 1.0, "labor_unit_price": 0.0,
                    "created_at": "2025-01-01T00:00:00Z",
                })
            client.close()

        asyncio.new_event_loop().run_until_complete(seed_mats())

        r_all = requests.get(f"{BASE_URL}/api/projects/{project_id}/materials",
                             headers=headers, timeout=30)
        assert r_all.status_code == 200
        all_mats = r_all.json()
        names_all = [m.get("name") for m in all_mats]
        assert "TEST_mat_A" in names_all and "TEST_mat_B" in names_all

        r_a = requests.get(f"{BASE_URL}/api/projects/{project_id}/materials?sheet_id={sheet_a}",
                           headers=headers, timeout=30)
        assert r_a.status_code == 200
        names_a = [m.get("name") for m in r_a.json()]
        assert "TEST_mat_A" in names_a
        assert "TEST_mat_B" not in names_a


# ---------- 6. Not-found handling ----------
class TestNotFound:
    def test_patch_missing_sheet_404(self, project_id, headers):
        r = requests.patch(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/does-not-exist",
            json={"name": "x"}, headers=headers, timeout=30
        )
        assert r.status_code == 404

    def test_activate_missing_sheet_404(self, project_id, headers):
        r = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/active/nope",
            headers=headers, timeout=30
        )
        assert r.status_code == 404

    def test_sheet_ops_require_auth(self, project_id):
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                          json={"name": "x"}, timeout=15)
        assert r.status_code in (401, 403)
