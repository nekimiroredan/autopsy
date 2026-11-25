"""Derive dashboard series from the same ledger replay used for evidence."""

from engine.replay import Replayer


def balance(replay, window):
    anchor = next(count for count in replay.counts_for((window.item, window.location))
                  if count.count_ts == window.prev_count_ts)
    quantity = anchor.counted_qty
    points = [{"ts": anchor.count_ts.isoformat(), "quantity": quantity}]
    for txn_id in window.window_txn_ids:
        movement = replay.movements[txn_id]
        quantity += movement.qty_delta
        points.append({"ts": movement.ts.isoformat(), "quantity": quantity})
    points.extend([
        {"ts": window.count_ts.isoformat(), "quantity": window.expected},
        {"ts": window.count_ts.isoformat(), "quantity": window.counted},
    ])
    return {"points": points, "gap": window.gap}


def compare(run, case, hypothesis):
    replay = Replayer(run.movements, run.counts)
    key = (case.item, case.location)
    repaired = replay.apply(hypothesis.repair)
    before = next(window for window in replay.windows([key]) if window.id == case.id)
    after = next(window for window in repaired.windows([key]) if window.id == case.id)
    edits = []
    for edit in hypothesis.repair.ops:
        entry = edit.model_dump(mode="json", by_alias=True, exclude_none=True)
        if edit.op == "delete":
            entry["txn"] = replay.movements[edit.txn_id].model_dump(mode="json", exclude_none=True)
        edits.append(entry)
    return {"before": balance(replay, before), "after": balance(repaired, after), "edits": edits}
