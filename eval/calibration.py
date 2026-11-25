"""Print held-out calibration and the corresponding tolerance."""

import json
from argparse import ArgumentParser

from eval.run_all import RESULTS


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=("blind", "validation"), default="blind")
    args = parser.parse_args()
    metrics = json.loads(
        (RESULTS / "latest" / "metrics.json").read_text(encoding="utf-8")
    )
    result = metrics["reliability"][args.dataset]
    gate = metrics["gates"][f"{args.dataset} ECE"]
    print(
        json.dumps({**result, "target": gate["target"], "pass": gate["pass"]}, indent=2)
    )
    if not gate["pass"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
