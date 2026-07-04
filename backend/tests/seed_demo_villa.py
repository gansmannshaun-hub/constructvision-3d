"""
Seed a rich demo project so we can capture real in-app screenshots for the
landing / apps/atlas marketing surfaces. Idempotent — running twice just
updates the same "Demo · Villa Atlas" project.
"""
import os, sys, json, requests

API = os.environ.get("API", "http://localhost:8001")
EMAIL = "admin@atlas.app"
PASSWORD = "Open0says3me#*03#*"

def login():
    r = requests.post(f"{API}/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    return r.json()["token"]

def find_or_create(token, name):
    h = {"Authorization": f"Bearer {token}"}
    projects = requests.get(f"{API}/api/projects", headers=h).json()
    for p in projects:
        if p["name"] == name:
            return p["id"]
    r = requests.post(f"{API}/api/projects", headers=h, json={"name": name})
    r.raise_for_status()
    return r.json()["id"]

def seed_blueprint(token, pid):
    h = {"Authorization": f"Bearer {token}"}
    # A tidy 3BR / 2BA floor plan — 40' x 28' bounding box.
    walls = [
        # exterior
        {"id": "w-ext-1",  "start": [0, 0],   "end": [40, 0]},
        {"id": "w-ext-2",  "start": [40, 0],  "end": [40, 28]},
        {"id": "w-ext-3",  "start": [40, 28], "end": [0, 28]},
        {"id": "w-ext-4",  "start": [0, 28],  "end": [0, 0]},
        # interior horizontal — living/kitchen -> bedrooms
        {"id": "w-int-1",  "start": [0, 14],  "end": [22, 14]},
        {"id": "w-int-2",  "start": [26, 14], "end": [40, 14]},
        # kitchen/living divider
        {"id": "w-int-3",  "start": [16, 14], "end": [16, 28]},
        # bedroom split
        {"id": "w-int-4",  "start": [14, 0],  "end": [14, 14]},
        {"id": "w-int-5",  "start": [28, 0],  "end": [28, 14]},
        # bath partition
        {"id": "w-int-6",  "start": [28, 8],  "end": [40, 8]},
    ]
    doors = [
        {"id": "d1", "wall_id": "w-ext-1", "position": [20, 0], "width": 3, "swing": "in"},
        {"id": "d2", "wall_id": "w-int-1", "position": [8, 14],  "width": 2.5, "swing": "in"},
        {"id": "d3", "wall_id": "w-int-4", "position": [14, 6],  "width": 2.5, "swing": "in"},
        {"id": "d4", "wall_id": "w-int-5", "position": [28, 4],  "width": 2.5, "swing": "in"},
        {"id": "d5", "wall_id": "w-int-6", "position": [34, 8],  "width": 2.5, "swing": "in"},
        {"id": "d6", "wall_id": "w-int-2", "position": [32, 14], "width": 2.5, "swing": "in"},
    ]
    windows = [
        {"id": "wn1", "wall_id": "w-ext-1", "position": [6, 0],   "width": 4},
        {"id": "wn2", "wall_id": "w-ext-1", "position": [32, 0],  "width": 4},
        {"id": "wn3", "wall_id": "w-ext-3", "position": [8, 28],  "width": 5},
        {"id": "wn4", "wall_id": "w-ext-3", "position": [24, 28], "width": 4},
        {"id": "wn5", "wall_id": "w-ext-2", "position": [40, 20], "width": 3},
        {"id": "wn6", "wall_id": "w-ext-4", "position": [0, 20],  "width": 3},
    ]
    labels = [
        {"id": "l1", "position": [8, 21],  "text": "BEDROOM 01", "font_size": 1.4},
        {"id": "l2", "position": [21, 21], "text": "LIVING",     "font_size": 1.8},
        {"id": "l3", "position": [33, 21], "text": "KITCHEN",    "font_size": 1.6},
        {"id": "l4", "position": [7,  7],  "text": "BEDROOM 02", "font_size": 1.4},
        {"id": "l5", "position": [21, 7],  "text": "BEDROOM 03", "font_size": 1.4},
        {"id": "l6", "position": [33, 4],  "text": "BATH",       "font_size": 1.3},
        {"id": "l7", "position": [33, 11], "text": "LAUNDRY",    "font_size": 1.1},
    ]
    fixtures = [
        {"id": "f1", "type": "sink",    "position": [30, 20], "rotation": 0},
        {"id": "f2", "type": "stove",   "position": [37, 20], "rotation": 0},
        {"id": "f3", "type": "toilet",  "position": [31, 5],  "rotation": 90},
        {"id": "f4", "type": "shower",  "position": [37, 5],  "rotation": 0},
    ]
    r = requests.put(
        f"{API}/api/projects/{pid}/blueprint",
        headers=h,
        json={
            "walls": walls, "doors": doors, "windows": windows,
            "labels": labels, "fixtures": fixtures,
            "roof_type": "gable", "roof_pitch_deg": 30,
            "wall_color": "#c9a76b", "roof_color": "#4a3020",
        },
    )
    r.raise_for_status()
    print("Blueprint saved:", pid, "walls=", len(walls))

def seed_materials(token, pid):
    h = {"Authorization": f"Bearer {token}"}
    materials = [
        {"name": "2x4 x 8' STUD",         "quantity": 320, "unit": "EA",  "category": "framing",   "unit_price": 4.85},
        {"name": "5/8\" DRYWALL SHEET",   "quantity":  84, "unit": "EA",  "category": "finish",    "unit_price": 15.20},
        {"name": "ASPHALT SHINGLE BUNDLE","quantity":  38, "unit": "BND", "category": "roofing",   "unit_price": 42.00},
        {"name": "PEX 1/2\" PIPE",        "quantity": 240, "unit": "LF",  "category": "plumbing",  "unit_price": 0.80},
        {"name": "12/2 ROMEX",            "quantity": 500, "unit": "LF",  "category": "electrical","unit_price": 0.62},
        {"name": "SLAB CONCRETE 3000PSI", "quantity":  22, "unit": "CY",  "category": "concrete",  "unit_price": 165.00},
        {"name": "ANDERSEN 3050 WINDOW",  "quantity":   6, "unit": "EA",  "category": "openings",  "unit_price": 385.00},
        {"name": "R-19 BATT INSULATION",  "quantity":  95, "unit": "BAG", "category": "insulation","unit_price": 48.50},
    ]
    # Try /api/projects/{id}/materials — different possible endpoints
    r = requests.post(f"{API}/api/projects/{pid}/materials/bulk", headers=h, json={"materials": materials})
    if r.status_code >= 400:
        # fallback: post one by one
        for m in materials:
            requests.post(f"{API}/api/projects/{pid}/materials", headers=h, json=m)
    print("Materials seeded")

if __name__ == "__main__":
    token = login()
    pid = find_or_create(token, "Demo · Villa Atlas")
    print("Project:", pid)
    seed_blueprint(token, pid)
    try:
        seed_materials(token, pid)
    except Exception as e:
        print("Materials seeding non-fatal error:", e)
    print("\nDONE — open /app and select 'Demo · Villa Atlas'.")
