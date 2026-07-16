"""Iteration 5 — Admin + User Settings tests.

Covers:
- Seeded admin login & /auth/me
- Admin guard (403 for non-admin)
- /api/admin/overview, /users, /users/{id}, PATCH /users/{id}, DELETE /users/{id}
- Suspended account login blocked
- /api/admin/projects, /billing/summary, /billing/transactions
- /api/admin/settings GET/PUT, /ai-settings, /audit-log
- /api/user/profile, /password, /preferences, /notifications
- /api/user/export, /sessions, /account
"""
import io
import os
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or ""
if not BASE_URL:
    env_path = Path("/app/frontend/.env")
    for line in env_path.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
BASE_URL = BASE_URL.rstrip("/")

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@atlas.app")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "Open0says3me#*03#*")


# ---------- helpers ----------
def _register(name="X", suffix=None):
    suf = suffix or uuid.uuid4().hex[:8]
    email = f"test_iter5_{suf}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "TestPass123!", "name": name},
                      timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"email": email, "password": "TestPass123!", "token": d["token"], "user": d["user"]}


def _login(email, password):
    return requests.post(f"{BASE_URL}/api/auth/login",
                         json={"email": email, "password": password}, timeout=15)


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture
def fresh_user():
    return _register("Iter5 Fresh")


# ============================================================
# 1. Seeded admin
# ============================================================
class TestSeededAdmin:
    def test_admin_login_returns_is_admin(self):
        r = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["is_admin"] is True
        assert d["user"]["email"] == ADMIN_EMAIL

    def test_auth_me_is_admin_and_studio(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["is_admin"] is True
        assert d.get("subscription", {}).get("tier") == "studio"


# ============================================================
# 2. Admin guard
# ============================================================
class TestAdminGuard:
    def test_non_admin_blocked(self, fresh_user):
        r = requests.get(f"{BASE_URL}/api/admin/overview", headers=_h(fresh_user["token"]), timeout=10)
        assert r.status_code == 403

    def test_admin_overview_ok(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/overview", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("total", "admins", "free", "pro", "studio", "trialing"):
            assert k in d["users"]
            assert d["users"][k] >= 0
        for k in ("projects", "documents", "materials"):
            assert k in d and d[k] >= 0
        assert "revenue" in d and "total_paid" in d["revenue"]


# ============================================================
# 3. Admin users listing/details
# ============================================================
class TestAdminUsers:
    def test_list_users_has_project_count(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/users", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) > 0
        assert all("project_count" in u for u in users)
        assert all("password_hash" not in u for u in users)

    def test_search_admin_returns_admin_row(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/users?q=admin", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        emails = [u["email"] for u in r.json()]
        assert ADMIN_EMAIL in emails

    def test_get_user_with_recent_usage(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        r = requests.get(f"{BASE_URL}/api/admin/users/{uid}", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == uid
        assert "recent_usage" in d and isinstance(d["recent_usage"], list)

    def test_get_user_404(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/users/does-not-exist",
                         headers=_h(admin_token), timeout=10)
        assert r.status_code == 404


# ============================================================
# 4. PATCH /admin/users/{id}
# ============================================================
class TestAdminPatchUser:
    def test_patch_changes_plan_and_credits(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        r = requests.patch(
            f"{BASE_URL}/api/admin/users/{uid}",
            headers=_h(admin_token),
            json={"plan_tier": "pro", "plan_status": "active",
                  "bonus_credits": 10, "rush_credits": 3,
                  "pdf_premium_branding": True, "name": "Patched Name"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["subscription"]["tier"] == "pro"
        assert d["subscription"]["status"] == "active"
        assert d["entitlements"]["bonus_credits"] == 10
        assert d["entitlements"]["rush_credits"] == 3
        assert d["entitlements"]["pdf_premium_branding"] is True
        assert d["name"] == "Patched Name"

    def test_patch_invalid_tier_400(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        r = requests.patch(f"{BASE_URL}/api/admin/users/{uid}",
                           headers=_h(admin_token), json={"plan_tier": "ultra"}, timeout=10)
        assert r.status_code == 400

    def test_patch_invalid_status_400(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        r = requests.patch(f"{BASE_URL}/api/admin/users/{uid}",
                           headers=_h(admin_token), json={"plan_status": "weird"}, timeout=10)
        assert r.status_code == 400

    def test_patch_empty_payload_400(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        r = requests.patch(f"{BASE_URL}/api/admin/users/{uid}",
                           headers=_h(admin_token), json={}, timeout=10)
        assert r.status_code == 400

    def test_patch_non_admin_caller_403(self, fresh_user):
        another = _register("Other")
        r = requests.patch(f"{BASE_URL}/api/admin/users/{another['user']['id']}",
                           headers=_h(fresh_user["token"]),
                           json={"name": "Hack"}, timeout=10)
        assert r.status_code == 403


# ============================================================
# 5. Suspension blocks login
# ============================================================
class TestSuspension:
    def test_suspended_user_cannot_login(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        r = requests.patch(f"{BASE_URL}/api/admin/users/{uid}",
                           headers=_h(admin_token),
                           json={"suspended": True, "plan_status": "suspended"},
                           timeout=10)
        assert r.status_code == 200
        r2 = _login(fresh_user["email"], fresh_user["password"])
        assert r2.status_code == 403
        assert "suspend" in r2.text.lower()


# ============================================================
# 6. Cascade delete
# ============================================================
class TestAdminDeleteUser:
    def test_self_delete_returns_400(self, admin_token):
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(admin_token), timeout=10).json()
        r = requests.delete(f"{BASE_URL}/api/admin/users/{me['id']}",
                            headers=_h(admin_token), timeout=10)
        assert r.status_code == 400

    def test_cascade_delete_user(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        # Upgrade to Pro so multi-project allowed, then create a project
        requests.patch(f"{BASE_URL}/api/admin/users/{uid}",
                       headers=_h(admin_token),
                       json={"plan_tier": "pro", "plan_status": "active"}, timeout=10)
        rp = requests.post(f"{BASE_URL}/api/projects",
                           headers=_h(fresh_user["token"]),
                           json={"name": "ToDelete"}, timeout=15)
        assert rp.status_code == 200, rp.text
        # Delete via admin
        rd = requests.delete(f"{BASE_URL}/api/admin/users/{uid}",
                             headers=_h(admin_token), timeout=15)
        assert rd.status_code == 200
        # Verify user gone
        rg = requests.get(f"{BASE_URL}/api/admin/users/{uid}",
                          headers=_h(admin_token), timeout=10)
        assert rg.status_code == 404
        # Verify cannot login
        rl = _login(fresh_user["email"], fresh_user["password"])
        assert rl.status_code == 401


# ============================================================
# 7. Admin projects + billing
# ============================================================
class TestAdminProjectsBilling:
    def test_list_projects_joined(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/projects", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        projs = r.json()
        assert isinstance(projs, list)
        if projs:
            p = projs[0]
            for k in ("user_email", "user_name", "doc_count", "material_count"):
                assert k in p

    def test_billing_summary(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/billing/summary",
                         headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("mrr_usd", "pro_subscribers", "studio_subscribers", "trialing",
                  "trials_started", "trial_converted", "trial_conversion_pct", "total_paid_usd"):
            assert k in d, f"missing {k}"
            assert d[k] >= 0

    def test_billing_transactions(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/billing/transactions",
                         headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ============================================================
# 8. System settings + AI + audit
# ============================================================
class TestAdminSettings:
    def test_get_settings_keys(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/settings", headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("settings", "default_catalog", "default_plan_limits",
                  "effective_catalog", "effective_plan_limits"):
            assert k in d

    def test_put_settings_reflected(self, admin_token):
        marker = f"You are a custom prompt {uuid.uuid4().hex[:6]}"
        r = requests.put(f"{BASE_URL}/api/admin/settings",
                         headers=_h(admin_token),
                         json={"ai_model": "gpt-5.2",
                               "ai_system_prompt_override": marker,
                               "catalog_overrides": {"materials_pack": {"price_usd": 7}},
                               "plan_limits_overrides": {"free": {"max_projects": 2}}},
                         timeout=15)
        assert r.status_code == 200, r.text
        g = requests.get(f"{BASE_URL}/api/admin/settings",
                         headers=_h(admin_token), timeout=15).json()
        assert g["settings"]["ai_model"] == "gpt-5.2"
        assert g["settings"]["ai_system_prompt_override"] == marker
        assert g["effective_plan_limits"]["free"]["max_projects"] == 2
        # Reset overrides so iter 1-4 regression tests (which depend on free.max_projects=1) still pass
        requests.put(f"{BASE_URL}/api/admin/settings",
                     headers=_h(admin_token),
                     json={"ai_model": "gpt-4o",
                           "ai_system_prompt_override": "",
                           "catalog_overrides": {},
                           "plan_limits_overrides": {}}, timeout=15)

    def test_ai_settings(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/ai-settings",
                         headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "ai_model" in d and "ai_provider" in d
        assert isinstance(d["available_models"], list) and d["available_models"]
        sample = d["available_models"][0]
        assert "id" in sample and "provider" in sample and "label" in sample
        assert d["analyzed_documents_count"] >= 0

    def test_audit_log_after_patch(self, admin_token, fresh_user):
        uid = fresh_user["user"]["id"]
        requests.patch(f"{BASE_URL}/api/admin/users/{uid}",
                       headers=_h(admin_token),
                       json={"name": "AuditTrigger"}, timeout=10)
        r = requests.get(f"{BASE_URL}/api/admin/audit-log",
                         headers=_h(admin_token), timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert any(row.get("action") == "admin.user.update" for row in rows)


# ============================================================
# 9. User profile, password, preferences, notifications
# ============================================================
class TestUserProfile:
    def test_profile_update_name(self, fresh_user):
        r = requests.put(f"{BASE_URL}/api/user/profile",
                         headers=_h(fresh_user["token"]),
                         json={"name": "New Name"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["name"] == "New Name"

    def test_profile_email_taken(self, fresh_user):
        other = _register("X")
        r = requests.put(f"{BASE_URL}/api/user/profile",
                         headers=_h(fresh_user["token"]),
                         json={"email": other["email"]}, timeout=10)
        assert r.status_code == 400

    def test_profile_empty_400(self, fresh_user):
        r = requests.put(f"{BASE_URL}/api/user/profile",
                         headers=_h(fresh_user["token"]),
                         json={}, timeout=10)
        assert r.status_code == 400


class TestUserPassword:
    def test_wrong_current_400(self, fresh_user):
        r = requests.put(f"{BASE_URL}/api/user/password",
                         headers=_h(fresh_user["token"]),
                         json={"current_password": "WRONG", "new_password": "NewPass1!"},
                         timeout=10)
        assert r.status_code == 400

    def test_same_new_400(self, fresh_user):
        r = requests.put(f"{BASE_URL}/api/user/password",
                         headers=_h(fresh_user["token"]),
                         json={"current_password": "TestPass123!", "new_password": "TestPass123!"},
                         timeout=10)
        assert r.status_code == 400

    def test_change_password_login_works(self, fresh_user):
        new_pw = "NewSecure!42"
        r = requests.put(f"{BASE_URL}/api/user/password",
                         headers=_h(fresh_user["token"]),
                         json={"current_password": "TestPass123!", "new_password": new_pw},
                         timeout=10)
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        # Old password fails
        r2 = _login(fresh_user["email"], "TestPass123!")
        assert r2.status_code == 401
        # New password works
        r3 = _login(fresh_user["email"], new_pw)
        assert r3.status_code == 200


class TestUserPreferences:
    def test_get_default(self, fresh_user):
        r = requests.get(f"{BASE_URL}/api/user/preferences",
                         headers=_h(fresh_user["token"]), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("currency", "units", "date_format", "theme"):
            assert k in d

    def test_put_update(self, fresh_user):
        r = requests.put(f"{BASE_URL}/api/user/preferences",
                         headers=_h(fresh_user["token"]),
                         json={"currency": "EUR", "units": "metric",
                               "date_format": "YYYY-MM-DD", "theme": "light"},
                         timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["currency"] == "EUR" and d["units"] == "metric"
        assert d["theme"] == "light" and d["date_format"] == "YYYY-MM-DD"


class TestUserNotifications:
    def test_get_default(self, fresh_user):
        r = requests.get(f"{BASE_URL}/api/user/notifications",
                         headers=_h(fresh_user["token"]), timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("email_trial_ending", "email_low_credits",
                  "email_payment_receipts", "email_product_updates"):
            assert k in d and isinstance(d[k], bool)

    def test_put_toggles(self, fresh_user):
        r = requests.put(f"{BASE_URL}/api/user/notifications",
                         headers=_h(fresh_user["token"]),
                         json={"email_trial_ending": False,
                               "email_low_credits": False,
                               "email_payment_receipts": False,
                               "email_product_updates": True},
                         timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["email_trial_ending"] is False
        assert d["email_product_updates"] is True


# ============================================================
# 10. Export + sessions + account delete
# ============================================================
class TestUserExportAndSessions:
    def test_export_bundle(self, fresh_user):
        r = requests.get(f"{BASE_URL}/api/user/export",
                         headers=_h(fresh_user["token"]), timeout=20)
        assert r.status_code == 200
        assert "application/json" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        d = r.json()
        for k in ("user", "projects", "documents", "materials",
                  "blueprints", "usage_periods", "payment_transactions"):
            assert k in d

    def test_revoke_all_sessions(self, fresh_user):
        r = requests.delete(f"{BASE_URL}/api/user/sessions",
                            headers=_h(fresh_user["token"]), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        assert "revoked" in d and d["revoked"] >= 0


class TestUserAccountDelete:
    def test_admin_cannot_self_delete_via_user_route(self, admin_token):
        r = requests.delete(f"{BASE_URL}/api/user/account",
                            headers=_h(admin_token), timeout=10)
        assert r.status_code == 400

    def test_non_admin_delete_then_login_401(self, fresh_user):
        r = requests.delete(f"{BASE_URL}/api/user/account",
                            headers=_h(fresh_user["token"]), timeout=15)
        assert r.status_code == 200
        r2 = _login(fresh_user["email"], fresh_user["password"])
        assert r2.status_code == 401
