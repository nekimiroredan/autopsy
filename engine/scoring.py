"""Rank replay-verified causes using shrunk priors and bounded chance ratios."""

from collections import defaultdict
from dataclasses import dataclass

PRIORS = {
    "double_scan": 0.16,
    "missed_scan": 0.17,
    "qty_typo": 0.20,
    "unit_mismatch": 0.09,
    "item_swap": 0.10,
    "wrong_location": 0.10,
    "miscount": 0.06,
    "cutoff_timing": 0.09,
    "residual_shrink": 0.03,
}
FALLBACKS = {"miscount", "residual_shrink"}


@dataclass(frozen=True)
class Ranked:
    candidate: object
    likelihood_ratio: float
    probability: float


def prior(cause, buckets, counts, strength=10):
    estimate = PRIORS[cause]
    for bucket in buckets:
        labels = counts.get(bucket, {})
        total = sum(labels.values())
        # No populated slice may outweigh the parent prior by more than 3:1.
        weight = min(total / (total + strength), 0.75)
        if total:
            estimate = estimate * (1 - weight) + weight * labels.get(cause, 0) / total
    return estimate


def score(
    candidates, buckets=("global",), counts=None, *, uniform_chance=False, use_docs=True
):
    rows = defaultdict(list)
    for proposal in candidates:
        ratio = proposal.search_space / proposal.competing_matches
        if uniform_chance:
            ratio = 1.0
        else:
            ratio *= proposal.corroboration
        if use_docs:
            ratio *= proposal.doc_signal
        ratio = 1.0 if proposal.cause in FALLBACKS else min(50.0, ratio)
        weight = prior(proposal.cause, buckets, counts or {}) * ratio
        rows[proposal.cause].append((weight, ratio, proposal))
    for matches in rows.values():
        matches.sort(key=lambda row: row[0], reverse=True)
    total = sum(matches[0][0] for matches in rows.values())
    return sorted(
        (
            Ranked(proposal, ratio, weight / total)
            for matches in rows.values()
            for weight, ratio, proposal in matches
        ),
        key=lambda row: (-row.probability, row.candidate.cause),
    )


def best_by_cause(ranked):
    best = {}
    for row in ranked:
        best.setdefault(row.candidate.cause, row)
    return list(best.values())
