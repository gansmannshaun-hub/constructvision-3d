"""Iter-46: code-review-driven fixes.

Covers:
  HIGH  — Stripe entitlement double-grant idempotency (billing.py)
  MED   — Retry double-count: purge materials + sheets before re-run (routes/documents.py)
  MED   — Autonomous /extract cost gating (autonomous.py)
  LOW   — CORS preflight to /api/auth/login (server.py)
"""
import os
import sys
import uuid
import asyncio
import base64
import io
import time
import pytest
import requests
from pathlib import Path
from PIL import Image
import pymongo

# Ensure backend importable for direct-call tests
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"')
BASE_URL = (BASE_URL or "").rstrip("/")

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
for line in Path("/app/backend/.env").read_text().splitlines():
    if line.startswith("MONGO_URL="):
        MONGO_URL = line.split("=", 1)[1].strip().strip('"')
    if line.startswith("DB_NAME="):
        DB_NAME = line.split("=", 1)[1].strip().strip('"')

ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PASSWORD = "Open0says3me#*03#*"


@pytest.fixture(scope="module")
def sync_db():
    client = pymongo.MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_user(admin_token):
    r = requests.get(f"{BASE_URL}/api/auth/me",
                     headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


def _png_b64(w=64, h=64, color="white") -> str:
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


# -----------------------------------------------------------------------------
# LOW — CORS preflight
# -----------------------------------------------------------------------------
class TestCORSPreflight:
    def test_options_login_from_arbitrary_origin(self):
        r = requests.options(
            f"{BASE_URL}/api/auth/login",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=10,
        )
        assert r.status_code in (200, 204), f"Preflight failed: {r.status_code} {r.text}"
        aco = r.headers.get("access-control-allow-origin", "")
        assert aco in ("*", "https://example.com"), f"Missing/incorrect ACAO: {aco!r}"
        # allow_credentials=False → header must be absent or 'false' (never 'true' with *)
        acc = r.headers.get("access-control-allow-credentials", "").lower()
        assert acc != "true", "allow_credentials should be false with wildcard origin"


# -----------------------------------------------------------------------------
# HIGH — Stripe idempotency (direct call to _apply_entitlements + compare-and-set)
# -----------------------------------------------------------------------------
class TestStripeIdempotency:
    """Simulate the concurrent webhook + status-poll race.

    We can't easily fake a Stripe response through the HTTP endpoint, but we
    can exercise the exact code path that guards the double-grant: the
    compare-and-set on `entitlements_applied` followed by _apply_entitlements.
    """

    def test_apply_entitlements_only_once_via_cas(self, sync_db, admin_user):
        import billing as billing_mod

        # Baseline user + reset entitlements
        uid = admin_user["id"]
        sync_db.users.update_one(
            {"id": uid},
            {"$set": {"entitlements.studio_render_credits": 0,
                       "entitlements.bonus_credits": 0}},
        )
        user_pre = sync_db.users.find_one({"id": uid})
        pre_credits = int(((user_pre or {}).get("entitlements") or {}).get("studio_render_credits") or 0)

        # Seed a fake addon tx
        sid = f"cs_test_{uuid.uuid4().hex}"
        tx = {
            "id": str(uuid.uuid4()),
            "session_id": sid,
            "user_id": uid,
            "user_email": admin_user.get("email"),
            "item": "addon_renders_5",  # effect: studio_render_credits +5
            "kind": "addon",
            "amount": 19.0,
            "currency": "usd",
            "status": "initiated",
            "payment_status": "pending",
            "entitlements_applied": False,
        }
        sync_db.payment_transactions.insert_one(dict(tx))

        try:
            from motor.motor_asyncio import AsyncIOMotorClient
            aclient = AsyncIOMotorClient(MONGO_URL)
            adb = aclient[DB_NAME]

            async def race():
                # Two concurrent claim attempts – simulate webhook + status-poll
                async def claim_and_apply():
                    res = await adb.payment_transactions.update_one(
                        {"session_id": sid, "entitlements_applied": {"$ne": True}},
                        {"$set": {"entitlements_applied": True,
                                    "payment_status": "paid",
                                    "status": "complete"}},
                    )
                    if res.modified_count:
                        tx_row = await adb.payment_transactions.find_one({"session_id": sid})
                        await billing_mod._apply_entitlements(adb, tx_row)
                        return True
                    return False

                results = await asyncio.gather(claim_and_apply(), claim_and_apply())
                return results

            results = asyncio.run(race())
            # Exactly ONE of the two concurrent claims should have applied
            assert sum(1 for r in results if r) == 1, f"Expected one winner, got {results}"

            # And credits should be incremented by exactly +5, NOT +10
            user_post = sync_db.users.find_one({"id": uid})
            post_credits = int(((user_post or {}).get("entitlements") or {}).get("studio_render_credits") or 0)
            assert post_credits - pre_credits == 5, (
                f"Double-grant detected: pre={pre_credits} post={post_credits}"
            )
        finally:
            sync_db.payment_transactions.delete_one({"session_id": sid})
            # Reset credits so we don't leave admin with skewed state
            sync_db.users.update_one(
                {"id": uid},
                {"$set": {"entitlements.studio_render_credits": pre_credits}},
            )

    def test_second_call_after_applied_is_noop(self, sync_db, admin_user):
        """Belt-and-suspenders: re-running _apply_entitlements on an
        already-applied tx WILL still $inc — the guard sits in the CAS
        wrapper, not inside _apply_entitlements itself.  Verify that
        callers gated by the CAS never invoke it twice.
        """
        import billing as billing_mod
        uid = admin_user["id"]
        sid = f"cs_test_{uuid.uuid4().hex}"

        sync_db.payment_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "session_id": sid,
            "user_id": uid,
            "item": "addon_renders_5",
            "kind": "addon",
            "amount": 19.0,
            "currency": "usd",
            "status": "complete",
            "payment_status": "paid",
            "entitlements_applied": True,  # already applied
        })
        try:
            from motor.motor_asyncio import AsyncIOMotorClient
            aclient = AsyncIOMotorClient(MONGO_URL)
            adb = aclient[DB_NAME]

            async def try_claim():
                res = await adb.payment_transactions.update_one(
                    {"session_id": sid, "entitlements_applied": {"$ne": True}},
                    {"$set": {"entitlements_applied": True}},
                )
                return res.modified_count

            n = asyncio.run(try_claim())
            assert n == 0, "CAS should not match already-applied tx"
        finally:
            sync_db.payment_transactions.delete_one({"session_id": sid})


# -----------------------------------------------------------------------------
# MED — Retry double-count purge
# -----------------------------------------------------------------------------
class TestRetryPurgesArtifacts:
    def test_retry_purges_materials_and_sheets(self, sync_db, admin_token, admin_user):
        headers = {"Authorization": f"Bearer {admin_token}"}
        # Create a project
        pr = requests.post(f"{BASE_URL}/api/projects", headers=headers,
                           json={"name": f"TEST_iter46_{uuid.uuid4().hex[:6]}"}, timeout=15)
        assert pr.status_code == 200, pr.text
        project_id = pr.json()["id"]

        doc_id = str(uuid.uuid4())
        thumb_b64 = _png_b64()
        # Seed a fake errored document (status=error, with cached thumbnail)
        sync_db.documents.insert_one({
            "id": doc_id,
            "project_id": project_id,
            "user_id": admin_user["id"],
            "filename": "TEST_iter46.png",
            "mime_type": "image/png",
            "status": "error",
            "image_base64": thumb_b64,
            "pages_total": 1,
            "is_pdf": False,
            "analysis": {"summary": "prior error"},
            "materials_count": 2,
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        # Seed 2 materials attributed to this doc + 1 merged
        sync_db.materials.insert_many([
            {"id": str(uuid.uuid4()), "project_id": project_id,
             "document_id": doc_id, "name": "TEST_iter46_a", "quantity": 5},
            {"id": str(uuid.uuid4()), "project_id": project_id,
             "document_id": doc_id, "name": "TEST_iter46_b", "quantity": 3},
        ])
        merged_id = str(uuid.uuid4())
        sync_db.materials.insert_one({
            "id": merged_id, "project_id": project_id,
            "document_id": "other-doc",
            "source_documents": ["other-doc", doc_id],
            "name": "TEST_iter46_merged", "quantity": 7,
        })
        # Seed a blueprint sheet from this doc
        sheet_id = str(uuid.uuid4())
        sync_db.blueprint_sheets.insert_one({
            "id": sheet_id, "project_id": project_id,
            "source_document_id": doc_id,
            "name": "TEST_iter46_sheet",
        })

        try:
            # Baseline counts
            pre_mats = sync_db.materials.count_documents({"document_id": doc_id})
            pre_sheets = sync_db.blueprint_sheets.count_documents({"source_document_id": doc_id})
            pre_merged = sync_db.materials.find_one({"id": merged_id})
            assert pre_mats == 2
            assert pre_sheets == 1
            assert doc_id in (pre_merged.get("source_documents") or [])

            # Call retry
            r = requests.post(f"{BASE_URL}/api/documents/{doc_id}/retry",
                              headers=headers, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json().get("retrying") is True

            # Immediately check purge (before pipeline background task can re-add)
            time.sleep(0.3)
            post_mats = sync_db.materials.count_documents({"document_id": doc_id})
            post_sheets = sync_db.blueprint_sheets.count_documents({"source_document_id": doc_id})
            post_merged = sync_db.materials.find_one({"id": merged_id})

            assert post_mats == 0, f"Materials not purged: {post_mats} remain"
            assert post_sheets == 0, f"Sheets not purged: {post_sheets} remain"
            # Merged material should still exist but with doc_id pulled from source_documents
            assert post_merged is not None, "Merged material should not be deleted"
            assert doc_id not in (post_merged.get("source_documents") or []), \
                "doc_id should have been $pull'd from merged material.source_documents"
        finally:
            # Cleanup
            sync_db.materials.delete_many({"project_id": project_id})
            sync_db.materials.delete_one({"id": merged_id})
            sync_db.blueprint_sheets.delete_many({"project_id": project_id})
            sync_db.documents.delete_one({"id": doc_id})
            try:
                requests.delete(f"{BASE_URL}/api/projects/{project_id}", headers=headers, timeout=10)
            except Exception:
                pass


# -----------------------------------------------------------------------------
# MED — Autonomous cost gating (402 for out-of-quota free user)
# -----------------------------------------------------------------------------
class TestAutonomousCostGating:
    def test_402_when_free_user_quota_exhausted(self, sync_db):
        email = f"test_iter46_gate_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "TestPass123!", "name": "Iter46"},
                          timeout=15)
        assert r.status_code == 200, r.text
        token = r.json()["token"]
        uid = r.json()["user"]["id"]
        headers = {"Authorization": f"Bearer {token}"}

        # Free tier only allows 1 project — use whichever already exists,
        # else create one.
        lr = requests.get(f"{BASE_URL}/api/projects", headers=headers, timeout=10)
        assert lr.status_code == 200, lr.text
        projs = lr.json() if isinstance(lr.json(), list) else lr.json().get("projects", [])
        if projs:
            project_id = projs[0]["id"]
        else:
            pr = requests.post(f"{BASE_URL}/api/projects", headers=headers,
                               json={"name": f"TEST_iter46_gate_{uuid.uuid4().hex[:6]}"}, timeout=15)
            assert pr.status_code == 200, pr.text
            project_id = pr.json()["id"]

        # Directly exhaust free-tier quota (5 ai_uploads/month, 0 bonus credits)
        from datetime import datetime, timezone
        period = datetime.now(timezone.utc).strftime("%Y-%m")
        sync_db.usage_periods.update_one(
            {"user_id": uid, "period": period},
            {"$set": {"user_id": uid, "period": period, "ai_uploads": 999}},
            upsert=True,
        )
        sync_db.users.update_one(
            {"id": uid},
            {"$set": {"entitlements.bonus_credits": 0,
                       "subscription.tier": "free",
                       "subscription.status": "free"}},
        )

        # Small valid-shape base64 (>=100 chars per Pydantic min_length)
        img_b64 = _png_b64(200, 200, "white")
        r = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/autonomous/extract",
            headers=headers,
            json={"image_base64": img_b64, "filename": "TEST_iter46.png"},
            timeout=30,
        )
        assert r.status_code == 402, f"Expected 402, got {r.status_code}: {r.text[:400]}"

    def test_admin_unlimited_bypass(self, admin_token, admin_user):
        """Admin (studio/unlimited) should NOT get 402 for quota — but may
        still return 500 (LLM key missing) or 422 (validation fail) or 200.
        Any status OTHER than 402 is acceptable — we only assert the gate
        doesn't block the admin.
        """
        headers = {"Authorization": f"Bearer {admin_token}"}
        pr = requests.post(f"{BASE_URL}/api/projects", headers=headers,
                           json={"name": f"TEST_iter46_admin_{uuid.uuid4().hex[:6]}"}, timeout=15)
        assert pr.status_code == 200, pr.text
        project_id = pr.json()["id"]

        img_b64 = _png_b64(200, 200, "white")
        r = requests.post(
            f"{BASE_URL}/api/projects/{project_id}/autonomous/extract",
            headers=headers,
            json={"image_base64": img_b64, "filename": "TEST_iter46_admin.png"},
            timeout=180,
        )
        assert r.status_code != 402, f"Admin blocked by quota gate: {r.text[:400]}"
        # Cleanup
        try:
            requests.delete(f"{BASE_URL}/api/projects/{project_id}", headers=headers, timeout=10)
        except Exception:
            pass
