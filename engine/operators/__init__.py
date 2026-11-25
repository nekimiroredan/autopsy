"""Bounded repair searches for the supported discrepancy causes."""

import re
from collections import defaultdict
from datetime import time, timedelta
from itertools import pairwise
from math import isclose

from engine.operators.base import candidate, set_quantity, tally
from engine.replay import EPSILON
from schemas.models import EditOp, Movement


def same(left, right):
    return isclose(left, right, rel_tol=0, abs_tol=EPSILON)


def double_scan(d, window, ctx):
    recent = defaultdict(list)
    documents = defaultdict(list)
    for row in window:
        prior = recent[row.qty_delta]
        matching_doc = (
            documents[row.doc_no, row.qty_delta]
            if row.doc_no and ctx.tier >= 1 and ctx.use_docs
            else []
        )
        matching_time = prior and row.ts - prior[-1].ts <= timedelta(minutes=10)
        if (matching_doc or matching_time) and same(-row.qty_delta, d.gap):
            first = matching_doc[-1] if matching_doc else prior[-1]
            signal = (
                3.0
                if matching_doc
                else (0.8 if ctx.tier >= 1 and not row.doc_no else 1.0)
            )
            reason = (
                f"Repeated source document {row.doc_no}."
                if matching_doc
                else "Scanned within ten minutes."
            )
            yield candidate(
                "double_scan",
                [EditOp(op="delete", txn_id=row.txn_id)],
                [d],
                f"Removing {row.txn_id} after {first.txn_id} closes the gap. {reason}",
                signal,
            )
        prior.append(row)
        if row.doc_no:
            documents[row.doc_no, row.qty_delta].append(row)


def missed_scan(d, window, ctx):
    dates = sorted({row.ts for row in window} | {d.count_ts})
    evidence = f"An unlogged movement of {d.gap:+g} units would close the gap at any of {len(dates)} possible timestamps."
    signal = 1.0
    if ctx.tier >= 1 and ctx.use_docs:
        nearby = ctx.replay.transactions(
            (d.item, d.location), d.prev_count_ts, d.count_ts
        )
        number_groups = defaultdict(set)
        for row in nearby:
            match = re.fullmatch(r"(.*?)[ -]?(\d+)", row.doc_no or "")
            if match:
                number_groups[match[1]].add(int(match[2]))
        for numbers in number_groups.values():
            ordered = sorted(numbers)
            if any(right - left == 2 for left, right in pairwise(ordered)):
                signal = 2.0
                evidence += " A nearby numeric document sequence skips a number."
                break
    if len(dates) > ctx.candidate_cap and ctx.truncations is not None:
        ctx.truncations["missed_scan"] = (
            ctx.truncations.get("missed_scan", 0) + len(dates) - ctx.candidate_cap
        )
    output = []
    for position, ts in enumerate(reversed(dates[-ctx.candidate_cap :])):
        identifier = f"R-{d.id}-{position}"
        while identifier in ctx.replay.movements:
            identifier += "-R"
        row = Movement(
            txn_id=identifier,
            ts=ts,
            item=d.item,
            location=d.location,
            qty_delta=d.gap,
            event_type="receive" if d.gap > 0 else "pick",
        )
        output.append(
            candidate(
                "missed_scan",
                [EditOp(op="insert", txn=row)],
                [d],
                evidence,
                signal,
            )
        )
    return tally(output, len(dates), ctx, inferred_matches=len(dates))


def typo_compatible(original, corrected):
    if original == 0 or corrected == 0:
        return False
    if any(same(original * scale, corrected) for scale in (0.01, 0.1, 10, 100, -1)):
        return True
    if (original < 0) != (corrected < 0):
        return False
    left, right = format(abs(original), ".12g"), format(abs(corrected), ".12g")
    if abs(len(left) - len(right)) == 1:
        longer, shorter = sorted((left, right), key=len, reverse=True)
        return any(
            character.isdigit() and longer[:index] + longer[index + 1 :] == shorter
            for index, character in enumerate(longer)
        )
    if len(left) == len(right):
        differences = [index for index, (a, b) in enumerate(zip(left, right)) if a != b]
        if len(differences) == 2:
            first, second = differences
            return (
                left[first].isdigit()
                and left[second].isdigit()
                and left[first] == right[second]
                and left[second] == right[first]
            )
    return False


def qty_typo(d, window, ctx):
    for row in reversed(window):
        corrected = row.qty_delta + d.gap
        if typo_compatible(row.qty_delta, corrected):
            yield candidate(
                "qty_typo",
                [set_quantity(row, corrected)],
                [d],
                f"{row.txn_id} logged {row.qty_delta:g} units. Changing it to {corrected:g} closes the gap.",
                0.8 if ctx.tier >= 1 and not row.doc_no else 1.0,
            )


def unit_mismatch(d, window, ctx):
    item = ctx.master.get(d.item)
    pack = item.pack_size if item else None
    if pack and pack > 1:
        for row in reversed(window):
            for corrected in (row.qty_delta / pack, row.qty_delta * pack):
                if same(corrected - row.qty_delta, d.gap):
                    yield candidate(
                        "unit_mismatch",
                        [set_quantity(row, corrected)],
                        [d],
                        f"Using the {pack:g}-unit pack size on {row.txn_id} changes "
                        f"{row.qty_delta:g} to {corrected:g} and closes the gap.",
                        0.8 if ctx.tier >= 1 and not row.doc_no else 1.0,
                    )


def pair_repair(d, window, ctx, field):
    cause = "item_swap" if field == "item" else "wrong_location"
    bucket = d.location if field == "item" else d.item
    peers = ctx.pair_windows.get((field, bucket), ())
    opportunities, proposals = 0, []
    for peer in peers:
        if peer.id == d.id or not same(d.gap, -peer.gap):
            continue
        if abs(d.count_ts - peer.count_ts) > timedelta(days=3):
            continue
        if field == "item" and ctx.tier >= 2:
            first = ctx.master.get(d.item)
            second = ctx.master.get(peer.item)
            if (
                first
                and second
                and first.similar_group
                and second.similar_group
                and first.similar_group != second.similar_group
            ):
                continue
        for source, destination in ((d, peer), (peer, d)):
            if max(source.prev_count_ts, destination.prev_count_ts) >= min(
                source.count_ts, destination.count_ts
            ):
                continue
            rows = ctx.replay.transactions(
                (source.item, source.location),
                max(source.prev_count_ts, destination.prev_count_ts),
                min(source.count_ts, destination.count_ts),
            )
            opportunities += len(rows)
            for row in reversed(rows):
                if not same(-row.qty_delta, source.gap):
                    continue
                old, new = getattr(source, field), getattr(destination, field)
                proposals.append(
                    candidate(
                        cause,
                        [
                            EditOp(
                                op="set_field",
                                txn_id=row.txn_id,
                                field=field,
                                from_value=old,
                                to_value=new,
                            )
                        ],
                        [d, peer],
                        f"Moving {row.txn_id} from {old} to {new} closes two opposing gaps.",
                        0.8 if ctx.tier >= 1 and not row.doc_no else 1.0,
                    )
                )
    return tally(proposals, opportunities, ctx)


def miscount(d, window, ctx):
    return [
        candidate(
            "miscount",
            [
                EditOp(
                    op="set_count",
                    count_id=d.count_id,
                    from_value=d.counted,
                    to_value=d.expected,
                )
            ],
            [d],
            f"A recount of {d.expected:g} instead of {d.counted:g} units would close the gap.",
        )
    ]


def _cutoff_edits(d, ctx):
    if d.count_ts.time() == time.min:
        return [], 0
    key = d.item, d.location
    span = timedelta(minutes=30)
    rows_before = ctx.replay.transactions(
        key, max(d.prev_count_ts, d.count_ts - span), d.count_ts
    )
    rows_after = ctx.replay.transactions(key, d.count_ts, d.count_ts + span)
    next_window = ctx.by_count_start.get((*key, d.count_ts))
    boundaries = {row.ts - timedelta(microseconds=1) for row in rows_before}
    boundaries.update(row.ts for row in rows_after)
    boundaries = sorted(boundaries, key=lambda ts: (abs(ts - d.count_ts), ts))
    boundaries = [
        ts
        for ts in boundaries
        if d.prev_count_ts < ts and (next_window is None or ts < next_window.count_ts)
    ]
    affected = [d]
    if (
        next_window
        and next_window.id in ctx.discrepancies
        and same(next_window.gap, -d.gap)
    ):
        affected.append(next_window)
    proposals = [
        candidate(
            "cutoff_timing",
            [
                EditOp(
                    op="set_count",
                    count_id=d.count_id,
                    field="count_ts",
                    from_value=d.count_ts.isoformat(),
                    to_value=ts.isoformat(),
                )
            ],
            affected,
            f"Shifting the count cutoff to {ts.isoformat()} closes "
            + ("two consecutive gaps." if len(affected) == 2 else "the gap."),
            corroboration=2.0 if len(affected) == 2 else 1.0,
        )
        for ts in boundaries
    ]
    return proposals, len(boundaries)


def cutoff_timing(d, window, ctx):
    proposals, opportunities = _cutoff_edits(d, ctx)
    previous = ctx.by_count_end.get((d.item, d.location, d.prev_count_ts))
    if previous and previous.id in ctx.discrepancies and same(previous.gap, -d.gap):
        paired, examined = _cutoff_edits(previous, ctx)
        proposals.extend(row for row in paired if d.id in row.affected)
        opportunities += examined
    return tally(proposals, opportunities, ctx)


def residual_shrink(d, window, ctx):
    if d.gap > 0:
        return []
    return [
        candidate(
            "residual_shrink",
            [EditOp(op="book_loss", count_id=d.count_id, qty=d.gap)],
            [d],
            f"Booking a residual loss of {abs(d.gap):g} units reconciles the balance.",
        )
    ]


def generate(d, ctx):
    """Run each eligible search and retain only candidates that independently replay."""
    window = [ctx.replay.movements[identifier] for identifier in d.window_txn_ids]
    output = tally(double_scan(d, window, ctx), len(window), ctx)
    output.extend(missed_scan(d, window, ctx))
    output.extend(tally(qty_typo(d, window, ctx), len(window), ctx))
    if ctx.tier >= 2:
        output.extend(tally(unit_mismatch(d, window, ctx), 2 * len(window), ctx))
    for field in ("item", "location"):
        output.extend(pair_repair(d, window, ctx, field))
    output.extend(tally(miscount(d, window, ctx), 1, ctx))
    output.extend(cutoff_timing(d, window, ctx))
    output.extend(tally(residual_shrink(d, window, ctx), 1, ctx))
    return output
