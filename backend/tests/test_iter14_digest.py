"""Iteration 14 — Resend email digests.

Sandbox-friendly: RESEND_API_KEY is empty by default, so the digest endpoint
returns 503; we test the preview path + status + content gathering instead.
The real send path is exercised in a single LLM-style gated test.

Run: pytest /app/backend/tests/test_iter14_digest.py -v
"""
import os
import uuid

import pytest
import requests


@pytest.fixture(scope="module")
def project_a(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter14_{uuid.uuid4().hex[:6]}"},
                      headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield {"id": pid, "headers": headers, "user": user_a}
    requests.delete(f"{base_url}/api/projects/{pid}", headers=headers, timeout=20)


def test_status_endpoint(base_url):
    r = requests.get(f"{base_url}/api/notifications/status", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "configured" in body
    assert "sender" in body
    assert body["digest_hour_utc"] == 8
    assert body["scheduler_running"] in (True, False)


def test_digest_preview_authed(base_url, project_a):
    r = requests.get(
        f"{base_url}/api/notifications/digest-preview",
        headers=project_a["headers"], timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert "html" in body
    assert "subject" in body
    assert "empty" in body
    # Owner of brand-new project with no activity yet → empty digest
    assert body["empty"] is True
    assert "configured" in body
    assert "Atlas" in body["html"] or "atlas" in body["html"].lower()


def test_digest_preview_requires_auth(base_url):
    r = requests.get(f"{base_url}/api/notifications/digest-preview", timeout=10)
    assert r.status_code in (401, 403)


def test_digest_preview_includes_recent_activity(base_url, user_a, user_b):
    """Owner uploads a material; teammate (member with PM role) gets it in their digest."""
    headers_a = {"Authorization": f"Bearer {user_a['token']}"}
    headers_b = {"Authorization": f"Bearer {user_b['token']}"}
    # A creates a project and invites B as PM
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter14_invite_{uuid.uuid4().hex[:6]}"},
                      headers=headers_a, timeout=20)
    pid = r.json()["id"]
    try:
        # Invite B (logs member.invited activity by A)
        inv = requests.post(
            f"{base_url}/api/projects/{pid}/members",
            json={"email": user_b["email"], "role": "pm"},
            headers=headers_a, timeout=15,
        )
        assert inv.status_code == 200, inv.text

        # A files a daily log (logs daily_log.created activity by A)
        log = requests.post(
            f"{base_url}/api/projects/{pid}/daily-logs",
            json={"notes": "Test log for digest", "crew_size": 3, "fetch_weather": False},
            headers=headers_a, timeout=15,
        )
        assert log.status_code == 200, log.text

        # B previews their digest → should see at least the daily_log event from A
        prev = requests.get(
            f"{base_url}/api/notifications/digest-preview",
            headers=headers_b, timeout=15,
        )
        assert prev.status_code == 200
        body = prev.json()
        assert body["total_events"] >= 1
        assert body["empty"] is False
        # render must include A's email (the actor)
        assert user_a["email"] in body["html"]
    finally:
        requests.delete(f"{base_url}/api/projects/{pid}", headers=headers_a, timeout=15)


def test_digest_excludes_self_actions(base_url, project_a):
    """User does an action on their own project → it shouldn't show in their own digest."""
    log = requests.post(
        f"{base_url}/api/projects/{project_a['id']}/daily-logs",
        json={"notes": "self log", "crew_size": 1, "fetch_weather": False},
        headers=project_a["headers"], timeout=15,
    )
    assert log.status_code == 200

    prev = requests.get(
        f"{base_url}/api/notifications/digest-preview",
        headers=project_a["headers"], timeout=15,
    )
    assert prev.status_code == 200
    assert prev.json()["empty"] is True  # self-actions are filtered out


def test_test_digest_returns_503_when_unconfigured(base_url, project_a):
    """With RESEND_API_KEY empty, test-digest should fail-fast 503."""
    r = requests.post(
        f"{base_url}/api/notifications/test-digest",
        json={}, headers=project_a["headers"], timeout=15,
    )
    # If env happens to be set in CI, accept either path.
    assert r.status_code in (200, 503)
    if r.status_code == 503:
        assert "not configured" in r.json()["detail"].lower()


def test_run_all_admin_only(base_url, project_a):
    r = requests.post(
        f"{base_url}/api/notifications/run-all",
        headers=project_a["headers"], timeout=15,
    )
    # Non-admin → 403 OR 503 (depending on RESEND key presence)
    assert r.status_code in (403, 503)


def test_notification_pref_includes_daily_digest(base_url, project_a):
    r = requests.get(f"{base_url}/api/user/notifications",
                     headers=project_a["headers"], timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "email_daily_digest" in body
    assert body["email_daily_digest"] is True  # default


def test_notification_pref_toggle_daily_digest(base_url, project_a):
    r = requests.put(
        f"{base_url}/api/user/notifications",
        json={"email_daily_digest": False},
        headers=project_a["headers"], timeout=10,
    )
    assert r.status_code == 200
    assert r.json()["email_daily_digest"] is False

    # restore
    requests.put(f"{base_url}/api/user/notifications",
                 json={"email_daily_digest": True},
                 headers=project_a["headers"], timeout=10)


@pytest.mark.skipif(not os.environ.get("RESEND_API_KEY"),
                    reason="set RESEND_API_KEY to test actual send")
def test_real_send(base_url, project_a):
    r = requests.post(
        f"{base_url}/api/notifications/test-digest",
        json={}, headers=project_a["headers"], timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.json()["sent"] is True
