"""Build a partial retail replay from a local Online Retail II workbook."""

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import load_workbook

ATTRIBUTION = "Chen, D. (2012). Online Retail II [Dataset]. https://doi.org/10.24432/C5CG6D"


def read_orders(path, limit):
    book = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = book.worksheets[0]
        rows = sheet.values
        headers = {str(label).casefold().strip(): index for index, label in enumerate(next(rows))}
        sku_index = headers["stockcode"]
        qty_index = headers["quantity"]
        time_index = headers["invoicedate"]
        result = []
        for row in rows:
            item, qty, timestamp = row[sku_index], row[qty_index], row[time_index]
            if item is None or not str(item).isdigit() or not isinstance(qty, (int, float)) or qty <= 0:
                continue
            if not hasattr(timestamp, "isoformat"):
                continue
            result.append((timestamp, str(item), qty))
            if len(result) == limit:
                break
        return sorted(result)
    finally:
        book.close()


def adapt(source, output, limit=2000):
    from datetime import timedelta

    orders = read_orders(source, limit)
    if not orders:
        raise ValueError("The workbook contained no usable positive order rows.")
    counts_by_item = Counter(item for _, item, _ in orders)
    items = {item: f"RETAIL-{index:03d}" for index, (item, _) in
             enumerate(counts_by_item.most_common(8), 1)}
    orders = [(ts, items[item], qty) for ts, item, qty in orders if item in items]
    balance = defaultdict(int)
    for _, item, qty in orders:
        balance[item] += qty
    start, end = orders[0][0] - timedelta(seconds=2), orders[-1][0] + timedelta(seconds=1)
    rows = [
        (f"OPEN-{item}", start.isoformat(), item, "RETAIL-PROXY", qty, "receive", "", "", "")
        for item, qty in sorted(balance.items())
    ]
    rows.extend(
        (f"PICK-{index}", timestamp.isoformat(), item, "RETAIL-PROXY", -qty, "pick", "", "", "")
        for index, (timestamp, item, qty) in enumerate(orders, 1)
        if index != 2
    )
    counts = []
    for item, qty in sorted(balance.items()):
        counts.append((f"C1-{item}", (start + timedelta(seconds=1)).isoformat(), item, "RETAIL-PROXY", qty))
        counts.append((f"C2-{item}", end.isoformat(), item, "RETAIL-PROXY", 0))
    output.mkdir(parents=True, exist_ok=True)
    for filename, headers, records in (
        ("movements.csv", ("txn_id", "ts", "item", "location", "qty_delta", "event_type", "doc_no", "worker", "shift"), rows),
        ("counts.csv", ("count_id", "count_ts", "item", "location", "counted_qty"), counts),
    ):
        with (output / filename).open("w", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(headers)
            writer.writerows(records)
    (output / "manifest.json").write_text(json.dumps({
        "source": "Partial/adapted retail data",
        "attribution": ATTRIBUTION,
        "simulated": ["location", "opening quantities", "physical counts", "omitted pick"],
        "real_proxy": "Positive product order quantities and invoice timestamps",
    }, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=2000)
    args = parser.parse_args()
    if args.limit < 2:
        parser.error("--limit must be at least 2")
    adapt(args.workbook, args.out, args.limit)


if __name__ == "__main__":
    main()
