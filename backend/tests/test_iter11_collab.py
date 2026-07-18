"""Iteration 11: collaboration backend tests.

Covers: members CRUD + role enforcement, projects-shared-with-me, activity feed,
comments with @mentions, branding validation, public share branding inclusion.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://construction-viz-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@atlas.app")
ADMIN_PW = os.environ.get("ADMIN_PASSWORD", "Open0says3me#*03#*")


def _register(email, pw="TestPass123!", name="Test User"):
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": name}, timeout=30)
    # 200 created or 400 already exists; both acceptable
    return r


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    return j.get("token") or j.get("access_token")


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def user_b():
    email = f"test_iter11_b_{uuid.uuid4().hex[:8]}@example.com"
    pw = "TestPass123!"
    _register(email, pw, "User B")
    tok = _login(email, pw)
    return {"email": email, "password": pw, "token": tok}


@pytest.fixture(scope="module")
def user_c():
    email = f"test_iter11_c_{uuid.uuid4().hex[:8]}@example.com"
    pw = "TestPass123!"
    _register(email, pw, "User C")
    tok = _login(email, pw)
    return {"email": email, "password": pw, "token": tok}


@pytest.fixture(scope="module")
def project(admin_token):
    r = requests.post(f"{API}/projects",
                      json={"name": f"TEST_iter11_{uuid.uuid4().hex[:6]}", "description": "iter11 collab"},
                      headers=_h(admin_token), timeout=30)
    assert r.status_code == 200, r.text
    p = r.json()
    yield p
    # cleanup
    requests.delete(f"{API}/projects/{p['id']}", headers=_h(admin_token), timeout=30)


# ============ MEMBERS ============

class TestMembers:
    def test_list_initial_owner(self, admin_token, project):
        r = requests.get(f"{API}/projects/{project['id']}/members", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["your_role"] == "owner"
        assert d["owner"]["email"] == ADMIN_EMAIL
        assert d["members"] == []

    def test_invite_existing_user_auto_accepts(self, admin_token, project, user_b):
        r = requests.post(f"{API}/projects/{project['id']}/members",
                          json={"email": user_b["email"], "role": "estimator"},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["accepted"] is True
        assert d["role"] == "estimator"

    def test_invite_pending_for_unknown_email(self, admin_token, project):
        ghost = f"ghost_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/projects/{project['id']}/members",
                          json={"email": ghost, "role": "viewer"},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["accepted"] is False
        assert d["role"] == "viewer"

    def test_invalid_role_rejected(self, admin_token, project):
        for bad in ("admin", "owner", "xyz"):
            r = requests.post(f"{API}/projects/{project['id']}/members",
                              json={"email": f"x_{uuid.uuid4().hex[:6]}@example.com", "role": bad},
                              headers=_h(admin_token), timeout=30)
            assert r.status_code == 400, f"{bad}: {r.status_code}"

    def test_patch_role(self, admin_token, project, user_b):
        r = requests.patch(f"{API}/projects/{project['id']}/members/{user_b['email']}",
                           json={"role": "pm"}, headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "pm"

    def test_non_member_cannot_list(self, project, user_c):
        r = requests.get(f"{API}/projects/{project['id']}/members", headers=_h(user_c["token"]), timeout=30)
        # 404 from require_role when role is None
        assert r.status_code == 404, r.text

    def test_viewer_cannot_invite(self, admin_token, project, user_c):
        # add user_c as viewer
        requests.post(f"{API}/projects/{project['id']}/members",
                      json={"email": user_c["email"], "role": "viewer"},
                      headers=_h(admin_token), timeout=30)
        r = requests.post(f"{API}/projects/{project['id']}/members",
                          json={"email": "intruder@example.com", "role": "estimator"},
                          headers=_h(user_c["token"]), timeout=30)
        assert r.status_code == 403, r.text

    def test_404_on_nonexistent_project(self, admin_token):
        r = requests.get(f"{API}/projects/does-not-exist-xyz/members",
                        headers=_h(admin_token), timeout=30)
        assert r.status_code == 404


# ============ PROJECTS SHARED WITH ME ============

class TestSharedProjects:
    def test_user_b_sees_shared_project(self, user_b, project):
        r = requests.get(f"{API}/projects-shared-with-me", headers=_h(user_b["token"]), timeout=30)
        assert r.status_code == 200, r.text
        rows = r.json()
        ids = [p["id"] for p in rows]
        assert project["id"] in ids, f"project {project['id']} not in shared list {ids}"
        match = next(p for p in rows if p["id"] == project["id"])
        assert match.get("role") in ("pm", "estimator")  # after patch role -> pm


# ============ ACTIVITY ============

class TestActivity:
    def test_activity_contains_member_events(self, admin_token, project):
        r = requests.get(f"{API}/projects/{project['id']}/activity",
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        events = r.json()
        actions = {e["action"] for e in events}
        assert "member.invited" in actions
        assert "member.role_changed" in actions
        # descending by created_at
        timestamps = [e["created_at"] for e in events]
        assert timestamps == sorted(timestamps, reverse=True)
        # required fields
        for e in events:
            assert "user_email" in e and "action" in e


# ============ COMMENTS ============

class TestComments:
    def test_comment_with_mention(self, admin_token, project):
        body = "Check this @john@atlas.app and also @jane@atlas.app please"
        r = requests.post(f"{API}/projects/{project['id']}/comments",
                          json={"body": body, "target_type": "general", "target_id": ""},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d["mentions"]) == {"john@atlas.app", "jane@atlas.app"}
        assert d["author_email"] == ADMIN_EMAIL

    def test_invalid_target_type(self, admin_token, project):
        r = requests.post(f"{API}/projects/{project['id']}/comments",
                          json={"body": "hi", "target_type": "invalid_type"},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 422

    def test_body_min_length(self, admin_token, project):
        r = requests.post(f"{API}/projects/{project['id']}/comments",
                          json={"body": "", "target_type": "general"},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 422

    def test_body_max_length(self, admin_token, project):
        r = requests.post(f"{API}/projects/{project['id']}/comments",
                          json={"body": "x" * 1501, "target_type": "general"},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 422

    def test_filter_by_target(self, admin_token, project):
        # create document comment
        r = requests.post(f"{API}/projects/{project['id']}/comments",
                          json={"body": "doc comment", "target_type": "document", "target_id": "doc-1"},
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        # list filtered
        r = requests.get(f"{API}/projects/{project['id']}/comments?target_type=document&target_id=doc-1",
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        comments = r.json()
        assert len(comments) >= 1
        assert all(c["target_type"] == "document" and c["target_id"] == "doc-1" for c in comments)

    def test_delete_by_non_author_non_pm_forbidden(self, admin_token, project, user_c):
        # admin creates a comment
        r = requests.post(f"{API}/projects/{project['id']}/comments",
                          json={"body": "owner only", "target_type": "general"},
                          headers=_h(admin_token), timeout=30)
        cid = r.json()["id"]
        # user_c is viewer, should get 403
        r2 = requests.delete(f"{API}/comments/{cid}", headers=_h(user_c["token"]), timeout=30)
        assert r2.status_code == 403, r2.text

    def test_delete_by_author(self, admin_token, project):
        r = requests.post(f"{API}/projects/{project['id']}/comments",
                          json={"body": "self delete", "target_type": "general"},
                          headers=_h(admin_token), timeout=30)
        cid = r.json()["id"]
        r2 = requests.delete(f"{API}/comments/{cid}", headers=_h(admin_token), timeout=30)
        assert r2.status_code == 200


# ============ BRANDING ============

class TestBranding:
    def test_get_default_branding(self, admin_token, project):
        r = requests.get(f"{API}/projects/{project['id']}/branding",
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "accent_color" in d

    def test_set_branding(self, admin_token, project):
        payload = {
            "company_name": "TEST_Atlas Co",
            "accent_color": "#FF3366",
            "tagline": "Build it bold",
            "logo_data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        }
        r = requests.put(f"{API}/projects/{project['id']}/branding",
                         json=payload, headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["company_name"] == "TEST_Atlas Co"
        assert d["accent_color"] == "#FF3366"
        # verify persisted
        r2 = requests.get(f"{API}/projects/{project['id']}/branding",
                          headers=_h(admin_token), timeout=30)
        assert r2.json()["tagline"] == "Build it bold"

    def test_invalid_accent_color(self, admin_token, project):
        r = requests.put(f"{API}/projects/{project['id']}/branding",
                         json={"accent_color": "red"},
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 422

    def test_invalid_logo_prefix(self, admin_token, project):
        r = requests.put(f"{API}/projects/{project['id']}/branding",
                         json={"logo_data_url": "http://example.com/logo.png"},
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 400

    def test_logo_too_large(self, admin_token, project):
        big = "data:image/png;base64," + ("A" * 700_000)
        r = requests.put(f"{API}/projects/{project['id']}/branding",
                         json={"logo_data_url": big},
                         headers=_h(admin_token), timeout=30)
        assert r.status_code == 400


# ============ PUBLIC SHARE WITH BRANDING ============

class TestPublicShareBranding:
    def test_share_includes_branding(self, admin_token, project):
        # ensure share enabled
        r = requests.post(f"{API}/projects/{project['id']}/share",
                          headers=_h(admin_token), timeout=30)
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        # set branding
        requests.put(f"{API}/projects/{project['id']}/branding",
                     json={"company_name": "TEST_ShareCo", "accent_color": "#00AA88", "tagline": "TEST_tag"},
                     headers=_h(admin_token), timeout=30)
        # fetch without auth
        r2 = requests.get(f"{API}/share/{token}", timeout=30)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert "branding" in data
        assert data["branding"].get("company_name") == "TEST_ShareCo"
        assert data["branding"].get("accent_color") == "#00AA88"
