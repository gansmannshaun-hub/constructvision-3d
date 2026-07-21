"""iter52 targeted tests: confirm the reanalyze-with-walls endpoint returns
a FastAPI 422 with `detail` as a LIST of Pydantic error objects when payload
types are invalid. This is the crash-shape the frontend `formatApiError`
must safely stringify.
"""
import os
import uuid
import requests
import pytest


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                return ln.split("=", 1)[1].strip().rstrip("/")
    return ""


BASE_URL = _load_backend_url()
ADMIN_EMAIL = "admin@atlas.app"
ADMIN_PASSWORD = "Open0says3me#*03#*"


@pytest.fixture(scope="module")
def headers():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


def test_422_detail_is_list_of_objects(headers):
    """Send walls as a STRING instead of List[dict] — expect 422 with
    detail as a list of Pydantic error objects (keys: type, loc, msg, input).
    """
    fake_sheet = str(uuid.uuid4())
    r = requests.post(
        f"{BASE_URL}/api/blueprint_sheets/{fake_sheet}/reanalyze-with-walls",
        headers=headers,
        json={"walls": "not-a-list", "building_ft": {"w": 10, "h": 10}},
        timeout=30,
    )
    assert r.status_code == 422, r.text
    body = r.json()
    detail = body.get("detail")
    assert isinstance(detail, list), f"Expected list detail, got: {type(detail).__name__} = {detail}"
    assert len(detail) >= 1
    first = detail[0]
    assert isinstance(first, dict), f"expected dict error item, got {type(first).__name__}"
    # Pydantic v2 error object keys: type, loc, msg, input, ctx (subset)
    assert "msg" in first, f"missing 'msg' in Pydantic error: {first}"
    assert "loc" in first
    # This is EXACTLY the shape that crashed React before the formatApiError fix.
    print(f"[verified] 422 detail shape: {first}")


def test_400_string_detail_shape(headers):
    """Send empty walls array — expect 400 with detail as a STRING.
    Confirms formatApiError's string branch is exercised by real backend.
    Requires a real existing sheet, so we look one up first.
    """
    proj = requests.get(f"{BASE_URL}/api/projects", headers=headers, timeout=30)
    assert proj.status_code == 200
    projects = proj.json()
    if not projects:
        pytest.skip("No projects — can't find a real sheet")
    sheets = None
    for p in projects:
        s = requests.get(f"{BASE_URL}/api/projects/{p['id']}/blueprint/sheets",
                         headers=headers, timeout=30)
        if s.status_code == 200 and s.json():
            sheets = s.json()
            break
    if not sheets:
        pytest.skip("No sheets to hit reanalyze endpoint against")
    r = requests.post(
        f"{BASE_URL}/api/blueprint_sheets/{sheets[0]['id']}/reanalyze-with-walls",
        headers=headers,
        json={"walls": [], "building_ft": {"w": 10, "h": 10}},
        timeout=30,
    )
    assert r.status_code == 400
    detail = r.json().get("detail")
    assert isinstance(detail, str), f"expected str detail, got {type(detail).__name__}"
    assert "No valid walls" in detail
