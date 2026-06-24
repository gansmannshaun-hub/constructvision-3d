"""In-app support messaging — users talk to admin, admin replies, with
email notifications via Resend (when configured) and optional file
attachments (stored as base64 inside Mongo for simplicity)."""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from routes.notifications import send_html_email

logger = logging.getLogger("support")

MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_BODY_LEN = 5000
ALLOWED_ATTACHMENT_TYPES = {
    "image/png", "image/jpeg", "image/webp", "image/gif",
    "application/pdf",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _admin_email() -> str:
    return os.environ.get("ADMIN_EMAIL", "admin@atlas.app").strip()


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=MAX_BODY_LEN)


class ThreadPatchIn(BaseModel):
    status: Optional[str] = Field(default=None, pattern=r"^(open|closed)$")
    subject: Optional[str] = Field(default=None, max_length=120)


def build_support_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api/support")

    async def _require_admin(user: dict):
        if not user.get("is_admin"):
            raise HTTPException(403, "Admin only")

    async def _get_or_create_user_thread(user: dict) -> dict:
        """Find the user's open thread, or create a new one."""
        existing = await db.support_threads.find_one(
            {"user_id": user["id"], "status": "open"},
            {"_id": 0},
        )
        if existing:
            return existing
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "user_email": user.get("email"),
            "user_name": user.get("name") or user.get("email"),
            "subject": None,
            "status": "open",
            "unread_admin": 0,
            "unread_user": 0,
            "message_count": 0,
            "last_message_preview": "",
            "last_message_at": None,
            "created_at": _now_iso(),
        }
        await db.support_threads.insert_one(doc)
        doc.pop("_id", None)
        return doc

    # ------------ User-facing ------------

    @router.get("/me/thread")
    async def my_thread(user: dict = Depends(get_current_user)):
        """Return the current user's support thread (auto-creates one)."""
        t = await _get_or_create_user_thread(user)
        return t

    @router.get("/me/unread")
    async def my_unread(user: dict = Depends(get_current_user)):
        t = await db.support_threads.find_one(
            {"user_id": user["id"], "status": "open"},
            {"_id": 0, "unread_user": 1},
        )
        return {"unread": int((t or {}).get("unread_user", 0))}

    @router.get("/threads/{thread_id}/messages")
    async def list_messages(thread_id: str, user: dict = Depends(get_current_user)):
        t = await db.support_threads.find_one({"id": thread_id}, {"_id": 0})
        if not t:
            raise HTTPException(404, "Thread not found")
        if not user.get("is_admin") and t["user_id"] != user["id"]:
            raise HTTPException(403, "Forbidden")
        cur = db.support_messages.find(
            {"thread_id": thread_id},
            {"_id": 0, "attachments.data_b64": 0},  # strip large blobs from list
        ).sort("created_at", 1)
        messages = await cur.to_list(length=500)
        return {"thread": t, "messages": messages}

    @router.post("/threads/{thread_id}/messages")
    async def post_message(thread_id: str,
                           payload: MessageIn,
                           user: dict = Depends(get_current_user)):
        thread = await db.support_threads.find_one({"id": thread_id}, {"_id": 0})
        if not thread:
            raise HTTPException(404, "Thread not found")
        is_admin = bool(user.get("is_admin"))
        if not is_admin and thread["user_id"] != user["id"]:
            raise HTTPException(403, "Forbidden")
        if thread.get("status") == "closed" and not is_admin:
            raise HTTPException(400, "This thread is closed. Reopen by starting a new conversation.")

        sender_role = "admin" if is_admin else "user"
        msg = {
            "id": str(uuid.uuid4()),
            "thread_id": thread_id,
            "sender": sender_role,
            "sender_id": user["id"],
            "sender_name": user.get("name") or user.get("email"),
            "sender_email": user.get("email"),
            "body": payload.body.strip(),
            "attachments": [],
            "created_at": _now_iso(),
        }
        await db.support_messages.insert_one(msg)
        msg.pop("_id", None)

        # Update thread metadata + unread counters
        update = {
            "$set": {
                "last_message_at": msg["created_at"],
                "last_message_preview": msg["body"][:140],
                "status": "open",  # reopen on new message
            },
            "$inc": {"message_count": 1},
        }
        # Increment the OTHER side's unread counter
        if sender_role == "user":
            update["$inc"]["unread_admin"] = 1
        else:
            update["$inc"]["unread_user"] = 1
        await db.support_threads.update_one({"id": thread_id}, update)

        # Fire email notification (best-effort, no await blocking the response)
        try:
            await _notify_email(thread, msg, sender_role)
        except Exception as exc:  # noqa: BLE001
            logger.warning("support email notify failed: %s", exc)

        return msg

    @router.post("/threads/{thread_id}/read")
    async def mark_read(thread_id: str, user: dict = Depends(get_current_user)):
        thread = await db.support_threads.find_one({"id": thread_id}, {"_id": 0})
        if not thread:
            raise HTTPException(404, "Thread not found")
        is_admin = bool(user.get("is_admin"))
        if not is_admin and thread["user_id"] != user["id"]:
            raise HTTPException(403, "Forbidden")
        field = "unread_admin" if is_admin else "unread_user"
        await db.support_threads.update_one(
            {"id": thread_id}, {"$set": {field: 0}},
        )
        return {"ok": True}

    @router.post("/threads/{thread_id}/attachments")
    async def upload_attachment(thread_id: str,
                                file: UploadFile = File(...),
                                body: str = Form(""),
                                user: dict = Depends(get_current_user)):
        """Upload a file attachment with optional body text — creates a new
        message containing the attachment."""
        thread = await db.support_threads.find_one({"id": thread_id}, {"_id": 0})
        if not thread:
            raise HTTPException(404, "Thread not found")
        is_admin = bool(user.get("is_admin"))
        if not is_admin and thread["user_id"] != user["id"]:
            raise HTTPException(403, "Forbidden")
        if file.content_type not in ALLOWED_ATTACHMENT_TYPES:
            raise HTTPException(400,
                f"Unsupported file type: {file.content_type}. "
                f"Allowed: {', '.join(sorted(ALLOWED_ATTACHMENT_TYPES))}")
        raw = await file.read()
        if len(raw) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(400, f"File too large (max {MAX_ATTACHMENT_BYTES // (1024*1024)} MB)")

        att = {
            "id": str(uuid.uuid4()),
            "filename": (file.filename or "attachment")[:120],
            "content_type": file.content_type,
            "size": len(raw),
            "data_b64": base64.b64encode(raw).decode("ascii"),
        }
        sender_role = "admin" if is_admin else "user"
        msg = {
            "id": str(uuid.uuid4()),
            "thread_id": thread_id,
            "sender": sender_role,
            "sender_id": user["id"],
            "sender_name": user.get("name") or user.get("email"),
            "sender_email": user.get("email"),
            "body": (body or "").strip()[:MAX_BODY_LEN],
            "attachments": [att],
            "created_at": _now_iso(),
        }
        await db.support_messages.insert_one(msg)

        update = {
            "$set": {
                "last_message_at": msg["created_at"],
                "last_message_preview": (msg["body"] or f"📎 {att['filename']}")[:140],
                "status": "open",
            },
            "$inc": {"message_count": 1},
        }
        if sender_role == "user":
            update["$inc"]["unread_admin"] = 1
        else:
            update["$inc"]["unread_user"] = 1
        await db.support_threads.update_one({"id": thread_id}, update)

        try:
            await _notify_email(thread, msg, sender_role)
        except Exception as exc:  # noqa: BLE001
            logger.warning("support attachment email notify failed: %s", exc)

        # Strip the b64 blob from the response (the file list endpoint also strips it)
        msg_out = {**msg, "attachments": [{k: v for k, v in att.items() if k != "data_b64"}]}
        msg_out.pop("_id", None)
        return msg_out

    @router.get("/attachments/{attachment_id}")
    async def get_attachment(attachment_id: str,
                             user: dict = Depends(get_current_user)):
        """Stream a single attachment back as base64 + content_type."""
        msg = await db.support_messages.find_one(
            {"attachments.id": attachment_id}, {"_id": 0},
        )
        if not msg:
            raise HTTPException(404, "Attachment not found")
        thread = await db.support_threads.find_one({"id": msg["thread_id"]}, {"_id": 0})
        if not thread:
            raise HTTPException(404, "Thread not found")
        if not user.get("is_admin") and thread["user_id"] != user["id"]:
            raise HTTPException(403, "Forbidden")
        att = next((a for a in msg.get("attachments", []) if a.get("id") == attachment_id), None)
        if not att:
            raise HTTPException(404, "Attachment record missing")
        return {
            "id": att["id"],
            "filename": att["filename"],
            "content_type": att["content_type"],
            "size": att["size"],
            "data_b64": att["data_b64"],
        }

    # ------------ Admin-only ------------

    @router.get("/admin/inbox")
    async def admin_inbox(user: dict = Depends(get_current_user)):
        await _require_admin(user)
        cur = db.support_threads.find(
            {}, {"_id": 0},
        ).sort([("unread_admin", -1), ("last_message_at", -1), ("created_at", -1)])
        threads = await cur.to_list(length=500)
        unread_total = sum(int(t.get("unread_admin", 0)) for t in threads)
        return {
            "threads": threads,
            "unread_total": unread_total,
            "open_count": sum(1 for t in threads if t.get("status") == "open"),
        }

    @router.get("/admin/unread")
    async def admin_unread(user: dict = Depends(get_current_user)):
        await _require_admin(user)
        cur = db.support_threads.find({}, {"_id": 0, "unread_admin": 1})
        total = 0
        async for t in cur:
            total += int(t.get("unread_admin", 0))
        return {"unread": total}

    @router.patch("/threads/{thread_id}")
    async def update_thread(thread_id: str,
                            payload: ThreadPatchIn,
                            user: dict = Depends(get_current_user)):
        await _require_admin(user)
        upd: dict = {}
        if payload.status is not None:
            upd["status"] = payload.status
        if payload.subject is not None:
            upd["subject"] = payload.subject
        if not upd:
            raise HTTPException(400, "Nothing to update")
        res = await db.support_threads.update_one({"id": thread_id}, {"$set": upd})
        if res.matched_count == 0:
            raise HTTPException(404, "Thread not found")
        t = await db.support_threads.find_one({"id": thread_id}, {"_id": 0})
        return t

    return router


# ---------- email helpers ----------

async def _notify_email(thread: dict, msg: dict, sender_role: str) -> None:
    """Fire-and-forget email notification on new message."""
    body_excerpt = (msg.get("body") or "").strip()
    if not body_excerpt and msg.get("attachments"):
        att = msg["attachments"][0]
        body_excerpt = f"[Attachment: {att.get('filename')}]"
    body_excerpt = body_excerpt[:300]

    if sender_role == "user":
        # → email admin
        to = _admin_email()
        subject = f"[Atlas Support] New message from {thread.get('user_name') or thread.get('user_email')}"
        html = _html_email(
            heading="New support message",
            preheader=f"From {thread.get('user_email')}",
            body_excerpt=body_excerpt,
            from_label=f"{thread.get('user_name')} ({thread.get('user_email')})",
        )
    else:
        # → email user (admin replied)
        to = thread.get("user_email")
        if not to:
            return
        subject = "[Atlas Construction] You have a new reply from support"
        html = _html_email(
            heading="You have a new support reply",
            preheader="A team member replied to your support thread",
            body_excerpt=body_excerpt,
            from_label="Atlas Support",
        )
    try:
        await asyncio.wait_for(send_html_email(to, subject, html), timeout=10)
    except asyncio.TimeoutError:
        logger.warning("support email send timed out")


def _html_email(heading: str, preheader: str, body_excerpt: str,
                from_label: str) -> str:
    safe = (body_excerpt or "").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html><html><body style="margin:0;background:#0a0a0a;color:#eaeaea;font-family:-apple-system,Segoe UI,Inter,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">{preheader}</div>
<div style="max-width:560px;margin:32px auto;padding:24px;background:#111;border:1px solid #2a2a2a">
<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#FFCC00;letter-spacing:0.15em">// ATLAS · SUPPORT</div>
<h1 style="font-size:22px;margin:8px 0 4px;letter-spacing:-0.02em">{heading}</h1>
<div style="font-size:13px;color:#888;margin-bottom:18px">From: {from_label}</div>
<div style="font-size:15px;line-height:1.55;border-left:3px solid #FFCC00;padding:8px 14px;background:#181818;color:#ddd;white-space:pre-wrap">{safe}</div>
<a href="https://app-gonzo.com/app" style="display:inline-block;margin-top:22px;padding:10px 18px;background:#FFCC00;color:#000;text-decoration:none;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.1em">OPEN ATLAS →</a>
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #222;color:#666;font-size:11px">You're receiving this because of a support conversation in Atlas Construction.</div>
</div></body></html>"""
