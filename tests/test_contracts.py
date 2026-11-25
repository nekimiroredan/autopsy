from pathlib import Path

import pytest
from pydantic import ValidationError

from schemas.models import Movement
from schemas.validate import ADAPTER

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures/evidence_fake.json"


def test_evidence_round_trip():
    cases = ADAPTER.validate_json(FIXTURE.read_bytes())
    assert len(cases) == 3
    assert cases[0].hypotheses[0].repair.ops[0].model_dump(by_alias=True)["from"] == 110
    assert cases[1].abstain and cases[1].expected is None
    assert cases[2].hypotheses[0].cause == "wrong_location"
    assert ADAPTER.validate_json(ADAPTER.dump_json(cases, by_alias=True)) == cases


def test_strict_quantity_and_timezone_normalization():
    with pytest.raises(ValidationError):
        Movement.model_validate_json(
            '{"txn_id":"T-1","ts":"2025-01-01T08:00:00+05:00",'
            '"item":"I-1","location":"L-1","qty_delta":"5","event_type":"receive"}'
        )
    txn = Movement.model_validate_json(
        '{"txn_id":"T-1","ts":"2025-01-01T08:00:00+05:00",'
        '"item":"I-1","location":"L-1","qty_delta":5,"event_type":"receive"}'
    )
    assert txn.ts.hour == 3
    assert txn.ts.tzinfo is None
