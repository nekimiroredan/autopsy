"""Check clean replay or reconcile a dirty bundle against its ground truth."""

import json
from argparse import ArgumentParser

from engine.replay import Replayer
from generator.ground_truth import verify
from generator.make import read_dataset


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--expect-ground-truth", action="store_true")
    args = parser.parse_args()
    dataset = read_dataset(args.dataset)
    replayer = Replayer(dataset.movements, dataset.counts)
    if args.expect_ground_truth and not dataset.truth:
        raise SystemExit("No ground truth found")
    verify(replayer, dataset.truth if args.expect_ground_truth else [])
    print(
        json.dumps(
            {
                "reconciles": True,
                "anchored_windows": sum(w.anchored for w in replayer.windows()),
            }
        )
    )


if __name__ == "__main__":
    main()
