"""Iteration 26 — In-app support messaging backend tests.

Covers:
- GET /api/support/me/thread (auto-create on first hit)
- POST /api/support/threads/{id}/messages (user → admin, increments unread_admin)
- GET /api/support/admin/inbox + /api/support/admin/unread
- Admin reply increments unread_user
- POST /api/support/threads/{id}/read (clears unread for caller's role)
- PATCH /api/support/threads/{id} {status:'closed'} (admin only, non-admin 403)
- Cross-user isolation
- Body validation (empty / >5000 chars)
- Attachment upload + retrieval + validation (content-type, size)
"""
from __future__ import annotations

import io
import os
import uuid

import pytest
import requests
from PIL import Image


ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@atlas.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Open0says3me#*03#*")


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def admin_token(base_url):
    r = requests.post(
        f"{base_url}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def support_user_a(base_url):
    email = f"supporttest_a_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": "Support User A"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["token"], "user": data["user"]}


@pytest.fixture(scope="module")
def support_user_b(base_url):
    email = f"supporttest_b_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(
        f"{base_url}/api/auth/register",
        json={"email": email, "password": "TestPass123!", "name": "Support User B"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "token": data["token"], "user": data["user"]}


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- Thread auto-create ----------

class TestSupportThreadCreate:
    def test_me_thread_autocreates(self, base_url, support_user_a):
        r = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        t = r.json()
        assert "id" in t and len(t["id"]) > 0
        assert t["status"] == "open"
        assert t["unread_admin"] == 0
        assert t["unread_user"] == 0
        assert t["user_id"] == support_user_a["user"]["id"]
        assert "_id" not in t
        # idempotent — second call returns same id
        r2 = requests.get(f"{base_url}/api/support/me/thread",
                          headers=_h(support_user_a["token"]), timeout=15)
        assert r2.status_code == 200
        assert r2.json()["id"] == t["id"]


# ---------- User → admin message flow ----------

class TestUserToAdminFlow:
    def test_user_posts_message_increments_unread_admin(self, base_url, support_user_a, admin_headers):
        # Capture admin baseline unread
        b = requests.get(f"{base_url}/api/support/admin/unread",
                         headers=admin_headers, timeout=10)
        assert b.status_code == 200
        baseline = int(b.json()["unread"])

        # Ensure user thread exists
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        tid = t["id"]

        r = requests.post(
            f"{base_url}/api/support/threads/{tid}/messages",
            json={"body": "hello from user A"},
            headers=_h(support_user_a["token"]), timeout=15,
        )
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["body"] == "hello from user A"
        assert msg["sender"] == "user"
        assert msg["thread_id"] == tid
        assert "id" in msg
        assert "_id" not in msg

        # Admin unread total should be at least baseline+1
        a = requests.get(f"{base_url}/api/support/admin/unread",
                         headers=admin_headers, timeout=10)
        assert a.status_code == 200
        assert int(a.json()["unread"]) >= baseline + 1

    def test_admin_inbox_shows_thread(self, base_url, support_user_a, admin_headers):
        # Thread should appear with unread_admin>=1 and preview text
        r = requests.get(f"{base_url}/api/support/admin/inbox",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "threads" in data and isinstance(data["threads"], list)
        user_id = support_user_a["user"]["id"]
        ours = [t for t in data["threads"] if t.get("user_id") == user_id]
        assert ours, "Admin inbox did not surface the user's thread"
        t = ours[0]
        assert int(t.get("unread_admin", 0)) >= 1
        assert "hello from user A" in (t.get("last_message_preview") or "")

    def test_non_admin_cannot_access_inbox(self, base_url, support_user_a):
        r = requests.get(f"{base_url}/api/support/admin/inbox",
                         headers=_h(support_user_a["token"]), timeout=10)
        assert r.status_code == 403

    def test_non_admin_cannot_access_admin_unread(self, base_url, support_user_a):
        r = requests.get(f"{base_url}/api/support/admin/unread",
                         headers=_h(support_user_a["token"]), timeout=10)
        assert r.status_code == 403


# ---------- Admin → user reply ----------

class TestAdminReplyFlow:
    def test_admin_reply_increments_unread_user(self, base_url, support_user_a, admin_headers):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        tid = t["id"]

        r = requests.post(
            f"{base_url}/api/support/threads/{tid}/messages",
            json={"body": "admin reply here"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["sender"] == "admin"
        assert msg["body"] == "admin reply here"

        # User side: unread_user should be >=1
        u = requests.get(f"{base_url}/api/support/me/unread",
                        headers=_h(support_user_a["token"]), timeout=10)
        assert u.status_code == 200
        assert int(u.json()["unread"]) >= 1

    def test_user_mark_read_clears_unread_user(self, base_url, support_user_a):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        tid = t["id"]
        r = requests.post(f"{base_url}/api/support/threads/{tid}/read",
                          headers=_h(support_user_a["token"]), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
        # unread cleared
        u = requests.get(f"{base_url}/api/support/me/unread",
                         headers=_h(support_user_a["token"]), timeout=10)
        assert u.status_code == 200
        assert int(u.json()["unread"]) == 0

    def test_admin_mark_read_clears_unread_admin(self, base_url, support_user_a, admin_headers):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        tid = t["id"]
        r = requests.post(f"{base_url}/api/support/threads/{tid}/read",
                          headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        # Confirm via inbox
        inbox = requests.get(f"{base_url}/api/support/admin/inbox",
                             headers=admin_headers, timeout=10).json()
        ours = [x for x in inbox["threads"] if x["id"] == tid]
        assert ours and int(ours[0].get("unread_admin", 0)) == 0


# ---------- List messages ----------

class TestListMessages:
    def test_list_returns_user_and_admin_messages(self, base_url, support_user_a):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        tid = t["id"]
        r = requests.get(f"{base_url}/api/support/threads/{tid}/messages",
                         headers=_h(support_user_a["token"]), timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "messages" in data and "thread" in data
        senders = {m["sender"] for m in data["messages"]}
        assert "user" in senders and "admin" in senders


# ---------- Validation ----------

class TestValidation:
    def test_empty_body_422(self, base_url, support_user_a):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        r = requests.post(
            f"{base_url}/api/support/threads/{t['id']}/messages",
            json={"body": ""},
            headers=_h(support_user_a["token"]), timeout=10,
        )
        assert r.status_code == 422

    def test_body_too_long_422(self, base_url, support_user_a):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        r = requests.post(
            f"{base_url}/api/support/threads/{t['id']}/messages",
            json={"body": "x" * 5001},
            headers=_h(support_user_a["token"]), timeout=15,
        )
        assert r.status_code == 422


# ---------- Cross-user isolation ----------

class TestIsolation:
    def test_user_b_cannot_read_user_a_messages(self, base_url, support_user_a, support_user_b):
        ta = requests.get(f"{base_url}/api/support/me/thread",
                          headers=_h(support_user_a["token"]), timeout=10).json()
        r = requests.get(
            f"{base_url}/api/support/threads/{ta['id']}/messages",
            headers=_h(support_user_b["token"]), timeout=10,
        )
        assert r.status_code == 403

    def test_user_b_cannot_post_in_user_a_thread(self, base_url, support_user_a, support_user_b):
        ta = requests.get(f"{base_url}/api/support/me/thread",
                          headers=_h(support_user_a["token"]), timeout=10).json()
        r = requests.post(
            f"{base_url}/api/support/threads/{ta['id']}/messages",
            json={"body": "intrusion"},
            headers=_h(support_user_b["token"]), timeout=10,
        )
        assert r.status_code == 403


# ---------- PATCH thread status (admin-only) ----------

class TestThreadPatch:
    def test_non_admin_patch_close_403(self, base_url, support_user_a):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        r = requests.patch(
            f"{base_url}/api/support/threads/{t['id']}",
            json={"status": "closed"},
            headers=_h(support_user_a["token"]), timeout=10,
        )
        assert r.status_code == 403

    def test_admin_can_close_thread(self, base_url, support_user_a, admin_headers):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_a["token"]), timeout=10).json()
        r = requests.patch(
            f"{base_url}/api/support/threads/{t['id']}",
            json={"status": "closed"},
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "closed"


# ---------- Attachments ----------

def _make_png_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), "blue")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class TestAttachments:
    def test_upload_png_attachment(self, base_url, support_user_b):
        # Use user B (fresh thread; user A's thread may be closed by previous test)
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_b["token"]), timeout=10).json()
        tid = t["id"]
        files = {"file": ("test.png", _make_png_bytes(), "image/png")}
        r = requests.post(
            f"{base_url}/api/support/threads/{tid}/attachments",
            files=files, data={"body": "see screenshot"},
            headers=_h(support_user_b["token"]), timeout=20,
        )
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["body"] == "see screenshot"
        assert isinstance(msg.get("attachments"), list) and len(msg["attachments"]) == 1
        att = msg["attachments"][0]
        assert att["filename"] == "test.png"
        assert att["content_type"] == "image/png"
        assert att["size"] > 0
        assert "data_b64" not in att  # stripped from response
        assert "_id" not in msg
        att_id = att["id"]

        # Retrieve attachment
        g = requests.get(f"{base_url}/api/support/attachments/{att_id}",
                         headers=_h(support_user_b["token"]), timeout=15)
        assert g.status_code == 200, g.text
        gdata = g.json()
        assert gdata["id"] == att_id
        assert gdata["content_type"] == "image/png"
        assert gdata["data_b64"] and len(gdata["data_b64"]) > 20

    def test_disallowed_content_type_400(self, base_url, support_user_b):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_b["token"]), timeout=10).json()
        files = {"file": ("test.txt", b"hello world", "text/plain")}
        r = requests.post(
            f"{base_url}/api/support/threads/{t['id']}/attachments",
            files=files, data={"body": ""},
            headers=_h(support_user_b["token"]), timeout=15,
        )
        assert r.status_code == 400

    def test_file_too_large_400(self, base_url, support_user_b):
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_b["token"]), timeout=10).json()
        # 6 MB blob
        big = b"\x00" * (6 * 1024 * 1024)
        files = {"file": ("big.png", big, "image/png")}
        r = requests.post(
            f"{base_url}/api/support/threads/{t['id']}/attachments",
            files=files, data={"body": ""},
            headers=_h(support_user_b["token"]), timeout=30,
        )
        assert r.status_code == 400

    def test_other_user_cannot_fetch_attachment(self, base_url, support_user_a, support_user_b):
        # Create attachment for user B
        t = requests.get(f"{base_url}/api/support/me/thread",
                         headers=_h(support_user_b["token"]), timeout=10).json()
        files = {"file": ("priv.png", _make_png_bytes(), "image/png")}
        r = requests.post(
            f"{base_url}/api/support/threads/{t['id']}/attachments",
            files=files, data={"body": "private"},
            headers=_h(support_user_b["token"]), timeout=20,
        )
        assert r.status_code == 200
        att_id = r.json()["attachments"][0]["id"]

        # User A tries to fetch — must be forbidden
        g = requests.get(f"{base_url}/api/support/attachments/{att_id}",
                         headers=_h(support_user_a["token"]), timeout=10)
        assert g.status_code == 403
