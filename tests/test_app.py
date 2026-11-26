import json
from pathlib import Path

from app.Home import app
from app import data_source
from engine.replay import Replayer

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
    assert result["before"]["points"][-2]["ts"] == result["before"]["points"][-1]["ts"]
    assert result["before"]["points"][-1]["quantity"] - result["before"]["points"][-2]["quantity"] == case["gap"]
    assert client.get(path + f"/{len(case['hypotheses'])}").status_code == 404
    assert client.get(url).get_json() == run


def test_error_experiments_preserve_original_transactions():
    client = app.test_client()
    url = "/api/runs/demo"
    before = client.get(url).get_json()
    rows = client.get(url + "/transactions").get_json()
    run = data_source.get_run("demo")
    replay = Replayer(run.movements, run.counts)
    txn_id = next(txn_id for window in replay.windows() if window.anchored
                  for txn_id in window.window_txn_ids if replay.movements[txn_id].qty_delta)
    txn = next(row for row in rows if row["txn_id"] == txn_id)
    destination = next(row["location"] for row in rows if row["location"] != txn["location"])
    for kind in ("double_scan", "qty_typo", "wrong_location"):
        response = client.post(url + "/experiment", json={
            "txn_id": txn["txn_id"], "kind": kind, "destination": destination,
        })
        assert response.status_code == 200
        result = response.get_json()
        assert result["affected_windows"] >= 1
        assert result["detected"] == bool(result["cases"])
        assert all(case["narrative"] for case in result["cases"])
    assert client.post(url + "/experiment", json={"kind": "unknown"}).status_code == 400
    assert client.post(url + "/experiment", json={
        "txn_id": txn_id, "kind": "wrong_location", "destination": txn["location"],
    }).status_code == 400
    assert client.post("/api/runs/unknown/experiment", json={}).status_code == 404
    assert client.get("/api/runs/unknown/transactions").status_code == 404
    assert client.get(url + "/transactions").get_json() == rows
    assert client.get(url).get_json() == before


def test_trust_reads_metrics_and_published_report(tmp_path, monkeypatch):
    monkeypatch.setattr(data_source, "ROOT", tmp_path)
    client = app.test_client()
    assert client.get("/api/trust").get_json() is None
    latest = tmp_path / "eval/results/latest"
    latest.mkdir(parents=True)
    points = {difficulty: [{"threshold": 0.778, "coverage": 0.25, "accuracy": 0.8, "support": 5}]
              for difficulty in ("easy", "medium", "hard")}
    metrics = {"coverage_at_threshold_by_difficulty": points, "coverage_curve": points["easy"]}
    (latest / "results.json").write_text(json.dumps({"metrics": metrics}))
    (latest / "RESULTS.md").write_text(
        "# Evaluation\n\n## Gates\n\n| Hard improvement | Missed | -1.5% | 10.0% |\n"
        "| Calibration | Pass | 2.7% | 8.0% |\n\n## Limitations\n\n"
        "Offsetting errors can cancel.\n\n## Feedback simulation\nOther text.\n"
    )
    payload = client.get("/api/trust").get_json()
    assert payload["metrics"] == metrics
    assert payload["missed_gates"] == [{"name": "Hard improvement", "measured": "-1.5%", "target": "10.0%"}]
    assert payload["limitations"] == ["Offsetting errors can cancel."]


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
    assert run["shift_tiles"] == []
