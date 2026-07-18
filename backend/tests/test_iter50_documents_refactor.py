"""Backend regression tests for iteration_50: documents package refactor.

Focus: verify that splitting routes/documents.py into a package preserved the
public HTTP API and cross-module import chain (routes.ai_tools).
"""
import base64
import io
import os
import time

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://construction-viz-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PASSWORD = "Open0says3me#*03#*"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def project_id(headers):
    r = requests.get(f"{BASE_URL}/api/projects", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    projects = r.json()
    if projects:
        return projects[0]["id"]
    # create a project
    r2 = requests.post(f"{BASE_URL}/api/projects", headers=headers,
                       json={"name": "TEST_iter50_refactor", "address": "123 Test St"}, timeout=30)
    assert r2.status_code in (200, 201), r2.text
    return r2.json()["id"]


def _tiny_png_bytes():
    # 1x1 PNG
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    )


# ---------- auth + basic list ----------
class TestAuthAndProjects:
    def test_login(self, token):
        assert isinstance(token, str) and len(token) > 20

    def test_list_projects(self, headers):
        r = requests.get(f"{BASE_URL}/api/projects", headers=headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- documents endpoints ----------
class TestDocumentsRoutes:
    def test_list_documents(self, headers, project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/documents", headers=headers, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_delete_unknown_doc_returns_404(self, headers):
        r = requests.delete(f"{BASE_URL}/api/documents/nonexistent-id-xyz", headers=headers, timeout=30)
        assert r.status_code == 404, f"Expected 404 got {r.status_code}: {r.text[:200]}"

    def test_image_unknown_doc_returns_404(self, headers):
        r = requests.get(f"{BASE_URL}/api/documents/nonexistent-id-xyz/image", headers=headers, timeout=30)
        # 404 acceptable; ensures route is mounted
        assert r.status_code in (404, 400), f"Expected 404/400 got {r.status_code}"

    def test_retry_all_errored(self, headers, project_id):
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/documents/retry-all-errored",
                          headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "retried" in data
        assert "skipped_no_thumb" in data
        assert "total_errored" in data


# ---------- upload + pipeline (E2E) ----------
class TestUploadPipeline:
    doc_id = None

    def test_upload_png(self, token, project_id):
        # multipart, no explicit Content-Type
        files = {"file": ("tiny.png", _tiny_png_bytes(), "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/documents/upload",
            headers={"Authorization": f"Bearer {token}"},
            files=files,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "queued", data
        assert "id" in data
        TestUploadPipeline.doc_id = data["id"]

    def test_poll_pipeline(self, headers, project_id):
        doc_id = TestUploadPipeline.doc_id
        assert doc_id, "upload must run first"
        deadline = time.time() + 120
        last_status = None
        while time.time() < deadline:
            r = requests.get(f"{BASE_URL}/api/projects/{project_id}/documents", headers=headers, timeout=30)
            assert r.status_code == 200
            for d in r.json():
                if d.get("id") == doc_id:
                    last_status = d.get("status")
                    break
            if last_status in ("done", "error"):
                break
            time.sleep(4)
        assert last_status in ("done", "error"), f"pipeline did not reach terminal state, last={last_status}"
        # image endpoint should now respond 200 (thumb cached) for real doc
        r2 = requests.get(f"{BASE_URL}/api/documents/{doc_id}/image", headers=headers, timeout=30)
        assert r2.status_code == 200, r2.text
        # query ?page=N branch
        r3 = requests.get(f"{BASE_URL}/api/documents/{doc_id}/image?page=1", headers=headers, timeout=30)
        assert r3.status_code == 200, r3.text
        j = r3.json()
        assert "page" in j
        assert "fallback" in j

    def test_retry(self, headers, project_id):
        doc_id = TestUploadPipeline.doc_id
        assert doc_id
        r = requests.post(f"{BASE_URL}/api/documents/{doc_id}/retry", headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        assert data.get("retrying") is True

    def test_cleanup_delete_uploaded_doc(self, headers):
        doc_id = TestUploadPipeline.doc_id
        if not doc_id:
            pytest.skip("no doc uploaded")
        r = requests.delete(f"{BASE_URL}/api/documents/{doc_id}", headers=headers, timeout=30)
        assert r.status_code in (200, 204), r.text


# ---------- cross-module import chain (ai_tools) ----------
class TestAiToolsImportChain:
    def test_ai_route_mounts(self, headers):
        # Hit any /api/ai/... route: 200/401/422 are all acceptable as proof of mount.
        # 500 would indicate ImportError leaked from routes.ai_tools.
        r = requests.post(f"{BASE_URL}/api/ai/floorplan/generate",
                          headers=headers, json={}, timeout=30)
        assert r.status_code != 500, f"500 suggests import failure: {r.text[:300]}"
        assert r.status_code in (200, 400, 401, 404, 422), f"unexpected status {r.status_code}: {r.text[:200]}"
