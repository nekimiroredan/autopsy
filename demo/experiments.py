"""Synthetic demo inputs and isolated dashboard corruption experiments."""

from uuid import uuid4

from make_demo_assets import corrupt
from schemas.models import Movement

ERROR_TYPES = ("double_scan", "qty_typo", "wrong_location")


def sample():
    from generator.sim import generate

    return generate(seed=2025, days=45, errors=24, difficulty="medium")


def alter(movements, txn_id, kind, destination):
    index = next((i for i, row in enumerate(movements) if row.txn_id == txn_id), None)
    if index is None or kind not in ERROR_TYPES:
        raise ValueError("Choose a valid transaction and error type.")
    original = movements[index]
    if kind == "wrong_location":
        if destination == original.location or not any(row.location == destination for row in movements):
            raise ValueError("Choose a different location from this run.")
    elif not original.qty_delta:
        raise ValueError("Choose a transaction with a nonzero quantity.")
    rows, _, _ = corrupt([row.model_dump() for row in movements], index, kind, destination)
    if kind == "double_scan":
        rows[index + 1]["txn_id"] = f"DEMO-{uuid4().hex}"
    return original, [Movement.model_validate(row, strict=False) for row in rows]
