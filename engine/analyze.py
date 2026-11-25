"""Run replay, attribution, compatible assignment, and check recommendation."""

import logging
from collections import defaultdict
from datetime import time
from itertools import pairwise

from engine import checks
from engine.assign import assign
from engine.feedback import label_counts
from engine.operators import generate
from engine.operators.base import Context
from engine.replay import EPSILON, Replayer
from engine.scoring import FALLBACKS, best_by_cause, score
from schemas.models import EvidenceObject, Hypothesis, Repair

PROVISIONAL_THRESHOLD = 0.55
LOGGER = logging.getLogger(__name__)


def analyze(
    movements,
    counts,
    master=(),
    tier=0,
    calibrator=None,
    *,
    threshold=None,
    margin=0.1,
    uniform_chance=False,
    use_docs=True,
    greedy=False,
    feedback=False,
    priors=None,
):
    replay = Replayer(movements, counts)
    items = {item.item: item for item in master}
    windows = replay.windows()
    anchored = {d.id: d for d in windows if d.anchored and abs(d.gap) > EPSILON}
    indexed = defaultdict(list)
    for d in anchored.values():
        indexed["item", d.location].append(d)
        indexed["location", d.item].append(d)
    truncations = {}
    by_end = {(d.item, d.location, d.count_ts): d for d in windows if d.anchored}
    by_start = {(d.item, d.location, d.prev_count_ts): d for d in windows if d.anchored}
    ctx = Context(
        replay,
        tier,
        items,
        anchored,
        indexed,
        by_end,
        by_start,
        truncations=truncations,
        use_docs=use_docs,
    )
    if threshold is None:
        threshold = calibrator.threshold if calibrator else PROVISIONAL_THRESHOLD
    if priors is None:
        priors = label_counts() if feedback else {}
    ranked, eligible, hypotheses, reasons = {}, {}, {}, {}
    for identifier, d in anchored.items():
        rows = [replay.movements[key] for key in d.window_txn_ids]
        buckets = ["global", f"location:{d.location}"]
        if rows:
            first = rows[-1]
            buckets.insert(1, f"event_type:{first.event_type}")
            if tier >= 1:
                buckets.extend(
                    f"{name}:{value}"
                    for name in ("worker", "shift")
                    if (value := getattr(first, name))
                )
        proposals = generate(d, ctx)
        ranked[identifier] = score(
            proposals, buckets, priors, uniform_chance=uniform_chance, use_docs=use_docs
        )
        top = best_by_cause(ranked[identifier])
        confidences = [row.probability for row in top]
        if calibrator:
            original = confidences[0]
            confidences[0] = calibrator.predict(original)
            if len(top) > 1:
                # Display the top rating with calibrated confidence, spreading
                # the remaining mass proportionally to the original ranking.
                residual = (1 - confidences[0]) / (1 - original)
                confidences[1:] = [value * residual for value in confidences[1:]]
        hypotheses[identifier] = [
            _hypothesis(row, confidence) for row, confidence in zip(top, confidences)
        ]
        raw_margin = top[0].probability - (top[1].probability if len(top) > 1 else 0)
        leading = top[0]
        needs_corroboration = leading.candidate.cause in FALLBACKS or (
            leading.candidate.cause == "missed_scan" and leading.likelihood_ratio <= 1
        )
        if threshold > 0 and needs_corroboration:
            reasons[identifier] = (
                "The leading repair reconciles the gap by construction and needs independent confirmation."
            )
        elif confidences[0] < threshold or raw_margin < margin:
            reasons[identifier] = (
                "The leading explanation fell below the confidence or separation threshold."
            )
        else:
            eligible[identifier] = ranked[identifier]
    if truncations:
        LOGGER.info("Replay-verified candidates truncated by cause: %s", truncations)
    selected = assign(eligible, greedy=greedy)
    cascades = _confirm_combination(replay, windows, anchored, selected, reasons)
    output = []
    for d in windows:
        if d.anchored and d.id not in anchored:
            continue
        item = items.get(d.item)
        limits = []
        if d.id in reasons:
            limits.append(reasons[d.id])
        if not d.anchored:
            limits.append(
                "Opening balance unavailable. A prior physical count is needed to anchor this window."
            )
        elif d.id in eligible and d.id not in selected and d.id not in reasons:
            limits.append(
                "The leading repair conflicts with another supported window or ledger edit."
            )
        if tier < 2 or not item or not item.pack_size:
            limits.append("Unit-mismatch checks need a pack size from the item master.")
        if d.count_ts.time() == time.min:
            limits.append(
                "Count timing has day-level precision; cutoff timing is unavailable."
            )
        if d.id in cascades:
            limits.append("The count repair changes a subsequent window.")
        matches = hypotheses.get(d.id, [])
        if d.id in selected:
            top = next(
                row
                for row in ranked[d.id]
                if row.candidate.cause == selected[d.id].cause
                and row.candidate.repair == selected[d.id].repair
            )
            matches[0] = _hypothesis(top, matches[0].confidence)
        if d.id not in selected and d.anchored:
            check_id, check = (
                "recount_location",
                f"Recount {d.item} at {d.location} and verify the original count sheet.",
            )
        else:
            check_id, check = checks.recommend(d, matches, replay, tier)
        value = (
            abs(d.gap) * item.unit_cost
            if d.anchored and tier >= 2 and item and item.unit_cost is not None
            else None
        )
        output.append(
            EvidenceObject(
                id=d.id,
                item=d.item,
                location=d.location,
                tier=tier,
                window=(d.prev_count_ts, d.count_ts),
                expected=d.expected,
                counted=d.counted,
                gap=d.gap,
                anchored=d.anchored,
                value_at_risk=value,
                abstain=d.id not in selected,
                hypotheses=matches,
                check_id=check_id,
                suggested_check=check,
                limitations=limits,
                calibrated=bool(calibrator and d.anchored),
                cascades=d.id in cascades,
            )
        )
    return output


def _confirm_combination(replay, windows, anchored, selected, reasons):
    for _ in range(2):
        if not selected:
            return set()
        candidates = {id(candidate): candidate for candidate in selected.values()}
        changes = Repair(
            ops=[op for proposal in candidates.values() for op in proposal.repair.ops]
        )
        changed = replay.apply(changes)
        gaps = {
            window.count_id: window.gap
            for window in changed.windows()
            if window.anchored
        }
        invalid = {
            id(proposal)
            for identifier, proposal in selected.items()
            if abs(gaps.get(anchored[identifier].count_id, float("inf"))) > EPSILON
        }
        if not invalid:
            return _count_cascades(gaps, windows, anchored, selected)
        for identifier in list(selected):
            if id(selected[identifier]) in invalid:
                selected.pop(identifier)
                reasons[identifier] = (
                    "This repair conflicts with another change in the combined replay."
                )
    # Removing further repairs would need another replay to guarantee closure.
    for identifier in selected:
        reasons[identifier] = "The combined repairs could not be verified together."
    selected.clear()
    return set()


def _count_cascades(gaps, windows, anchored, selected):
    next_windows = {}
    for previous, current in pairwise(windows):
        if (previous.item, previous.location) == (current.item, current.location):
            next_windows[previous.count_id] = current
    cascades = set()
    for identifier, proposal in selected.items():
        d = anchored[identifier]
        if any(
            op.op == "set_count" and op.count_id == d.count_id
            for op in proposal.repair.ops
        ):
            next_window = next_windows.get(d.count_id)
            if (
                next_window
                and abs(gaps[next_window.count_id] - next_window.gap) > EPSILON
            ):
                cascades.add(identifier)
    return cascades


def _hypothesis(row, confidence):
    candidate = row.candidate
    return Hypothesis(
        cause=candidate.cause,
        confidence=confidence,
        repair=candidate.repair,
        likelihood_ratio=row.likelihood_ratio,
        search_space=candidate.search_space,
        competing_matches=candidate.competing_matches,
        evidence=list(candidate.evidence),
    )
