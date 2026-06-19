"""Pricing engine: applies regional multiplier + waste/overhead/profit/contingency
cascade and computes labor totals. Used by the takeoff PDF/CSV/XLSX endpoints,
the public share endpoint, and the bid-snapshot endpoints.
"""
from __future__ import annotations

from typing import Iterable


DEFAULT_CONFIG = {
    "zip": "",
    "city": "",
    "state": "",
    "regional_multiplier": 1.0,
    "regional_source": "default",
    "waste_pct": 5.0,
    "overhead_pct": 10.0,
    "profit_pct": 12.0,
    "contingency_pct": 3.0,
    "labor_rate_multiplier": 1.0,
}


async def get_pricing_config(db, project_id: str) -> dict:
    cfg = await db.pricing_configs.find_one({"project_id": project_id}, {"_id": 0})
    if not cfg:
        return {**DEFAULT_CONFIG, "project_id": project_id}
    return {**DEFAULT_CONFIG, **cfg}


def compute_bid(materials: Iterable[dict], cfg: dict) -> dict:
    """Apply pricing cascade. Returns a totals dict + a per-line enriched materials list."""
    mult = float(cfg.get("regional_multiplier") or 1.0)
    labor_mult = float(cfg.get("labor_rate_multiplier") or 1.0)
    waste_pct = float(cfg.get("waste_pct") or 0)
    overhead_pct = float(cfg.get("overhead_pct") or 0)
    profit_pct = float(cfg.get("profit_pct") or 0)
    cont_pct = float(cfg.get("contingency_pct") or 0)

    lines: list[dict] = []
    materials_subtotal = 0.0
    labor_subtotal = 0.0

    for m in materials:
        qty = float(m.get("quantity") or 0)
        mat_unit = float(m.get("unit_price") or 0)
        labor_unit = float(m.get("labor_unit_price") or 0)
        mat_total = qty * mat_unit * mult
        lab_total = qty * labor_unit * mult * labor_mult
        line = {**m, "material_total": round(mat_total, 2), "labor_total": round(lab_total, 2),
                "line_total": round(mat_total + lab_total, 2)}
        lines.append(line)
        materials_subtotal += mat_total
        labor_subtotal += lab_total

    base = materials_subtotal + labor_subtotal
    waste_amt = base * waste_pct / 100.0
    after_waste = base + waste_amt
    overhead_amt = after_waste * overhead_pct / 100.0
    after_overhead = after_waste + overhead_amt
    profit_amt = after_overhead * profit_pct / 100.0
    after_profit = after_overhead + profit_amt
    cont_amt = after_profit * cont_pct / 100.0
    grand_total = after_profit + cont_amt

    return {
        "lines": lines,
        "totals": {
            "materials_subtotal": round(materials_subtotal, 2),
            "labor_subtotal": round(labor_subtotal, 2),
            "base_subtotal": round(base, 2),
            "waste_amount": round(waste_amt, 2),
            "overhead_amount": round(overhead_amt, 2),
            "profit_amount": round(profit_amt, 2),
            "contingency_amount": round(cont_amt, 2),
            "grand_total": round(grand_total, 2),
            "applied_multiplier": round(mult, 3),
            "labor_multiplier": round(labor_mult, 3),
            "waste_pct": waste_pct,
            "overhead_pct": overhead_pct,
            "profit_pct": profit_pct,
            "contingency_pct": cont_pct,
        },
    }
