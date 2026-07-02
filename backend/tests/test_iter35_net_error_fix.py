"""Iter 35 — verify:
1. Sheet CRUD regression still works end-to-end (backend contract for
   activateSheet / createSheet / renameSheet / deleteSheet / saveSheetGeometry).
2. OpenCV `trace_walls_from_image` extracts >0 wall segments from a synthetic
   blueprint PNG.
"""
import base64
import io
import os
import uuid
from pathlib import Path

import pytest
import requests
from PIL import Image, ImageDraw

_burl = os.environ.get("REACT_APP_BACKEND_URL")
if not _burl:
    _p = Path("/app/frontend/.env")
    if _p.exists():
        for _line in _p.read_text().splitlines():
            if _line.startswith("REACT_APP_BACKEND_URL="):
                _burl = _line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (_burl or "").rstrip("/")


@pytest.fixture(scope="module")
def token():
    email = f"iter35_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "TestPass123!", "name": "iter35"},
                      timeout=30)
    assert r.status_code in (200, 201), r.text
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
                      json={"name": f"TEST_iter35_{uuid.uuid4().hex[:6]}", "address": "1 Test"},
                      headers=headers, timeout=30)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


class TestSheetCRUDRegression:
    """Regression: sheet CRUD endpoints hit by frontend store functions."""

    def test_get_blueprint_has_sheets(self, project_id, headers):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint",
                         headers=headers, timeout=30)
        assert r.status_code == 200
        bp = r.json()
        assert "sheets" in bp and "active_sheet_id" in bp
        assert len(bp["sheets"]) >= 1

    def test_create_rename_activate_save_delete_sheet(self, project_id, headers):
        # CREATE
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                          json={"name": "Iter35 Floor", "floor_level": 1},
                          headers=headers, timeout=30)
        assert r.status_code in (200, 201), r.text
        new_sid = r.json()["id"]
        assert r.json()["name"] == "Iter35 Floor"

        # RENAME (patch)
        r = requests.patch(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{new_sid}",
                           json={"name": "Iter35 Renamed"},
                           headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Iter35 Renamed"

        # ACTIVATE
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/blueprint/active/{new_sid}",
                          headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["active_sheet_id"] == new_sid

        # SAVE GEOMETRY (PUT sheet)
        payload = {
            "walls": [{"id": "w1", "start": [0, 0], "end": [10, 0], "thickness": 0.5}],
            "doors": [], "windows": [], "labels": [], "fixtures": [],
        }
        r = requests.put(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{new_sid}",
                         json=payload, headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        assert len(r.json()["walls"]) == 1

        # DELETE
        r = requests.delete(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{new_sid}",
                            headers=headers, timeout=30)
        assert r.status_code == 200, r.text

        # Verify no longer present
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint",
                         headers=headers, timeout=30)
        ids = [s["id"] for s in r.json()["sheets"]]
        assert new_sid not in ids


class TestOpenCVWallExtraction:
    """Regression: OpenCV trace produces walls for a synthetic PNG blueprint."""

    def _floor_plan_b64(self):
        img = Image.new("RGB", (800, 600), "white")
        d = ImageDraw.Draw(img)
        d.rectangle([60, 60, 740, 540], outline="black", width=6)
        d.line([(400, 60), (400, 300)], fill="black", width=5)
        d.line([(60, 300), (740, 300)], fill="black", width=5)
        d.line([(200, 300), (200, 540)], fill="black", width=5)
        d.line([(550, 300), (550, 540)], fill="black", width=5)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return base64.b64encode(buf.getvalue()).decode()

    def test_trace_walls_returns_segments(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from routes.opencv_tracer import trace_walls_from_image  # type: ignore

        b64 = self._floor_plan_b64()
        out = trace_walls_from_image(b64, building_ft_w=40.0, building_ft_h=30.0)
        assert isinstance(out, dict)
        assert "walls" in out and "count" in out
        assert out["count"] > 0, f"expected walls, got {out}"
        # sanity check on wall shape
        w0 = out["walls"][0]
        assert "start" in w0 and "end" in w0 and "thickness" in w0
        assert isinstance(w0["start"], list) and len(w0["start"]) == 2

    def test_trace_walls_bad_input_returns_empty(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from routes.opencv_tracer import trace_walls_from_image  # type: ignore
        out = trace_walls_from_image("not-a-valid-base64-image")
        assert out["count"] == 0
        assert out["walls"] == []
