"""Run the opt-in raw CSV baseline on an explicitly selected synthetic dataset."""

import argparse
import json
import os
from pathlib import Path
from types import SimpleNamespace
from urllib.request import Request, urlopen

from engine.replay import Replayer
from eval.baselines import PRIOR_RANKING
from eval.metrics import samples, summarize
from generator.make import read_dataset


def score(dataset, predictions):
    windows = {window.count_id: window for window in Replayer(dataset.movements, dataset.counts).windows()
               if window.anchored}
    prices = {row.item: row.unit_cost for row in dataset.master}
    if not isinstance(predictions, list):
        raise ValueError("Expected a list of predictions.")
    evidence = []
    seen = set()
    for prediction in predictions:
        if not isinstance(prediction, dict):
            raise ValueError("Invalid prediction.")
        count_id = prediction.get("count_id")
        causes = prediction.get("causes")
        if not isinstance(count_id, str) or count_id not in windows or count_id in seen:
            raise ValueError("Invalid or repeated count ID.")
        if not isinstance(causes, list) or len(causes) > 3 or any(cause not in PRIOR_RANKING for cause in causes):
            raise ValueError("Invalid cause ranking.")
        if len(set(causes)) != len(causes):
            raise ValueError("Duplicate ranked cause.")
        seen.add(count_id)
        window = windows[count_id]
        evidence.append(SimpleNamespace(
            anchored=True, id=window.id, abstain=not causes,
            value_at_risk=abs(window.gap) * (prices.get(window.item) or 0),
            hypotheses=[SimpleNamespace(cause=cause, confidence=0) for cause in causes],
        ))
    return summarize(*samples(dataset, evidence))


def ask(directory, model, key):
    files = {name: (directory / name).read_text(encoding="utf-8")
             for name in ("movements.csv", "counts.csv", "items.csv")}
    instructions = (
        "Use only the provided raw inventory CSVs. Find anchored count windows with discrepancies. "
        "Return a JSON object with a predictions array of objects with count_id from counts.csv "
        "and causes (up to three ranked cause codes, or an empty list to abstain). "
        "Allowed cause codes: " + ", ".join(PRIOR_RANKING)
    )
    request = Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps({"model": model, "response_format": {"type": "json_object"}, "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": json.dumps(files)},
        ]}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urlopen(request, timeout=180) as response:
        content = json.load(response)["choices"][0]["message"]["content"]
    return json.loads(content)["predictions"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--model", required=True, help="API model supporting JSON mode")
    parser.add_argument("--send-synthetic-csv", action="store_true")
    args = parser.parse_args()
    key = os.getenv("OPENAI_API_KEY")
    if not args.send_synthetic_csv or not key:
        parser.error("Set OPENAI_API_KEY and pass --send-synthetic-csv to opt in.")
    dataset = read_dataset(args.dataset, verify_hashes=True)
    if not dataset.manifest.get("generator_version"):
        parser.error("Select a dataset written by the synthetic generator.")
    print(json.dumps({
        "model": args.model,
        "dataset_hash": dataset.manifest["dataset_hash"],
        **score(dataset, ask(args.dataset, args.model, key)),
    }, indent=2))


if __name__ == "__main__":
    main()
