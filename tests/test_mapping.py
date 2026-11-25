import json

import pytest

from eval.mapping import FIXTURES, GOLDEN_DIR, snapshot
from ingest.mapping import propose_mapping, resolve_mapping
from ingest.preflight import load_bundle


@pytest.mark.parametrize("fixture", FIXTURES)
def test_messy_export_matches_golden(fixture):
    actual = snapshot(fixture)
    expected = json.loads((GOLDEN_DIR / f"{fixture.stem}.json").read_text())
    assert actual == expected
    assert not any(actual["report"]["rows_dropped"].values())


def test_fuzzy_match_requires_review_and_explicit_override_wins():
    proposed = propose_mapping(
        ["Transection Date", "Bin", "SKU", "Reference"], "movement"
    )
    assert proposed["ts"]["column"] == "Transection Date"
    assert 0.60 <= proposed["ts"]["confidence"] < 0.90
    assert proposed["doc_no"]["column"] == "Reference"
    mapping = resolve_mapping(["Reference", "Bin"], "movement", {"txn_id": "Reference"})
    assert mapping["txn_id"] == "Reference"
    assert mapping["doc_no"] is None


def test_date_ambiguity_uses_explicit_confirmation_and_preserves_iso():
    source = (
        b"txn_id,ts,item,location,qty_delta,event_type\n"
        b"A,04/03/2025 11:00,A,B,2,receive\nB,2025-04-05T12:00:00,A,B,1,pick\n"
    )
    day_first, *_ = load_bundle(source)
    month_first, _, _, report = load_bundle(source, day_first=False)
    assert report.details["ambiguous_dates"] == 1
    assert month_first[0].ts.month == 4
    assert day_first[0].ts.month == 3
    assert day_first[1].ts == month_first[1].ts
