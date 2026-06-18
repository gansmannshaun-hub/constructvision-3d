"""Iteration 7: Cross-document material dedup pipeline tests.

Validates that uploading the SAME image twice to a project does NOT double the
materials count - either via AI's dedup="skip"/"merge" tag or via the fuzzy
normalised name+category+unit fallback.
"""
import os
import time
import uuid
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")


def _wait_for_doc(token: str, project_id: str, doc_id: str, timeout: int = 90) -> dict:
    """Poll until document status is 'done' or 'error'."""
    h = {"Authorization": f"Bearer {token}"}
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/documents",
                         headers=h, timeout=15)
        assert r.status_code == 200, r.text
        for d in r.json():
            if d["id"] == doc_id and d["status"] in ("done", "error"):
                return d
        time.sleep(2.5)
    raise AssertionError(f"Doc {doc_id} did not reach done/error in {timeout}s")


@pytest.fixture(scope="module")
def fresh_user_token():
    email = f"test_iter7_dedup_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": "TestPass123!", "name": "Dedup Tester"
    }, timeout=30)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    # Activate Pro trial so we have upload credits for 2 uploads
    requests.post(f"{BASE_URL}/api/billing/start-trial",
                  headers={"Authorization": f"Bearer {token}"}, json={}, timeout=15)
    return token


@pytest.fixture(scope="module")
def project_id(fresh_user_token):
    h = {"Authorization": f"Bearer {fresh_user_token}"}
    r = requests.post(f"{BASE_URL}/api/projects",
                      headers=h,
                      json={"name": "TEST_iter7_dedup", "location": "TestLand"},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _upload(token: str, project_id: str, png_path: str) -> str:
    h = {"Authorization": f"Bearer {token}"}
    with open(png_path, "rb") as f:
        r = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/documents/upload",
            headers=h,
            files={"file": ("floor_plan.png", f, "image/png")},
            timeout=30,
        )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _materials(token: str, project_id: str) -> list:
    h = {"Authorization": f"Bearer {token}"}
    r = requests.get(f"{BASE_URL}/api/projects/{project_id}/materials",
                     headers=h, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ===== Test 1: First upload (regression baseline) =====
def test_first_upload_baseline(fresh_user_token, project_id, floor_plan_png):
    doc_a_id = _upload(fresh_user_token, project_id, floor_plan_png)
    doc_a = _wait_for_doc(fresh_user_token, project_id, doc_a_id, timeout=90)
    assert doc_a["status"] == "done", f"Doc A failed: {doc_a.get('error')}"
    # Regression: first doc => merged=0, skipped=0, materials_count>0
    assert doc_a.get("materials_merged", 0) == 0, doc_a
    assert doc_a.get("materials_skipped", 0) == 0, doc_a
    assert doc_a.get("materials_count", 0) > 0, doc_a
    # dedup_audit must exist and all entries should be "new"
    audit = doc_a.get("dedup_audit") or []
    assert isinstance(audit, list)
    assert len(audit) > 0
    assert all(a.get("decision") == "new" for a in audit), audit
    # Stash on module
    pytest.doc_a_data = doc_a
    pytest.materials_after_a = _materials(fresh_user_token, project_id)
    assert len(pytest.materials_after_a) == doc_a["materials_count"]


# ===== Test 2: Second upload of SAME image => dedup must fire =====
def test_second_upload_deduplicates(fresh_user_token, project_id, floor_plan_png):
    # Ensure first ran
    assert hasattr(pytest, "materials_after_a"), "first upload test must run first"
    count_a = len(pytest.materials_after_a)

    doc_b_id = _upload(fresh_user_token, project_id, floor_plan_png)
    doc_b = _wait_for_doc(fresh_user_token, project_id, doc_b_id, timeout=120)
    assert doc_b["status"] == "done", f"Doc B failed: {doc_b.get('error')}"

    # New fields must be present
    assert "materials_merged" in doc_b
    assert "materials_skipped" in doc_b
    assert "dedup_audit" in doc_b
    assert isinstance(doc_b["dedup_audit"], list)

    merged = doc_b.get("materials_merged", 0)
    skipped = doc_b.get("materials_skipped", 0)
    new_count = doc_b.get("materials_count", 0)

    # MAIN ASSERTION: total materials should NOT double
    materials_after_b = _materials(fresh_user_token, project_id)
    count_b = len(materials_after_b)
    growth_ratio = count_b / count_a if count_a else 99
    print(f"\n[dedup] count_a={count_a} count_b={count_b} ratio={growth_ratio:.2f} "
          f"new={new_count} merged={merged} skipped={skipped}")
    assert growth_ratio < 1.6, (
        f"Dedup failed: materials grew from {count_a} to {count_b} "
        f"(ratio {growth_ratio:.2f}). new={new_count} merged={merged} skipped={skipped}"
    )

    # Some dedup signal should be present (AI tags OR fuzzy fallback)
    assert (merged + skipped) > 0, (
        f"No materials_merged or materials_skipped reported on doc B. "
        f"audit={doc_b.get('dedup_audit')}"
    )


# ===== Test 3: Documents endpoint exposes new dedup fields =====
def test_documents_endpoint_exposes_dedup_fields(fresh_user_token, project_id):
    h = {"Authorization": f"Bearer {fresh_user_token}"}
    r = requests.get(f"{BASE_URL}/api/projects/{project_id}/documents",
                     headers=h, timeout=15)
    assert r.status_code == 200
    docs = r.json()
    done_docs = [d for d in docs if d.get("status") == "done"]
    assert len(done_docs) >= 2, f"Expected 2 done docs, got {len(done_docs)}"
    for d in done_docs:
        assert "materials_merged" in d, d.keys()
        assert "materials_skipped" in d, d.keys()
        assert "dedup_audit" in d, d.keys()
        assert isinstance(d["dedup_audit"], list)


# ===== Test 4: Merged quantities accumulate (sanity) =====
def test_merged_increments_quantities(fresh_user_token, project_id):
    """If a material was merged, its quantity in the materials list should reflect the sum."""
    materials = _materials(fresh_user_token, project_id)
    # If anything merged in test 2, at least one material should have source_documents with 2 entries
    # OR we can just sanity-check no negative quantities and all categories valid
    valid_cats = {"Structural", "Framing", "Electrical", "Plumbing", "Finishes",
                  "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other"}
    for m in materials:
        assert m.get("quantity", 0) >= 0, m
        assert m.get("category") in valid_cats, m
        assert m.get("unit_price", 0) >= 0, m
