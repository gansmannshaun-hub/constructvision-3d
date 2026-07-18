"""Pure helpers for cleaning + validating AI-extracted document data.

Kept dependency-free so both `ai_vision.py` and the pipeline can import
these without pulling in Pillow / pdfium / OpenCV.
"""
from __future__ import annotations

import re
import uuid


VALID_CATEGORIES = {
    "Structural", "Framing", "Electrical", "Plumbing", "Finishes",
    "HVAC", "Insulation", "Roofing", "Doors & Windows", "Other",
}

VALID_FIXTURE_KINDS = {
    "toilet", "sink", "shower", "tub", "vanity", "stove", "oven",
    "refrigerator", "dishwasher", "washer", "dryer", "island", "counter",
    "closet", "stairs", "bed", "sofa", "dining_table", "desk", "fireplace",
    "hvac_unit", "water_heater", "column", "other",
}

EXISTING_MATERIALS_TEMPLATE_NONE = (
    "EXISTING MATERIALS IN THIS PROJECT: (none — this is the first document)"
)


def _coord(p):
    if isinstance(p, list) and len(p) >= 2:
        return [float(p[0]), float(p[1])]
    return None


def _norm_key(name: str, category: str, unit: str) -> str:
    """Normalised key for fuzzy fallback dedup: lowercase, strip punctuation."""
    norm_name = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    norm_cat = (category or "").lower()
    norm_unit = re.sub(r"[^a-z0-9]+", "", (unit or "").lower())
    return f"{norm_cat}|{norm_name}|{norm_unit}"


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    return text.strip()


def _format_existing_materials_for_prompt(existing: list[dict]) -> str:
    if not existing:
        return EXISTING_MATERIALS_TEMPLATE_NONE
    lines = [
        "EXISTING MATERIALS IN THIS PROJECT (already counted from prior documents — do NOT double-count):"
    ]
    for i, m in enumerate(existing, start=1):
        lines.append(
            f"  [{i}] {m.get('name', '')} · {m.get('category', '')} · "
            f"{m.get('quantity', 0)} {m.get('unit', '')}"
        )
    return "\n".join(lines)


def _sanitize_fixture(fx: dict) -> dict | None:
    pos = _coord(fx.get("position"))
    if not pos:
        return None
    kind = str(fx.get("kind") or "other").lower().replace("-", "_").replace(" ", "_")
    if kind not in VALID_FIXTURE_KINDS:
        kind = "other"
    size = fx.get("size") or [2.0, 2.0]
    try:
        sw = float(size[0])
        sh = float(size[1])
    except (TypeError, ValueError, IndexError):
        sw, sh = 2.0, 2.0
    sw = max(0.5, min(sw, 40.0))
    sh = max(0.5, min(sh, 40.0))
    try:
        rot = float(fx.get("rotation_deg") or 0)
    except (TypeError, ValueError):
        rot = 0.0
    return {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "position": pos,
        "size": [sw, sh],
        "rotation_deg": rot % 360,
    }


def _sanitize_label(lbl: dict) -> dict | None:
    pos = _coord(lbl.get("position"))
    text = (lbl.get("text") or "").strip()[:60]
    if not pos or not text:
        return None
    return {"id": str(uuid.uuid4()), "position": pos, "text": text}
