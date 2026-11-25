"""Counterfactual source edits used to corrupt clean ledger observations."""

from datetime import timedelta

from schemas.models import EditOp, Repair

CAUSES = (
    "double_scan",
    "missed_scan",
    "qty_typo",
    "unit_mismatch",
    "item_swap",
    "wrong_location",
    "miscount",
    "cutoff_timing",
    "residual_shrink",
)
EASY_CAUSES = CAUSES[:6]


def inject(cause, txn, count, *, alternate_location, alternate_item, pack_size, serial):
    if cause == "double_scan":
        duplicate = txn.model_copy(
            update={
                "txn_id": f"X-{serial:04d}",
                "ts": txn.ts + timedelta(minutes=1),
            }
        )
        edit = EditOp(op="insert", txn=duplicate)
    elif cause in ("missed_scan", "residual_shrink"):
        edit = EditOp(op="delete", txn_id=txn.txn_id)
    elif cause == "miscount":
        edit = EditOp.model_validate(
            {
                "op": "set_count",
                "count_id": count.count_id,
                "from": count.counted_qty,
                "to": count.counted_qty + 9,
            }
        )
    elif cause == "cutoff_timing":
        edit = EditOp.model_validate(
            {
                "op": "set_count",
                "field": "count_ts",
                "count_id": count.count_id,
                "from": count.count_ts.isoformat(),
                "to": (txn.ts - timedelta(minutes=1)).isoformat(),
            }
        )
    else:
        field, changed = {
            "qty_typo": (
                "qty_delta",
                float(f"{'-' if txn.qty_delta < 0 else ''}1{int(abs(txn.qty_delta))}"),
            ),
            "unit_mismatch": ("qty_delta", txn.qty_delta * pack_size),
            "item_swap": ("item", alternate_item),
            "wrong_location": ("location", alternate_location),
        }[cause]
        edit = EditOp.model_validate(
            {
                "op": "set_field",
                "txn_id": txn.txn_id,
                "field": field,
                "from": getattr(txn, field),
                "to": changed,
            }
        )
    return (
        cause,
        txn.txn_id if cause not in ("cutoff_timing", "miscount") else count.count_id,
        Repair(ops=[edit]),
    )
