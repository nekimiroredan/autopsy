"""Measure location and worker hotspot recovery in labeled exposure controls."""

import json
from argparse import ArgumentParser
from datetime import datetime, timedelta

from engine.hotspots import hotspots
from schemas.models import EditOp, EvidenceObject, Hypothesis, Movement, Repair


def controls(planted):
    start = datetime(2025, 1, 1)
    movements, evidence = [], []
    for location_index in range(3):
        location = f"L{location_index + 1}"
        worker = f"control-worker-{location_index + 1}"
        errors = 32 if planted and location_index == 0 else 2
        for serial in range(100):
            identifier = f"T-{location_index}-{serial}"
            stamp = start + timedelta(minutes=serial)
            movements.append(
                Movement(
                    txn_id=identifier,
                    ts=stamp,
                    item="CONTROL",
                    location=location,
                    event_type="pick",
                    qty_delta=-1,
                    worker=worker,
                    shift="Day",
                )
            )
            if serial >= errors:
                continue
            evidence.append(
                EvidenceObject(
                    id=f"D-{location_index}-{serial}",
                    item="CONTROL",
                    location=location,
                    window=(start, start + timedelta(days=1)),
                    tier=1,
                    anchored=True,
                    expected=2,
                    counted=1,
                    gap=-1,
                    value_at_risk=None,
                    abstain=False,
                    calibrated=True,
                    hypotheses=[
                        Hypothesis(
                            cause="double_scan",
                            confidence=0.99,
                            search_space=10,
                            competing_matches=1,
                            repair=Repair(ops=[EditOp(op="delete", txn_id=identifier)]),
                            likelihood_ratio=10,
                            evidence=["Known planted label in the exposure control"],
                        )
                    ],
                )
            )
    return movements, evidence


def evaluate():
    salt = b"fixed-evaluation-namespace"
    planted = hotspots(*controls(True), tier=1, salt=salt)
    null = hotspots(*controls(False), tier=1, salt=salt)
    discoveries = [row for row in planted if row["significant"]]
    false_discoveries = [row for row in null if row["significant"]]
    dimensions = {row["dimension"] for row in discoveries if row["errors"] == 32}
    if "control-worker" in json.dumps(planted) or "control-worker" in json.dumps(null):
        raise ValueError("Raw worker identifier leaked")
    return {
        "planted_recovery": len(dimensions.intersection({"location", "worker"})) / 2,
        "null_false_discoveries": len(false_discoveries),
        "planted_discoveries": discoveries,
        "null_tested_slices": len(null),
        "control_design": "300 fixed labeled transactions, with 32/100 planted versus 2/100 background",
    }


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset", help="Context label for the standalone planted/null control"
    )
    parser.add_argument("--planted", action="store_true")
    parser.add_argument("--expect-zero", action="store_true")
    args = parser.parse_args()
    result = evaluate()
    print(json.dumps(result, indent=2))
    if (
        args.planted
        and result["planted_recovery"] != 1
        or args.expect_zero
        and result["null_false_discoveries"]
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
