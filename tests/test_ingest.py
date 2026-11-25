from io import BytesIO
from pathlib import Path

import pytest

from ingest.preflight import load_bundle
from schemas.preflight import PreflightReport

FIXTURES = Path("fixtures")


@pytest.mark.parametrize(
    "filename,tier",
    [
        ("tier0.csv", 0),
        ("tier1.csv", 1),
        ("tier2.xlsx", 2),
        ("invalid_rows.csv", 1),
    ],
)
def test_preflight_reports_all_source_rows_and_matches_golden(filename, tier):
    file = FIXTURES / filename
    movements, counts, items, report = load_bundle(file)
    expected = PreflightReport.model_validate_json(
        (FIXTURES / "golden" / (file.stem + ".json")).read_text()
    )
    assert report == expected
    assert report.tier == tier
    assert report.rows_kept["movement"] == len(movements)
    assert report.rows_kept["count"] == len(counts)
    assert report.rows_kept["master"] == len(items)
    assert sum(report.rows_dropped.values()) == sum(report.drops.values())
    assert movements[0].txn_id == "0001"


def test_latin1_named_streams_and_separate_counts_use_utc():
    movements_source = BytesIO(
        (
            "txn_id;ts;item;location;qty_delta;event_type\n"
            "0001;2025-03-01T08:00:00+02:00;Crème;A;2;Receive\n"
        ).encode("latin-1")
    )
    movements_source.name = "ledger.csv"
    counts_source = (
        b"count_id,count_ts,item,location,counted_qty\nC1,2025-03-08,A,B,1\n"
    )
    movements, counts, _, report = load_bundle(movements_source, counts_source)
    assert movements[0].item == "Crème"
    assert movements[0].ts.isoformat() == "2025-03-01T06:00:00"
    assert counts[0].item == "A"
    assert report.details["count_key_overlap"] == 0
    assert report.details["count_items_without_movements"] == 1
    assert movements_source.tell() == 0


def test_counts_anchor_negative_balance_and_warn_on_duplicate_snapshots():
    movements_source = (
        b"txn_id,ts,item,location,qty_delta,event_type\nT1,2025-03-03,A,B,-2,pick\n"
    )
    counts_source = (
        b"count_id,count_ts,item,location,counted_qty\n"
        b"C1,2025-03-01,A,B,1\nC2,2025-03-01,A,B,1\n"
    )
    _, counts, _, report = load_bundle(movements_source, counts_source)
    assert len(counts) == 2
    assert report.details["duplicate_count_timestamps"] == 1
    assert report.details["negative_balance_keys"] == 1
