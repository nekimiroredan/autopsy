"""Evaluate one generated bundle or read a reproducible aggregate blind report."""

import json
from argparse import ArgumentParser
from pathlib import Path

from engine.calibrate import Calibrator
from eval.baselines import forecast
from eval.metrics import samples, summarize
from eval.run_all import RESULTS, analyze_bundle
from generator.make import read_dataset


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--compare", choices=("prior_only", "naive", "flag_only"))
    parser.add_argument("--abstain", action="store_true")
    args = parser.parse_args()
    latest = RESULTS / "latest"
    source = Path(args.dataset)
    if source.is_dir():
        dataset = read_dataset(source)
        calibrator_path = latest / "calibrator.json"
        config = (
            {"calibrator": Calibrator.load(calibrator_path)}
            if args.abstain and calibrator_path.exists()
            else {}
            if args.abstain
            else {"threshold": 0, "margin": 0}
        )
        rows, counts = samples(dataset, analyze_bundle(dataset, **config))
        result = {"engine": summarize(rows, counts)}
        if args.compare:
            result[args.compare] = summarize(
                forecast(dataset, rows, args.compare), counts
            )
    elif args.dataset.endswith("_blind") and (latest / "metrics.json").exists():
        metrics = json.loads((latest / "metrics.json").read_text(encoding="utf-8"))
        difficulty = args.dataset.removesuffix("_blind")
        result = {"engine": metrics["by_difficulty"][difficulty], "synthetic": True}
        if args.compare:
            if difficulty == "easy" and args.compare == "prior_only":
                delta = metrics["gates"]["easy improvement over prior only"]["actual"]
                result[args.compare] = {"top1": result["engine"]["top1"] - delta}
            else:
                result[args.compare] = metrics["baselines"][args.compare]
    else:
        parser.error(
            "Provide a dataset directory or run python -m eval.run_all to create blind aggregates"
        )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
