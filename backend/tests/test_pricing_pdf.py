"""Iteration 2 backend tests: per-material pricing PATCH/DELETE + Takeoff PDF.

Reuses fixtures from conftest.py (user_a, user_b, base_url, floor_plan_png).
"""
import time
import requests
import pytest


def _wait_for_pipeline(base_url, headers, project_id, doc_id, deadline_s=120):
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        r = requests.get(f"{base_url}/api/projects/{project_id}/documents",
                         headers=headers, timeout=15)
        assert r.status_code == 200
        mine = next((d for d in r.json() if d["id"] == doc_id), None)
        if mine and mine["status"] in {"done", "error"}:
            return mine
        time.sleep(2)
    return None


# ---------- Shared fixture: one analyzed project with materials ----------
@pytest.fixture(scope="module")
def analyzed_project(base_url, user_a, floor_plan_png):
    """Upload an image, wait for pipeline, return project+materials."""
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    # Create a fresh project to avoid interference
    pr = requests.post(f"{base_url}/api/projects",
                       json={"name": "TEST_Pricing Project"},
                       headers=headers, timeout=15)
    assert pr.status_code == 200
    pid = pr.json()["id"]

    with open(floor_plan_png, "rb") as f:
        files = {"file": ("floor_plan.png", f, "image/png")}
        up = requests.post(f"{base_url}/api/projects/{pid}/documents/upload",
                           files=files, headers=headers, timeout=30)
    assert up.status_code == 200, up.text
    doc_id = up.json()["id"]
    final = _wait_for_pipeline(base_url, headers, pid, doc_id)
    assert final is not None, "Pipeline timeout"
    assert final["status"] == "done", f"pipeline error: {final}"

    mats_resp = requests.get(f"{base_url}/api/projects/{pid}/materials",
                             headers=headers, timeout=15)
    assert mats_resp.status_code == 200
    mats = mats_resp.json()
    assert len(mats) > 0
    return {"project_id": pid, "headers": headers, "materials": mats}


# ---------- Pricing in AI pipeline ----------
class TestAIPricing:
    def test_materials_have_unit_price_field(self, analyzed_project):
        mats = analyzed_project["materials"]
        for m in mats:
            assert "unit_price" in m, "unit_price field missing"
            assert "currency" in m
            assert m.get("currency") == "USD"
            assert isinstance(m["unit_price"], (int, float))
            assert m["unit_price"] >= 0

    def test_most_materials_have_nonzero_price(self, analyzed_project):
        mats = analyzed_project["materials"]
        priced = [m for m in mats if float(m.get("unit_price") or 0) > 0]
        ratio = len(priced) / max(len(mats), 1)
        assert ratio >= 0.5, (
            f"Expected >=50% of materials with unit_price>0, "
            f"got {len(priced)}/{len(mats)} ({ratio:.0%})"
        )


# ---------- PATCH /materials/{id} ----------
class TestMaterialPatch:
    def test_patch_unit_price(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        mat = analyzed_project["materials"][0]
        r = requests.patch(f"{base_url}/api/materials/{mat['id']}",
                           json={"unit_price": 42.55}, headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["unit_price"] == 42.55
        # GET to verify persistence
        pid = analyzed_project["project_id"]
        g = requests.get(f"{base_url}/api/projects/{pid}/materials",
                         headers=headers, timeout=15)
        found = next(m for m in g.json() if m["id"] == mat["id"])
        assert found["unit_price"] == 42.55

    def test_patch_quantity(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        mat = analyzed_project["materials"][1 % len(analyzed_project["materials"])]
        r = requests.patch(f"{base_url}/api/materials/{mat['id']}",
                           json={"quantity": 99}, headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        assert float(r.json()["quantity"]) == 99.0
        pid = analyzed_project["project_id"]
        g = requests.get(f"{base_url}/api/projects/{pid}/materials",
                         headers=headers, timeout=15)
        found = next(m for m in g.json() if m["id"] == mat["id"])
        assert float(found["quantity"]) == 99.0

    def test_patch_name(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        mat = analyzed_project["materials"][0]
        new_name = "TEST_Renamed Material"
        r = requests.patch(f"{base_url}/api/materials/{mat['id']}",
                           json={"name": new_name}, headers=headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == new_name
        pid = analyzed_project["project_id"]
        g = requests.get(f"{base_url}/api/projects/{pid}/materials",
                         headers=headers, timeout=15)
        found = next(m for m in g.json() if m["id"] == mat["id"])
        assert found["name"] == new_name

    def test_patch_negative_price_clamped_to_zero(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        mat = analyzed_project["materials"][-1]
        r = requests.patch(f"{base_url}/api/materials/{mat['id']}",
                           json={"unit_price": -99.5}, headers=headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["unit_price"] == 0.0

    def test_patch_empty_payload_returns_400(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        mat = analyzed_project["materials"][0]
        r = requests.patch(f"{base_url}/api/materials/{mat['id']}",
                           json={}, headers=headers, timeout=15)
        assert r.status_code == 400

    def test_patch_requires_auth(self, base_url, analyzed_project):
        mat = analyzed_project["materials"][0]
        r = requests.patch(f"{base_url}/api/materials/{mat['id']}",
                           json={"unit_price": 1.0}, timeout=15)
        assert r.status_code == 401

    def test_patch_nonexistent_material_404(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        r = requests.patch(f"{base_url}/api/materials/does-not-exist-xyz",
                           json={"unit_price": 1.0}, headers=headers, timeout=15)
        assert r.status_code == 404

    def test_user_b_cannot_patch_user_a_material(self, base_url, analyzed_project, user_b):
        mat = analyzed_project["materials"][0]
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        r = requests.patch(f"{base_url}/api/materials/{mat['id']}",
                           json={"unit_price": 1.0}, headers=hb, timeout=15)
        assert r.status_code == 403


# ---------- DELETE /materials/{id} ----------
class TestMaterialDelete:
    def test_user_b_cannot_delete_user_a_material(self, base_url, analyzed_project, user_b):
        mat = analyzed_project["materials"][0]
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        r = requests.delete(f"{base_url}/api/materials/{mat['id']}",
                            headers=hb, timeout=15)
        assert r.status_code == 403

    def test_delete_removes_material(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        pid = analyzed_project["project_id"]
        # Pick the last material (others may have been mutated above)
        mat = analyzed_project["materials"][-1]
        r = requests.delete(f"{base_url}/api/materials/{mat['id']}",
                            headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # Verify removal
        g = requests.get(f"{base_url}/api/projects/{pid}/materials",
                         headers=headers, timeout=15)
        ids = [m["id"] for m in g.json()]
        assert mat["id"] not in ids

    def test_delete_nonexistent_404(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        r = requests.delete(f"{base_url}/api/materials/non-existent-zzz",
                            headers=headers, timeout=15)
        assert r.status_code == 404


# ---------- GET /projects/{id}/takeoff.pdf ----------
class TestTakeoffPDF:
    def test_pdf_for_project_with_materials(self, base_url, analyzed_project):
        headers = analyzed_project["headers"]
        pid = analyzed_project["project_id"]
        r = requests.get(f"{base_url}/api/projects/{pid}/takeoff.pdf",
                         headers=headers, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()
        assert "atlas_takeoff_" in cd
        assert ".pdf" in cd
        assert len(r.content) > 1000
        # PDF magic number
        assert r.content.startswith(b"%PDF"), "Not a valid PDF stream"

    def test_pdf_for_empty_project(self, base_url, auth_headers_a):
        # Create an empty project (no materials uploaded)
        cr = requests.post(f"{base_url}/api/projects",
                           json={"name": "TEST_Empty PDF Project"},
                           headers=auth_headers_a, timeout=15)
        assert cr.status_code == 200
        pid = cr.json()["id"]
        r = requests.get(f"{base_url}/api/projects/{pid}/takeoff.pdf",
                         headers=auth_headers_a, timeout=30)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert len(r.content) > 1000
        assert r.content.startswith(b"%PDF")

    def test_pdf_requires_auth(self, base_url, analyzed_project):
        pid = analyzed_project["project_id"]
        r = requests.get(f"{base_url}/api/projects/{pid}/takeoff.pdf", timeout=30)
        assert r.status_code == 401

    def test_pdf_cross_user_returns_404(self, base_url, analyzed_project, user_b):
        pid = analyzed_project["project_id"]
        hb = {"Authorization": f"Bearer {user_b['token']}"}
        r = requests.get(f"{base_url}/api/projects/{pid}/takeoff.pdf",
                         headers=hb, timeout=30)
        assert r.status_code == 404
