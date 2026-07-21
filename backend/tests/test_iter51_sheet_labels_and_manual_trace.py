"""Backend tests for iteration_51 features:
1. Sheet-Label hint (upload with `sheet_label_hint` form field) — whitelist + persistence.
2. Sheet PATCH `view_type` override.
3. Manual-Trace re-analyze endpoint: POST /api/blueprint_sheets/{sid}/reanalyze-with-walls.
4. ai_tools import chain regression check.
"""
import base64
import os
import time
import uuid

import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return ""

BASE_URL = _load_backend_url()
assert BASE_URL, "REACT_APP_BACKEND_URL not resolvable"
ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PASSWORD = "Open0says3me#*03#*"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def project_id(headers):
    r = requests.get(f"{BASE_URL}/api/projects", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    projects = r.json()
    if projects:
        return projects[0]["id"]
    r2 = requests.post(f"{BASE_URL}/api/projects", headers={**headers, "Content-Type": "application/json"},
                       json={"name": "TEST_iter51", "address": "123 Test St"}, timeout=30)
    assert r2.status_code in (200, 201), r2.text
    return r2.json()["id"]


def _tiny_png_bytes():
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


def _wait_terminal(headers, project_id, doc_id, timeout=90):
    """Poll list_documents until this doc is done or errored."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/documents", headers=headers, timeout=30)
        if r.status_code == 200:
            docs = r.json()
            match = next((d for d in docs if d["id"] == doc_id), None)
            if match:
                last = match
                if match.get("status") in ("done", "error"):
                    return match
        time.sleep(2)
    return last


class TestUploadHint:
    def test_upload_without_hint_backward_compat(self, headers, project_id):
        files = {"file": ("tiny_nohint.png", _tiny_png_bytes(), "image/png")}
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/documents/upload",
                          headers=headers, files=files, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] in ("queued", "uploaded")
        assert d.get("sheet_label_hint") in (None, "")
        doc_id = d["id"]
        final = _wait_terminal(headers, project_id, doc_id, timeout=90)
        # Cleanup
        requests.delete(f"{BASE_URL}/api/documents/{doc_id}", headers=headers, timeout=30)
        assert final is not None
        assert final["status"] in ("done", "error")  # either is fine, just not stuck

    def test_upload_with_valid_hint_persists(self, headers, project_id):
        files = {"file": ("tiny_elev.png", _tiny_png_bytes(), "image/png")}
        data = {"sheet_label_hint": "elevation"}
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/documents/upload",
                          headers=headers, files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("sheet_label_hint") == "elevation", d
        doc_id = d["id"]
        # Verify persistence via list endpoint
        r2 = requests.get(f"{BASE_URL}/api/projects/{project_id}/documents", headers=headers, timeout=30)
        docs = r2.json()
        match = next((x for x in docs if x["id"] == doc_id), None)
        assert match is not None
        assert match.get("sheet_label_hint") == "elevation"
        # Wait until terminal, then cleanup
        _wait_terminal(headers, project_id, doc_id, timeout=90)
        requests.delete(f"{BASE_URL}/api/documents/{doc_id}", headers=headers, timeout=30)

    def test_upload_with_nonsense_hint_silently_dropped(self, headers, project_id):
        files = {"file": ("tiny_bad.png", _tiny_png_bytes(), "image/png")}
        data = {"sheet_label_hint": "NONSENSE_XYZ"}
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/documents/upload",
                          headers=headers, files=files, data=data, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("sheet_label_hint") in (None, ""), d
        doc_id = d["id"]
        _wait_terminal(headers, project_id, doc_id, timeout=90)
        requests.delete(f"{BASE_URL}/api/documents/{doc_id}", headers=headers, timeout=30)


class TestSheetPatchViewType:
    def test_patch_view_type_updates(self, headers, project_id):
        # Find an existing sheet, if any
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                         headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        sheets = r.json()
        if not sheets:
            pytest.skip("No sheets exist on the test project; skipping view_type PATCH.")
        sheet_id = sheets[0]["id"]
        original = sheets[0].get("view_type")

        # PATCH to elevation
        h = {**headers, "Content-Type": "application/json"}
        r2 = requests.patch(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
                            headers=h, json={"view_type": "elevation"}, timeout=30)
        assert r2.status_code == 200, r2.text
        # Re-fetch to verify persistence
        r3 = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                          headers=headers, timeout=30)
        updated = next((s for s in r3.json() if s["id"] == sheet_id), None)
        assert updated is not None
        assert updated.get("view_type") == "elevation"

        # Restore
        if original:
            requests.patch(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets/{sheet_id}",
                           headers=h, json={"view_type": original}, timeout=30)


class TestManualTraceReanalyze:
    @pytest.fixture(scope="class")
    def existing_sheet_id(self, headers, project_id):
        """Find any existing sheet with a linked source_document to run against."""
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                         headers=headers, timeout=30)
        sheets = r.json() if r.status_code == 200 else []
        candidate = next((s for s in sheets if s.get("source_document_id")), None)
        if not candidate:
            pytest.skip("No sheet with source_document_id — cannot exercise reanalyze endpoint E2E.")
        return candidate["id"]

    def test_404_unknown_sheet(self, headers):
        h = {**headers, "Content-Type": "application/json"}
        body = {"walls": [{"start": [0, 0], "end": [10, 0]}], "building_ft": {"w": 10, "h": 10}}
        r = requests.post(f"{BASE_URL}/api/blueprint_sheets/{uuid.uuid4()}/reanalyze-with-walls",
                          headers=h, json=body, timeout=30)
        assert r.status_code == 404, r.text

    def test_empty_walls_400(self, headers, existing_sheet_id):
        h = {**headers, "Content-Type": "application/json"}
        r = requests.post(f"{BASE_URL}/api/blueprint_sheets/{existing_sheet_id}/reanalyze-with-walls",
                          headers=h, json={"walls": [], "building_ft": {"w": 20, "h": 15}}, timeout=30)
        assert r.status_code == 400, r.text
        detail = (r.json() or {}).get("detail", "")
        assert "No valid walls" in detail

    def test_too_many_walls_400(self, headers, existing_sheet_id):
        h = {**headers, "Content-Type": "application/json"}
        walls = [{"start": [i, 0], "end": [i + 1, 0]} for i in range(500)]
        r = requests.post(f"{BASE_URL}/api/blueprint_sheets/{existing_sheet_id}/reanalyze-with-walls",
                          headers=h, json={"walls": walls, "building_ft": {"w": 500, "h": 10}}, timeout=30)
        assert r.status_code == 400, r.text
        detail = (r.json() or {}).get("detail", "")
        assert "Too many walls" in detail

    def test_happy_path_walls_locked(self, headers, existing_sheet_id):
        """4 walls forming a rect; expect 200 (or 400 'not cached' / 502 AI budget) response.
        If 200, walls must round-trip exactly with scale_confidence='manual' and manual_walls_locked=True.
        """
        h = {**headers, "Content-Type": "application/json"}
        walls = [
            {"start": [0, 0], "end": [20, 0]},
            {"start": [20, 0], "end": [20, 15]},
            {"start": [20, 15], "end": [0, 15]},
            {"start": [0, 15], "end": [0, 0]},
        ]
        body = {"walls": walls, "building_ft": {"w": 20, "h": 15}}
        r = requests.post(f"{BASE_URL}/api/blueprint_sheets/{existing_sheet_id}/reanalyze-with-walls",
                          headers=h, json=body, timeout=180)
        if r.status_code == 400 and "not cached" in (r.json().get("detail", "").lower()):
            pytest.skip("Sheet's original image not cached (valid response per spec).")
        if r.status_code == 502:
            # AI budget exhausted or transient LLM failure — endpoint contract OK, extraction failed.
            print(f"[warn] AI call failed (502): {r.json().get('detail')}")
            pytest.skip("AI backend failure (502) — endpoint contract validated up to AI call.")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("scale_confidence") == "manual"
        assert data.get("manual_walls_locked") is True
        out_walls = data.get("walls") or []
        assert len(out_walls) == 4
        for i, w in enumerate(out_walls):
            assert list(w["start"]) == walls[i]["start"], f"wall {i} start changed: {w}"
            assert list(w["end"]) == walls[i]["end"], f"wall {i} end changed: {w}"
            assert w.get("source") == "manual"


class TestAIToolsImportChain:
    def test_ai_endpoint_reachable(self, headers):
        """Any /api/ai/* endpoint returning 4xx (auth/validation) proves imports resolved.
        500 would indicate import broken."""
        # Try a known endpoint; even empty POST should not 500 due to imports.
        r = requests.post(f"{BASE_URL}/api/ai/floorplan/generate",
                          headers={**headers, "Content-Type": "application/json"},
                          json={}, timeout=30)
        assert r.status_code < 500, f"Import/routing broken: {r.status_code} {r.text[:200]}"
