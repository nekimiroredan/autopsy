"""Run the opt-in raw CSV baseline on an explicitly selected synthetic dataset."""

import argparse
import json
import os
from hashlib import sha256
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


def verified_csvs(directory, hashes):
    files = {}
    for name in ("movements.csv", "counts.csv", "items.csv"):
        content = (directory / name).read_bytes()
        if sha256(content).hexdigest() != hashes.get(name):
            raise ValueError(f"CSV does not match its synthetic dataset checksum: {name}")
        files[name] = content.decode("utf-8")
    return files


def ask(files, model, key):
    instructions = (
        "Use only the provided raw inventory CSVs. An anchored count window starts at the "
        "previous count for the same item and location. Sum movements after that count through "
        "the current count. Predict only windows where that balance differs from the physical count. "
        "Return a JSON object with a predictions array of objects with count_id from counts.csv "
        "and causes (up to three distinct cause codes, best first). Use an empty causes list "
        "when you detect a gap but abstain on its cause. Omit windows with no detected gap. "
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
    if not content:
        raise ValueError("The model did not return predictions.")
    response = json.loads(content)
    if not isinstance(response, dict) or "predictions" not in response:
        raise ValueError("The model response is missing its predictions array.")
    return response["predictions"]


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
    files = verified_csvs(args.dataset, dataset.manifest["hashes"])
    print(json.dumps({
        "model": args.model,
        "dataset_hash": dataset.manifest["dataset_hash"],
        **score(dataset, ask(files, args.model, key)),
    }, indent=2))


if __name__ == "__main__":
    main()
