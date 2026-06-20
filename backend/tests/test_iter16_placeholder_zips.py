"""Iter16 — quick sanity: placeholder/repdigit zips must fall back to multiplier=1.0."""
import os
import uuid
import pytest
import requests
from pathlib import Path

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "")
if not BASE_URL:
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = BASE_URL.rstrip("/")


def _make_project(token):
    r = requests.post(
        f"{BASE_URL}/api/projects",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": f"TEST_iter16_zip_{uuid.uuid4().hex[:6]}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.mark.parametrize("zip_code", ["00000", "11111", "22222", "99999"])
def test_placeholder_zip_fallback_one(user_a, zip_code):
    pid = _make_project(user_a["token"])
    r = requests.patch(
        f"{BASE_URL}/api/projects/{pid}/pricing",
        headers={"Authorization": f"Bearer {user_a['token']}"},
        json={"zip": zip_code},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    cfg = body.get("config", body)
    assert cfg["regional_multiplier"] == 1.0, f"zip {zip_code} → {cfg.get('regional_multiplier')} (expected 1.0)"
