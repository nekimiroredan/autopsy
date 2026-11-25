"""Verify that each answered discrepancy has a concrete next check."""

import json
from argparse import ArgumentParser
from pathlib import Path

from engine.calibrate import Calibrator
from eval.run_all import CACHE, RESULTS, _dataset, analyze_bundle, split_specs
from generator.make import read_dataset


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True)
    args = parser.parse_args()
    artifact = RESULTS / "latest" / "calibrator.json"
    options = {"calibrator": Calibrator.load(artifact)} if artifact.exists() else {}
    if args.dataset == "hard_blind":
        bundles = (
            _dataset("blind", seed, difficulty, CACHE)
            for seed, difficulty in split_specs()["blind"]
            if difficulty == "hard"
        )
    elif Path(args.dataset).is_dir():
        bundles = [read_dataset(args.dataset)]
    else:
        parser.error("Provide hard_blind or a generated dataset directory")
    answered = [
        row
        for dataset in bundles
        for row in analyze_bundle(dataset, **options)
        if not row.abstain
    ]
    missing = [
        row.id for row in answered if not row.check_id or not row.suggested_check
    ]
    print(json.dumps({"answered": len(answered), "missing": len(missing)}))
    if missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
