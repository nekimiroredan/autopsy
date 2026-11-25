from collections import defaultdict

import pytest

from engine.replay import Replayer
from generator.make import read_dataset, write_dataset
from generator.sim import generate


@pytest.mark.parametrize("difficulty", ["easy", "medium", "hard"])
def test_simulated_clean_bundle_balances_at_counts(difficulty):
    dataset = generate(seed=1025, days=18, errors=0, difficulty=difficulty)
    balance = defaultdict(float)
    events = [(row.ts, 0, row) for row in dataset.movements]
    events.extend((row.count_ts, 1, row) for row in dataset.counts)
    for _, is_count, row in sorted(events, key=lambda event: event[:2]):
        if is_count:
            assert row.counted_qty == balance[row.item, row.location]
        else:
            balance[row.item, row.location] += row.qty_delta
            assert balance[row.item, row.location] >= 0
    assert all(
        not window.anchored
        for window in Replayer(dataset.movements, dataset.counts).detect()
    )


def test_seeded_bundle_round_trip_includes_offsetting_pairs(tmp_path):
    dataset = generate(seed=4101, days=30, errors=24, difficulty="hard")
    manifest = write_dataset(dataset, tmp_path)
    loaded = read_dataset(tmp_path)
    assert loaded.manifest == manifest
    assert loaded == type(dataset)(
        dataset.movements, dataset.counts, dataset.master, dataset.truth, manifest
    )
    effects = defaultdict(list)
    for record in loaded.truth:
        for window, gap in record.effects.items():
            effects[window].append(gap)
    assert any(len(gaps) > 1 and sum(gaps) == 0 for gaps in effects.values())
    assert len(loaded.truth) == 24
