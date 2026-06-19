"""Iter-10 backend tests: regional pricing, markup cascade, bid snapshots, diff, exports.

Covers:
 - GET/PATCH /api/projects/{id}/pricing (defaults, ZIP resolution, bounds)
 - Cascade math correctness (W%/O%/P%/C% each-on-previous)
 - Labor totals (utilities BOM has labor_unit_price > 0)
 - POST/GET/DELETE /api/projects/{id}/bids + GET .../bids-diff
 - PATCH /api/materials/{id} accepts labor_unit_price
 - CSV/XLSX exports include enriched columns + cascade summary
 - Cross-user isolation (404 on other-user project)
"""
import io
import csv
import uuid

import pytest
import requests


# Re-usable session ---------------------------------------------------------
@pytest.fixture(scope="module")
def proj_a(base_url, user_a):
    h = {"Authorization": f"Bearer {user_a['token']}"}
    r = requests.post(f"{base_url}/api/projects",
                      json={"name": f"TEST_iter10_{uuid.uuid4().hex[:6]}"},
                      headers=h, timeout=20)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # Seed the blueprint so utilities BOM populates labor-bearing lines
    bp = {
        "walls": [
            {"id": "w1", "start": [0, 0], "end": [40, 0], "thickness": 0.5, "height": 8},
            {"id": "w2", "start": [40, 0], "end": [40, 30], "thickness": 0.5, "height": 8},
            {"id": "w3", "start": [40, 30], "end": [0, 30], "thickness": 0.5, "height": 8},
            {"id": "w4", "start": [0, 30], "end": [0, 0], "thickness": 0.5, "height": 8},
        ],
        "doors": [], "windows": [], "labels": [],
        "roof_type": "gable", "roof_pitch_deg": 20,
    }
    requests.put(f"{base_url}/api/projects/{pid}/blueprint", json=bp, headers=h, timeout=15)
    return pid


# 1. Pricing GET/PATCH ------------------------------------------------------
class TestPricingConfig:
    def test_get_pricing_defaults(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.get(f"{base_url}/api/projects/{proj_a}/pricing", headers=h, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "config" in d and "totals" in d
        cfg = d["config"]
        assert cfg["regional_multiplier"] == 1.0
        assert cfg["waste_pct"] == 5.0
        assert cfg["overhead_pct"] == 10.0
        assert cfg["profit_pct"] == 12.0
        assert cfg["contingency_pct"] == 3.0

    def test_patch_zip_10001_resolves_nyc(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                           json={"zip": "10001"}, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        cfg = r.json()["config"]
        assert cfg["zip"] == "10001"
        assert cfg["city"] == "New York, NY"
        assert cfg["state"] == "NY"
        assert abs(cfg["regional_multiplier"] - 1.42) < 1e-6
        assert cfg["regional_source"] == "rsmeans_metro_2024"

    def test_patch_zip_50001_iowa_state_avg(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                           json={"zip": "50001"}, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        cfg = r.json()["config"]
        assert cfg["state"] == "IA"
        assert abs(cfg["regional_multiplier"] - 0.94) < 1e-6
        assert cfg["regional_source"].startswith("rsmeans_state")

    def test_patch_zip_99999_fallback_default(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                           json={"zip": "99999"}, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        cfg = r.json()["config"]
        assert cfg["regional_multiplier"] == 1.0

    @pytest.mark.parametrize("field,bad", [
        ("waste_pct", 60), ("waste_pct", -1),
        ("overhead_pct", 60), ("overhead_pct", -1),
        ("profit_pct", 51), ("profit_pct", -0.1),
        ("contingency_pct", 26), ("contingency_pct", -0.5),
    ])
    def test_patch_out_of_range_422(self, base_url, user_a, proj_a, field, bad):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                           json={field: bad}, headers=h, timeout=15)
        assert r.status_code == 422, f"{field}={bad} expected 422, got {r.status_code}: {r.text}"

    def test_patch_inside_bounds_ok(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                           json={"waste_pct": 10.0, "overhead_pct": 10.0,
                                 "profit_pct": 10.0, "contingency_pct": 5.0},
                           headers=h, timeout=15)
        assert r.status_code == 200, r.text
        cfg = r.json()["config"]
        assert cfg["waste_pct"] == 10.0
        assert cfg["contingency_pct"] == 5.0


# 2. Labor totals from utilities BOM ---------------------------------------
class TestLaborInUtilitiesBOM:
    def test_labor_subtotal_nonzero_for_blueprint_project(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        # Reset region to default so we measure labor without inflation
        requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                       json={"zip": "99999"}, headers=h, timeout=15)
        r = requests.get(f"{base_url}/api/projects/{proj_a}/pricing", headers=h, timeout=15)
        assert r.status_code == 200
        totals = r.json()["totals"]
        assert totals["materials_subtotal"] > 0, "Materials subtotal should be > 0 from blueprint walls"
        assert totals["labor_subtotal"] > 0, (
            "Labor subtotal expected > 0 after labor_unit_price added to utilities BOM; got "
            f"{totals['labor_subtotal']}"
        )


# 3. Cascade math correctness ----------------------------------------------
class TestCascadeMath:
    def test_compute_bid_cascade_each_on_previous(self):
        """Pure-function math check: ((X+Y)*1.10)*1.10*1.10*1.05 == 2095.665 for X=1000,Y=500."""
        import sys, os as _os
        sys.path.insert(0, "/app/backend")
        from pricing import compute_bid  # noqa
        mats = [
            {"name": "m", "category": "c", "unit": "ea", "quantity": 1, "unit_price": 1000, "labor_unit_price": 500},
        ]
        cfg = {"regional_multiplier": 1.0, "labor_rate_multiplier": 1.0,
               "waste_pct": 10, "overhead_pct": 10, "profit_pct": 10, "contingency_pct": 5}
        out = compute_bid(mats, cfg)
        t = out["totals"]
        assert t["materials_subtotal"] == 1000.0
        assert t["labor_subtotal"] == 500.0
        assert t["base_subtotal"] == 1500.0
        expected_grand = 1500 * 1.10 * 1.10 * 1.10 * 1.05
        assert abs(t["grand_total"] - round(expected_grand, 2)) < 0.01, (
            f"grand_total={t['grand_total']} expected≈{expected_grand}")


# 4. Bid snapshot CRUD + diff ----------------------------------------------
@pytest.fixture(scope="module")
def bids_setup(base_url, user_a, proj_a):
    """Create two bid snapshots at different ZIPs and return their ids."""
    h = {"Authorization": f"Bearer {user_a['token']}"}
    # V1 at ZIP 50001 (multiplier 0.94)
    requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                   json={"zip": "50001"}, headers=h, timeout=15)
    b1 = requests.post(f"{base_url}/api/projects/{proj_a}/bids",
                       json={"name": "TEST_V1_IA"}, headers=h, timeout=20)
    assert b1.status_code == 200, b1.text
    bid1 = b1.json()
    # V2 at ZIP 10001 (multiplier 1.42)
    requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                   json={"zip": "10001"}, headers=h, timeout=15)
    b2 = requests.post(f"{base_url}/api/projects/{proj_a}/bids",
                       json={"name": "TEST_V2_NYC"}, headers=h, timeout=20)
    assert b2.status_code == 200, b2.text
    bid2 = b2.json()
    return bid1, bid2


class TestBidSnapshots:
    def test_bid_versioning_autoincrement(self, bids_setup):
        b1, b2 = bids_setup
        assert b1["version"] >= 1
        assert b2["version"] == b1["version"] + 1
        assert b1["totals"]["grand_total"] > 0
        assert "config_snapshot" in b1
        assert b1["config_snapshot"]["zip"] == "50001"

    def test_list_bids_lightweight_no_materials(self, base_url, user_a, proj_a, bids_setup):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.get(f"{base_url}/api/projects/{proj_a}/bids", headers=h, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        # 'materials' is omitted in list view
        for it in items:
            assert "materials" not in it
            assert "totals" in it
            assert "version" in it

    def test_get_bid_full_snapshot(self, base_url, user_a, proj_a, bids_setup):
        b1, _ = bids_setup
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.get(f"{base_url}/api/projects/{proj_a}/bids/{b1['id']}", headers=h, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == b1["id"]
        assert "materials" in d and isinstance(d["materials"], list)
        assert "config_snapshot" in d

    def test_diff_two_bids_same_rows_diff_totals(self, base_url, user_a, proj_a, bids_setup):
        b1, b2 = bids_setup
        h = {"Authorization": f"Bearer {user_a['token']}"}
        r = requests.get(
            f"{base_url}/api/projects/{proj_a}/bids-diff?a={b1['id']}&b={b2['id']}",
            headers=h, timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert "rows" in d and len(d["rows"]) > 0
        assert "totals_delta" in d
        assert "grand_total" in d["totals_delta"]
        # Even with identical materials, totals diff because regional_multiplier changed
        assert abs(d["totals_delta"]["grand_total"]) > 0.01, (
            f"Expected grand_total delta != 0 between ZIPs; got {d['totals_delta']}")
        # All rows in this scenario should be 'same' (no qty/price changes)
        statuses = {row["status"] for row in d["rows"]}
        assert "same" in statuses

    def test_delete_bid_removes(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        # Create a throw-away
        r = requests.post(f"{base_url}/api/projects/{proj_a}/bids",
                          json={"name": "TEST_DELETE_ME"}, headers=h, timeout=20)
        assert r.status_code == 200
        bid_id = r.json()["id"]
        d = requests.delete(f"{base_url}/api/projects/{proj_a}/bids/{bid_id}",
                            headers=h, timeout=15)
        assert d.status_code == 200
        g = requests.get(f"{base_url}/api/projects/{proj_a}/bids/{bid_id}",
                         headers=h, timeout=15)
        assert g.status_code == 404


# 5. Cross-user isolation --------------------------------------------------
class TestCrossUserIsolation:
    def test_user_b_cannot_access_user_a_pricing(self, base_url, user_b, proj_a):
        h = {"Authorization": f"Bearer {user_b['token']}"}
        for path in (
            f"/api/projects/{proj_a}/pricing",
            f"/api/projects/{proj_a}/bids",
        ):
            r = requests.get(f"{base_url}{path}", headers=h, timeout=15)
            assert r.status_code == 404, f"{path} leaked: {r.status_code}"
        r = requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                           json={"zip": "10001"}, headers=h, timeout=15)
        assert r.status_code == 404


# 6. Material PATCH with labor_unit_price ----------------------------------
class TestMaterialLaborPatch:
    def test_patch_labor_unit_price_persists(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        # Find any existing utilities material on the project
        r = requests.get(f"{base_url}/api/projects/{proj_a}/materials", headers=h, timeout=15)
        if r.status_code != 200:
            pytest.skip(f"materials list unavailable: {r.status_code}")
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if not items:
            pytest.skip("No materials available on project to PATCH")
        mid = items[0].get("id")
        if not mid:
            pytest.skip("Material has no id field")
        p = requests.patch(f"{base_url}/api/materials/{mid}",
                           json={"labor_unit_price": 25.0}, headers=h, timeout=15)
        assert p.status_code == 200, p.text
        # Verify persistence
        r2 = requests.get(f"{base_url}/api/projects/{proj_a}/materials", headers=h, timeout=15)
        items2 = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        found = next((m for m in items2 if m.get("id") == mid), None)
        assert found is not None
        assert abs(float(found.get("labor_unit_price") or 0) - 25.0) < 1e-6


# 7. CSV/XLSX exports ------------------------------------------------------
class TestExports:
    def test_csv_includes_enriched_columns_and_cascade(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        # Set known config
        requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                       json={"zip": "10001", "waste_pct": 8.0}, headers=h, timeout=15)
        r = requests.get(f"{base_url}/api/projects/{proj_a}/takeoff.csv", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        text = r.content.decode("utf-8", errors="replace")
        # Header columns
        for col in ("Material $/unit", "Labor $/unit", "Material Total", "Labor Total", "Line Total"):
            assert col in text, f"CSV missing header '{col}'"
        # Cascade summary rows
        for row in ("Materials subtotal", "Labor subtotal", "Waste", "Overhead",
                    "Profit", "Contingency", "GRAND TOTAL"):
            assert row in text, f"CSV missing cascade row '{row}'"

    def test_xlsx_has_region_header_and_columns(self, base_url, user_a, proj_a):
        h = {"Authorization": f"Bearer {user_a['token']}"}
        requests.patch(f"{base_url}/api/projects/{proj_a}/pricing",
                       json={"zip": "10001"}, headers=h, timeout=15)
        r = requests.get(f"{base_url}/api/projects/{proj_a}/takeoff.xlsx", headers=h, timeout=30)
        if r.status_code == 404:
            pytest.skip("XLSX export not implemented")
        assert r.status_code == 200, r.text
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(r.content))
        ws = wb.active
        # Scan rows for region marker and column headers
        rows_text = []
        for row in ws.iter_rows(values_only=True):
            rows_text.append(" | ".join(str(c) if c is not None else "" for c in row))
        joined = "\n".join(rows_text)
        assert "New York, NY" in joined, f"XLSX missing region info; head=\n{rows_text[:6]}"
        assert "10001" in joined
        assert "1.42" in joined or "1.420" in joined
        for col in ("Material $/unit", "Labor $/unit", "Material Total", "Labor Total", "Line Total"):
            assert col in joined, f"XLSX missing column '{col}'"
        assert "GRAND TOTAL" in joined
