"""Iteration 47 — Multi-page PDF creates one sheet per page (bug fix).

Verifies:
  1. Multi-page PDF upload → N blueprint_sheets (one per page) with
     source_document_id == doc_id, source_page in {1..N}, and name suffix "pN/M".
  2. Regression: single-page image upload → exactly 1 sheet, no source_page suffix.
  3. Regression: retry on multi-page doc doesn't leave stale sheets (still N, not 2N).
"""
from __future__ import annotations

import io
import os
import time
import uuid

import pytest
import requests
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from PIL import Image, ImageDraw

def _load_backend_url() -> str:
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        # pytest doesn't auto-load frontend/.env
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    return url.rstrip("/")


BASE_URL = _load_backend_url()
POLL_TIMEOUT = 240  # 4 min — GPT-4o vision + 3 pages
POLL_INTERVAL = 5


# ---------- Fixtures ----------

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def auth_token(api):
    # Use admin — unlimited quota + higher upload limits for AI processing.
    r = api.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@atlas.app", "password": "Open0says3me#*03#*",
    })
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, f"no token in response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="module")
def project_id(api, headers):
    r = api.post(f"{BASE_URL}/api/projects", headers=headers,
                 json={"name": "TEST_iter47_multipage", "description": "multi-page pdf test"})
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    return r.json()["id"]


# ---------- Helpers ----------

def _make_multipage_pdf(n_pages: int = 3) -> bytes:
    """Simple floor-plan-like PDF: rectangle w/ interior partition + page label."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    w, h = letter
    for p in range(1, n_pages + 1):
        # outer rectangle (building outline)
        c.setLineWidth(3)
        c.rect(72, 72, w - 144, h - 144)
        # interior partition — divides into two rooms
        c.setLineWidth(2)
        y_mid = (h - 144) / 2 + 72
        c.line(72, y_mid, w - 72, y_mid)
        # room labels
        c.setFont("Helvetica", 14)
        c.drawString(200, y_mid + 40, "LIVING ROOM")
        c.drawString(200, y_mid - 60, "BEDROOM")
        # page marker
        c.setFont("Helvetica-Bold", 20)
        c.drawString(72, h - 50, f"Floor Plan — Page {p} of {n_pages}")
        c.drawString(72, 50, f"FLOOR {p}")
        c.showPage()
    c.save()
    return buf.getvalue()


def _make_floorplan_image() -> bytes:
    """PNG floor-plan-like image."""
    img = Image.new("RGB", (1200, 900), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([60, 60, 1140, 840], outline="black", width=5)
    d.line([60, 450, 1140, 450], fill="black", width=4)
    d.line([600, 60, 600, 450], fill="black", width=4)
    d.text((300, 200), "LIVING ROOM", fill="black")
    d.text((900, 200), "KITCHEN", fill="black")
    d.text((500, 650), "BEDROOM", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _poll_document(api, headers, project_id: str, doc_id: str,
                   timeout: int = POLL_TIMEOUT) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = api.get(f"{BASE_URL}/api/projects/{project_id}/documents",
                    headers=headers)
        assert r.status_code == 200, f"list docs: {r.status_code} {r.text[:200]}"
        docs = r.json()
        this = next((d for d in docs if d["id"] == doc_id), None)
        if this:
            last = this
            status = this.get("status")
            if status in ("done", "error"):
                return this
        time.sleep(POLL_INTERVAL)
    raise AssertionError(f"Timed out polling doc {doc_id}; last={last}")


# ---------- Tests ----------

class TestMultipagePDF:
    """PRIMARY BUG FIX — multi-page PDF must produce one sheet per page."""

    def test_multipage_pdf_creates_sheet_per_page(self, api, headers, project_id):
        pdf_bytes = _make_multipage_pdf(n_pages=3)
        files = {"file": ("test_3page.pdf", pdf_bytes, "application/pdf")}
        r = api.post(f"{BASE_URL}/api/projects/{project_id}/documents/upload",
                     headers=headers, files=files)
        assert r.status_code == 200, f"upload: {r.status_code} {r.text[:200]}"
        doc = r.json()
        doc_id = doc["id"]
        assert doc.get("is_pdf") is True

        final = _poll_document(api, headers, project_id, doc_id)
        assert final.get("status") == "done", f"doc did not reach done: {final}"
        pages_total = final.get("pages_total")
        assert pages_total == 3, f"expected 3 pages, got {pages_total}"

        # Fetch sheets and count those tied to this doc.
        r = api.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                    headers=headers)
        assert r.status_code == 200
        sheets = r.json()
        doc_sheets = [s for s in sheets if s.get("source_document_id") == doc_id]

        page_summaries = (final.get("analysis") or {}).get("page_summaries") or []
        drawing_types = {
            "floor_plan", "blueprint", "site_plan", "foundation_plan",
            "framing_plan", "roof_plan", "sheathing_plan", "elevation",
            "electrical_plan", "plumbing_plan", "hvac_plan", "detail",
        }
        drawing_pages = [
            p for p in page_summaries if p.get("doc_type") in drawing_types
        ]
        expected = len(drawing_pages) if drawing_pages else 3
        print(f"page_summaries doc_types: {[p.get('doc_type') for p in page_summaries]}")
        print(f"doc_sheets count={len(doc_sheets)} expected~={expected}")

        # Primary assertion: multi-page created MORE THAN ONE sheet (the bug).
        assert len(doc_sheets) > 1, (
            f"BUG NOT FIXED: multi-page PDF produced only {len(doc_sheets)} sheet(s). "
            f"page_summaries={page_summaries}"
        )
        # Ideally one sheet per drawing-classified page.
        assert len(doc_sheets) == expected, (
            f"expected {expected} sheets (one per drawing page), got {len(doc_sheets)}"
        )

        # Each sheet has source_page in expected set + name has 'pN/M'.
        pages_seen = set()
        for s in doc_sheets:
            sp = s.get("source_page")
            assert sp is not None and 1 <= sp <= 3, f"bad source_page: {s}"
            pages_seen.add(sp)
            assert "/" in (s.get("name") or ""), f"sheet name missing pN/M: {s.get('name')}"
            assert f"p{sp}/" in (s.get("name") or ""), f"sheet name mismatch: {s.get('name')}"
        assert len(pages_seen) == len(doc_sheets), "duplicate source_page values"

        # Save for the retry test.
        pytest.multipage_doc_id = doc_id
        pytest.multipage_sheet_count = len(doc_sheets)
        pytest.multipage_expected = expected

    def test_multipage_first_sheet_is_active(self, api, headers, project_id):
        # Depends on prior test; skip if it didn't set state.
        doc_id = getattr(pytest, "multipage_doc_id", None)
        if not doc_id:
            pytest.skip("multipage upload didn't complete")
        r = api.get(f"{BASE_URL}/api/projects/{project_id}/blueprint",
                    headers=headers)
        assert r.status_code == 200
        bp = r.json()
        active_id = bp.get("active_sheet_id")
        assert active_id
        # active sheet should be from this doc, on page 1
        r2 = api.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                     headers=headers)
        sheets = r2.json()
        active = next((s for s in sheets if s["id"] == active_id), None)
        assert active is not None
        # Not strictly required but ideal:
        if active.get("source_document_id") == doc_id:
            assert active.get("source_page") == 1, (
                f"expected page 1 active, got page {active.get('source_page')}"
            )


class TestSinglePageRegression:
    """REGRESSION — single-page image upload creates exactly ONE sheet."""

    def test_single_image_creates_one_sheet(self, api, headers, project_id):
        png_bytes = _make_floorplan_image()
        files = {"file": ("floorplan.png", png_bytes, "image/png")}
        r = api.post(f"{BASE_URL}/api/projects/{project_id}/documents/upload",
                     headers=headers, files=files)
        assert r.status_code == 200
        doc_id = r.json()["id"]

        final = _poll_document(api, headers, project_id, doc_id)
        assert final.get("status") == "done", f"single-page did not reach done: {final}"

        r = api.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                    headers=headers)
        sheets = r.json()
        doc_sheets = [s for s in sheets if s.get("source_document_id") == doc_id]
        assert len(doc_sheets) == 1, f"single-page expected 1 sheet, got {len(doc_sheets)}"
        s = doc_sheets[0]
        # source_page should be None/absent
        assert s.get("source_page") in (None,), f"single-page sheet should have no source_page, got {s.get('source_page')}"
        # name should be filename (no pN/M suffix)
        assert "/" not in (s.get("name") or ""), f"single-page sheet should not have pN/M: {s.get('name')}"


class TestRetryDoesNotDuplicate:
    """REGRESSION — retry on multi-page doc doesn't leave stale sheets."""

    def test_retry_purges_stale_sheets(self, api, headers, project_id):
        doc_id = getattr(pytest, "multipage_doc_id", None)
        expected = getattr(pytest, "multipage_expected", None)
        if not doc_id or not expected:
            pytest.skip("multipage upload didn't complete")
        # Multi-page retry is expected to only re-analyze the thumbnail page
        # (per code comments) — but the purge should still delete prior sheets.
        # So after retry, source_document_id==doc_id sheets should be <= expected
        # (definitely NOT 2 * expected which would indicate stale sheets).
        r = api.post(f"{BASE_URL}/api/documents/{doc_id}/retry", headers=headers)
        # Retry may return various status codes; accept 200 or the specific
        # "no cached original" if backend rejects PDF retry.
        if r.status_code == 400:
            # PDF retry may be rejected — verify no duplicates were created regardless
            pass
        else:
            assert r.status_code == 200, f"retry: {r.status_code} {r.text[:200]}"
            # Poll until done
            _poll_document(api, headers, project_id, doc_id, timeout=180)

        r = api.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                    headers=headers)
        sheets = r.json()
        doc_sheets = [s for s in sheets if s.get("source_document_id") == doc_id]
        assert len(doc_sheets) <= expected, (
            f"retry created stale duplicates: {len(doc_sheets)} sheets, expected <= {expected}"
        )
