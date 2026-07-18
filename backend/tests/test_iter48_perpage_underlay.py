"""Iteration 48 — Multi-page PDF: each sheet has DIFFERENT per-page underlay image.

Fix under test:
- Each sheet stores its own `page_image_base64` (per-page rendered image).
- `GET /api/documents/{doc_id}/image?page=N` returns the matching page image
  via `blueprint_sheets` where source_document_id==doc_id AND source_page==N.
- List endpoint excludes `page_image_base64` (payload lean).
"""
from __future__ import annotations

import hashlib
import io
import os
import time

import pytest
import requests
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from PIL import Image, ImageDraw


def _load_backend_url() -> str:
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
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
POLL_TIMEOUT = 240
POLL_INTERVAL = 5


@pytest.fixture(scope="module")
def api():
    return requests.Session()


@pytest.fixture(scope="module")
def headers(api):
    r = api.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@atlas.app", "password": "Open0says3me#*03#*",
    })
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def project_id(api, headers):
    r = api.post(f"{BASE_URL}/api/projects", headers=headers,
                 json={"name": "TEST_iter48_perpage", "description": "per-page underlay test"})
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    return r.json()["id"]


def _make_distinct_multipage_pdf(n_pages: int = 3) -> bytes:
    """3-page PDF, each page visually DISTINCT (different corner rectangles + labels).
    Also floor-plan-like so the pipeline classifies pages as floor_plan.
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    w, h = letter
    labels = ["PAGE ONE", "PAGE TWO", "PAGE THREE"]
    # corners: (x, y) of a small filled rectangle to differentiate visually
    corners = [
        (100, 100),           # bottom-left  page 1
        (w - 200, 100),       # bottom-right page 2
        (w - 200, h - 200),   # top-right    page 3
    ]
    for p in range(1, n_pages + 1):
        # Outer building outline
        c.setLineWidth(3)
        c.rect(72, 72, w - 144, h - 144)
        # Interior partition (looks like floor plan)
        c.setLineWidth(2)
        y_mid = (h - 144) / 2 + 72
        c.line(72, y_mid, w - 72, y_mid)
        c.setFont("Helvetica", 14)
        c.drawString(200, y_mid + 40, "LIVING ROOM")
        c.drawString(200, y_mid - 60, "BEDROOM")
        # Distinct filled rectangle in different corner
        cx, cy = corners[p - 1]
        c.setFillColorRGB(0, 0, 0)
        c.rect(cx, cy, 100, 100, fill=1, stroke=0)
        # Big page marker
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 42)
        c.drawString(180, h / 2, labels[p - 1])
        c.setFont("Helvetica-Bold", 20)
        c.drawString(72, h - 50, f"Floor Plan — {labels[p - 1]}")
        c.showPage()
    c.save()
    return buf.getvalue()


def _make_floorplan_png() -> bytes:
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


def _poll_document(api, headers, project_id, doc_id, timeout=POLL_TIMEOUT):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = api.get(f"{BASE_URL}/api/projects/{project_id}/documents", headers=headers)
        assert r.status_code == 200
        this = next((d for d in r.json() if d["id"] == doc_id), None)
        if this:
            last = this
            if this.get("status") in ("done", "error"):
                return this
        time.sleep(POLL_INTERVAL)
    raise AssertionError(f"Timed out polling doc {doc_id}; last={last}")


def _hash(s: str | None) -> str | None:
    if not s:
        return None
    return hashlib.sha256(s.encode()).hexdigest()


# ============================================================================
# Primary bug fix
# ============================================================================

class TestPerPageUnderlay:
    def test_multipage_pdf_each_page_has_distinct_image(self, api, headers, project_id):
        pdf_bytes = _make_distinct_multipage_pdf(3)
        files = {"file": ("test_iter48_3pg.pdf", pdf_bytes, "application/pdf")}
        r = api.post(f"{BASE_URL}/api/projects/{project_id}/documents/upload",
                     headers=headers, files=files)
        assert r.status_code == 200, f"upload: {r.status_code} {r.text[:200]}"
        doc_id = r.json()["id"]

        final = _poll_document(api, headers, project_id, doc_id)
        assert final.get("status") == "done", f"doc not done: {final}"
        assert final.get("pages_total") == 3

        # Fetch sheets.
        r = api.get(f"{BASE_URL}/api/projects/{project_id}/blueprint/sheets",
                    headers=headers)
        assert r.status_code == 200
        sheets = r.json()
        doc_sheets = [s for s in sheets if s.get("source_document_id") == doc_id]

        # Log for context
        page_types = [(p.get("page"), p.get("doc_type"))
                      for p in (final.get("analysis") or {}).get("page_summaries") or []]
        print(f"page_summaries: {page_types}")
        print(f"doc_sheets pages: {sorted(s.get('source_page') for s in doc_sheets)}")

        assert len(doc_sheets) >= 2, (
            f"Expected multiple sheets for 3-page PDF, got {len(doc_sheets)}. "
            f"page_summaries={page_types}"
        )

        # ---- (Regression c) — list endpoint must NOT include page_image_base64 ----
        for s in doc_sheets:
            assert "page_image_base64" not in s, (
                f"list endpoint leaks page_image_base64 for sheet {s.get('id')}"
            )

        # ---- Primary assertion — /image?page=N returns DIFFERENT bytes ----
        pages = sorted({s.get("source_page") for s in doc_sheets if s.get("source_page")})
        assert len(pages) >= 2, f"need >=2 distinct pages, got {pages}"

        hashes = {}
        for n in pages:
            r = api.get(f"{BASE_URL}/api/documents/{doc_id}/image",
                        headers=headers, params={"page": n})
            assert r.status_code == 200, f"page {n} img: {r.status_code} {r.text[:200]}"
            body = r.json()
            b64 = body.get("image_base64")
            assert b64, f"page {n} image_base64 is empty"
            assert body.get("page") == n
            hashes[n] = _hash(b64)
            print(f"page {n} hash: {hashes[n][:16]}... len(b64)={len(b64)}")

        distinct = set(hashes.values())
        assert len(distinct) == len(hashes), (
            f"BUG NOT FIXED: pages return duplicate images. hashes={hashes}"
        )

        # ---- Default (no page param) must equal page 1 ----
        r_def = api.get(f"{BASE_URL}/api/documents/{doc_id}/image", headers=headers)
        assert r_def.status_code == 200
        default_hash = _hash(r_def.json().get("image_base64"))
        assert default_hash == hashes[1], (
            f"default /image ({default_hash[:16] if default_hash else None}) "
            f"!= page=1 ({hashes[1][:16]})"
        )

        # ---- ?page=1 must equal default (page 1 = doc-level thumbnail) ----
        r_p1 = api.get(f"{BASE_URL}/api/documents/{doc_id}/image",
                       headers=headers, params={"page": 1})
        assert r_p1.status_code == 200
        assert _hash(r_p1.json().get("image_base64")) == hashes[1]

        # Save for downstream tests
        pytest.iter48_doc_id = doc_id
        pytest.iter48_page1_hash = hashes[1]


# ============================================================================
# Regressions
# ============================================================================

class TestSinglePageImageRegression:
    def test_single_image_endpoint_still_works(self, api, headers, project_id):
        png = _make_floorplan_png()
        files = {"file": ("floorplan_iter48.png", png, "image/png")}
        r = api.post(f"{BASE_URL}/api/projects/{project_id}/documents/upload",
                     headers=headers, files=files)
        assert r.status_code == 200
        doc_id = r.json()["id"]

        final = _poll_document(api, headers, project_id, doc_id)
        assert final.get("status") == "done"

        # No page param
        r = api.get(f"{BASE_URL}/api/documents/{doc_id}/image", headers=headers)
        assert r.status_code == 200
        b64_default = r.json().get("image_base64")
        assert b64_default, "default image_base64 is empty"

        # ?page=1 — should also work
        r = api.get(f"{BASE_URL}/api/documents/{doc_id}/image",
                    headers=headers, params={"page": 1})
        assert r.status_code == 200
        b64_p1 = r.json().get("image_base64")
        assert b64_p1
        # page 1 == default for single-page docs
        assert _hash(b64_p1) == _hash(b64_default)

        # ?page=5 (nonexistent) — must fall back to doc-level thumbnail, NOT 404
        r = api.get(f"{BASE_URL}/api/documents/{doc_id}/image",
                    headers=headers, params={"page": 5})
        assert r.status_code == 200, (
            f"nonexistent page should fall back, got {r.status_code} {r.text[:200]}"
        )
        b64_p5 = r.json().get("image_base64")
        assert b64_p5, "fallback image_base64 is empty"
        # Falls back to doc-level = same as default
        assert _hash(b64_p5) == _hash(b64_default), (
            "?page=5 should fall back to doc-level thumbnail (same as default)"
        )
