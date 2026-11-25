"""Produce signed counterfactual effects aligned by physical count identity."""

from collections import defaultdict

from schemas.models import GroundTruthRecord


def _windows_by_count(replayer):
    return {window.count_id: window for window in replayer.windows() if window.anchored}


def build(replayer, dirty, events):
    clean = _windows_by_count(replayer)
    actual = _windows_by_count(dirty)
    records = []
    for step, (cause, target, repair) in enumerate(events):
        only_error = _windows_by_count(replayer.apply(repair))
        effects = {
            actual[count_id].id: window.gap - clean[count_id].gap
            for count_id, window in only_error.items()
            if count_id in actual
            and count_id in clean
            and abs(window.gap - clean[count_id].gap) > 1e-6
        }
        if not effects:
            raise ValueError(f"{cause} on {target} had no isolated effect")
        records.append(
            GroundTruthRecord(
                cause=cause,
                target_id=target,
                edit=repair,
                injected_at_step=step,
                effects=effects,
            )
        )
    verify(dirty, records)
    return records


def verify(dirty, records):
    expected = defaultdict(float)
    for record in records:
        for identifier, effect in record.effects.items():
            expected[identifier] += effect
    actual = {window.id: window.gap for window in dirty.windows() if window.anchored}
    unfound = set(expected) - set(actual)
    mismatches = {
        identifier: (gap, expected[identifier])
        for identifier, gap in actual.items()
        if abs(gap - expected[identifier]) > 1e-6
    }
    if unfound or mismatches:
        raise ValueError(
            f"Ground truth failed to reconcile: {sorted(unfound)} {mismatches}"
        )
