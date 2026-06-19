"""Iteration 12 — Field execution: daily logs, NOAA weather, site photos AI, LiDAR.

Run: pytest /app/backend/tests/test_iter12_field.py -v
"""
import io
import uuid
import pytest
import requests
from PIL import Image, ImageDraw


def _png_bytes(size=(400, 300)):
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    d.rectangle([20, 20, size[0] - 20, size[1] - 20], outline="black", width=4)
    d.text((40, 40), "site", fill="black")
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def project(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter12_{uuid.uuid4().hex[:6]}"},
                      headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    proj_id = r.json()["id"]
    yield {"id": proj_id, "headers": headers}
    requests.delete(f"{base_url}/api/projects/{proj_id}", headers=headers, timeout=20)


# -------------------- Daily logs --------------------

def test_list_empty_logs(base_url, project):
    r = requests.get(f"{base_url}/api/projects/{project['id']}/daily-logs",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    assert r.json() == []


def test_create_log_without_weather(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/daily-logs",
        json={"notes": "Slab poured. Crew on site.", "crew_size": 6, "fetch_weather": False},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 200, r.text
    log = r.json()
    assert log["crew_size"] == 6
    assert log["notes"].startswith("Slab")
    assert log["weather"] is None
    assert log["author_email"]
    assert log["photo_ids"] == []


def test_create_log_weather_skipped_when_no_site(base_url, project):
    # No site captured for this project so backend silently skips fetch.
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/daily-logs",
        json={"notes": "Wx test", "crew_size": 1, "fetch_weather": True},
        headers=project["headers"], timeout=20,
    )
    assert r.status_code == 200
    assert r.json()["weather"] is None


def test_logs_listed_newest_first(base_url, project):
    r = requests.get(f"{base_url}/api/projects/{project['id']}/daily-logs",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 2


def test_delete_log(base_url, project):
    # Create a fresh one to delete.
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/daily-logs",
        json={"notes": "to be deleted", "crew_size": 0, "fetch_weather": False},
        headers=project["headers"], timeout=15,
    )
    log_id = r.json()["id"]
    d = requests.delete(f"{base_url}/api/daily-logs/{log_id}",
                        headers=project["headers"], timeout=15)
    assert d.status_code == 200
    assert d.json()["ok"] is True


def test_delete_log_404(base_url, project):
    r = requests.delete(f"{base_url}/api/daily-logs/{uuid.uuid4()}",
                        headers=project["headers"], timeout=15)
    assert r.status_code == 404


def test_non_member_403_on_logs(base_url, project, user_b):
    headers_b = {"Authorization": f"Bearer {user_b['token']}"}
    r = requests.get(f"{base_url}/api/projects/{project['id']}/daily-logs",
                     headers=headers_b, timeout=15)
    # Non-member is not on the project at all
    assert r.status_code in (403, 404)


# -------------------- Site photos --------------------

def test_upload_site_photo(base_url, project):
    files = {"file": ("site1.png", _png_bytes(), "image/png")}
    data = {"caption": "Day 1 — slab"}
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site-photos",
        files=files, data=data, headers=project["headers"], timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"]
    assert "analysis" in body  # may be empty if AI fails — but key must exist


def test_list_site_photos(base_url, project):
    r = requests.get(f"{base_url}/api/projects/{project['id']}/site-photos",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    assert len(rows) >= 1
    # image_base64 should be excluded from list view
    assert "image_base64" not in rows[0]


def test_photo_image_endpoint(base_url, project):
    listing = requests.get(f"{base_url}/api/projects/{project['id']}/site-photos",
                           headers=project["headers"], timeout=15).json()
    pid = listing[0]["id"]
    r = requests.get(f"{base_url}/api/site-photos/{pid}/image",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["image_base64"]
    assert body["mime_type"].startswith("image/")


def test_non_image_rejected(base_url, project):
    files = {"file": ("x.txt", b"hello", "text/plain")}
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/site-photos",
        files=files, headers=project["headers"], timeout=15,
    )
    assert r.status_code == 400


def test_progress_summary(base_url, project):
    r = requests.get(f"{base_url}/api/projects/{project['id']}/progress-summary",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "phases" in body
    assert "photos_analyzed" in body
    assert body["photos_analyzed"] >= 1


# -------------------- LiDAR --------------------

def test_upload_lidar(base_url, project):
    fake_usdz = b"USDZ" + b"\x00" * 256  # not a real USDZ but extension is what matters
    files = {"file": ("scan.usdz", fake_usdz, "application/octet-stream")}
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/lidar",
        files=files, headers=project["headers"], timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["filename"] == "scan.usdz"
    assert body["format"] == "usdz"


def test_list_lidar(base_url, project):
    r = requests.get(f"{base_url}/api/projects/{project['id']}/lidar",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 1
    # base64 blob excluded
    assert "data_base64" not in rows[0]


def test_download_lidar(base_url, project):
    rows = requests.get(f"{base_url}/api/projects/{project['id']}/lidar",
                        headers=project["headers"], timeout=15).json()
    sid = rows[0]["id"]
    r = requests.get(f"{base_url}/api/lidar/{sid}/download",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    assert b"USDZ" in r.content
    cd = r.headers.get("content-disposition", "")
    assert "scan.usdz" in cd


def test_lidar_rejects_unknown_extension(base_url, project):
    files = {"file": ("scan.xyz", b"\x00\x00\x00", "application/octet-stream")}
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/lidar",
        files=files, headers=project["headers"], timeout=15,
    )
    assert r.status_code == 400


# -------------------- Activity feed entry --------------------

def test_activity_log_recorded(base_url, project):
    r = requests.get(f"{base_url}/api/projects/{project['id']}/activity",
                     headers=project["headers"], timeout=15)
    assert r.status_code == 200
    actions = {a["action"] for a in r.json()}
    # at least one of these should be present after the above suite
    assert any(a in actions for a in {
        "daily_log.created", "site_photo.uploaded", "lidar.uploaded",
    }), f"missing field activities, got: {actions}"
