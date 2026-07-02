"""Tests for AI Exact Blueprint Replication (iter 32).

Covers:
- POST /api/projects/{id}/ai/trace-blueprint: auth, doc 404
- PUT/GET /api/projects/{id}/blueprint: fixtures round-trip
- Regression: POST /api/projects/{id}/ai/floorplan still works
- Happy-path trace: seed a doc with image_base64 and call the tracer (best-effort;
  skipped if AI is slow/unavailable).
"""
import base64
import os
import uuid
import asyncio

import pytest
import requests

from pathlib import Path
_burl = os.environ.get("REACT_APP_BACKEND_URL")
if not _burl:
    _p = Path("/app/frontend/.env")
    if _p.exists():
        for _line in _p.read_text().splitlines():
            if _line.startswith("REACT_APP_BACKEND_URL="):
                _burl = _line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (_burl or "").rstrip("/")

# 1x1 white PNG (valid image bytes)
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def user_token():
    email = f"iter32_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "TestPass123!", "name": "Trace Tester"})
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    tok = r.json()["token"]
    # Start Pro trial so multi-project + AI credits are available
    requests.post(f"{BASE_URL}/api/billing/start-trial",
                  headers={"Authorization": f"Bearer {tok}"}, json={}, timeout=10)
    return tok, email


@pytest.fixture(scope="module")
def headers(user_token):
    return {"Authorization": f"Bearer {user_token[0]}"}


@pytest.fixture(scope="module")
def project_id(headers):
    r = requests.post(f"{BASE_URL}/api/projects",
                      json={"name": "TEST_trace_iter32", "address": "1 Test St"},
                      headers=headers)
    assert r.status_code in (200, 201), f"proj create: {r.status_code} {r.text}"
    return r.json()["id"]


# ---------- auth + validation on trace endpoint ----------
class TestTraceBlueprintAuth:
    def test_requires_auth(self, project_id):
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/ai/trace-blueprint",
                          json={"document_id": "any"})
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_missing_doc_returns_404(self, project_id, headers):
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/ai/trace-blueprint",
                          json={"document_id": "nonexistent-doc-id"},
                          headers=headers)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ---------- blueprint fixtures persistence ----------
class TestBlueprintFixturesPersistence:
    def test_get_blueprint_has_fixtures_field(self, project_id, headers):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint", headers=headers)
        assert r.status_code == 200
        bp = r.json()
        assert "fixtures" in bp, f"blueprint missing fixtures field: keys={list(bp.keys())}"
        assert isinstance(bp["fixtures"], list)

    def test_put_blueprint_persists_fixtures(self, project_id, headers):
        payload = {
            "walls": [{"id": "w1", "start": {"x": 0, "y": 0}, "end": {"x": 20, "y": 0}, "thickness": 0.5}],
            "doors": [],
            "windows": [],
            "labels": [{"id": "l1", "text": "Kitchen", "position": {"x": 10, "y": 5}}],
            "fixtures": [
                {"id": "f1", "type": "toilet", "position": {"x": 5, "y": 3}, "w": 2, "h": 1.5, "rotation": 0},
                {"id": "f2", "type": "sink", "position": {"x": 8, "y": 3}, "w": 2, "h": 1.5, "rotation": 0},
            ],
        }
        r = requests.put(f"{BASE_URL}/api/projects/{project_id}/blueprint",
                         json=payload, headers=headers)
        assert r.status_code == 200, f"put blueprint: {r.status_code} {r.text}"

        # GET to verify persistence
        r2 = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint", headers=headers)
        assert r2.status_code == 200
        bp = r2.json()
        assert len(bp["fixtures"]) == 2, f"expected 2 fixtures, got {len(bp.get('fixtures', []))}"
        types = sorted(f.get("type") for f in bp["fixtures"])
        assert types == ["sink", "toilet"], f"unexpected fixture types: {types}"
        # walls preserved too
        assert len(bp["walls"]) == 1


# ---------- regression: AI floorplan text-prompt still works ----------
class TestAIFloorplanRegression:
    def test_floorplan_generation_still_works(self, project_id, headers):
        # This calls GPT-4o under the hood; allow up to 90s.
        r = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/ai/floorplan",
            json={"prompt": "small 20x15 studio with bathroom", "replace": True},
            headers=headers,
            timeout=120,
        )
        if r.status_code == 402:
            pytest.skip("Out of AI credits — regression path not testable here.")
        if r.status_code in (502, 504, 503):
            pytest.skip(f"AI provider transient error {r.status_code}: {r.text[:120]}")
        assert r.status_code == 200, f"floorplan gen failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert "counts" in body and body["counts"].get("walls", 0) > 0, f"no walls returned: {body}"

        # Verify blueprint was updated
        gb = requests.get(f"{BASE_URL}/api/projects/{project_id}/blueprint", headers=headers)
        assert gb.status_code == 200
        assert len(gb.json().get("walls", [])) > 0


# ---------- happy-path trace-blueprint (best-effort) ----------
class TestTraceBlueprintHappyPath:
    def test_trace_with_seeded_doc(self, project_id, headers):
        """Seed a document with a cached image_base64 via direct Mongo insert, then trace it.
        Since we can't upload PDF/images cleanly without triggering the multi-minute pipeline,
        we directly seed a `documents` row so the endpoint's re-tracing path is exercised.
        """
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
            doc_id = str(uuid.uuid4())
            await db.documents.insert_one({
                "id": doc_id,
                "project_id": project_id,
                "filename": "TEST_trace_seed.png",
                "status": "done",
                "doc_type": "floor_plan",
                "image_base64": PNG_B64,
                "materials_count": 0,
            })
            client.close()
            return doc_id

        doc_id = asyncio.get_event_loop().run_until_complete(seed())

        r = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/ai/trace-blueprint",
            json={"document_id": doc_id, "replace": True},
            headers=headers,
            timeout=120,
        )
        # Accept several outcomes:
        # - 200 happy path
        # - 402 out-of-credit
        # - 422 "no walls" (the 1x1 white PNG is unlikely to yield walls) — this is still valid pipeline
        # - 502/504 AI transient
        if r.status_code == 402:
            pytest.skip("Out of AI credits.")
        if r.status_code in (502, 503, 504):
            pytest.skip(f"AI transient: {r.status_code}")
        if r.status_code == 422:
            # Endpoint reached AI, parsed, but got no walls from a blank PNG. Expected.
            assert "no walls" in r.text.lower() or "floor plan" in r.text.lower()
            return
        assert r.status_code == 200, f"trace-blueprint failed: {r.status_code} {r.text[:400]}"
        body = r.json()
        assert "counts" in body, f"missing counts in response: {body}"
        for key in ("walls", "doors", "windows", "labels", "fixtures"):
            assert key in body["counts"], f"counts missing {key}: {body['counts']}"
        assert "building_ft" in body
        assert "scale_confidence" in body
