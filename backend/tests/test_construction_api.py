"""End-to-end backend tests for Construction Management API."""
import time
import requests
import pytest


# -------- Health --------
class TestHealth:
    def test_root(self, base_url):
        r = requests.get(f"{base_url}/api/", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "version" in data
        assert data.get("message")


# -------- Auth --------
class TestAuth:
    def test_register_creates_default_project(self, base_url, user_a):
        # user_a fixture already registered; verify default project exists
        r = requests.get(f"{base_url}/api/projects",
                         headers={"Authorization": f"Bearer {user_a['token']}"}, timeout=15)
        assert r.status_code == 200
        projects = r.json()
        assert isinstance(projects, list)
        assert len(projects) >= 1
        names = [p["name"] for p in projects]
        assert any("First Project" in n or "Project" in n for n in names)

    def test_register_returns_token_and_user(self, user_a):
        assert isinstance(user_a["token"], str) and len(user_a["token"]) > 20
        assert user_a["user"]["email"] == user_a["email"].lower()
        assert "password_hash" not in user_a["user"]

    def test_login_success(self, base_url, user_a):
        r = requests.post(f"{base_url}/api/auth/login", json={
            "email": user_a["email"], "password": user_a["password"]
        }, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert data["user"]["email"] == user_a["email"].lower()

    def test_login_wrong_password(self, base_url, user_a):
        r = requests.post(f"{base_url}/api/auth/login", json={
            "email": user_a["email"], "password": "WrongPass!!"
        }, timeout=15)
        assert r.status_code == 401

    def test_me_returns_user(self, base_url, auth_headers_a, user_a):
        r = requests.get(f"{base_url}/api/auth/me", headers=auth_headers_a, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == user_a["email"].lower()
        assert "password_hash" not in data
        assert "id" in data

    def test_me_unauthorized(self, base_url):
        r = requests.get(f"{base_url}/api/auth/me", timeout=15)
        assert r.status_code == 401


# -------- Authorization --------
class TestAuthorization:
    def test_projects_requires_auth(self, base_url):
        r = requests.get(f"{base_url}/api/projects", timeout=15)
        assert r.status_code == 401

    def test_blueprint_requires_auth(self, base_url, user_a):
        # Get project id
        pr = requests.get(f"{base_url}/api/projects",
                          headers={"Authorization": f"Bearer {user_a['token']}"}, timeout=15)
        pid = pr.json()[0]["id"]
        r = requests.get(f"{base_url}/api/projects/{pid}/blueprint", timeout=15)
        assert r.status_code == 401

    def test_documents_requires_auth(self, base_url, user_a):
        pr = requests.get(f"{base_url}/api/projects",
                          headers={"Authorization": f"Bearer {user_a['token']}"}, timeout=15)
        pid = pr.json()[0]["id"]
        r = requests.get(f"{base_url}/api/projects/{pid}/documents", timeout=15)
        assert r.status_code == 401


# -------- Projects --------
class TestProjects:
    def test_create_project(self, base_url, auth_headers_a):
        r = requests.post(f"{base_url}/api/projects",
                          json={"name": "TEST_New Project", "description": "Test desc"},
                          headers=auth_headers_a, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "TEST_New Project"
        assert "id" in data and "user_id" in data
        # Verify persisted
        r2 = requests.get(f"{base_url}/api/projects", headers=auth_headers_a, timeout=15)
        ids = [p["id"] for p in r2.json()]
        assert data["id"] in ids


# -------- Blueprint --------
class TestBlueprint:
    def test_get_blueprint_initially_empty(self, base_url, auth_headers_a):
        pr = requests.get(f"{base_url}/api/projects", headers=auth_headers_a, timeout=15)
        pid = pr.json()[0]["id"]
        r = requests.get(f"{base_url}/api/projects/{pid}/blueprint",
                         headers=auth_headers_a, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "walls" in data and isinstance(data["walls"], list)
        assert "doors" in data and "windows" in data

    def test_save_blueprint(self, base_url, auth_headers_a):
        # Create a fresh project for clean state
        pr = requests.post(f"{base_url}/api/projects",
                           json={"name": "TEST_BP Project"},
                           headers=auth_headers_a, timeout=15)
        pid = pr.json()["id"]
        payload = {
            "walls": [{"id": "w1", "start": [0, 0], "end": [10, 0], "thickness": 0.2}],
            "doors": [{"id": "d1", "position": [5, 0], "width": 3, "wall_index": 0}],
            "windows": [],
        }
        r = requests.put(f"{base_url}/api/projects/{pid}/blueprint",
                         json=payload, headers=auth_headers_a, timeout=15)
        assert r.status_code == 200
        # Verify persistence
        g = requests.get(f"{base_url}/api/projects/{pid}/blueprint",
                         headers=auth_headers_a, timeout=15)
        d = g.json()
        assert len(d["walls"]) == 1
        assert d["walls"][0]["start"] == [0, 0]
        assert len(d["doors"]) == 1


# -------- Document Upload + AI Pipeline --------
class TestDocumentPipeline:
    @pytest.fixture(scope="class")
    def uploaded_doc(self, base_url, user_a, floor_plan_png):
        headers = {"Authorization": f"Bearer {user_a['token']}"}
        # Use the default project
        pr = requests.get(f"{base_url}/api/projects", headers=headers, timeout=15)
        pid = pr.json()[0]["id"]

        with open(floor_plan_png, "rb") as f:
            files = {"file": ("floor_plan.png", f, "image/png")}
            r = requests.post(f"{base_url}/api/projects/{pid}/documents/upload",
                              files=files, headers=headers, timeout=30)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert "id" in doc
        assert doc["status"] in {"uploaded", "analyzing", "saving", "syncing", "done"}
        return {"project_id": pid, "doc": doc, "headers": headers}

    def test_upload_returns_document(self, uploaded_doc):
        doc = uploaded_doc["doc"]
        assert doc["filename"] == "floor_plan.png"
        assert doc["mime_type"] == "image/png"
        assert doc["size"] > 1000

    def test_pipeline_completes(self, base_url, uploaded_doc):
        headers = uploaded_doc["headers"]
        pid = uploaded_doc["project_id"]
        doc_id = uploaded_doc["doc"]["id"]

        deadline = time.time() + 120  # up to 2 min for GPT-4o
        final = None
        statuses_seen = []
        while time.time() < deadline:
            r = requests.get(f"{base_url}/api/projects/{pid}/documents",
                             headers=headers, timeout=15)
            assert r.status_code == 200
            docs = r.json()
            mine = next((d for d in docs if d["id"] == doc_id), None)
            assert mine is not None
            statuses_seen.append(mine["status"])
            if mine["status"] in {"done", "error"}:
                final = mine
                break
            time.sleep(2)

        assert final is not None, f"Timeout. Statuses seen: {set(statuses_seen)}"
        assert final["status"] == "done", f"Pipeline errored. Doc: {final}"
        assert final.get("doc_type") is not None
        assert final.get("analysis"), "analysis should not be empty"
        assert final["analysis"].get("summary"), "summary should be set"
        assert final.get("materials_count", 0) > 0, "materials_count should be > 0"

        # Store for next tests
        TestDocumentPipeline.final_doc = final
        TestDocumentPipeline.project_id = pid
        TestDocumentPipeline.headers = headers

    def test_materials_persisted(self, base_url):
        pid = TestDocumentPipeline.project_id
        headers = TestDocumentPipeline.headers
        r = requests.get(f"{base_url}/api/projects/{pid}/materials",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        mats = r.json()
        assert len(mats) > 0, "materials list should not be empty"
        valid_cats = {"Structural", "Framing", "Electrical", "Plumbing", "Finishes",
                      "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other"}
        for m in mats:
            assert m["category"] in valid_cats, f"invalid cat: {m['category']}"
            assert m.get("ai_extracted") is True
            assert m.get("name")

    def test_blueprint_synced_if_floorplan(self, base_url):
        final = TestDocumentPipeline.final_doc
        pid = TestDocumentPipeline.project_id
        headers = TestDocumentPipeline.headers
        if final.get("doc_type") in {"floor_plan", "blueprint", "site_plan"}:
            assert final.get("synced_3d") is True, "synced_3d should be True for floor plans"
            r = requests.get(f"{base_url}/api/projects/{pid}/blueprint",
                             headers=headers, timeout=15)
            assert r.status_code == 200
            bp = r.json()
            assert len(bp.get("walls", [])) > 0, "expected walls > 0 for a floor plan"
        else:
            pytest.skip(f"doc_type={final.get('doc_type')} - skipping wall check")

    def test_document_image_endpoint(self, base_url):
        final = TestDocumentPipeline.final_doc
        headers = TestDocumentPipeline.headers
        r = requests.get(f"{base_url}/api/documents/{final['id']}/image",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["mime_type"] == "image/png"
        assert data.get("image_base64")
        assert len(data["image_base64"]) > 100


# -------- Cross-user isolation --------
class TestCrossUserIsolation:
    def test_user_b_cannot_see_user_a_project(self, base_url, user_a, user_b):
        ha = {"Authorization": f"Bearer {user_a['token']}"}
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        # Get A's project id
        pr = requests.get(f"{base_url}/api/projects", headers=ha, timeout=15)
        a_pid = pr.json()[0]["id"]
        # B should NOT see it in their list
        prb = requests.get(f"{base_url}/api/projects", headers=hb, timeout=15)
        b_ids = [p["id"] for p in prb.json()]
        assert a_pid not in b_ids

    def test_user_b_cannot_access_user_a_blueprint(self, base_url, user_a, user_b):
        ha = {"Authorization": f"Bearer {user_a['token']}"}
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        pr = requests.get(f"{base_url}/api/projects", headers=ha, timeout=15)
        a_pid = pr.json()[0]["id"]
        r = requests.get(f"{base_url}/api/projects/{a_pid}/blueprint",
                         headers=hb, timeout=15)
        assert r.status_code in (403, 404)

    def test_user_b_cannot_access_user_a_materials(self, base_url, user_a, user_b):
        ha = {"Authorization": f"Bearer {user_a['token']}"}
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        pr = requests.get(f"{base_url}/api/projects", headers=ha, timeout=15)
        a_pid = pr.json()[0]["id"]
        r = requests.get(f"{base_url}/api/projects/{a_pid}/materials",
                         headers=hb, timeout=15)
        assert r.status_code in (403, 404)

    def test_user_b_cannot_access_user_a_documents(self, base_url, user_a, user_b):
        ha = {"Authorization": f"Bearer {user_a['token']}"}
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        pr = requests.get(f"{base_url}/api/projects", headers=ha, timeout=15)
        a_pid = pr.json()[0]["id"]
        r = requests.get(f"{base_url}/api/projects/{a_pid}/documents",
                         headers=hb, timeout=15)
        assert r.status_code in (403, 404)
