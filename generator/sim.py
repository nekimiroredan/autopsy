"""Seeded warehouse simulator. All names, counts and event records are synthetic."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import timedelta
from random import Random

from engine.replay import Replayer
from generator.catalog import build_catalog, order_profile, size_sample
from generator.ground_truth import build
from generator.injectors.base import CAUSES, EASY_CAUSES, inject
from generator.world import SHIFTS, WORKERS, at, count_days, ledger_locations
from schemas.models import Count, GroundTruthRecord, ItemMaster, Movement, Repair


@dataclass
class Dataset:
    movements: list[Movement]
    counts: list[Count]
    master: list[ItemMaster]
    truth: list[GroundTruthRecord]
    manifest: dict


def generate(seed=2025, days=30, errors=24, difficulty="medium", *, retail=None):
    if days < 3 or errors < 0 or difficulty not in {"easy", "medium", "hard"}:
        raise ValueError(
            "Use at least 3 days, a non-negative error count, and easy, medium or hard"
        )
    rng = Random(seed)
    master = build_catalog(rng)
    frequencies, sizes = order_profile(retail) if retail else ([], None)
    popularity = (
        [value / frequencies[0] for value in frequencies[: len(master)]]
        if frequencies
        else []
    )
    movements, counts = [], []
    pairs = defaultdict(list)
    stock = {}
    item_index = {entry.item: index for index, entry in enumerate(master)}

    def movement(item, location, day, hour, minute, quantity, event, doc=None):
        index = len(movements)
        stock[item, location] = stock.get((item, location), 0) + quantity
        if stock[item, location] < 0:
            raise ValueError(
                f"Invalid negative stock in clean simulation for {item} at {location}"
            )
        row = Movement(
            txn_id=f"T-{index + 1:05d}",
            ts=at(day, hour, minute),
            item=item,
            location=location,
            qty_delta=quantity,
            event_type=event,
            doc_no=doc or f"{1000 + index}",
            worker=rng.choice(WORKERS),
            shift=SHIFTS[(hour // 8) % 3],
        )
        movements.append(row)
        return row

    for index, entry in enumerate(master):
        schedule = set(count_days(days, index))
        locations = ledger_locations(index)
        for location in locations:
            movement(entry.item, location, 0, 7, 0, rng.randint(80, 155), "receive")
        for day in range(days + 1):
            if day:
                if day % 3 == 1:
                    source, destination = locations if day % 2 else locations[::-1]
                    amount = min(stock[entry.item, source] // 4, 8)
                    if amount:
                        doc = f"TR-{index}-{day}"
                        movement(
                            entry.item, source, day, 6, 0, -amount, "move_out", doc
                        )
                        movement(
                            entry.item, destination, day, 6, 2, amount, "move_in", doc
                        )
                for location in locations:
                    rate = (
                        popularity[index % len(popularity)]
                        if popularity
                        else 1 / (1 + index / 4)
                    )
                    key = entry.item, location
                    if stock[key] < 35 or rng.random() < 0.16:
                        quantity = max(30, 180 - stock[key])
                        movement(
                            entry.item,
                            location,
                            day,
                            9,
                            rng.randrange(40),
                            quantity,
                            "receive",
                        )
                    if rng.random() < 0.3 + 0.65 * rate and stock[key]:
                        quantity = min(stock[key], size_sample(rng, sizes))
                        pick = movement(
                            entry.item,
                            location,
                            day,
                            13,
                            rng.randrange(40),
                            -quantity,
                            "pick",
                        )
                        if (
                            difficulty != "easy"
                            and rng.random() < 0.14
                            and stock[key] >= quantity
                        ):
                            movement(
                                entry.item,
                                location,
                                day,
                                13,
                                pick.ts.minute + 1,
                                -quantity,
                                "pick",
                            )
                    if rng.random() < 0.12:
                        movement(
                            entry.item,
                            location,
                            day,
                            16,
                            25,
                            rng.randint(1, 7),
                            "return",
                        )
            if day in schedule:
                for location in locations:
                    if day:
                        latest = movement(
                            entry.item,
                            location,
                            day,
                            18,
                            0,
                            3 + (index + day) % 7,
                            "receive",
                        )
                    count = Count(
                        count_id=f"C-{len(counts) + 1:04d}",
                        count_ts=at(day, 18, 5),
                        item=entry.item,
                        location=location,
                        counted_qty=stock[entry.item, location],
                    )
                    counts.append(count)
                    if day:
                        pairs[entry.item, location].append((count, latest))

    replay = Replayer(movements, counts)
    if any(window.anchored for window in replay.detect()):
        raise ValueError("Clean simulation failed replay")
    options = [
        (item, location, previous, count, latest)
        for (item, location), windows in pairs.items()
        for index, (count, latest) in enumerate(windows)
        for previous in [windows[index - 1][0].count_ts if index else at(0, 18, 5)]
    ]
    rng.shuffle(options)
    reserved = set()
    edited_txns = set()
    protected = set()
    occupancy = defaultdict(int)
    events = []
    cause_pool = EASY_CAUSES if difficulty == "easy" else CAUSES
    cycle = list(cause_pool)
    rng.shuffle(cycle)
    if difficulty == "hard" and errors >= 2:
        item, location, previous, count, _ = options[0]
        txn = next(
            row
            for row in replay.transactions((item, location), previous, count.count_ts)
            if row.ts < count.count_ts - timedelta(minutes=2)
        )
        for cause, serial in (("double_scan", 0), ("missed_scan", 1)):
            events.append(
                inject(
                    cause,
                    txn,
                    count,
                    alternate_location=location,
                    alternate_item=item,
                    pack_size=1,
                    serial=serial,
                )
            )
        edited_txns.add(txn.txn_id)
        reserved.add((item, location, count.count_ts))
        protected.update(reserved)
    for serial in range(len(events), errors):
        cause = cycle[serial % len(cycle)]
        rng.shuffle(options)
        wants_overlap = (
            difficulty == "hard"
            and serial % 3 == 0
            or difficulty == "medium"
            and serial % 5 == 0
        )
        for item, location, previous, count, latest in options:
            current = (item, location, count.count_ts)
            index = item_index[item]
            other_item = master[index ^ 1].item
            other_location = next(
                other for other in ledger_locations(index) if other != location
            )
            affected = {current}
            if cause == "wrong_location":
                affected.add((item, other_location, count.count_ts))
            if cause == "item_swap":
                affected.add((other_item, location, count.count_ts))
            if cause in {"cutoff_timing", "miscount"}:
                window_index = next(
                    i
                    for i, (row, _) in enumerate(pairs[item, location])
                    if row == count
                )
                if window_index + 1 < len(pairs[item, location]):
                    affected.add(
                        (
                            item,
                            location,
                            pairs[item, location][window_index + 1][0].count_ts,
                        )
                    )
                elif cause == "cutoff_timing":
                    continue
            is_count_edit = cause in {"cutoff_timing", "miscount"}
            if protected.intersection(affected) or (
                reserved.intersection(affected)
                and (difficulty == "easy" or is_count_edit)
            ):
                continue
            limit = 1 if difficulty == "easy" else 2
            if any(occupancy[key] >= limit for key in affected):
                continue
            if not is_count_edit and wants_overlap != bool(
                reserved.intersection(affected)
            ):
                continue
            txns = [
                row
                for row in replay.transactions(
                    (item, location), previous, count.count_ts
                )
                if row.txn_id not in edited_txns
                and row.qty_delta != 0
                and row.event_type in {"receive", "pick", "return"}
                and row.ts < count.count_ts - timedelta(minutes=10)
            ]
            if cause == "residual_shrink":
                txns = [row for row in txns if row.qty_delta < 0]
            if not txns and not is_count_edit:
                continue
            txn = latest if is_count_edit else rng.choice(txns)
            events.append(
                inject(
                    cause,
                    txn,
                    count,
                    alternate_location=other_location,
                    alternate_item=other_item,
                    pack_size=master[index].pack_size,
                    serial=serial,
                )
            )
            edited_txns.add(txn.txn_id)
            reserved.update(affected)
            for key in affected:
                occupancy[key] += 1
            if is_count_edit:
                protected.update(affected)
            break
        else:
            # Remaining easy windows are exhausted, or dense mode has no legal compatible injection.
            continue

    dirty = (
        replay.apply(Repair(ops=[op for _, _, repair in events for op in repair.ops]))
        if events
        else replay
    )
    truth = build(replay, dirty, events)

    dirty_rows = list(dirty.movements.values())
    if difficulty == "hard":
        dirty_rows = [
            row.model_copy(update={"worker": None, "shift": rng.choice(SHIFTS)})
            if rng.random() < 0.12
            else row
            for row in dirty_rows
        ]
    return Dataset(
        dirty_rows,
        list(dirty.counts.values()),
        master,
        truth,
        {
            "source": "synthetic",
            "catalog_source": "adapted retail distribution"
            if retail
            else "seeded offline",
            "seed": seed,
            "days": days,
            "requested_errors": errors,
            "difficulty": difficulty,
            "counts": len(counts),
            "movements": len(dirty_rows),
            "injected_errors": len(truth),
            "window_boundary_policy": "One shifted count per affected window; nearby count corrections excluded.",
            "generator_version": 1,
        },
    )
