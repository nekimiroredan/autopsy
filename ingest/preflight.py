from __future__ import annotations

import argparse
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from math import isfinite
from pathlib import Path

import pandas as pd
from dateutil.parser import parse as parse_date
from pydantic import ValidationError

from ingest.loaders import Source, read_source
from ingest.mapping import (
    REQUIRED,
    MappingOverride,
    normalize,
    propose_mapping,
    resolve_mapping,
)
from schemas.models import Count, ItemMaster, Movement, utc
from schemas.preflight import PreflightReport

EVENTS = {
    "adjustment": ("adjust", "stock adjustment", "correction"),
    "count": ("cycle count", "stocktake", "physical count", "inventory count"),
    "move_in": ("transfer in", "relocation in", "movein"),
    "move_out": ("transfer out", "relocation out", "moveout"),
    "move": ("transfer", "relocation", "bin transfer"),
    "opening_balance": ("opening", "initial stock", "beginning balance"),
    "pick": (
        "ship",
        "shipment",
        "dispatch",
        "issue",
        "outbound",
        "sale",
        "stock out",
        "out",
    ),
    "receive": (
        "receipt",
        "receiving",
        "purchase",
        "inbound",
        "goods receipt",
        "stock in",
        "in",
    ),
    "return": ("returned", "customer return", "return in"),
    "loss": ("write off", "shrink", "damage", "writeoff"),
}
EVENT_BY_NAME = {
    normalize(alias): canonical
    for canonical, aliases in EVENTS.items()
    for alias in (canonical, *aliases)
}
OUTBOUND = {"pick", "move_out", "loss"}
ROLE_HEADERS = {"type", "kind", "recordtype", "rowtype", "recordkind"}
FEATURES_TIER1 = ("doc_no", "worker", "shift")
FEATURES_TIER2 = ("unit_cost", "pack_size", "similar_group", "location_zone")
DATE_PATTERN = re.compile(r"^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-]\d{2,4}(?:\D|$)")


class InvalidRow(ValueError):
    """A row cannot enter the canonical bundle."""


def _populated(value: object) -> bool:
    return bool(pd.notna(value) and str(value).strip())


def _suggested(frame: pd.DataFrame, kind: str) -> dict[str, str | None]:
    return {
        field: result["column"]
        for field, result in propose_mapping(frame.columns, kind).items()
        if result["confidence"] >= 0.90
    }


def _sheet(book: dict[str, pd.DataFrame], kind: str) -> pd.DataFrame | None:
    names = {
        "movement": {"movements", "movement", "transactions", "ledger", "log"},
        "count": {"counts", "count", "cyclecounts", "stocktake", "physicalcounts"},
        "master": {"master", "itemmaster", "items", "catalog", "products"},
    }
    signals = {
        "movement": ("txn_id",),
        "count": ("count_id", "counted_qty"),
        "master": FEATURES_TIER2,
    }
    ranked = []
    for name, frame in book.items():
        matched = _suggested(frame, kind)
        if normalize(name) in names[kind] or any(
            matched.get(key) for key in signals[kind]
        ):
            score = sum(key in matched for key in REQUIRED[kind]) + sum(
                key in matched for key in signals[kind]
            )
            ranked.append((score, normalize(name) in names[kind], name))
    return book[max(ranked)[2]] if ranked else None


def _split_combined(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    roles = next(
        (column for column in frame.columns if normalize(column) in ROLE_HEADERS), None
    )
    count_mapping = _suggested(frame, "count")
    movement_mapping = _suggested(frame, "movement")

    if roles is None:
        roles = movement_mapping.get("event_type")
    is_count = pd.Series(False, index=frame.index)
    if roles is not None:
        is_count = frame[roles].map(
            lambda value: EVENT_BY_NAME.get(normalize(value)) == "count"
        )
    for field in ("count_id", "count_ts", "counted_qty"):
        column = count_mapping.get(field)
        if column and column not in movement_mapping.values():
            is_count |= frame[column].map(_populated)
    if is_count.any():
        return frame.loc[~is_count].copy(), frame.loc[is_count].copy()
    return frame, None


def inspect_bundle(
    movements: Source, counts: Source | None = None, master: Source | None = None
) -> dict[str, pd.DataFrame]:
    """Pick movement, count and item master tables without interpreting cell values."""
    book = read_source(movements)
    movement_frame = _sheet(book, "movement")
    if movement_frame is None:
        movement_frame = next(iter(book.values()))
    count_frame = _sheet(book, "count")
    master_frame = _sheet(book, "master")

    if counts is not None:
        count_book = read_source(counts)
        count_frame = _sheet(count_book, "count")
        if count_frame is None:
            count_frame = next(iter(count_book.values()))
    elif count_frame is None or count_frame is movement_frame:
        movement_frame, count_frame = _split_combined(movement_frame)

    if master is not None:
        master_book = read_source(master)
        master_frame = _sheet(master_book, "master")
        if master_frame is None:
            master_frame = next(iter(master_book.values()))

    frames = {"movement": movement_frame}
    if count_frame is not None:
        frames["count"] = count_frame
    if master_frame is not None:
        frames["master"] = master_frame
    return frames


def _get(row: dict, mapping: dict[str, str | None], field: str) -> str:
    value = row.get(mapping[field], "")
    return str(value).strip() if _populated(value) else ""


def _datetime(value: str, day_first: bool, details: Counter) -> datetime:
    try:
        dt = datetime.fromisoformat(
            value.removesuffix("Z") + "+00:00" if value.endswith("Z") else value
        )
    except ValueError:
        match = DATE_PATTERN.match(value)
        if (
            match
            and 0 < int(match[1]) <= 12
            and 0 < int(match[2]) <= 12
            and match[1] != match[2]
        ):
            details["ambiguous_dates"] += 1
        try:
            if not match and not re.search(r"\b\d{4}\b", value):
                raise ValueError("No explicit year")
            dt = parse_date(
                value,
                dayfirst=day_first,
                fuzzy=False,
                default=datetime(1900, 1, 1),
            )
        except (ValueError, OverflowError) as exc:
            raise InvalidRow("invalid_timestamp") from exc
    return utc(dt)


def _number(
    value: str, field: str, details: Counter, allow_blank: bool = False
) -> float | None:
    if not value and allow_blank:
        return None
    try:
        if value.startswith("(") and value.endswith(")"):
            value = "-" + value[1:-1]
        if re.fullmatch(r"[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?", value):
            value = value.replace(",", "")
        result = float(value)
        if not isfinite(result):
            raise ValueError
        return result
    except ValueError as exc:
        details[f"non_numeric_{field}"] += 1
        raise InvalidRow("invalid_" + field) from exc


def _parse_row(row, kind, mapping, details, day_first):
    values = {field: _get(row, mapping, field) for field in mapping}
    for field in REQUIRED[kind]:
        if not values[field]:
            raise InvalidRow("missing_" + field)
    if kind == "movement":
        event = EVENT_BY_NAME.get(normalize(values["event_type"]))
        if event is None or event == "count":
            details["unparseable_event_types"] += 1
            raise InvalidRow("unknown_event_type")
        if values["qty_delta"]:
            delta = _number(values["qty_delta"], "qty_delta", details)
        else:
            if not (values["qty_in"] or values["qty_out"]):
                raise InvalidRow("missing_quantity")
            qty_in = (
                _number(values["qty_in"], "qty_in", details, allow_blank=True) or 0.0
            )
            qty_out = (
                _number(values["qty_out"], "qty_out", details, allow_blank=True) or 0.0
            )
            if qty_in < 0 or qty_out < 0:
                raise InvalidRow("negative_directional_quantity")
            delta = qty_in - qty_out
        if event == "move":
            event = "move_out" if delta < 0 else "move_in"
        return Movement(
            txn_id=values["txn_id"],
            ts=_datetime(values["ts"], day_first, details),
            item=values["item"],
            location=values["location"],
            qty_delta=delta,
            event_type=event,
            doc_no=values["doc_no"] or None,
            worker=values["worker"] or None,
            shift=values["shift"] or None,
        )
    if kind == "count":
        return Count(
            count_id=values["count_id"],
            count_ts=_datetime(values["count_ts"], day_first, details),
            item=values["item"],
            location=values["location"],
            counted_qty=_number(values["counted_qty"], "counted_qty", details),
        )
    optional_numbers = {}
    for field in ("unit_cost", "pack_size"):
        try:
            value = _number(values[field], field, details, allow_blank=True)
            if value is not None and (
                value < 0 or (field == "pack_size" and value == 0)
            ):
                details[f"invalid_{field}"] += 1
                value = None
        except InvalidRow:
            value = None
        optional_numbers[field] = value
    return ItemMaster(
        item=values["item"],
        **optional_numbers,
        similar_group=values["similar_group"] or None,
        location_zone=values["location_zone"] or None,
    )


def _parse_table(frame, kind, mapping, drops, details, day_first):
    records = []
    seen = set()
    key = {"movement": "txn_id", "count": "count_id", "master": "item"}[kind]
    for row in frame.to_dict(orient="records"):
        try:
            record = _parse_row(row, kind, mapping, details, day_first)
            record_id = getattr(record, key)
            if record_id in seen:
                raise InvalidRow("duplicate_" + key)
            seen.add(record_id)
            records.append(record)
        except InvalidRow as exc:
            drops[f"{kind}.{exc}"] += 1
        except ValidationError:
            drops[f"{kind}.schema_validation"] += 1
    if kind == "movement" and not (mapping["qty_in"] or mapping["qty_out"]):
        has_outbound = any(row.event_type in OUTBOUND for row in records)
        if has_outbound and all(row.qty_delta >= 0 for row in records):
            records = [
                row.model_copy(update={"qty_delta": -row.qty_delta})
                if row.event_type in OUTBOUND
                else row
                for row in records
            ]
            details["inferred_unsigned_quantities"] = 1
    return records


def _coverage(rows: list, field: str) -> float:
    return (
        sum(getattr(row, field, None) is not None for row in rows) / len(rows)
        if rows
        else 0.0
    )


def _diagnose(movements, counts, items, details, gap_days):
    movement_keys = {(m.item, m.location) for m in movements}
    count_keys = {(c.item, c.location) for c in counts}
    movement_items = {m.item for m in movements}
    count_items = {c.item for c in counts}
    count_locations = {c.location for c in counts}
    master_items = {row.item for row in items}
    details["count_items_without_movements"] = len(count_items - movement_items)
    details["count_keys_without_movements"] = len(count_keys - movement_keys)
    details["count_key_overlap"] = (
        len(count_keys & movement_keys) / len(count_keys) if count_keys else 0.0
    )
    details["movement_rows_with_unknown_items"] = (
        sum(m.item not in (master_items or count_items) for m in movements)
        if master_items or count_items
        else 0
    )
    details["movement_rows_with_unknown_locations"] = (
        sum(m.location not in count_locations for m in movements)
        if count_locations
        else 0
    )
    doc_counts = Counter(m.doc_no for m in movements if m.doc_no)
    details["duplicate_doc_no"] = sum(n - 1 for n in doc_counts.values())
    details["missing_doc_no_rate"] = (
        1.0 - _coverage(movements, "doc_no") if movements else 0.0
    )
    count_time_keys = Counter((c.item, c.location, c.count_ts) for c in counts)
    details["duplicate_count_timestamps"] = sum(n - 1 for n in count_time_keys.values())

    balance = defaultdict(float)
    previous = {}
    threshold = timedelta(days=gap_days)
    events = [(m.ts, 0, m.txn_id, m) for m in movements] + [
        (c.count_ts, 1, c.count_id, c) for c in counts
    ]
    negative_keys = set()
    for stamp, role, _, row in sorted(events, key=lambda record: record[:3]):
        key = (row.item, row.location)
        if role:
            balance[key] = row.counted_qty
        else:
            if row.event_type == "opening_balance":
                balance[key] = row.qty_delta
                if balance[key] < -1e-6:
                    negative_keys.add(key)
            elif key in balance:
                balance[key] += row.qty_delta
                if balance[key] < -1e-6:
                    negative_keys.add(key)
            last = previous.get(row.location)
            if last is not None and stamp - last > threshold:
                details["timestamp_gaps"] += 1
            previous[row.location] = stamp
    details["negative_balance_keys"] = len(negative_keys)


def load_bundle(
    movements: Source,
    counts: Source | None = None,
    master: Source | None = None,
    *,
    movement_mapping: MappingOverride | None = None,
    count_mapping: MappingOverride | None = None,
    master_mapping: MappingOverride | None = None,
    day_first: bool = True,
    key_overlap_threshold: float = 0.80,
    gap_days: int = 7,
) -> tuple[list[Movement], list[Count], list[ItemMaster], PreflightReport]:
    """Validate source rows, compute honest tier coverage, and report every drop."""
    frames = inspect_bundle(movements, counts, master)
    overrides = {
        "movement": movement_mapping,
        "count": count_mapping,
        "master": master_mapping,
    }
    details: Counter = Counter()
    drops: Counter = Counter()
    warnings = []
    rows_read, rows_kept, records = {}, {}, {}
    for kind, override in overrides.items():
        frame = frames.get(kind)
        parsed = []
        if frame is not None:
            mapping = resolve_mapping(frame.columns, kind, override)
            missing = [field for field in REQUIRED[kind] if not mapping[field]]
            if kind == "movement" and not any(
                mapping[field] for field in ("qty_delta", "qty_in", "qty_out")
            ):
                missing.append("quantity")
            if missing:
                warnings.append(
                    f"{kind.title()} fields unmapped: {', '.join(missing)}."
                )
            parsed = _parse_table(frame, kind, mapping, drops, details, day_first)
        records[kind] = parsed
        rows_read[kind] = len(frame) if frame is not None else 0
        rows_kept[kind] = len(parsed)

    movement_rows = records["movement"]
    count_rows = records["count"]
    master_rows = records["master"]
    master_by_item = {row.item: row for row in master_rows}
    active_items = {row.item for row in (*movement_rows, *count_rows)}
    joined = [master_by_item.get(item) for item in sorted(active_items)]
    coverage = {field: _coverage(movement_rows, field) for field in FEATURES_TIER1}
    coverage.update({field: _coverage(joined, field) for field in FEATURES_TIER2})
    coverage["item_master"] = (
        sum(row is not None for row in joined) / len(joined) if joined else 0.0
    )
    tier = int(all(coverage[field] >= 0.8 for field in FEATURES_TIER1))
    if tier == 1 and coverage["item_master"] >= 0.95:
        tier = 2

    _diagnose(movement_rows, count_rows, master_rows, details, gap_days)
    for drop_kind in ("duplicate_txn_id", "duplicate_count_id"):
        details[drop_kind] = sum(
            total for reason, total in drops.items() if reason.endswith(f".{drop_kind}")
        )
    if not count_rows:
        warnings.append("No usable physical counts were supplied.")
    if not movement_rows:
        warnings.append("No usable movement rows were supplied.")
    if sum(rows_kept.values()) < sum(rows_read.values()):
        warnings.append("Some source rows were discarded. Review the drop reasons.")
    if count_rows and details["count_key_overlap"] < key_overlap_threshold:
        warnings.append(
            "Few physical count item/location keys match the movement log. Check the key mapping."
        )
    for key, message in {
        "ambiguous_dates": f"Ambiguous dates used {'day-first' if day_first else 'month-first'} interpretation.",
        "inferred_unsigned_quantities": "Outbound events were assigned negative quantities.",
        "duplicate_count_timestamps": "Some item/location counts share a timestamp.",
        "negative_balance_keys": "Some running balances fall below zero after a physical count.",
        "timestamp_gaps": f"Some locations have movement gaps longer than {gap_days} days.",
    }.items():
        if details[key]:
            warnings.append(message)
    return (
        movement_rows,
        count_rows,
        master_rows,
        PreflightReport(
            tier=tier,
            coverage=coverage,
            rows_read=rows_read,
            rows_kept=rows_kept,
            rows_dropped={
                kind: rows_read[kind] - rows_kept[kind] for kind in rows_read
            },
            drops=dict(drops),
            warnings=warnings,
            details=dict(details),
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit a warehouse export before replay."
    )
    parser.add_argument("file", type=Path)
    parser.add_argument("--counts", type=Path)
    parser.add_argument("--master", type=Path)
    parser.add_argument("--month-first", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    _, _, _, report = load_bundle(
        args.file, args.counts, args.master, day_first=not args.month_first
    )
    if args.json:
        print(report.model_dump_json(indent=2))
        return
    print(
        f"Tier {report.tier} · {sum(report.rows_kept.values())} rows kept · {sum(report.rows_dropped.values())} dropped"
    )
    for kind, total in report.rows_read.items():
        print(f"{kind.title():10} {report.rows_kept[kind]:>6}/{total} usable")
    for reason, total in sorted(report.drops.items()):
        print(f"  {reason}: {total}")
    for warning in report.warnings:
        print(f"  {warning}")


if __name__ == "__main__":
    main()
