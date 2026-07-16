"""Iteration 6 tests:
- PUT /api/projects/{id}/blueprint accepts the FULL payload (labels, roof_type,
  roof_pitch_deg, wall_color, roof_color) — was 422 before; now fixed.
- Takeoff PDF now includes Utilities/MEP procedural items (AUTO src column).
- Admin login still works after refactor.
- EMERGENT_LLM_KEY is read AFTER load_dotenv (no 'EMERGENT_LLM_KEY missing' error).
"""
import os
import time
import uuid
import requests
import pytest


ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@atlas.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Open0says3me#*03#*")

RECT_WALLS = [
    {"id": "w1", "start": [10, 10], "end": [90, 10], "thickness": 0.2},
    {"id": "w2", "start": [90, 10], "end": [90, 90], "thickness": 0.2},
    {"id": "w3", "start": [90, 90], "end": [10, 90], "thickness": 0.2},
    {"id": "w4", "start": [10, 90], "end": [10, 10], "thickness": 0.2},
]


# ---------- Admin login (post-refactor) ----------
class TestAdminLogin:
    def test_admin_login_returns_is_admin_true(self, base_url):
        r = requests.post(f"{base_url}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                          timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"].get("is_admin") is True
        token = data["token"]
        # /me should also surface is_admin
        me = requests.get(f"{base_url}/api/auth/me",
                         headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert me.status_code == 200
        assert me.json().get("is_admin") is True


@pytest.fixture(scope="module")
def admin_token(base_url):
    r = requests.post(f"{base_url}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_project(base_url, admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    pr = requests.post(f"{base_url}/api/projects",
                       json={"name": f"TEST_iter6_{uuid.uuid4().hex[:6]}"},
                       headers=h, timeout=15)
    assert pr.status_code == 200, pr.text
    return pr.json()["id"]


# ---------- PUT blueprint FULL payload ----------
class TestBlueprintFullPayload:
    def test_put_full_blueprint_payload_persists(self, base_url, admin_token, admin_project):
        h = {"Authorization": f"Bearer {admin_token}"}
        payload = {
            "walls": RECT_WALLS,
            "doors": [{"id": "d1", "position": [50, 10], "width": 3, "wall_index": 0}],
            "windows": [{"id": "win1", "position": [30, 10], "width": 4, "wall_index": 0}],
            "labels": [
                {"id": "lbl1", "text": "Master Bedroom", "position": [40, 40]},
                {"id": "lbl2", "text": "Kitchen", "position": [70, 40]},
            ],
            "roof_type": "hip",
            "roof_pitch_deg": 22.5,
            "wall_color": "#A1B2C3",
            "roof_color": "#332211",
        }
        r = requests.put(f"{base_url}/api/projects/{admin_project}/blueprint",
                         json=payload, headers=h, timeout=15)
        assert r.status_code == 200, f"PUT blueprint FAILED (was 422 before fix): {r.status_code} {r.text}"

        # GET and verify ALL fields persisted
        g = requests.get(f"{base_url}/api/projects/{admin_project}/blueprint",
                        headers=h, timeout=15)
        assert g.status_code == 200
        d = g.json()
        assert len(d["walls"]) == 4
        assert len(d["doors"]) == 1
        assert len(d["windows"]) == 1
        # Critical: previously missing fields
        assert d.get("labels") and len(d["labels"]) == 2
        assert d["labels"][0]["text"] == "Master Bedroom"
        assert d.get("roof_type") == "hip"
        assert abs(float(d.get("roof_pitch_deg", 0)) - 22.5) < 0.001
        assert d.get("wall_color") == "#A1B2C3"
        assert d.get("roof_color") == "#332211"

    def test_put_partial_blueprint_accepts_defaults(self, base_url, admin_token):
        """Only walls — labels/roof fields should default, no 422."""
        h = {"Authorization": f"Bearer {admin_token}"}
        pr = requests.post(f"{base_url}/api/projects",
                          json={"name": f"TEST_iter6_partial_{uuid.uuid4().hex[:6]}"},
                          headers=h, timeout=15)
        pid = pr.json()["id"]
        r = requests.put(f"{base_url}/api/projects/{pid}/blueprint",
                        json={"walls": RECT_WALLS[:1]}, headers=h, timeout=15)
        assert r.status_code == 200, r.text


# ---------- Takeoff PDF includes utilities ----------
class TestTakeoffPdfUtilities:
    def test_pdf_contains_utilities_phrases(self, base_url, admin_token, admin_project):
        h = {"Authorization": f"Bearer {admin_token}"}
        # Ensure rectangular blueprint is saved
        put = requests.put(
            f"{base_url}/api/projects/{admin_project}/blueprint",
            json={
                "walls": RECT_WALLS,
                "doors": [], "windows": [], "labels": [],
                "roof_type": "gable", "roof_pitch_deg": 12.0,
                "wall_color": "#D8D4CC", "roof_color": "#4A5C6E",
            },
            headers=h, timeout=15,
        )
        assert put.status_code == 200, put.text

        # Download PDF (admin should have access - studio plan)
        r = requests.get(f"{base_url}/api/projects/{admin_project}/takeoff.pdf",
                        headers=h, timeout=60)
        assert r.status_code == 200, f"PDF gen failed: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        body = r.content
        assert body.startswith(b"%PDF"), "Response is not a PDF"

        # Extract text via pypdf (PDF streams are flate-compressed)
        import pypdf
        from io import BytesIO
        reader = pypdf.PdfReader(BytesIO(body))
        extracted_text = "\n".join((p.extract_text() or "") for p in reader.pages)

        required_any = ["Septic tank", "Leach field", "Water main",
                       "EMT conduit", "Vertical drain stack"]
        found = [p for p in required_any if p in extracted_text]
        assert found, (
            f"None of the expected utility phrases found in PDF text. "
            f"Expected at least one of: {required_any}. "
            f"Sample extracted text: {extracted_text[:1000]!r}"
        )
        # Also expect AUTO source marker rendered
        assert "AUTO" in extracted_text, \
            "PDF should contain 'AUTO' src marker for procedural items"


# ---------- AI pipeline regression: EMERGENT_LLM_KEY readable ----------
class TestAiPipelineKeyLoaded:
    def test_emergent_llm_key_in_env(self, base_url):
        """Smoke: the backend reads EMERGENT_LLM_KEY at runtime (lazy via _llm_key())."""
        # Verify via uploading a tiny image and checking it does NOT immediately error on 'missing'
        r = requests.post(f"{base_url}/api/auth/register", json={
            "email": f"test_iter6_pipe_{uuid.uuid4().hex[:6]}@example.com",
            "password": "TestPass123!",
            "name": "Pipe Tester",
        }, timeout=20)
        assert r.status_code == 200
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}

        pr = requests.get(f"{base_url}/api/projects", headers=h, timeout=15)
        pid = pr.json()[0]["id"]

        # Tiny 100x100 PNG via PIL
        from PIL import Image, ImageDraw
        import io
        img = Image.new("RGB", (200, 200), "white")
        d = ImageDraw.Draw(img)
        d.rectangle([20, 20, 180, 180], outline="black", width=4)
        buf = io.BytesIO()
        img.save(buf, "PNG")
        buf.seek(0)

        files = {"file": ("tiny.png", buf, "image/png")}
        u = requests.post(f"{base_url}/api/projects/{pid}/documents/upload",
                        files=files, headers=h, timeout=30)
        assert u.status_code == 200
        doc_id = u.json()["id"]

        # Poll briefly: must NOT end with status=error AND error containing 'EMERGENT_LLM_KEY missing'
        deadline = time.time() + 60
        while time.time() < deadline:
            ls = requests.get(f"{base_url}/api/projects/{pid}/documents",
                            headers=h, timeout=15)
            docs = ls.json()
            mine = next((d for d in docs if d["id"] == doc_id), None)
            assert mine is not None
            if mine["status"] in {"done", "error"}:
                if mine["status"] == "error":
                    assert "EMERGENT_LLM_KEY missing" not in (mine.get("error") or ""), \
                        f"Pipeline reports EMERGENT_LLM_KEY missing — regression! {mine}"
                # Either done OR errored-but-for-other-reason — both prove key was read
                break
            time.sleep(2)
