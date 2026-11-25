"""Summarize observed human timing trials from the study's CSV."""

import json
from argparse import ArgumentParser
from collections import Counter, defaultdict
from csv import DictReader
from pathlib import Path
from statistics import median

TIMING_CSV = Path(__file__).resolve().parents[1] / "docs" / "timing.csv"
LIMIT_SECONDS = 900


def flag(raw):
    value = raw.strip().casefold()
    if value in {"yes", "true", "1"}:
        return True
    if value in {"no", "false", "0"}:
        return False
    raise ValueError(f"Expected yes/no, got {raw!r}")


def summarize(path):
    condition_rows = defaultdict(list)
    case_rows = defaultdict(list)
    paired = defaultdict(set)
    tester_orders = {}
    with path.open(newline="", encoding="utf-8-sig") as stream:
        for line, row in enumerate(DictReader(stream), start=2):
            tester, case = row["tester"].strip(), row["case_id"].strip()
            condition = row["condition"].strip().casefold()
            order = row["order"].strip().casefold()
            if condition not in {"tool", "manual"} or not tester or not case:
                raise ValueError(f"Invalid tester, case, or condition on line {line}")
            if condition in paired[tester, case]:
                raise ValueError(f"Duplicate tester/case/condition on line {line}")
            if (
                order not in {"manual-first", "tool-first"}
                or tester_orders.get(tester, order) != order
            ):
                raise ValueError(f"Invalid or inconsistent tester order on line {line}")
            tester_orders[tester] = order
            paired[tester, case].add(condition)
            seconds = float(row["seconds"])
            confidence = float(row["confidence"])
            if not (0 <= seconds <= LIMIT_SECONDS and 0 <= confidence <= 1):
                raise ValueError(f"Invalid time or confidence on line {line}")
            timed_out = flag(row["timed_out"]) or seconds == LIMIT_SECONDS
            sample = {
                "seconds": LIMIT_SECONDS if timed_out else seconds,
                "timed_out": timed_out,
                "cause_correct": not timed_out and flag(row["cause_correct"]),
                "check_actionable": not timed_out and flag(row["check_actionable"]),
                "confidence": confidence,
            }
            condition_rows[condition].append(sample)
            case_rows[case, condition].append(sample)

    def aggregate(rows):
        return {
            "trials": len(rows),
            "median_seconds": median(row["seconds"] for row in rows),
            "timeouts": sum(row["timed_out"] for row in rows),
            "cause_correct": sum(row["cause_correct"] for row in rows) / len(rows),
            "check_actionable": sum(row["check_actionable"] for row in rows)
            / len(rows),
            "median_confidence": median(row["confidence"] for row in rows),
        }

    conditions = {
        condition: aggregate(rows) for condition, rows in sorted(condition_rows.items())
    }
    orders = Counter(tester_orders.values())
    cases = {case for _, case in paired}
    ready = (
        len(tester_orders) >= 5
        and len(cases) >= 3
        and len(paired) == len(tester_orders) * len(cases)
        and all(len(conditions) == 2 for conditions in paired.values())
        and len(orders) == 2
        and max(orders.values()) - min(orders.values()) <= 1
        and conditions.get("manual", {}).get("median_seconds", 0) > 0
    )
    reduction = (
        1
        - conditions["tool"]["median_seconds"] / conditions["manual"]["median_seconds"]
        if ready
        else None
    )
    return {
        "status": "complete"
        if ready
        else "incomplete"
        if condition_rows
        else "no observations",
        "testers": len(tester_orders),
        "orders": dict(orders),
        "conditions": conditions,
        "by_case": {
            f"{case} / {condition}": aggregate(rows)
            for (case, condition), rows in sorted(case_rows.items())
        },
        "median_reduction": reduction,
        "passed_target": reduction >= 0.3
        and conditions["tool"]["cause_correct"] >= conditions["manual"]["cause_correct"]
        if ready
        else None,
    }


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=TIMING_CSV)
    parser.add_argument("--out", type=Path, help="Write summary JSON to a file")
    args = parser.parse_args()
    output = json.dumps(summarize(args.csv), indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(output, encoding="utf-8")
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
