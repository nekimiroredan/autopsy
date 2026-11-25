"""Recommend a low-effort physical or documentary validation check."""

from functools import lru_cache
from pathlib import Path

import yaml


@lru_cache(maxsize=1)
def catalog():
    return yaml.safe_load(Path(__file__).with_suffix(".yaml").read_text())


def recommend(d, hypotheses, replay, tier):
    if not d.anchored:
        return (
            "opening_balance",
            f"Obtain an earlier physical count for {d.item} at {d.location}.",
        )
    if not hypotheses:
        return (
            "recount_location",
            f"Recount {d.item} at {d.location} and compare the ledger balance.",
        )
    top = hypotheses[0]
    transaction = next(
        (replay.movements.get(op.txn_id) for op in top.repair.ops if op.txn_id), None
    )
    options = []
    for identifier, check in catalog().items():
        if check.get("document") and (
            tier < 1 or not transaction or not transaction.doc_no
        ):
            continue
        if check.get("event") and transaction.event_type != check["event"]:
            continue
        if top.cause in check["causes"]:
            p = top.confidence
            coverage = sum(
                row.confidence for row in hypotheses[1:] if row.cause in check["causes"]
            )
            options.append(
                (
                    4 * p * (1 - p) / check["effort"],
                    -check["effort"],
                    coverage,
                    identifier,
                )
            )
    identifier = max(options)[-1] if options else "recount_location"
    return identifier, catalog()[identifier]["instruction"].format(
        item=d.item,
        location=d.location,
        txn=transaction.txn_id if transaction else d.count_id,
    )
