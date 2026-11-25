"""Replay inventory windows against physical counts."""

import json
from argparse import ArgumentParser
from bisect import bisect_right
from collections import defaultdict
from datetime import datetime
from hashlib import sha256
from pathlib import Path

from schemas.models import Count, Discrepancy, Movement, Repair, utc

EPSILON = 1e-6


class Replayer:
    def __init__(self, movements, counts, losses=None):
        self.movements = {row.txn_id: row for row in movements}
        self.counts = {row.count_id: row for row in counts}
        self.losses = dict(losses or {})
        self._movements_by_key = defaultdict(list)
        self._counts_by_key = defaultdict(list)
        for row in sorted(
            self.movements.values(), key=lambda row: (row.ts, row.txn_id)
        ):
            self._movements_by_key[row.item, row.location].append(row)
        for row in sorted(
            self.counts.values(), key=lambda row: (row.count_ts, row.count_id)
        ):
            self._counts_by_key[row.item, row.location].append(row)
        self._timestamps = {
            key: [row.ts for row in rows]
            for key, rows in self._movements_by_key.items()
        }

    def transactions(self, key, start, end):
        """Read a half-open span (start, end]."""
        times = self._timestamps.get(key, ())
        begin = bisect_right(times, start) if start is not None else 0
        finish = bisect_right(times, end)
        return self._movements_by_key.get(key, ())[begin:finish]

    def counts_for(self, key):
        """Return physical counts ordered by timestamp and ID."""
        return self._counts_by_key.get(key, ())

    def windows(self, keys=None):
        result = []
        for key in sorted(self._counts_by_key if keys is None else set(keys)):
            previous = None
            for count in self._counts_by_key.get(key, ()):
                if previous and previous.count_ts == count.count_ts:
                    continue
                anchor = previous
                start = anchor.count_ts if anchor else None
                rows = self.transactions(key, start, count.count_ts)
                expected = None
                if anchor:
                    expected = anchor.counted_qty + sum(row.qty_delta for row in rows)
                    expected += self.losses.get(count.count_id, 0)
                serial = json.dumps(
                    [
                        *key,
                        start.isoformat() if start else None,
                        count.count_ts.isoformat(),
                    ]
                )
                result.append(
                    Discrepancy(
                        id="D-" + sha256(serial.encode()).hexdigest()[:12],
                        count_id=count.count_id,
                        item=count.item,
                        location=count.location,
                        prev_count_ts=start,
                        count_ts=count.count_ts,
                        expected=expected,
                        counted=count.counted_qty,
                        gap=count.counted_qty - expected if anchor else 0,
                        anchored=anchor is not None,
                        window_txn_ids=[row.txn_id for row in rows],
                    )
                )
                # The first count ID at each timestamp is the deterministic next anchor.
                previous = count
        return result

    def detect(self):
        return [
            window
            for window in self.windows()
            if not window.anchored or abs(window.gap) > EPSILON
        ]

    def residual(self, keys):
        windows = self.windows()
        by_id = {window.id: window.gap for window in windows if window.anchored}
        by_item_location = {
            (window.item, window.location): window.gap
            for window in windows
            if window.anchored
        }
        return {
            key: (by_id if isinstance(key, str) else by_item_location)[key]
            for key in keys
        }

    def apply(self, repair: Repair):
        movements = self.movements.copy()
        counts = self.counts.copy()
        losses = self.losses.copy()
        windows_by_id = None
        for edit in repair.ops:
            if edit.op == "delete":
                del movements[edit.txn_id]
            elif edit.op == "insert":
                if edit.txn.txn_id in movements:
                    raise ValueError(f"Transaction {edit.txn.txn_id} already exists")
                movements[edit.txn.txn_id] = edit.txn
            elif edit.op == "set_field":
                movements[edit.txn_id] = _replace(movements[edit.txn_id], edit)
            elif edit.op == "set_count":
                counts[edit.count_id] = _replace(
                    counts[edit.count_id], edit, "counted_qty"
                )
            elif edit.op == "book_loss":
                if edit.count_id:
                    count_id = edit.count_id
                else:
                    if windows_by_id is None:
                        windows_by_id = {row.id: row.count_id for row in self.windows()}
                    count_id = windows_by_id.get(edit.window_id)
                if count_id not in counts:
                    raise ValueError(f"Unknown loss window or count for {edit}")
                losses[count_id] = losses.get(count_id, 0) + edit.qty
        return Replayer(movements.values(), counts.values(), losses)


def _replace(row, edit, default_field=None):
    field = edit.field or default_field
    if field in ("txn_id", "count_id") or field not in type(row).model_fields:
        raise ValueError(f"Invalid edit field {field}")
    values = row.model_dump()
    old, new = edit.from_value, edit.to_value
    if isinstance(values[field], datetime):
        old = datetime.fromisoformat(old) if isinstance(old, str) else old
        new = datetime.fromisoformat(new) if isinstance(new, str) else new
        old = utc(old) if isinstance(old, datetime) else old
        new = utc(new) if isinstance(new, datetime) else new
    if old != values[field]:
        raise ValueError(f"Edit has stale value for {field}")
    values[field] = new
    return type(row).model_validate(values)


def _main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    import csv

    def read(model, name):
        with (args.dataset / name).open(newline="") as source:
            return [
                model.model_validate({k: v for k, v in row.items() if v}, strict=False)
                for row in csv.DictReader(source)
            ]

    replay = Replayer(read(Movement, "movements.csv"), read(Count, "counts.csv"))
    output = json.dumps(
        [row.model_dump(mode="json") for row in replay.detect()], indent=2
    )
    if args.out:
        args.out.write_text(output + "\n")
    else:
        print(output)


if __name__ == "__main__":
    _main()
