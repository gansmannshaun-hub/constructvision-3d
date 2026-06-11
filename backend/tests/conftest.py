import os
import uuid
import pytest
import requests
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Read from /app/frontend/.env
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = (BASE_URL or "").rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def floor_plan_png(tmp_path_factory):
    """Generate a realistic-looking floor plan PNG (real visual features: walls, doors, rooms, labels)."""
    img = Image.new("RGB", (900, 700), "white")
    d = ImageDraw.Draw(img)
    # Outer wall (thick rectangle)
    d.rectangle([60, 60, 840, 640], outline="black", width=8)
    # Interior walls
    d.line([(450, 60), (450, 380)], fill="black", width=6)
    d.line([(60, 380), (840, 380)], fill="black", width=6)
    d.line([(250, 380), (250, 640)], fill="black", width=6)
    d.line([(600, 380), (600, 640)], fill="black", width=6)
    # Doors (gaps + arcs)
    d.rectangle([280, 376, 340, 384], fill="white", outline="white")
    d.arc([280, 350, 340, 410], start=180, end=270, fill="black", width=2)
    d.rectangle([700, 376, 760, 384], fill="white", outline="white")
    d.arc([700, 350, 760, 410], start=180, end=270, fill="black", width=2)
    d.rectangle([446, 200, 454, 260], fill="white", outline="white")
    # Windows (double lines)
    d.line([(150, 56), (220, 56)], fill="black", width=2)
    d.line([(150, 64), (220, 64)], fill="black", width=2)
    d.line([(600, 56), (700, 56)], fill="black", width=2)
    d.line([(600, 64), (700, 64)], fill="black", width=2)
    d.line([(836, 200), (844, 200)], fill="black", width=2)
    # Room labels
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    d.text((180, 200), "LIVING ROOM", fill="black", font=font)
    d.text((580, 180), "KITCHEN", fill="black", font=font)
    d.text((110, 480), "BEDROOM 1", fill="black", font=font)
    d.text((340, 480), "BATH", fill="black", font=font)
    d.text((660, 480), "BEDROOM 2", fill="black", font=font)
    # Dimension marks
    d.text((400, 30), "FLOOR PLAN - 1200 sqft", fill="black", font=font)
    d.line([(60, 660), (840, 660)], fill="gray", width=1)
    d.text((430, 665), "40 ft", fill="gray", font=font)

    p = tmp_path_factory.mktemp("imgs") / "floor_plan.png"
    img.save(p, "PNG")
    return str(p)


@pytest.fixture(scope="session")
def user_a(base_url):
    email = f"test_a_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{base_url}/api/auth/register", json={
        "email": email, "password": "TestPass123!", "name": "User A"
    }, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "password": "TestPass123!", "token": data["token"], "user": data["user"]}


@pytest.fixture(scope="session")
def user_b(base_url):
    email = f"test_b_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{base_url}/api/auth/register", json={
        "email": email, "password": "TestPass123!", "name": "User B"
    }, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"email": email, "password": "TestPass123!", "token": data["token"], "user": data["user"]}


@pytest.fixture
def auth_headers_a(user_a):
    return {"Authorization": f"Bearer {user_a['token']}"}


@pytest.fixture
def auth_headers_b(user_b):
    return {"Authorization": f"Bearer {user_b['token']}"}
