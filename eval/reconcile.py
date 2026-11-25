"""Verify signed effects against detected anchored gaps on a generated bundle."""

import json
from argparse import ArgumentParser

from engine.replay import Replayer
from generator.ground_truth import verify
from generator.make import read_dataset


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True)
    args = parser.parse_args()
    dataset = read_dataset(args.dataset)
    verify(Replayer(dataset.movements, dataset.counts), dataset.truth)
    print(
        json.dumps(
            {
                "reconciles": True,
                "injected_errors": len(dataset.truth),
                "unexplained_windows": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
