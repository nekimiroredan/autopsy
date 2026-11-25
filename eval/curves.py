"""Print coverage and accuracy points from the regenerated benchmark."""

import json
from argparse import ArgumentParser

from eval.run_all import RESULTS


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=("blind", "hard_blind"), default="blind")
    args = parser.parse_args()
    metrics = json.loads(
        (RESULTS / "latest" / "metrics.json").read_text(encoding="utf-8")
    )
    print(
        json.dumps(
            metrics[
                "hard_coverage_curve"
                if args.dataset == "hard_blind"
                else "coverage_curve"
            ],
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
