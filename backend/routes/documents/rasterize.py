"""PDF-page rasterization and image-shrink helpers for document uploads.

Kept in its own module so the pipeline can `asyncio.to_thread(...)` these
CPU-heavy functions without dragging along AI/DB imports.
"""
from __future__ import annotations

import base64
import io

import pypdfium2 as pdfium


MAX_PDF_PAGES = 20
PDF_RASTER_SCALE = 2.0  # 2x = ~144dpi, good balance of detail/AI cost
# Cap the longest side of any stored blueprint image at 1600 px and re-encode
# as JPEG so the resulting base64 fits well within MongoDB's 16 MB BSON
# document limit and GPT-4o Vision's per-image budget. Large architectural
# sheets (24×36 Arch-D) at 2x scale can be > 20 MB PNG which used to blow up
# the DocumentTooLarge error and silently kill batch uploads.
MAX_IMAGE_DIM = 1600
JPEG_QUALITY = 85
# Any base64 payload larger than this is refused before hitting Mongo (16 MB
# is Mongo's hard cap; we keep a safety margin for other fields on the doc).
MAX_STORED_B64_BYTES = 6 * 1024 * 1024


def _shrink_and_encode(img) -> str:
    """Downscale a PIL image to fit within MAX_IMAGE_DIM and return base64 JPEG."""
    from PIL import Image  # local import to avoid startup cost
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > MAX_IMAGE_DIM:
        scale = MAX_IMAGE_DIM / float(max(w, h))
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    # If we're STILL over the safety cap (shouldn't happen for 1600px JPEG q85),
    # step the quality down until we fit.
    q = JPEG_QUALITY
    while len(b64) > MAX_STORED_B64_BYTES and q > 40:
        q -= 15
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=q, optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return b64


def _rasterize_pdf_pages(pdf_bytes: bytes) -> list[str]:
    """Render up to MAX_PDF_PAGES pages, downscale, JPEG-encode, base64."""
    pages_b64: list[str] = []
    pdf = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    try:
        n = min(len(pdf), MAX_PDF_PAGES)
        for i in range(n):
            page = pdf[i]
            pil_image = page.render(scale=PDF_RASTER_SCALE).to_pil()
            pages_b64.append(_shrink_and_encode(pil_image))
            page.close()
    finally:
        pdf.close()
    return pages_b64


def _shrink_image_bytes_to_b64(content: bytes) -> str:
    """Downscale a raw uploaded image file (PNG/JPG/WEBP) and return base64 JPEG."""
    from PIL import Image
    img = Image.open(io.BytesIO(content))
    return _shrink_and_encode(img)
