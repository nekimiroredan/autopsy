"""Summarize exposure-adjusted concentrations in transaction-linked evidence."""

import csv
import hashlib
import hmac
import json
import os
import secrets
from argparse import ArgumentParser
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

from scipy.stats import beta, hypergeom

from schemas.models import EvidenceObject, Movement

SALT_PATH = Path(__file__).resolve().parents[1] / "data" / ".worker_salt"


def _local_salt():
    try:
        return SALT_PATH.read_bytes()
    except FileNotFoundError:
        SALT_PATH.parent.mkdir(parents=True, exist_ok=True)
        secret = secrets.token_bytes(32)
        temporary = SALT_PATH.with_name(f".worker-salt-{secrets.token_hex(8)}")
        try:
            with os.fdopen(
                os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
            ) as stream:
                stream.write(secret)
            try:
                SALT_PATH.hardlink_to(temporary)
            except FileExistsError:
                pass
        finally:
            temporary.unlink(missing_ok=True)
        return SALT_PATH.read_bytes()


def _bh(p_values):
    adjusted = [1.0] * len(p_values)
    ordered = sorted(range(len(p_values)), key=p_values.__getitem__)
    ceiling = 1.0
    for rank in range(len(ordered) - 1, -1, -1):
        index = ordered[rank]
        ceiling = min(ceiling, p_values[index] * len(ordered) / (rank + 1))
        adjusted[index] = ceiling
    return adjusted


def hotspots(
    movements,
    evidence,
    *,
    tier=0,
    salt=None,
    min_exposure=30,
    confirmations=None,
    master=(),
):
    """Count one error per verified transaction, with worker labels hashed locally."""
    dimensions = ["location", "event_type"] + (["worker", "shift"] if tier >= 1 else [])
    salt = salt if salt is not None else (_local_salt() if tier >= 1 else b"")
    if isinstance(salt, str):
        salt = salt.encode()
    confirmations = confirmations or {}
    errors, values = set(), {}
    movements = {row.txn_id: row for row in movements}
    prices = {
        item.item: item.unit_cost for item in master if item.unit_cost is not None
    }
    for case in evidence:
        if not case.hypotheses:
            continue
        hypothesis = case.hypotheses[0]
        confirmed = confirmations.get(case.id)
        if confirmed is False or (case.abstain and not confirmed):
            continue
        if isinstance(confirmed, str) and confirmed != hypothesis.cause:
            continue
        for op in hypothesis.repair.ops:
            if op.txn_id in movements:
                errors.add(op.txn_id)
                if tier >= 2 and case.value_at_risk is not None:
                    values[op.txn_id] = max(
                        values.get(op.txn_id, 0), case.value_at_risk
                    )
    slices = defaultdict(list)
    for row in movements.values():
        for field in dimensions:
            value = getattr(row, field)
            if value:
                slices[field, value].append(row.txn_id)

    family_totals = defaultdict(lambda: [0, 0])
    rates = defaultdict(list)
    results = []
    for (field, label), ids in sorted(slices.items()):
        group_errors = [identifier for identifier in ids if identifier in errors]
        count, exposure = len(group_errors), len(ids)
        rate = count / exposure
        family_totals[field][0] += exposure
        family_totals[field][1] += count
        if exposure >= min_exposure:
            rates[field].append(rate)
        lower, upper = beta.ppf([0.025, 0.975], count + 0.5, exposure - count + 0.5)
        label = (
            f"W-{hmac.new(salt, label.encode(), hashlib.sha256).hexdigest()[:8]}"
            if field == "worker"
            else label
        )
        costs = [
            values[identifier] for identifier in group_errors if identifier in values
        ]
        priced = [
            movements[identifier]
            for identifier in ids
            if movements[identifier].item in prices
        ]
        value_moved = (
            sum(abs(row.qty_delta) * prices[row.item] for row in priced)
            if priced and tier >= 2
            else None
        )
        results.append(
            {
                "dimension": field,
                "slice": label,
                "exposure": exposure,
                "errors": count,
                "rate": rate,
                "lower": float(lower),
                "upper": float(upper),
                "value_moved": value_moved,
                "average_error_value": mean(costs) if costs else None,
            }
        )
    p_values, tested = [], []
    for index, row in enumerate(results):
        population, successes = family_totals[row["dimension"]]
        baseline = median(rates[row["dimension"]]) if rates[row["dimension"]] else 0
        exposure, rate = row["exposure"], row["rate"]
        effect = rate / baseline if baseline else None
        excess = max(0, rate - baseline) * exposure
        average_value = row.pop("average_error_value")
        row.update(
            baseline=baseline,
            effect_ratio=effect,
            excess=excess,
            value=excess * average_value if average_value is not None else None,
            q=None,
            significant=False,
        )
        if exposure >= min_exposure:
            tested.append(index)
            p_values.append(
                float(hypergeom.sf(row["errors"] - 1, population, successes, exposure))
            )
    for index, q_value in zip(tested, _bh(p_values)):
        row = results[index]
        ratio = row["effect_ratio"]
        effect_pass = ratio >= 1.5 if ratio is not None else row["rate"] > 0
        row.update(q=q_value, significant=q_value < 0.05 and effect_pass)
    return sorted(
        results,
        key=lambda row: (
            not row["significant"],
            -row["rate"],
            row["dimension"],
            row["slice"],
        ),
    )


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--movements", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--tier", type=int, choices=(0, 1, 2), default=0)
    options = parser.parse_args()
    records = json.loads(options.evidence.read_text())
    evidence = [
        EvidenceObject.model_validate_json(json.dumps(record)) for record in records
    ]
    with options.movements.open(newline="") as stream:
        movements = [
            Movement.model_validate(
                {key: value for key, value in row.items() if value}, strict=False
            )
            for row in csv.DictReader(stream)
        ]
    options.out.write_text(
        json.dumps(hotspots(movements, evidence, tier=options.tier), indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
