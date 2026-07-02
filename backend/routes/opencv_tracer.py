"""Deterministic wall extraction from raster blueprints using OpenCV.

GPT-4o Vision is great at understanding room labels and fixtures but poor at
tracing dense line geometry.  This module uses classical computer-vision
techniques (adaptive threshold + probabilistic Hough transform) to lift EVERY
line segment out of a blueprint image, then converts them to CAD walls in
real-world feet using the AI-estimated `building_ft` scale.
"""
from __future__ import annotations

import base64
import io
import logging
import math
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


def _cv2():
    """Lazy import cv2 so module load doesn't crash if it's not installed."""
    import cv2  # noqa: PLC0415
    return cv2


def _b64_to_bgr(b64: str):
    """Decode base64 → OpenCV BGR array."""
    cv2 = _cv2()
    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img


def _extract_line_segments(img_bgr, *, min_seg_px: int = 20,
                           merge_gap_px: int = 6) -> list[tuple[float, float, float, float]]:
    """Detect line segments (x1, y1, x2, y2) in pixel coordinates.

    We use Canny edges + probabilistic Hough. Segments shorter than
    `min_seg_px` are dropped. Collinear segments within `merge_gap_px` are
    merged so the final list is dense but not redundant.
    """
    cv2 = _cv2()
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    # Slight blur to suppress paper texture from phone photos.
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    # Adaptive threshold handles unevenly lit phone photos better than global.
    edges = cv2.Canny(gray, 60, 180, apertureSize=3)

    h, w = gray.shape[:2]
    # Auto-scale Hough thresholds to image size so a 400×300 sketch and a
    # 1600×1200 architectural sheet both produce a similar density of lines.
    min_len = max(min_seg_px, int(min(w, h) * 0.02))
    max_gap = max(merge_gap_px, int(min(w, h) * 0.008))
    lines = cv2.HoughLinesP(
        edges, rho=1, theta=np.pi / 360, threshold=45,
        minLineLength=min_len, maxLineGap=max_gap,
    )
    if lines is None:
        return []
    segs = [(float(x1), float(y1), float(x2), float(y2))
            for [x1, y1, x2, y2] in lines[:, 0, :]]
    return _merge_collinear(segs, merge_gap_px)


def _merge_collinear(segs, tol_px: float) -> list:
    """Merge segments that lie on the same line and touch / overlap."""
    if not segs:
        return []
    # Bucket by (angle rounded, perpendicular offset rounded).
    buckets: dict[tuple[int, int], list[tuple[float, float, float, float, float, float]]] = {}
    for x1, y1, x2, y2 in segs:
        dx, dy = x2 - x1, y2 - y1
        if dx == 0 and dy == 0:
            continue
        ang = math.atan2(dy, dx) % math.pi
        # Perpendicular distance from origin to the line.
        nx, ny = -math.sin(ang), math.cos(ang)
        perp = round((x1 * nx + y1 * ny) / max(tol_px, 1))
        key = (round(math.degrees(ang) / 3), perp)  # 3° buckets
        # Parameterize each endpoint along the line direction.
        dirx, diry = math.cos(ang), math.sin(ang)
        t1 = x1 * dirx + y1 * diry
        t2 = x2 * dirx + y2 * diry
        tmin, tmax = min(t1, t2), max(t1, t2)
        buckets.setdefault(key, []).append((tmin, tmax, x1, y1, x2, y2))
    merged: list[tuple[float, float, float, float]] = []
    for _key, bucket in buckets.items():
        bucket.sort()
        _, cur_max, sx, sy, ex, ey = bucket[0]
        for tmin, tmax, x1, y1, x2, y2 in bucket[1:]:
            if tmin <= cur_max + tol_px:
                if tmax > cur_max:
                    cur_max = tmax
                    ex, ey = x2, y2
            else:
                merged.append((sx, sy, ex, ey))
                _, cur_max, sx, sy, ex, ey = tmin, tmax, x1, y1, x2, y2
        merged.append((sx, sy, ex, ey))
    return merged


def trace_walls_from_image(image_b64: str, *,
                           building_ft_w: Optional[float] = None,
                           building_ft_h: Optional[float] = None) -> dict:
    """Extract dense wall segments from a blueprint image and convert to feet.

    Returns:
        {
          "walls": [{"start": [x, y], "end": [x, y], "thickness": 0.5}, ...],
          "building_ft": {"w": ..., "h": ...},   # px→ft scale used
          "image_px": {"w": ..., "h": ...},
          "count": int,
        }
    """
    try:
        img = _b64_to_bgr(image_b64)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"opencv decode failed: {exc}")
        return {"walls": [], "building_ft": None, "image_px": None, "count": 0}
    h_px, w_px = img.shape[:2]
    segs = _extract_line_segments(img)
    # Choose scale: prefer AI-provided building_ft; fall back to 60×proportion.
    if building_ft_w and building_ft_h and building_ft_w > 0 and building_ft_h > 0:
        bw_ft, bh_ft = building_ft_w, building_ft_h
    else:
        # Estimate: assume the longest side represents ~60 ft.
        long_side_ft = 60.0
        if w_px >= h_px:
            bw_ft = long_side_ft
            bh_ft = long_side_ft * (h_px / w_px)
        else:
            bh_ft = long_side_ft
            bw_ft = long_side_ft * (w_px / h_px)
    sx = bw_ft / w_px
    sy = bh_ft / h_px
    walls: list[dict] = []
    for (x1, y1, x2, y2) in segs:
        fx1, fy1 = x1 * sx, y1 * sy
        fx2, fy2 = x2 * sx, y2 * sy
        # Skip very short (< 1 ft) leftovers after conversion.
        if math.hypot(fx2 - fx1, fy2 - fy1) < 1.0:
            continue
        walls.append({
            "start": [round(fx1, 2), round(fy1, 2)],
            "end":   [round(fx2, 2), round(fy2, 2)],
            "thickness": 0.4,
        })
    return {
        "walls": walls,
        "building_ft": {"w": round(bw_ft, 2), "h": round(bh_ft, 2)},
        "image_px": {"w": w_px, "h": h_px},
        "count": len(walls),
    }
