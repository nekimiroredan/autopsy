from datetime import timedelta

import pytest

from engine.analyze import analyze
from engine.replay import Replayer
from schemas.models import ItemMaster
from tests.test_replay import END, START, count, movement


@pytest.mark.parametrize(
    ("cause", "moves", "counted", "master"),
    [
        ("double_scan", [movement("T1", END, 5), movement("T2", END, 5)], 105, []),
        ("missed_scan", [], 98, []),
        ("qty_typo", [movement("T1", END, 110)], 110, []),
        (
            "unit_mismatch",
            [movement("T1", END, 12)],
            102,
            [ItemMaster(item="SKU", pack_size=6)],
        ),
        ("miscount", [], 101, []),
        ("cutoff_timing", [movement("T1", END + timedelta(minutes=2), 5)], 105, []),
        ("residual_shrink", [], 98, []),
    ],
)
def test_candidate_replay(cause, moves, counted, master):
    counts = [count("A", START, 100), count("B", END, counted)]
    output = analyze(moves, counts, master, tier=2 if master else 0)
    hypothesis = next(row for row in output[1].hypotheses if row.cause == cause)
    fixed = Replayer(moves, counts).apply(hypothesis.repair).windows()
    assert fixed[1].gap == 0
    if cause in {"missed_scan", "miscount", "residual_shrink"}:
        assert hypothesis.likelihood_ratio == 1


@pytest.mark.parametrize(
    ("cause", "first", "second"),
    [
        ("item_swap", {"item": "SKU-1"}, {"item": "SKU-2"}),
        ("wrong_location", {"location": "B-1"}, {"location": "B-2"}),
    ],
)
def test_pair_repair_fixes_both_anchored_windows(cause, first, second):
    moves = [movement("T1", END, 7, **first)]
    counts = [
        count("A1", START, 100, **first),
        count("B1", END, 100, **first),
        count("A2", START, 100, **second),
        count("B2", END, 107, **second),
    ]
    cases = [case for case in analyze(moves, counts) if case.anchored]
    assert len(cases) == 2
    pair = next(row for row in cases[0].hypotheses if row.cause == cause)
    fixed = Replayer(moves, counts).apply(pair.repair).detect()
    assert len(fixed) == 2 and all(not row.anchored for row in fixed)
    assert all(
        cause not in [row.cause for row in case.hypotheses]
        for case in analyze(moves, counts[:2])
    )


def test_unsupported_signals_do_not_create_candidate_or_answer():
    output = analyze(
        [movement("T1", END, 13)], [count("A", START, 100), count("B", END, 110)]
    )
    case = output[1]
    causes = {row.cause for row in case.hypotheses}
    assert (
        not {"double_scan", "qty_typo", "unit_mismatch", "wrong_location", "item_swap"}
        & causes
    )
    assert case.abstain


def test_cutoff_correlated_gaps_share_a_single_repair():
    moves = [
        movement("T1", END + timedelta(minutes=2), 5),
        movement("T2", END + timedelta(minutes=4), 11),
    ]
    counts = [
        count("A", START, 100),
        count("B", END, 105),
        count("C", END + timedelta(days=1), 116),
    ]
    first, second = (
        case
        for case in analyze(moves, counts, threshold=0.4, margin=0.05)
        if case.anchored
    )
    assert not first.abstain and not second.abstain
    assert first.hypotheses[0].cause == second.hypotheses[0].cause == "cutoff_timing"
    assert first.hypotheses[0].repair == second.hypotheses[0].repair
    assert not any(
        row.anchored
        for row in Replayer(moves, counts).apply(first.hypotheses[0].repair).detect()
    )
