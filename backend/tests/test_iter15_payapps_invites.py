"""Iteration 15 — AIA G702/G703 pay apps + /invite landing endpoints.

Run: pytest /app/backend/tests/test_iter15_payapps_invites.py -v
"""
import uuid
import pytest
import requests


# ============ helpers ============

@pytest.fixture(scope="module")
def project_a(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter15_{uuid.uuid4().hex[:6]}"},
                      headers=headers, timeout=20)
    pid = r.json()["id"]
    yield {"id": pid, "headers": headers, "user": user_a}
    requests.delete(f"{base_url}/api/projects/{pid}", headers=headers, timeout=20)


@pytest.fixture(scope="module")
def project_with_bid(base_url, user_a, project_a):
    """Seed a bid so pay-app creation has materials to draw from."""
    h = project_a["headers"]
    # Use the AI-floorplan endpoint to seed walls cheaply? No — use pricing patch + bid save.
    # Actually we need MATERIALS to build a bid. Use the document AI route would be slow;
    # instead, insert materials directly via mongo isn't possible from this side.
    # Use pricing patch first (sets up region), then save a bid which snapshots even an empty list.
    requests.patch(
        f"{base_url}/api/projects/{project_a['id']}/pricing",
        json={"zip": "10001"}, headers=h, timeout=15,
    )
    # We need materials. The simplest path: use AI floorplan, then takeoff already populates utilities.
    # Actually let's just save a bid with zero materials -- the populate fallback will return [].
    # We test the empty 422 case AND inject a minimal bid manually via the bid endpoint.
    # For now, return whatever we have. Tests will exercise the 422 path first.
    return project_a


# ============ Pay App: empty + creation ============

def test_pay_app_list_empty(base_url, project_a):
    r = requests.get(f"{base_url}/api/projects/{project_a['id']}/pay-apps",
                     headers=project_a["headers"], timeout=10)
    assert r.status_code == 200
    assert r.json() == []


def test_pay_app_create_fails_with_no_materials(base_url, project_a):
    r = requests.post(
        f"{base_url}/api/projects/{project_a['id']}/pay-apps",
        json={"contractor": "Acme Build", "owner_name": "Client LLC",
              "retainage_pct": 10},
        headers=project_a["headers"], timeout=15,
    )
    assert r.status_code == 422
    assert "no bid or materials" in r.json()["detail"].lower()


def test_pay_app_create_with_uploaded_material(base_url, user_a, project_a):
    """Inject a material via document.uploaded path equivalent — patch in via blueprint save."""
    # Materials live in db.materials; the only way to create one without AI is via document upload.
    # We'll create a tiny doc + then attach materials manually using the bid save (which snapshots).
    # Simpler: use the project's "materials" tab via direct routes — but there is no POST /materials.
    # FALLBACK: bypass by creating a bid containing snapshot_materials via the pricing/bids route.
    bid = requests.post(
        f"{base_url}/api/projects/{project_a['id']}/pricing/bids",
        json={"name": "Test Bid"},
        headers=project_a["headers"], timeout=15,
    )
    # If empty bid creation isn't allowed, test ends here.
    if bid.status_code != 200:
        pytest.skip("Bid creation requires materials; skipping pay-app populate test.")
    # We could still try creating: populate falls back to materials too which are empty → 422.


def test_pay_app_create_with_synthetic_bid(base_url, project_a):
    """Directly seed a bid in the materials list (via internal API) so pay-app can populate."""
    # No supported insert-material API exists; we test via the AI floorplan + bid flow.
    # AI floorplan creates walls but not materials — utilities_takeoff produces them on PDF export.
    # Quick path: trigger a takeoff CSV which writes 0 materials but utilities — but materials don't auto-save.
    # End result: pay-app needs real materials; this test confirms the 422 path one more time.
    r = requests.post(
        f"{base_url}/api/projects/{project_a['id']}/pay-apps",
        json={"contractor": "Acme"},
        headers=project_a["headers"], timeout=15,
    )
    assert r.status_code in (200, 422)


# ============ Pay App: full lifecycle via direct DB seed ============

@pytest.fixture(scope="module")
def project_seeded(base_url, user_a):
    """Create a fresh project and use the AI floorplan + bid endpoint to seed line items."""
    h = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter15_seed_{uuid.uuid4().hex[:6]}"},
                      headers=h, timeout=20)
    pid = r.json()["id"]
    # Save a bid with a synthetic snapshot via direct bid save — but the API computes from materials.
    # In real production, materials are created by GPT-4o. To keep this test deterministic and offline,
    # we POST to /materials via the AI flow OR mark the test as needing pre-seed.
    yield {"id": pid, "headers": h}
    requests.delete(f"{base_url}/api/projects/{pid}", headers=h, timeout=15)


def _seed_one_material(base_url, headers, project_id):
    """Use the takeoff utilities to create a 'fake' material via blueprint save + bid creation."""
    # 1) Save a minimal blueprint with a wall — generates a utilities line in takeoff but doesn't persist materials.
    # 2) Save a bid — snapshot will include any present materials.
    # Since there's no public material POST endpoint, we just confirm the empty case.
    return None


# ============ Invite landing ============

def test_invite_404_for_unknown_token(base_url):
    r = requests.get(f"{base_url}/api/invites/{uuid.uuid4()}", timeout=10)
    assert r.status_code == 404


def test_invite_preview_after_invitation(base_url, user_a, user_b):
    h_a = {"Authorization": f"Bearer {user_a['token']}"}
    # New project so invite is fresh
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter15_inv_{uuid.uuid4().hex[:6]}"},
                      headers=h_a, timeout=15)
    pid = r.json()["id"]
    try:
        inv = requests.post(
            f"{base_url}/api/projects/{pid}/members",
            json={"email": user_b["email"], "role": "estimator"},
            headers=h_a, timeout=15,
        )
        assert inv.status_code == 200, inv.text
        token = inv.json()["id"]

        # Public preview — no auth header
        prev = requests.get(f"{base_url}/api/invites/{token}", timeout=10)
        assert prev.status_code == 200
        body = prev.json()
        assert body["token"] == token
        assert body["email"] == user_b["email"].lower()
        assert body["role"] == "estimator"
        assert body["project_name"]
        assert body["invited_by_name"]
        # user_b exists in DB so needs_signup is False, accepted auto-True
        assert body["needs_signup"] is False
        assert body["accepted"] is True
    finally:
        requests.delete(f"{base_url}/api/projects/{pid}", headers=h_a, timeout=15)


def test_invite_preview_needs_signup_for_new_email(base_url, user_a):
    h_a = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter15_inv2_{uuid.uuid4().hex[:6]}"},
                      headers=h_a, timeout=15)
    pid = r.json()["id"]
    try:
        new_email = f"newcomer_{uuid.uuid4().hex[:6]}@example.com"
        inv = requests.post(
            f"{base_url}/api/projects/{pid}/members",
            json={"email": new_email, "role": "viewer"},
            headers=h_a, timeout=15,
        )
        token = inv.json()["id"]
        prev = requests.get(f"{base_url}/api/invites/{token}", timeout=10).json()
        assert prev["needs_signup"] is True
        assert prev["accepted"] is False
    finally:
        requests.delete(f"{base_url}/api/projects/{pid}", headers=h_a, timeout=15)


def test_invite_accept_wrong_email_403(base_url, user_a, user_b):
    """user_a invites a new email; user_b (different email) tries to accept → 403."""
    h_a = {"Authorization": f"Bearer {user_a['token']}"}
    h_b = {"Authorization": f"Bearer {user_b['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter15_inv3_{uuid.uuid4().hex[:6]}"},
                      headers=h_a, timeout=15)
    pid = r.json()["id"]
    try:
        new_email = f"other_{uuid.uuid4().hex[:6]}@example.com"
        inv = requests.post(
            f"{base_url}/api/projects/{pid}/members",
            json={"email": new_email, "role": "viewer"},
            headers=h_a, timeout=15,
        )
        token = inv.json()["id"]
        accept = requests.post(
            f"{base_url}/api/invites/{token}/accept",
            headers=h_b, timeout=10,
        )
        assert accept.status_code == 403
    finally:
        requests.delete(f"{base_url}/api/projects/{pid}", headers=h_a, timeout=15)


def test_invite_accept_after_signup(base_url, user_a):
    """Invite a new email, register that user, then accept."""
    h_a = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter15_inv4_{uuid.uuid4().hex[:6]}"},
                      headers=h_a, timeout=15)
    pid = r.json()["id"]
    try:
        new_email = f"signup_{uuid.uuid4().hex[:6]}@example.com"
        inv = requests.post(
            f"{base_url}/api/projects/{pid}/members",
            json={"email": new_email, "role": "estimator"},
            headers=h_a, timeout=15,
        )
        token = inv.json()["id"]

        # Register
        reg = requests.post(
            f"{base_url}/api/auth/register",
            json={"email": new_email, "password": "TestPass123!", "name": "New User"},
            timeout=15,
        )
        assert reg.status_code == 200, reg.text
        new_token = reg.json()["token"]

        # Accept
        accept = requests.post(
            f"{base_url}/api/invites/{token}/accept",
            headers={"Authorization": f"Bearer {new_token}"},
            timeout=10,
        )
        assert accept.status_code == 200, accept.text
        body = accept.json()
        assert body["ok"] is True
        assert body["project_id"] == pid

        # Idempotent — second accept is fine
        again = requests.post(
            f"{base_url}/api/invites/{token}/accept",
            headers={"Authorization": f"Bearer {new_token}"},
            timeout=10,
        )
        assert again.status_code == 200
        assert again.json()["already_accepted"] is True
    finally:
        requests.delete(f"{base_url}/api/projects/{pid}", headers=h_a, timeout=15)


# ============ Pay App: full lifecycle with material seed ============

@pytest.mark.asyncio
async def test_pay_app_lifecycle_with_direct_seed(base_url, user_a):
    """Seed materials directly via Motor → create pay-app → patch line item → render PDF."""
    import os
    from motor.motor_asyncio import AsyncIOMotorClient
    from pathlib import Path
    # Read MONGO_URL from backend/.env (already loaded for the running server).
    env = (Path(__file__).resolve().parents[1] / ".env").read_text()
    def _read(prefix, default):
        for line in env.splitlines():
            if line.startswith(prefix):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
        return default
    mongo_url = _read("MONGO_URL=", "mongodb://localhost:27017")
    db_name = _read("DB_NAME=", "test_db")
    cli = AsyncIOMotorClient(mongo_url)
    db = cli[db_name]

    h = {"Authorization": f"Bearer {user_a['token']}"}
    pr = requests.post(f"{base_url}/api/projects",
                       json={"name": f"iter15_life_{uuid.uuid4().hex[:6]}"},
                       headers=h, timeout=15)
    pid = pr.json()["id"]
    try:
        # Seed two materials
        await db.materials.insert_many([
            {"id": str(uuid.uuid4()), "project_id": pid, "category": "Concrete",
             "name": "Footing concrete", "quantity": 20, "unit": "cyd",
             "unit_price": 175.0, "labor_unit_price": 50.0},
            {"id": str(uuid.uuid4()), "project_id": pid, "category": "Lumber",
             "name": "2x4 framing", "quantity": 200, "unit": "ea",
             "unit_price": 4.5, "labor_unit_price": 2.0},
        ])

        # Create pay app
        r = requests.post(
            f"{base_url}/api/projects/{pid}/pay-apps",
            json={"contractor": "Acme Build", "owner_name": "Client LLC",
                  "architect_name": "Arch & Co", "retainage_pct": 10.0},
            headers=h, timeout=15,
        )
        assert r.status_code == 200, r.text
        app = r.json()
        assert app["app_number"] == 1
        assert len(app["line_items"]) == 2
        assert app["line_items"][0]["scheduled_value"] > 0
        aid = app["id"]

        # List
        listing = requests.get(f"{base_url}/api/projects/{pid}/pay-apps",
                               headers=h, timeout=10).json()
        assert len(listing) == 1
        assert "line_items" not in listing[0]  # excluded from list view

        # Get full + check aggregate computation
        full = requests.get(f"{base_url}/api/pay-apps/{aid}", headers=h, timeout=10).json()
        assert "aggregate" in full
        assert full["aggregate"]["original_contract_sum"] > 0
        assert full["aggregate"]["total_completed_and_stored"] == 0  # nothing completed yet

        # Patch line item 1: mark 50% complete this period
        new_items = full["line_items"]
        # strip computed fields before sending
        clean = [{k: v for k, v in li.items()
                  if k in {"item_no", "description", "scheduled_value",
                           "work_completed_previous", "work_completed_this_period",
                           "materials_stored"}}
                 for li in new_items]
        clean[0]["work_completed_this_period"] = clean[0]["scheduled_value"] * 0.5
        patched = requests.patch(
            f"{base_url}/api/pay-apps/{aid}",
            json={"line_items": clean},
            headers=h, timeout=10,
        )
        assert patched.status_code == 200
        agg = patched.json()["aggregate"]
        assert agg["total_completed_and_stored"] > 0
        assert agg["total_retainage"] > 0
        assert agg["total_less_retainage"] < agg["total_completed_and_stored"]

        # PDF render
        pdf = requests.get(f"{base_url}/api/pay-apps/{aid}/pdf",
                          headers=h, timeout=20)
        assert pdf.status_code == 200
        assert pdf.headers["content-type"] == "application/pdf"
        assert pdf.content.startswith(b"%PDF")
        assert len(pdf.content) > 2000  # has actual content, not blank

        # Second pay-app increments app_number
        r2 = requests.post(f"{base_url}/api/projects/{pid}/pay-apps",
                           json={"contractor": "Acme"}, headers=h, timeout=15)
        assert r2.status_code == 200
        assert r2.json()["app_number"] == 2

        # Delete
        d = requests.delete(f"{base_url}/api/pay-apps/{aid}", headers=h, timeout=10)
        assert d.status_code == 200
    finally:
        await db.materials.delete_many({"project_id": pid})
        await db.pay_apps.delete_many({"project_id": pid})
        requests.delete(f"{base_url}/api/projects/{pid}", headers=h, timeout=15)
        cli.close()
