"""Iteration 13 — AI tools (text→floorplan, schedule/Gantt) and frontend
compliance helpers.

The /ai/floorplan endpoint does a real GPT-4o call — to keep this suite fast and
deterministic, those tests are marked `@pytest.mark.slow` and skipped by default
unless RUN_LLM_TESTS=1.

Run: pytest /app/backend/tests/test_iter13_ai_tools.py -v
"""
import os
import uuid

import pytest
import requests


@pytest.fixture(scope="module")
def project(base_url, user_a):
    headers = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"iter13_{uuid.uuid4().hex[:6]}"},
                      headers=headers, timeout=20)
    assert r.status_code == 200, r.text
    proj_id = r.json()["id"]
    yield {"id": proj_id, "headers": headers}
    requests.delete(f"{base_url}/api/projects/{proj_id}", headers=headers, timeout=20)


# -------------------- Schedule / Gantt --------------------

def test_schedule_default(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 1500, "crew_size": 4},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sqft"] == 1500
    assert body["crew_size"] == 4
    assert len(body["phases"]) == 15
    # phases must be ordered by id
    ids = [p["id"] for p in body["phases"]]
    assert ids == list(range(15))
    # critical path must include at least Site Prep + Foundation + Frame
    crit = body["critical_path"]
    assert 0 in crit and 3 in crit and 5 in crit
    assert body["project_duration_days"] > 0
    assert body["project_duration_weeks"] > 0


def test_schedule_scales_with_sqft(base_url, project):
    small = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 500, "crew_size": 4}, headers=project["headers"], timeout=15,
    ).json()
    big = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 5000, "crew_size": 4}, headers=project["headers"], timeout=15,
    ).json()
    assert big["project_duration_days"] > small["project_duration_days"]


def test_schedule_scales_with_crew(base_url, project):
    solo = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 1500, "crew_size": 2}, headers=project["headers"], timeout=15,
    ).json()
    army = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 1500, "crew_size": 16}, headers=project["headers"], timeout=15,
    ).json()
    assert solo["project_duration_days"] > army["project_duration_days"]


def test_schedule_validation_low(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 50, "crew_size": 4}, headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_schedule_validation_high_crew(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 1500, "crew_size": 100}, headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_schedule_get_after_post(base_url, project):
    requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 2000, "crew_size": 5, "start_date": "2026-03-01"},
        headers=project["headers"], timeout=15,
    )
    r = requests.get(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["sqft"] == 2000
    assert body["crew_size"] == 5
    assert body["start_date"] == "2026-03-01"
    assert body["result"]["project_duration_days"] > 0


def test_critical_path_phases(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 1500, "crew_size": 4}, headers=project["headers"], timeout=15,
    ).json()
    crit_ids = set(r["critical_path"])
    # Sequential trunk should be on critical path
    for needed in (0, 3, 5, 14):
        assert needed in crit_ids, f"expected phase {needed} on critical path"


def test_phase_dependencies_respected(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/schedule",
        json={"sqft": 1500, "crew_size": 4}, headers=project["headers"], timeout=15,
    ).json()
    by_id = {p["id"]: p for p in r["phases"]}
    for p in r["phases"]:
        for dep in p["depends_on"]:
            assert by_id[dep]["end_day"] <= p["start_day"] + 1e-6


# -------------------- AI Floorplan --------------------

def test_floorplan_validation_short(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/floorplan",
        json={"prompt": "x"},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_floorplan_validation_long(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/floorplan",
        json={"prompt": "x" * 700},
        headers=project["headers"], timeout=15,
    )
    assert r.status_code == 422


def test_floorplan_403_non_member(base_url, project, user_b):
    headers_b = {"Authorization": f"Bearer {user_b['token']}"}
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/floorplan",
        json={"prompt": "A 1000 sqft 2-bed cottage on a 40x60 lot"},
        headers=headers_b, timeout=15,
    )
    assert r.status_code in (403, 404)


@pytest.mark.slow
@pytest.mark.skipif(os.environ.get("RUN_LLM_TESTS") != "1", reason="set RUN_LLM_TESTS=1 to hit GPT")
def test_floorplan_generates_walls(base_url, project):
    r = requests.post(
        f"{base_url}/api/projects/{project['id']}/ai/floorplan",
        json={"prompt": "A 1000 sqft 2-bed cottage on a 40x60 lot", "replace": True},
        headers=project["headers"], timeout=90,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"]["walls"] > 0
    # blueprint should now reflect the AI plan
    bp = requests.get(
        f"{base_url}/api/projects/{project['id']}/blueprint",
        headers=project["headers"], timeout=15,
    ).json()
    assert len(bp["walls"]) == body["counts"]["walls"]
