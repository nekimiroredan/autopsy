from datetime import datetime, timedelta

import pytest

from engine.replay import Replayer
from schemas.models import Count, EditOp, Movement, Repair

START = datetime(2025, 1, 1, 12)
END = START + timedelta(days=1)


def count(identifier, ts, qty, *, item="SKU", location="B01"):
    return Count(
        count_id=identifier, count_ts=ts, item=item, location=location, counted_qty=qty
    )


def movement(identifier, ts, qty, *, item="SKU", location="B01", doc=None):
    return Movement(
        txn_id=identifier,
        ts=ts,
        item=item,
        location=location,
        qty_delta=qty,
        event_type="receive" if qty > 0 else "pick",
        doc_no=doc,
    )


def test_window_counts_end_time_once_and_excludes_anchor_time():
    counts = [
        count("A", START, 100),
        count("B", END, 106),
        count("C", END + timedelta(days=1), 106),
    ]
    movements = [movement("T-A", START, 100), movement("T-B", END, 6)]
    replay = Replayer(reversed(movements), reversed(counts))
    opening, verified, next_window = replay.windows()
    assert replay.detect() == [opening]
    assert opening.expected is None
    assert verified.window_txn_ids == ["T-B"]
    assert next_window.window_txn_ids == []
    assert replay.windows() == Replayer(movements, counts).windows()


def test_replay_applies_insert_qty_and_loss_immutably():
    counts = [count("A", START, 100), count("B", END, 108)]
    moves = [movement("T", END, 11)]
    replay = Replayer(moves, counts)
    window = replay.detect()[1]
    assert window.gap == -3
    edit = EditOp(
        op="set_field", txn_id="T", field="qty_delta", from_value=11, to_value=10
    )
    loss = EditOp(op="book_loss", window_id=window.id, qty=-3)
    insert = EditOp(op="insert", txn=movement("I", END, -2))
    assert replay.apply(Repair(ops=[edit, insert])).residual([window.id]) == {
        window.id: 0
    }
    assert replay.apply(Repair(ops=[loss])).residual([window.id]) == {window.id: 0}
    assert replay.residual([window.id]) == {window.id: -3}


def test_duplicate_count_timestamp_uses_lowest_id():
    counts = [count("A", START, 10), count("B", START, 90), count("C", END, 10)]
    result = Replayer([], reversed(counts)).windows()
    assert [window.count_id for window in result] == ["A", "C"]
    assert result[1].expected == 10


def test_replay_rejects_stale_repair():
    replay = Replayer([movement("T", END, 11)], [])
    edit = EditOp(
        op="set_field", txn_id="T", field="qty_delta", from_value=12, to_value=10
    )
    with pytest.raises(ValueError, match="stale"):
        replay.apply(Repair(ops=[edit]))
