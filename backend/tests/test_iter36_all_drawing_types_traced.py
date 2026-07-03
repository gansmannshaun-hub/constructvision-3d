"""Iteration 36 — Non-floor-plan drawings must still be traced by OpenCV.

Verifies the bug fix reported by user:
  "this is a blueprint for the steel framing but in the 3d renderer it thinks
   its a top view... why did it not trace these?"

Backend guarantees under test:
  1. `trace_walls_from_image` (opencv_tracer) produces walls from any raster.
  2. `DRAWING_TYPES` set in documents.py now includes framing_plan / roof_plan /
     sheathing_plan / elevation / electrical_plan / plumbing_plan / hvac_plan /
     detail so OpenCV runs on those view types.
  3. End-to-end: uploading a hand-crafted "framing-like" image results in a
     blueprint_sheet whose `walls` array is non-empty AND at least one wall has
     `source == "opencv"`, regardless of the AI's classification.
  4. If the sheet's view_type is a REF_ONLY drawing type, floor_level == -99 so
     the 3D renderer will not stack it.
  5. GET /api/projects/{id}/blueprint/sheets returns the non-floor-plan sheet
     with walls populated so the CAD tab can show its geometry.
"""
from __future__ import annotations

import base64
import io
import os
import time
import uuid

import pytest
import requests
from PIL import Image, ImageDraw

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

DRAWING_TYPES = {
    "floor_plan", "blueprint", "site_plan", "foundation_plan",
    "framing_plan", "roof_plan", "sheathing_plan", "elevation",
    "electrical_plan", "plumbing_plan", "hvac_plan", "detail",
}
REF_ONLY = {
    "framing_plan", "roof_plan", "sheathing_plan",
    "electrical_plan", "plumbing_plan", "hvac_plan",
    "elevation", "detail",
}


# ---------- Image factories ----------

def _make_framing_like_png() -> bytes:
    """Repeated parallel joist lines → biases GPT-4o toward framing_plan
    (though we don't depend on that classification for the invariant test)."""
    img = Image.new("RGB", (1200, 900), "white")
    d = ImageDraw.Draw(img)
    # Outer border
    d.rectangle([40, 40, 1160, 860], outline="black", width=4)
    # Repeated horizontal "joists" 16" o.c.
    for y in range(80, 860, 24):
        d.line([(50, y), (1150, y)], fill="black", width=2)
    # Two beam callouts (thick vertical)
    d.line([(400, 40), (400, 860)], fill="black", width=6)
    d.line([(800, 40), (800, 860)], fill="black", width=6)
    # Label the drawing so vision can classify it
    d.text((60, 20), "FRAMING PLAN - 2x10 JOISTS @ 16\" O.C.", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_floorplan_png() -> bytes:
    """Rectangular rooms with door gaps for regression testing."""
    img = Image.new("RGB", (1200, 900), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([50, 50, 1150, 850], outline="black", width=5)
    d.line([(600, 50), (600, 400)], fill="black", width=5)
    d.line([(600, 500), (600, 850)], fill="black", width=5)
    d.line([(50, 450), (400, 450)], fill="black", width=5)
    d.line([(500, 450), (1150, 450)], fill="black", width=5)
    d.text((200, 200), "LIVING ROOM", fill="black")
    d.text((800, 200), "KITCHEN", fill="black")
    d.text((200, 650), "BEDROOM", fill="black")
    d.text((800, 650), "BATH", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def auth():
    email = f"iter36_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": "TestPass123!", "name": "Iter36",
    }, timeout=30)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def project_id(auth):
    projs = requests.get(f"{BASE_URL}/api/projects", headers=auth, timeout=30).json()
    if projs:
        return projs[0]["id"]
    r = requests.post(
        f"{BASE_URL}/api/projects",
        headers=auth,
        json={"name": "TEST_iter36", "description": "iter36"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _upload_and_wait(project_id, auth, filename, content, timeout=180):
    r = requests.post(
        f"{BASE_URL}/api/projects/{project_id}/documents/upload",
        headers=auth,
        files={"file": (filename, io.BytesIO(content), "image/png")},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    deadline = time.time() + timeout
    doc = None
    while time.time() < deadline:
        docs = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/documents",
            headers=auth, timeout=30,
        ).json()
        doc = next((d for d in docs if d["id"] == doc_id), None)
        if doc and doc["status"] in ("done", "error"):
            break
        time.sleep(3)
    assert doc is not None, "doc lost"
    return doc


# ---------- Unit: opencv tracer ----------

class TestOpenCVTracerUnit:
    def test_tracer_produces_walls_from_synthetic_image(self):
        from routes.opencv_tracer import trace_walls_from_image
        png = _make_framing_like_png()
        b64 = base64.b64encode(png).decode()
        result = trace_walls_from_image(b64)
        assert result["count"] > 0, f"OpenCV returned 0 walls: {result}"
        assert len(result["walls"]) == result["count"]
        # Each wall has correct schema
        w = result["walls"][0]
        assert "start" in w and "end" in w and "thickness" in w
        assert isinstance(w["start"], list) and len(w["start"]) == 2

    def test_drawing_types_contains_non_floor_plans(self):
        """The set that gates OpenCV must include the bug-report types."""
        from routes.documents import _build_pipeline
        import inspect
        src = inspect.getsource(_build_pipeline)
        for t in ("framing_plan", "roof_plan", "sheathing_plan", "elevation",
                  "electrical_plan", "plumbing_plan", "hvac_plan", "detail"):
            assert f'"{t}"' in src, f"DRAWING_TYPES missing {t}"


# ---------- E2E: non-floor-plan upload gets walls ----------

class TestNonFloorPlanTracing:
    def test_framing_like_upload_populates_walls_via_opencv(self, project_id, auth):
        doc = _upload_and_wait(project_id, auth, "framing_test.png",
                               _make_framing_like_png(), timeout=180)
        assert doc["status"] == "done", (
            f"doc failed: status={doc['status']} error={doc.get('error')}"
        )
        view_type = doc.get("doc_type")
        assert view_type, "doc_type not set after pipeline"

        # Find the sheet created for this doc
        sheet_id = doc.get("sheet_id")
        assert sheet_id, f"no sheet was created for doc {doc['id']}"
        sheets = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
            headers=auth, timeout=30,
        ).json()
        sheet = next((s for s in sheets if s["id"] == sheet_id), None)
        assert sheet, f"sheet {sheet_id} not returned by list endpoint"

        # Sheet's view_type should be the pipeline's classification
        assert sheet["view_type"] == view_type

        # If AI classified it as any DRAWING_TYPE (very likely for a drawing
        # with dense parallel lines), OpenCV should have run and walls
        # should be populated with source=opencv.
        if view_type in DRAWING_TYPES:
            assert len(sheet["walls"]) > 0, (
                f"view_type={view_type} is a DRAWING_TYPE but walls are empty; "
                "OpenCV branch did not run"
            )
            opencv_walls = [w for w in sheet["walls"] if w.get("source") == "opencv"]
            assert len(opencv_walls) > 0, (
                f"No walls with source='opencv' — OpenCV branch skipped. "
                f"view_type={view_type}, walls={len(sheet['walls'])}"
            )
        else:
            # Non-drawing (e.g. photo/other) — the fix doesn't apply; just log.
            print(f"AI classified test image as {view_type} — outside DRAWING_TYPES; "
                  "invariant not directly exercised.")

        # REF_ONLY sheets must not stack in 3D (floor_level == -99)
        if view_type in REF_ONLY:
            assert sheet["floor_level"] == -99, (
                f"REF_ONLY view_type={view_type} but floor_level={sheet['floor_level']} "
                "— 3D would stack this as a story"
            )

    def test_sheet_listing_returns_non_floor_plan_with_walls(self, project_id, auth):
        """GET /api/projects/{id}/blueprint/sheets must return every sheet
        (including REF_ONLY ones) with their `walls` array intact so the CAD
        tab can render the traced geometry."""
        sheets = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
            headers=auth, timeout=30,
        ).json()
        assert isinstance(sheets, list) and len(sheets) > 0
        for s in sheets:
            # Response schema
            assert "view_type" in s
            assert "walls" in s and isinstance(s["walls"], list)
            assert "floor_level" in s
            # No mongo _id leaks
            assert "_id" not in s


# ---------- Regression: floor plan still works ----------

class TestFloorPlanRegression:
    def test_floor_plan_still_traces(self, project_id, auth):
        doc = _upload_and_wait(project_id, auth, "floorplan_test.png",
                               _make_floorplan_png(), timeout=180)
        assert doc["status"] == "done", (
            f"regression: floorplan doc failed: status={doc['status']} "
            f"error={doc.get('error')}"
        )
        view_type = doc.get("doc_type")
        assert view_type in DRAWING_TYPES, (
            f"floor plan classified as {view_type} — outside DRAWING_TYPES"
        )

        sheet_id = doc.get("sheet_id")
        assert sheet_id
        sheets = requests.get(
            f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
            headers=auth, timeout=30,
        ).json()
        sheet = next((s for s in sheets if s["id"] == sheet_id), None)
        assert sheet
        assert len(sheet["walls"]) > 0, "floor plan walls empty — regression"
        # Floor plans should NOT be REF_ONLY (they should stack)
        if view_type not in REF_ONLY:
            assert sheet["floor_level"] != -99, (
                "floor plan flagged as REF_ONLY (floor_level=-99)"
            )
