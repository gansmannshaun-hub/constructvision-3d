"""Pricing configuration + bid snapshot routes."""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from pricing import compute_bid, get_pricing_config
from pricing_data import resolve_zip
from routes.projects import get_or_create_blueprint
from routes.takeoff import _build_combined_materials
from utils import now_iso


class PricingPatchIn(BaseModel):
    zip: Optional[str] = None
    waste_pct: Optional[float] = Field(default=None, ge=0, le=50)
    overhead_pct: Optional[float] = Field(default=None, ge=0, le=50)
    profit_pct: Optional[float] = Field(default=None, ge=0, le=50)
    contingency_pct: Optional[float] = Field(default=None, ge=0, le=25)
    labor_rate_multiplier: Optional[float] = Field(default=None, ge=0.1, le=5.0)


class BidCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    notes: Optional[str] = ""


def build_pricing_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def _check_owner(project_id: str, user: dict) -> dict:
        proj = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
        if not proj:
            raise HTTPException(404, "Project not found")
        return proj

    @router.get("/projects/{project_id}/pricing")
    async def get_pricing(project_id: str, user: dict = Depends(get_current_user)):
        await _check_owner(project_id, user)
        cfg = await get_pricing_config(db, project_id)
        # Live compute totals
        mats = await _build_combined_materials(db, project_id)
        result = compute_bid(mats, cfg)
        return {"config": cfg, "totals": result["totals"]}

    @router.patch("/projects/{project_id}/pricing")
    async def patch_pricing(project_id: str, payload: PricingPatchIn, user: dict = Depends(get_current_user)):
        await _check_owner(project_id, user)
        update: dict = {}
        if payload.zip is not None:
            info = resolve_zip(payload.zip)
            update["zip"] = info["zip"]
            update["city"] = info["city"]
            update["state"] = info["state"]
            update["regional_multiplier"] = info["multiplier"]
            update["regional_source"] = info["source"]
        for field in ("waste_pct", "overhead_pct", "profit_pct", "contingency_pct", "labor_rate_multiplier"):
            val = getattr(payload, field)
            if val is not None:
                update[field] = float(val)
        if not update:
            raise HTTPException(400, "Nothing to update")
        update["updated_at"] = now_iso()
        update["project_id"] = project_id
        await db.pricing_configs.update_one(
            {"project_id": project_id},
            {"$set": update},
            upsert=True,
        )
        cfg = await get_pricing_config(db, project_id)
        mats = await _build_combined_materials(db, project_id)
        result = compute_bid(mats, cfg)
        return {"config": cfg, "totals": result["totals"]}

    # ---- Bid snapshots ----
    @router.get("/projects/{project_id}/bids")
    async def list_bids(project_id: str, user: dict = Depends(get_current_user)):
        await _check_owner(project_id, user)
        return await db.bids.find(
            {"project_id": project_id},
            {"_id": 0, "materials": 0},  # omit heavy snapshot from list
        ).sort("created_at", -1).to_list(50)

    @router.post("/projects/{project_id}/bids")
    async def create_bid(project_id: str, payload: BidCreateIn, user: dict = Depends(get_current_user)):
        await _check_owner(project_id, user)
        cfg = await get_pricing_config(db, project_id)
        mats = await _build_combined_materials(db, project_id)
        result = compute_bid(mats, cfg)
        existing = await db.bids.count_documents({"project_id": project_id})
        bid_doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "version": existing + 1,
            "name": payload.name.strip(),
            "notes": (payload.notes or "")[:500],
            "config_snapshot": cfg,
            "materials": mats,
            "totals": result["totals"],
            "created_at": now_iso(),
            "created_by": user.get("email"),
        }
        await db.bids.insert_one(bid_doc)
        try:
            from routes.collab import log_activity
            await log_activity(db, project_id, user.get("email", ""), "bid.saved",
                               target_type="bid", target_id=bid_doc["id"],
                               target_name=f"V{bid_doc['version']} {bid_doc['name']}")
        except Exception:
            pass
        bid_doc.pop("_id", None)
        return bid_doc

    @router.get("/projects/{project_id}/bids/{bid_id}")
    async def get_bid(project_id: str, bid_id: str, user: dict = Depends(get_current_user)):
        await _check_owner(project_id, user)
        bid = await db.bids.find_one({"id": bid_id, "project_id": project_id}, {"_id": 0})
        if not bid:
            raise HTTPException(404, "Bid not found")
        return bid

    @router.delete("/projects/{project_id}/bids/{bid_id}")
    async def delete_bid(project_id: str, bid_id: str, user: dict = Depends(get_current_user)):
        await _check_owner(project_id, user)
        await db.bids.delete_one({"id": bid_id, "project_id": project_id})
        return {"ok": True}

    @router.get("/projects/{project_id}/bids-diff")
    async def diff_bids(project_id: str, a: str, b: str, user: dict = Depends(get_current_user)):
        """Compare two bid snapshots line-by-line."""
        await _check_owner(project_id, user)
        bid_a = await db.bids.find_one({"id": a, "project_id": project_id}, {"_id": 0})
        bid_b = await db.bids.find_one({"id": b, "project_id": project_id}, {"_id": 0})
        if not bid_a or not bid_b:
            raise HTTPException(404, "Bid not found")
        # Build maps keyed by (category, name, unit)
        def key(m: dict) -> str:
            return f"{(m.get('category') or '').lower()}|{(m.get('name') or '').lower()}|{(m.get('unit') or '').lower()}"
        a_map = {key(m): m for m in (bid_a.get("materials") or [])}
        b_map = {key(m): m for m in (bid_b.get("materials") or [])}
        rows: list[dict] = []
        for k in sorted(set(a_map) | set(b_map)):
            ma, mb = a_map.get(k), b_map.get(k)
            ref = mb or ma
            qa = float((ma or {}).get("quantity") or 0)
            qb = float((mb or {}).get("quantity") or 0)
            pa = float((ma or {}).get("unit_price") or 0)
            pb = float((mb or {}).get("unit_price") or 0)
            la = float((ma or {}).get("labor_unit_price") or 0)
            lb = float((mb or {}).get("labor_unit_price") or 0)
            ta = qa * (pa + la) * float((bid_a.get("config_snapshot") or {}).get("regional_multiplier") or 1.0)
            tb = qb * (pb + lb) * float((bid_b.get("config_snapshot") or {}).get("regional_multiplier") or 1.0)
            if not ma:
                status = "added"
            elif not mb:
                status = "removed"
            elif abs(qa - qb) > 1e-6 or abs(pa - pb) > 1e-6 or abs(la - lb) > 1e-6:
                status = "changed"
            else:
                status = "same"
            rows.append({
                "name": ref.get("name"),
                "category": ref.get("category"),
                "unit": ref.get("unit"),
                "status": status,
                "a": {"quantity": qa, "unit_price": pa, "labor_unit_price": la, "total": round(ta, 2)},
                "b": {"quantity": qb, "unit_price": pb, "labor_unit_price": lb, "total": round(tb, 2)},
                "delta": round(tb - ta, 2),
            })
        return {
            "a": {"id": bid_a["id"], "name": bid_a["name"], "version": bid_a["version"], "totals": bid_a["totals"]},
            "b": {"id": bid_b["id"], "name": bid_b["name"], "version": bid_b["version"], "totals": bid_b["totals"]},
            "rows": rows,
            "totals_delta": {
                k: round(float(bid_b["totals"].get(k, 0)) - float(bid_a["totals"].get(k, 0)), 2)
                for k in ("materials_subtotal", "labor_subtotal", "base_subtotal",
                          "waste_amount", "overhead_amount", "profit_amount",
                          "contingency_amount", "grand_total")
            },
        }

    return router
