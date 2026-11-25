from engine.hotspots import hotspots
from schemas.models import EditOp, EvidenceObject, Hypothesis, Repair
from tests.test_replay import END, START, movement


def cases_for(indices, rows):
    return [
        EvidenceObject(
            id=f"D-{index}",
            item="SKU",
            location=rows[index].location,
            tier=1,
            window=(START, END),
            anchored=True,
            expected=10,
            counted=9,
            gap=-1,
            value_at_risk=None,
            abstain=False,
            hypotheses=[
                Hypothesis(
                    cause="double_scan",
                    confidence=0.95,
                    likelihood_ratio=8,
                    search_space=8,
                    competing_matches=1,
                    evidence=[],
                    repair=Repair(ops=[EditOp(op="delete", txn_id=rows[index].txn_id)]),
                ),
            ],
        )
        for index in indices
    ]


def test_recovers_concentration_and_anonymizes_worker():
    moves = [
        movement(f"T-{i}", END, 1, location="A" if i < 100 else "B").model_copy(
            update={"worker": "Raw-worker-A" if i < 100 else "Raw-worker-B"}
        )
        for i in range(200)
    ]
    rows = hotspots(moves, cases_for([*range(30), 101], moves), tier=1, salt=b"tests")
    assert {row["dimension"] for row in rows if row["significant"]} == {
        "location",
        "worker",
    }
    assert "Raw-worker" not in repr(rows)
    flagged = next(row for row in rows if row["significant"])
    assert flagged["lower"] < flagged["rate"] < flagged["upper"]
    assert flagged["excess"] > 0
    assert flagged["value"] is None
    null = hotspots(
        moves, cases_for([*range(10), *range(100, 110)], moves), tier=1, salt=b"tests"
    )
    assert not any(row["significant"] for row in null)
