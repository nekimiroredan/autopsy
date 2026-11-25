from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import TypedDict

from rapidfuzz.fuzz import ratio


class Match(TypedDict):
    column: str | None
    confidence: float


MappingOverride = Mapping[str, str | None]

ALIASES = {
    "txn_id": (
        "transaction id",
        "transaction number",
        "movement id",
        "movement ref",
        "txn",
        "transaction",
    ),
    "ts": (
        "txn date",
        "transaction date",
        "timestamp",
        "date",
        "datetime",
        "posted at",
        "posting date",
        "movement date",
    ),
    "item": (
        "sku",
        "item code",
        "material",
        "material number",
        "product",
        "product code",
        "stock code",
        "stockcode",
    ),
    "location": (
        "bin",
        "bin code",
        "warehouse bin",
        "warehouse",
        "location code",
        "storage location",
    ),
    "qty_delta": (
        "qty",
        "quantity",
        "units",
        "movement quantity",
        "signed quantity",
        "delta",
    ),
    "qty_in": (
        "in",
        "inbound",
        "qty received",
        "received qty",
        "quantity in",
        "inbound qty",
        "receipt",
    ),
    "qty_out": (
        "out",
        "outbound",
        "qty issued",
        "issued qty",
        "quantity out",
        "outbound qty",
        "pick",
        "issue",
    ),
    "event_type": (
        "transaction type",
        "movement type",
        "activity",
        "event",
        "type",
        "action",
        "operation",
    ),
    "doc_no": (
        "document",
        "doc",
        "document number",
        "document no",
        "reference",
        "ref",
        "grn",
        "order reference",
    ),
    "worker": ("operator", "worker id", "user", "employee", "employee id"),
    "shift": ("team shift", "shift id", "work shift"),
    "count_id": (
        "count reference",
        "cycle count id",
        "count number",
        "count ref",
        "stocktake id",
    ),
    "count_ts": (
        "count date",
        "cycle count date",
        "count timestamp",
        "counted at",
        "physical count date",
        "date",
        "timestamp",
    ),
    "counted_qty": (
        "physical qty",
        "physical quantity",
        "physical count",
        "counted",
        "count quantity",
        "stocktake qty",
        "on hand",
        "qty",
    ),
    "unit_cost": ("cost", "item cost", "unit price", "cost per unit"),
    "pack_size": ("pack", "case size", "units per case", "units per pack"),
    "similar_group": ("item group", "product group", "category", "similarity group"),
    "location_zone": ("zone", "warehouse zone", "storage zone"),
}

FIELDS = {
    "movement": (
        "txn_id",
        "ts",
        "item",
        "location",
        "qty_delta",
        "qty_in",
        "qty_out",
        "event_type",
        "doc_no",
        "worker",
        "shift",
    ),
    "count": ("count_id", "count_ts", "item", "location", "counted_qty"),
    "master": ("item", "unit_cost", "pack_size", "similar_group", "location_zone"),
}

REQUIRED = {
    "movement": ("txn_id", "ts", "item", "location", "event_type"),
    "count": FIELDS["count"],
    "master": ("item",),
}


def normalize(value: str) -> str:
    return re.sub(r"[\W_]+", "", str(value).casefold())


def propose_mapping(headers: Iterable[str], kind: str) -> dict[str, Match]:
    """Propose at most one source column per field, reserving exact matches first."""
    columns = [str(header) for header in headers]
    fields = FIELDS[kind]
    canonical_names = {normalize(field) for field in ALIASES}
    options = []
    for position, field in enumerate(fields):
        canonical = normalize(field)
        aliases = tuple(normalize(alias) for alias in ALIASES[field])
        for column in columns:
            key = normalize(column)
            if key == canonical:
                confidence = 1.0
            elif key in canonical_names:
                continue
            elif key in aliases:
                confidence = 0.98
            else:
                # Fuzzy guesses always require review, even when spelling is close.
                confidence = min(
                    0.89,
                    max(ratio(key, alias) for alias in (canonical, *aliases)) / 100,
                )
            if confidence >= 0.60:
                options.append((-confidence, position, column, field))
    proposals: dict[str, Match] = {
        field: {"column": None, "confidence": 0.0} for field in fields
    }
    used = set()
    for confidence, _, column, field in sorted(options):
        if proposals[field]["column"] is None and column not in used:
            proposals[field] = {"column": column, "confidence": round(-confidence, 3)}
            used.add(column)
    return proposals


def resolve_mapping(
    headers: Iterable[str], kind: str, overrides: MappingOverride | None = None
) -> dict[str, str | None]:
    columns = tuple(headers)
    mapping = {
        field: match["column"]
        for field, match in propose_mapping(columns, kind).items()
    }
    if overrides:
        for field, column in overrides.items():
            if field not in mapping or (column is not None and column not in columns):
                raise ValueError(f"Unknown {kind} mapping: {field} → {column}")
            # An explicitly chosen column takes precedence over another field's suggestion.
            if column is not None:
                for other, source in mapping.items():
                    if other != field and source == column:
                        mapping[other] = None
            mapping[field] = column
    return mapping
