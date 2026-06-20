"""AIA G702 / G703 Payment Application generator.

Endpoints:
  POST   /api/projects/{id}/pay-apps               create (auto-populates from latest bid)
  GET    /api/projects/{id}/pay-apps               list
  GET    /api/pay-apps/{id}                        get one with line items
  PATCH  /api/pay-apps/{id}                        update header / line items / retainage
  DELETE /api/pay-apps/{id}                        delete
  GET    /api/pay-apps/{id}.pdf                    render G702 cover + G703 continuation

G702 = Application & Certificate for Payment (cover sheet, totals).
G703 = Continuation Sheet (line-item schedule of values).

Data model (Mongo collection: pay_apps)
  id: uuid
  project_id: str
  app_number: int          (incrementing per project, 1 = first app)
  period_to: ISO date
  period_from: ISO date
  contractor: str          (free text — project owner's company)
  owner_name: str          (free text — building owner)
  architect_name: str      (free text)
  retainage_pct: float     (default 10.0)
  source_bid_id: str | "" (optional anchor)
  line_items: [{
    item_no: int, description: str, scheduled_value: float,
    work_completed_previous: float, work_completed_this_period: float,
    materials_stored: float, retainage: float (computed),
  }]
  created_at / updated_at / created_by
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from routes.collab import log_activity, require_role
from utils import now_iso

logger = logging.getLogger("pay-apps")


# ============================ Pydantic ============================

class LineItemIn(BaseModel):
    item_no: int
    description: str = Field(max_length=120)
    scheduled_value: float = Field(ge=0)
    work_completed_previous: float = Field(default=0, ge=0)
    work_completed_this_period: float = Field(default=0, ge=0)
    materials_stored: float = Field(default=0, ge=0)


class PayAppCreate(BaseModel):
    period_to: Optional[str] = None
    period_from: Optional[str] = None
    contractor: str = Field(default="", max_length=120)
    owner_name: str = Field(default="", max_length=120)
    architect_name: str = Field(default="", max_length=120)
    retainage_pct: float = Field(default=10.0, ge=0, le=20)
    source_bid_id: Optional[str] = None


class PayAppPatch(BaseModel):
    period_to: Optional[str] = None
    period_from: Optional[str] = None
    contractor: Optional[str] = None
    owner_name: Optional[str] = None
    architect_name: Optional[str] = None
    retainage_pct: Optional[float] = Field(default=None, ge=0, le=20)
    line_items: Optional[list[LineItemIn]] = None


# ============================ Helpers ============================

def _round2(v: float) -> float:
    return round(float(v), 2)


def _compute_line(item: dict, retainage_pct: float) -> dict:
    sv = float(item.get("scheduled_value") or 0)
    prev = float(item.get("work_completed_previous") or 0)
    this = float(item.get("work_completed_this_period") or 0)
    stored = float(item.get("materials_stored") or 0)
    total = prev + this + stored
    pct = (total / sv * 100) if sv > 0 else 0
    retainage = total * (retainage_pct / 100.0)
    balance = max(sv - total, 0)
    return {
        **item,
        "total_completed_and_stored": _round2(total),
        "percent_complete": _round2(pct),
        "balance_to_finish": _round2(balance),
        "retainage": _round2(retainage),
    }


def _aggregate(line_items: list[dict], retainage_pct: float) -> dict:
    sv_total = sum(li["scheduled_value"] for li in line_items)
    completed = sum(
        li["work_completed_previous"] + li["work_completed_this_period"] + li["materials_stored"]
        for li in line_items
    )
    retainage = completed * (retainage_pct / 100.0)
    balance = sv_total - completed
    return {
        "original_contract_sum": _round2(sv_total),
        "total_completed_and_stored": _round2(completed),
        "percent_complete": _round2((completed / sv_total * 100) if sv_total > 0 else 0),
        "total_retainage": _round2(retainage),
        "total_less_retainage": _round2(completed - retainage),
        "balance_to_finish_including_retainage": _round2(balance + retainage),
    }


async def _next_app_number(db, project_id: str) -> int:
    last = await db.pay_apps.find(
        {"project_id": project_id}, {"_id": 0, "app_number": 1},
    ).sort("app_number", -1).to_list(1)
    return (last[0]["app_number"] + 1) if last else 1


async def _populate_from_bid(db, project_id: str, source_bid_id: str | None) -> list[dict]:
    """Pull line items from the chosen bid OR the latest bid OR project materials."""
    bid = None
    if source_bid_id:
        bid = await db.bids.find_one({"id": source_bid_id, "project_id": project_id}, {"_id": 0})
    if not bid:
        bid = await db.bids.find_one(
            {"project_id": project_id}, {"_id": 0},
            sort=[("created_at", -1)],
        )
    materials = (bid or {}).get("snapshot_materials") or []
    if not materials:
        materials = await db.materials.find(
            {"project_id": project_id}, {"_id": 0},
        ).to_list(500)

    cfg = (bid or {}).get("config_snapshot") or {}
    region_mult = float(cfg.get("regional_multiplier") or 1.0)

    items = []
    for i, m in enumerate(materials, start=1):
        qty = float(m.get("quantity") or 0)
        unit_price = float(m.get("unit_price") or 0)
        labor_price = float(m.get("labor_unit_price") or 0)
        sv = qty * (unit_price + labor_price) * region_mult
        if sv <= 0:
            continue
        cat = m.get("category") or ""
        name = m.get("name") or ""
        desc = f"{cat} — {name}" if cat and name else (name or cat or "Line item")
        items.append({
            "item_no": i,
            "description": desc[:120],
            "scheduled_value": _round2(sv),
            "work_completed_previous": 0,
            "work_completed_this_period": 0,
            "materials_stored": 0,
        })
    return items


# ============================ PDF rendering ============================

def _render_pdf(pay_app: dict, project_name: str) -> bytes:
    """Render a G702 cover + G703 continuation in landscape PDF."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter, landscape
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
    )

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(letter),
        leftMargin=0.4 * inch, rightMargin=0.4 * inch,
        topMargin=0.4 * inch, bottomMargin=0.4 * inch,
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=14, alignment=0)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=10, alignment=0)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=8, leading=10)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=7, leading=8, textColor=colors.grey)

    elements = []
    agg = _aggregate(pay_app["line_items"], pay_app["retainage_pct"])

    # ========= G702 Cover =========
    elements.append(Paragraph("APPLICATION AND CERTIFICATE FOR PAYMENT — AIA G702", h1))
    elements.append(Paragraph(f"<b>Project:</b> {project_name} · <b>Application No:</b> {pay_app['app_number']} · "
                              f"<b>Period to:</b> {pay_app.get('period_to', '—')}", h2))
    elements.append(Spacer(1, 0.15 * inch))

    info_data = [
        ["TO OWNER:", pay_app.get("owner_name", "—") or "—",
         "FROM CONTRACTOR:", pay_app.get("contractor", "—") or "—"],
        ["VIA ARCHITECT:", pay_app.get("architect_name", "—") or "—",
         "CONTRACT DATE:", pay_app.get("period_from", "—") or "—"],
    ]
    t = Table(info_data, colWidths=[1.2 * inch, 3.5 * inch, 1.4 * inch, 3.5 * inch])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
        ("FONT", (2, 0), (2, -1), "Helvetica-Bold", 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 0.3 * inch))

    # Summary
    summary_data = [
        ["1. ORIGINAL CONTRACT SUM", f"${agg['original_contract_sum']:,.2f}"],
        ["2. NET CHANGE BY CHANGE ORDERS", "$0.00"],
        ["3. CONTRACT SUM TO DATE (Line 1 ± 2)", f"${agg['original_contract_sum']:,.2f}"],
        ["4. TOTAL COMPLETED & STORED TO DATE (G703 Col. G)", f"${agg['total_completed_and_stored']:,.2f}"],
        ["5. RETAINAGE ({:.1f}% of completed)".format(pay_app["retainage_pct"]), f"${agg['total_retainage']:,.2f}"],
        ["6. TOTAL EARNED LESS RETAINAGE (Line 4 - Line 5)", f"${agg['total_less_retainage']:,.2f}"],
        ["7. LESS PREVIOUS CERTIFICATES FOR PAYMENT", "$0.00"],
        ["8. CURRENT PAYMENT DUE", f"${agg['total_less_retainage']:,.2f}"],
        ["9. BALANCE TO FINISH INCLUDING RETAINAGE", f"${agg['balance_to_finish_including_retainage']:,.2f}"],
    ]
    t = Table(summary_data, colWidths=[5 * inch, 1.8 * inch])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("BACKGROUND", (0, 7), (-1, 7), colors.HexColor("#FFE066")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 0.3 * inch))

    elements.append(Paragraph(
        "<b>CONTRACTOR'S CERTIFICATION:</b> The undersigned Contractor certifies that to the best "
        "of the Contractor's knowledge, information and belief the Work covered by this Application "
        "for Payment has been completed in accordance with the Contract Documents, that all amounts "
        "have been paid by the Contractor for Work for which previous Certificates for Payment were "
        "issued and payments received from the Owner, and that current payment shown herein is now "
        "due.", body))
    elements.append(Spacer(1, 0.3 * inch))
    sig_data = [
        ["CONTRACTOR:", "By:", "Date:"],
        ["", "", ""],
        ["ARCHITECT'S CERTIFICATE FOR PAYMENT:", "", ""],
        ["Amount Certified:", f"${agg['total_less_retainage']:,.2f}", ""],
        ["ARCHITECT:", "By:", "Date:"],
    ]
    t = Table(sig_data, colWidths=[2.5 * inch, 4 * inch, 2 * inch])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9),
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 9),
        ("LINEBELOW", (1, 0), (1, 0), 0.5, colors.black),
        ("LINEBELOW", (2, 0), (2, 0), 0.5, colors.black),
        ("LINEBELOW", (1, 4), (1, 4), 0.5, colors.black),
        ("LINEBELOW", (2, 4), (2, 4), 0.5, colors.black),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
    ]))
    elements.append(t)

    # ========= G703 Continuation =========
    elements.append(PageBreak())
    elements.append(Paragraph("CONTINUATION SHEET — AIA G703", h1))
    elements.append(Paragraph(f"<b>Application No:</b> {pay_app['app_number']} · "
                              f"<b>Period to:</b> {pay_app.get('period_to', '—')}", h2))
    elements.append(Spacer(1, 0.15 * inch))

    header = [
        ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
        ["Item No.", "Description of Work", "Scheduled Value",
         "Work Completed\nFrom Previous\nApplication", "Work Completed\nThis Period",
         "Materials Presently\nStored", "Total Completed\n& Stored to Date\n(D+E+F)",
         "%\n(G/C)", "Balance to Finish\n(C-G)"],
    ]
    rows = [header[1]]
    for li in pay_app["line_items"]:
        c = _compute_line(li, pay_app["retainage_pct"])
        rows.append([
            str(c["item_no"]),
            c["description"],
            f"${c['scheduled_value']:,.2f}",
            f"${c['work_completed_previous']:,.2f}",
            f"${c['work_completed_this_period']:,.2f}",
            f"${c['materials_stored']:,.2f}",
            f"${c['total_completed_and_stored']:,.2f}",
            f"{c['percent_complete']:.1f}%",
            f"${c['balance_to_finish']:,.2f}",
        ])
    rows.append([
        "", "GRAND TOTALS",
        f"${agg['original_contract_sum']:,.2f}",
        f"${sum(li['work_completed_previous'] for li in pay_app['line_items']):,.2f}",
        f"${sum(li['work_completed_this_period'] for li in pay_app['line_items']):,.2f}",
        f"${sum(li['materials_stored'] for li in pay_app['line_items']):,.2f}",
        f"${agg['total_completed_and_stored']:,.2f}",
        f"{agg['percent_complete']:.1f}%",
        f"${agg['original_contract_sum'] - agg['total_completed_and_stored']:,.2f}",
    ])

    t = Table(rows, colWidths=[0.4*inch, 3.0*inch, 0.95*inch, 1.1*inch, 1.0*inch,
                               1.0*inch, 1.1*inch, 0.5*inch, 1.0*inch])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 7.5),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (7, 0), (7, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F1F1F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#FFE066")),
        ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 8),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(t)

    doc.build(elements)
    buf.seek(0)
    return buf.read()


# ============================ Router ============================

def build_pay_apps_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def _get_app(app_id: str, user: dict) -> dict:
        doc = await db.pay_apps.find_one({"id": app_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Pay app not found")
        await require_role(db, doc["project_id"], user, {"owner", "pm", "estimator", "viewer"})
        return doc

    @router.get("/projects/{project_id}/pay-apps")
    async def list_pay_apps(project_id: str, user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator", "viewer"})
        rows = await db.pay_apps.find(
            {"project_id": project_id}, {"_id": 0, "line_items": 0},
        ).sort("app_number", -1).to_list(50)
        return rows

    @router.post("/projects/{project_id}/pay-apps")
    async def create_pay_app(project_id: str, payload: PayAppCreate,
                             user: dict = Depends(get_current_user)):
        await require_role(db, project_id, user, {"owner", "pm", "estimator"})
        items = await _populate_from_bid(db, project_id, payload.source_bid_id)
        if not items:
            raise HTTPException(422, "No bid or materials found — add line items by saving a bid first.")
        app_no = await _next_app_number(db, project_id)
        today_iso = datetime.now(timezone.utc).date().isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "app_number": app_no,
            "period_to": payload.period_to or today_iso,
            "period_from": payload.period_from or today_iso,
            "contractor": payload.contractor,
            "owner_name": payload.owner_name,
            "architect_name": payload.architect_name,
            "retainage_pct": payload.retainage_pct,
            "source_bid_id": payload.source_bid_id or "",
            "line_items": items,
            "created_by": user["email"],
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.pay_apps.insert_one(doc)
        doc.pop("_id", None)
        await log_activity(db, project_id, user["email"], "pay_app.created",
                           target_type="pay_app", target_id=doc["id"],
                           target_name=f"#{app_no}")
        return doc

    @router.get("/pay-apps/{app_id}")
    async def get_pay_app(app_id: str, user: dict = Depends(get_current_user)):
        doc = await _get_app(app_id, user)
        # Compute totals on the way out so the UI doesn't have to.
        doc["line_items"] = [_compute_line(li, doc["retainage_pct"]) for li in doc["line_items"]]
        doc["aggregate"] = _aggregate(doc["line_items"], doc["retainage_pct"])
        return doc

    @router.patch("/pay-apps/{app_id}")
    async def patch_pay_app(app_id: str, payload: PayAppPatch,
                            user: dict = Depends(get_current_user)):
        doc = await _get_app(app_id, user)
        update = {}
        for k in ("period_to", "period_from", "contractor", "owner_name",
                  "architect_name", "retainage_pct"):
            v = getattr(payload, k)
            if v is not None:
                update[k] = v
        if payload.line_items is not None:
            update["line_items"] = [li.model_dump() for li in payload.line_items]
        update["updated_at"] = now_iso()
        await db.pay_apps.update_one({"id": app_id}, {"$set": update})
        await log_activity(db, doc["project_id"], user["email"], "pay_app.updated",
                           target_type="pay_app", target_id=app_id,
                           target_name=f"#{doc['app_number']}")
        fresh = await db.pay_apps.find_one({"id": app_id}, {"_id": 0})
        fresh["line_items"] = [_compute_line(li, fresh["retainage_pct"]) for li in fresh["line_items"]]
        fresh["aggregate"] = _aggregate(fresh["line_items"], fresh["retainage_pct"])
        return fresh

    @router.delete("/pay-apps/{app_id}")
    async def delete_pay_app(app_id: str, user: dict = Depends(get_current_user)):
        doc = await _get_app(app_id, user)
        await require_role(db, doc["project_id"], user, {"owner", "pm"})
        await db.pay_apps.delete_one({"id": app_id})
        await log_activity(db, doc["project_id"], user["email"], "pay_app.deleted",
                           target_type="pay_app", target_id=app_id,
                           target_name=f"#{doc['app_number']}")
        return {"ok": True}

    @router.get("/pay-apps/{app_id}/pdf")
    async def pay_app_pdf(app_id: str, user: dict = Depends(get_current_user)):
        doc = await _get_app(app_id, user)
        proj = await db.projects.find_one({"id": doc["project_id"]}, {"_id": 0, "name": 1})
        pdf = _render_pdf(doc, (proj or {}).get("name", "Project"))
        return StreamingResponse(
            BytesIO(pdf),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="payapp_{doc["app_number"]}.pdf"'},
        )

    return router
