"""Procedural utilities/MEP material take-off derived from the blueprint geometry.

Mirrors the math used by the 3D renderer's procedural builders so the takeoff
PDF and the 3D scene stay in sync.
"""
from __future__ import annotations

from math import hypot
from typing import List

# Renderer constants (kept in sync with frontend/src/lib/renderer/sceneBuilder.js)
SCALE = 0.3048  # blueprint units (ft) -> meters
WALL_HEIGHT_M = 3.05
M_TO_FT = 3.28084


def _wall_lengths_meters(walls: list) -> list[float]:
    out = []
    for w in walls:
        s, e = w.get("start"), w.get("end")
        if not s or not e:
            continue
        L = hypot((e[0] - s[0]) * SCALE, (e[1] - s[1]) * SCALE)
        if L >= 0.05:
            out.append(L)
    return out


def _footprint_extents_m(walls: list) -> tuple[float, float] | None:
    xs, zs = [], []
    for w in walls:
        for p in (w.get("start"), w.get("end")):
            if p:
                xs.append(p[0] * SCALE)
                zs.append(p[1] * SCALE)
    if not xs:
        return None
    return max(xs) - min(xs), max(zs) - min(zs)


def compute_utilities_takeoff(blueprint: dict) -> List[dict]:
    """Return a list of utility/MEP material line-items derived procedurally.

    Each item: { name, category, quantity, unit, unit_price, auto_computed: True }
    """
    walls = blueprint.get("walls") or []
    lengths = _wall_lengths_meters(walls)
    if not lengths:
        return []
    total_wall_m = sum(lengths)
    extents = _footprint_extents_m(walls)
    if not extents:
        return []
    width_m, depth_m = extents
    aabb_max = max(width_m, depth_m)

    outlet_count = sum(max(2, int(L / 2.5)) for L in lengths)

    items: List[dict] = []

    def add(category, name, qty, unit, price):
        items.append({
            "name": name, "category": category,
            "quantity": round(float(qty), 1) if isinstance(qty, float) else qty,
            "unit": unit, "unit_price": float(price),
            "auto_computed": True,
        })

    # --- Underground Utilities (Plumbing) ---
    util_run_ft = (aabb_max + 6) * M_TO_FT
    add("Plumbing", "Water main (Type-K copper, 1-in)",        util_run_ft, "ft", 4.50)
    add("Plumbing", "Natural gas line (CSST, 3/4-in)",         util_run_ft, "ft", 6.20)
    add("Plumbing", "Sewer lateral (PVC, 4-in SDR-35)",        util_run_ft, "ft", 8.50)
    add("Plumbing", "Water meter assembly",                    1,           "ea", 380.00)
    add("Plumbing", "Trench excavation & backfill (utilities)", round(util_run_ft, 1), "ft", 6.75)

    # --- Septic / Drain Field (Plumbing) ---
    lateral_len_m = max(4.0, depth_m * 0.8)
    lateral_count = 4
    total_lateral_ft = lateral_len_m * lateral_count * M_TO_FT
    # Gravel bed volume (lateral_len_m+0.3) x 0.55 x 0.08 m^3 per lateral, cu yd
    gravel_cu_yd = (lateral_len_m + 0.3) * 0.55 * 0.08 * lateral_count * 1.30795
    add("Plumbing", "Septic tank (1000 gal, concrete)",        1, "ea", 1450.00)
    add("Plumbing", "Distribution box (D-box)",                1, "ea", 95.00)
    add("Plumbing", "Septic riser & lid (12-in)",              2, "ea", 110.00)
    add("Plumbing", "Leach field perforated pipe (PVC, 4-in)", total_lateral_ft, "ft", 2.80)
    add("Plumbing", "Drain field gravel (3/4-in stone)",       round(gravel_cu_yd, 2), "cu yd", 42.00)

    # --- Plumbing rough-in (Plumbing) ---
    stack_ft = (WALL_HEIGHT_M + 0.8) * M_TO_FT
    supply_ft = total_wall_m * 0.95 * M_TO_FT
    add("Plumbing", "Vertical drain stack (PVC, 4-in)",        stack_ft, "ft", 11.00)
    add("Plumbing", "Cold water supply (PEX, 3/4-in)",         supply_ft, "ft", 1.80)
    add("Plumbing", "Hot water supply (PEX, 3/4-in)",          supply_ft, "ft", 1.80)
    add("Plumbing", "Drain/waste line (PVC, 2-in)",            supply_ft, "ft", 3.40)

    # --- Electrical ---
    conduit_ft = total_wall_m * 0.92 * M_TO_FT
    wire_ft = total_wall_m * 3.5 * M_TO_FT  # 3 conductors per run avg
    add("Electrical", "Main electrical panel (200A, 40-circuit)", 1, "ea", 320.00)
    add("Electrical", "EMT conduit (3/4-in)",                  conduit_ft, "ft", 1.20)
    add("Electrical", "Outlet boxes & 20A receptacles",        outlet_count, "ea", 12.50)
    add("Electrical", "Ceiling junction box",                  1, "ea", 8.00)
    add("Electrical", "THHN wire (12 AWG, copper)",            wire_ft, "ft", 0.55)

    return items
