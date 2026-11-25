"""Deterministic flag-only, prior-only and naive comparison policies."""

import itertools
import json
from argparse import ArgumentParser
from dataclasses import replace

from engine.replay import Replayer
from eval.metrics import Observation, observed_truth, summarize
from generator.make import read_dataset

PRIOR_RANKING = (
    "qty_typo",
    "double_scan",
    "missed_scan",
    "wrong_location",
    "item_swap",
    "unit_mismatch",
    "miscount",
    "cutoff_timing",
    "residual_shrink",
)


def forecast(dataset, rows, mode):
    if mode == "flag_only":
        return [replace(row, ranked=(), answered=False) for row in rows]
    if mode == "prior_only":
        return [replace(row, ranked=PRIOR_RANKING, answered=True) for row in rows]
    truth = observed_truth(dataset)
    replay = Replayer(dataset.movements, dataset.counts)
    output = []
    for window in replay.detect():
        if not window.anchored or window.id not in truth:
            continue
        txns = [replay.movements[identifier] for identifier in window.window_txn_ids]
        duplicate = any(
            a.qty_delta == b.qty_delta and abs((a.ts - b.ts).total_seconds()) <= 600
            for a, b in itertools.pairwise(txns)
        )
        output.append(
            Observation(
                truth[window.id],
                ("double_scan" if duplicate else "miscount",),
                1,
                1,
                True,
                0,
                dataset.manifest.get("difficulty", "unknown"),
            )
        )
    return output


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True)
    parser.add_argument(
        "--baseline", choices=("naive", "flag_only", "prior_only"), default="naive"
    )
    parser.add_argument("--assert-max-top1", type=float)
    args = parser.parse_args()
    dataset = read_dataset(args.dataset)
    difficulty = dataset.manifest.get("difficulty", "unknown")
    rows = [
        Observation(causes, (), 0, 0, False, 0, difficulty)
        for causes in observed_truth(dataset).values()
    ]
    metrics = summarize(forecast(dataset, rows, args.baseline))
    print(json.dumps(metrics, indent=2))
    if args.assert_max_top1 is not None and (
        metrics["top1"] is None or metrics["top1"] > args.assert_max_top1
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
