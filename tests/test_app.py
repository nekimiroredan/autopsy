import json
from pathlib import Path

from app.Home import app

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def test_balance_replay_closes_demo_gap_without_changing_run():
    client = app.test_client()
    url = "/api/runs/demo"
    run = client.get(url).get_json()
    case = next(row for row in run["cases"] if row["anchored"] and row["hypotheses"] and not row["abstain"])
    path = f"{url}/cases/{case['id']}/replay"
    response = client.get(path + "/0")
    assert response.status_code == 200
    result = response.get_json()
    assert result["before"]["gap"] == case["gap"]
    assert abs(result["after"]["gap"]) < 1e-6
    assert result["before"]["points"][-1]["quantity"] == case["counted"]
    assert result["edits"]
    assert client.get(path + f"/{len(case['hypotheses'])}").status_code == 404
    assert client.get(url).get_json() == run


def test_error_experiments_preserve_original_transactions():
    client = app.test_client()
    url = "/api/runs/demo"
    rows = client.get(url + "/transactions").get_json()
    txn = next(row for row in rows if row["qty_delta"])
    destination = next(row["location"] for row in rows if row["location"] != txn["location"])
    for kind in ("double_scan", "qty_typo", "wrong_location"):
        response = client.post(url + "/experiment", json={
            "txn_id": txn["txn_id"], "kind": kind, "destination": destination,
        })
        assert response.status_code == 200
        result = response.get_json()
        assert result["detected"] == bool(result["cases"])
    assert client.post(url + "/experiment", json={"kind": "unknown"}).status_code == 400
    assert client.get("/api/runs/unknown/transactions").status_code == 404
    assert client.get(url + "/transactions").get_json() == rows


def test_dashboard_routes_and_demo():
    client = app.test_client()
    assert b"Inventory Intelligence" in client.get("/").data
    run = client.get("/api/runs/demo").get_json()
    assert run["source"] == "Synthetic demo"
    assert run["transactions"] > 0
    opening = next(case for case in run["cases"] if not case["anchored"])
    assert opening["abstain"] and opening["expected"] is None
    assert any(case["anchored"] and case["hypotheses"] for case in run["cases"])
    base = f"/api/runs/demo/cases/{opening['id']}"
    assert client.post(base + "/question", json={"question": "What happened?"}).get_json()["answer"]
    assert client.post(base + "/feedback", json={"correct": True}).status_code == 400
    assert client.get("/api/runs/demo/export").mimetype == "text/csv"
    assert client.get("/api/trust").status_code == 200


def test_full_messy_upload():
    client = app.test_client()
    with (FIXTURES / "messy_3.xlsx").open("rb") as workbook:
        inspected = client.post("/api/inspect", data={"movements": workbook}).get_json()
    mapping = {
        kind: {field: suggestion["column"] for field, suggestion in info["fields"].items()}
        for kind, info in inspected.items()
    }
    assert "ts" in mapping["movement"] and "count_ts" in mapping["count"]
    assert inspected["movement"]["samples"]
    with (FIXTURES / "messy_3.xlsx").open("rb") as workbook:
        response = client.post("/api/analyze", data={
            "movements": workbook, "mapping": json.dumps(mapping), "day_first": "true",
            "source": "partial",
        })
    assert response.status_code == 200
    result = response.get_json()
    assert result["report"]["tier"] == 0
    assert sum(result["report"]["rows_dropped"].values()) == 0
    run = client.get(f"/api/runs/{result['run_id']}").get_json()
    assert run["source"] == "Partial / adapted public data"
    assert run["cases"]
    assert all(row["value_at_risk"] is None for row in run["cases"])
