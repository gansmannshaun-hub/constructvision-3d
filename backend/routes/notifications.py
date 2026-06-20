"""Email digests via Resend.

Daily activity-feed digest for project members.

Scope (per user preference confirmed with PM):
  - Only events on projects the user OWNS or is PM on (no viewer-only)
  - Only events authored by OTHER users (skip self-actions)
  - Past 24h

Send time: 08:00 UTC. The dispatch loop is started in server.py
on FastAPI startup via `start_digest_scheduler`.

If RESEND_API_KEY is empty (sandbox / dev), sending is logged but skipped
gracefully — the rest of the app remains operational.

Endpoints:
  POST /api/notifications/test-digest   — manually trigger your own digest now
  GET  /api/notifications/digest-preview — render the HTML without sending
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import resend
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger("digest")

DIGEST_HOUR_UTC = 8  # 08:00 UTC daily
DIGEST_ROLES = {"owner", "pm"}  # scope filter (option "d" — owner/pm only)


# ============================ Resend ============================

def _resend_key() -> str:
    return os.environ.get("RESEND_API_KEY", "").strip()


def _sender() -> str:
    return os.environ.get("RESEND_FROM", "").strip() or "onboarding@resend.dev"


def _is_configured() -> bool:
    return bool(_resend_key())


async def send_html_email(to: str, subject: str, html_body: str) -> dict:
    """Send a single HTML email. Returns {sent, id?, error?}."""
    if not _is_configured():
        logger.warning("RESEND_API_KEY missing — email skipped: to=%s subject=%r", to, subject)
        return {"sent": False, "error": "Email service not configured"}
    resend.api_key = _resend_key()
    params = {
        "from": _sender(),
        "to": [to],
        "subject": subject,
        "html": html_body,
    }
    try:
        result = await asyncio.to_thread(resend.Emails.send, params)
        return {"sent": True, "id": result.get("id")}
    except Exception as exc:  # noqa: BLE001
        logger.error("Resend send failed: %s", exc)
        return {"sent": False, "error": str(exc)[:200]}


# ============================ Digest content ============================

def _fmt_action(action: str) -> str:
    return {
        "material.created": "added a material",
        "material.updated": "edited a material",
        "material.deleted": "removed a material",
        "document.uploaded": "uploaded a document",
        "document.deleted": "removed a document",
        "blueprint.saved": "saved the blueprint",
        "bid.created": "saved a new bid",
        "bid.deleted": "deleted a bid",
        "site.captured": "captured a site",
        "member.added": "invited a teammate",
        "member.removed": "removed a teammate",
        "daily_log.created": "filed a daily log",
        "site_photo.uploaded": "uploaded a site photo",
        "lidar.uploaded": "uploaded a LiDAR scan",
        "ai.floorplan_generated": "AI-sketched a floor plan",
    }.get(action, action.replace("_", " "))


def _render_digest_html(user_name: str, day_label: str,
                        per_project: list[dict],
                        empty: bool) -> str:
    """Inline-styled HTML matching app's dark aesthetic. Tables for layout."""
    safe_name = html.escape(user_name or "there")
    safe_day = html.escape(day_label)

    if empty:
        body_blocks = """
          <tr><td style="padding:24px 32px;color:#999;font-family:monospace;font-size:13px;line-height:1.6;">
            Quiet day — nothing new on your projects in the last 24 hours.
          </td></tr>
        """
    else:
        rows = []
        for proj in per_project:
            pname = html.escape(proj["name"])
            evt_rows = []
            for evt in proj["events"][:20]:
                actor = html.escape(evt["actor"])
                action = html.escape(_fmt_action(evt["action"]))
                target = html.escape(evt.get("target_name") or "")
                ts = html.escape(evt["when"])
                target_html = f'&nbsp;<span style="color:#bbb">{target}</span>' if target else ""
                evt_rows.append(f"""
                  <tr><td style="padding:6px 0;border-bottom:1px solid #1a1a1a;color:#ddd;font-family:monospace;font-size:12px;">
                    <span style="color:#FFCC00">{actor}</span> {action}{target_html}
                    <span style="color:#555;float:right">{ts}</span>
                  </td></tr>
                """)
            evt_html = "".join(evt_rows)
            more_html = ""
            if len(proj["events"]) > 20:
                more_html = (
                    f'<tr><td style="padding-top:6px;color:#666;font-family:monospace;font-size:11px;">'
                    f'+ {len(proj["events"]) - 20} more</td></tr>'
                )
            rows.append(f"""
              <tr><td style="padding:20px 32px 8px;">
                <div style="font-family:'Georgia',serif;font-size:18px;color:#fff;letter-spacing:-0.5px;margin-bottom:10px;">
                  {pname}
                </div>
                <table width="100%" cellpadding="0" cellspacing="0">{evt_html}{more_html}</table>
              </td></tr>
            """)
        body_blocks = "".join(rows)

    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Daily digest</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#eee;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#0f0f0f;border:1px solid #1f1f1f;">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #1f1f1f;">
        <div style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#FFCC00;text-transform:uppercase;">
          // ATLAS · DAILY DIGEST
        </div>
        <div style="font-family:'Georgia',serif;font-size:26px;color:#fff;letter-spacing:-0.8px;margin-top:4px;">
          Hey {safe_name}, here&apos;s what shipped {safe_day}.
        </div>
      </td></tr>
      {body_blocks}
      <tr><td style="padding:24px 32px;border-top:1px solid #1f1f1f;color:#555;font-family:monospace;font-size:11px;line-height:1.6;">
        You receive this because daily digest is enabled in your notification preferences.<br>
        Adjust at <a href="#" style="color:#FFCC00;text-decoration:none;">app settings → notifications</a>.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>"""


# ============================ Data gathering ============================

async def _gather_user_digest(db, user_email: str) -> dict:
    """Return {per_project:[{id,name,events:[]}], total_events, empty}."""
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    since_iso = since.isoformat()

    # 1. Projects user OWNS or is PM on.
    pm_rows = await db.project_members.find(
        {"user_email": user_email, "role": {"$in": list(DIGEST_ROLES)}, "accepted": True},
        {"_id": 0, "project_id": 1},
    ).to_list(500)
    owned_rows = await db.projects.find(
        {"user_email": user_email}, {"_id": 0, "id": 1},
    ).to_list(500)
    user_doc = await db.users.find_one({"email": user_email}, {"_id": 0, "id": 1, "name": 1})
    if user_doc:
        owned_rows = owned_rows + await db.projects.find(
            {"user_id": user_doc["id"]}, {"_id": 0, "id": 1},
        ).to_list(500)
    project_ids = list({r["project_id"] for r in pm_rows} |
                       {r["id"] for r in owned_rows})
    if not project_ids:
        return {"per_project": [], "total_events": 0, "empty": True,
                "user_name": user_doc.get("name") if user_doc else ""}

    # 2. Activities in those projects in last 24h, not by self.
    acts = await db.activity_log.find(
        {"project_id": {"$in": project_ids},
         "user_email": {"$ne": user_email},
         "created_at": {"$gte": since_iso}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)

    if not acts:
        return {"per_project": [], "total_events": 0, "empty": True,
                "user_name": user_doc.get("name") if user_doc else ""}

    # 3. Project name lookup.
    projects = await db.projects.find(
        {"id": {"$in": project_ids}}, {"_id": 0, "id": 1, "name": 1},
    ).to_list(len(project_ids))
    name_map = {p["id"]: p["name"] for p in projects}

    # 4. Group by project, keep order.
    by_project: dict[str, dict] = {}
    for a in acts:
        pid = a["project_id"]
        bucket = by_project.setdefault(pid, {
            "id": pid,
            "name": name_map.get(pid, "(unknown project)"),
            "events": [],
        })
        ts = a.get("created_at", "")
        when = ts[11:16] if len(ts) >= 16 else ts  # HH:MM
        bucket["events"].append({
            "actor": a.get("user_email", "someone"),
            "action": a.get("action", ""),
            "target_name": a.get("target_name") or a.get("details") or "",
            "when": when,
        })

    return {
        "per_project": list(by_project.values()),
        "total_events": len(acts),
        "empty": False,
        "user_name": user_doc.get("name") if user_doc else "",
    }


async def send_daily_digest_for_user(db, user_email: str) -> dict:
    """Build and send the digest for one user. Returns {sent, total_events, empty, error?}."""
    bundle = await _gather_user_digest(db, user_email)
    yesterday = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%A %b %-d")
    html_body = _render_digest_html(
        user_name=bundle.get("user_name") or "there",
        day_label=yesterday,
        per_project=bundle["per_project"],
        empty=bundle["empty"],
    )
    subject = "Atlas · daily digest" if bundle["empty"] else f"Atlas · {bundle['total_events']} updates yesterday"
    result = await send_html_email(user_email, subject, html_body)
    return {**result, "total_events": bundle["total_events"], "empty": bundle["empty"]}


async def send_daily_digest_for_all(db) -> dict:
    """Iterate every user that has email_daily_digest=True and send."""
    cursor = db.users.find(
        {"notifications.email_daily_digest": {"$ne": False}},
        {"_id": 0, "email": 1},
    )
    sent = 0
    skipped = 0
    failed = 0
    async for u in cursor:
        email_addr = u.get("email")
        if not email_addr:
            continue
        try:
            r = await send_daily_digest_for_user(db, email_addr)
            if r.get("sent"):
                sent += 1
            else:
                skipped += 1
        except Exception:  # noqa: BLE001
            logger.exception("digest failed for %s", email_addr)
            failed += 1
    return {"sent": sent, "skipped": skipped, "failed": failed,
            "ran_at": datetime.now(timezone.utc).isoformat()}


# ============================ Scheduler ============================

_scheduler_task: Optional[asyncio.Task] = None


async def _scheduler_loop(db):
    """Tick once a minute; when UTC hour == DIGEST_HOUR_UTC and we haven't sent
    yet today, fire the digest run."""
    last_run_day: Optional[str] = None
    while True:
        try:
            now = datetime.now(timezone.utc)
            today = now.date().isoformat()
            if now.hour == DIGEST_HOUR_UTC and last_run_day != today:
                last_run_day = today
                logger.info("Digest tick — running daily digest")
                await send_daily_digest_for_all(db)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Digest scheduler tick failed")
        await asyncio.sleep(60)


def start_digest_scheduler(db) -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running loop — digest scheduler not started")
        return
    _scheduler_task = loop.create_task(_scheduler_loop(db))
    logger.info("Digest scheduler started (sends at %02d:00 UTC daily)", DIGEST_HOUR_UTC)


def stop_digest_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task:
        _scheduler_task.cancel()
        _scheduler_task = None


# ============================ Router ============================

class TestEmailIn(BaseModel):
    to: Optional[str] = None  # if missing, defaults to caller's email


def build_notifications_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api/notifications")

    @router.get("/digest-preview")
    async def digest_preview(user: dict = Depends(get_current_user)):
        """Render the current user's digest HTML without sending."""
        bundle = await _gather_user_digest(db, user["email"])
        yesterday = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%A %b %-d")
        html_body = _render_digest_html(
            user_name=bundle.get("user_name") or "there",
            day_label=yesterday,
            per_project=bundle["per_project"],
            empty=bundle["empty"],
        )
        return {
            "html": html_body,
            "subject": "Atlas · daily digest" if bundle["empty"] else f"Atlas · {bundle['total_events']} updates yesterday",
            "total_events": bundle["total_events"],
            "empty": bundle["empty"],
            "configured": _is_configured(),
        }

    @router.post("/test-digest")
    async def test_digest(payload: TestEmailIn,
                          user: dict = Depends(get_current_user)):
        """Send the digest right now to the caller (or to payload.to)."""
        to = (payload.to or user["email"]).strip().lower()
        if not _is_configured():
            raise HTTPException(503, "Email service not configured — set RESEND_API_KEY in backend/.env")
        result = await send_daily_digest_for_user(db, to)
        return result

    @router.post("/run-all")
    async def run_all(user: dict = Depends(get_current_user)):
        """Admin-only: trigger the full digest run NOW."""
        if not user.get("is_admin"):
            raise HTTPException(403, "Admins only")
        if not _is_configured():
            raise HTTPException(503, "Email service not configured")
        return await send_daily_digest_for_all(db)

    @router.get("/status")
    async def status():
        return {
            "configured": _is_configured(),
            "sender": _sender(),
            "scheduler_running": bool(_scheduler_task and not _scheduler_task.done()),
            "digest_hour_utc": DIGEST_HOUR_UTC,
        }

    return router
