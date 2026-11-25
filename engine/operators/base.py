"""Candidate generation utilities and common replay gate."""

from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Protocol

from engine.replay import EPSILON, Replayer
from schemas.models import EditOp, Repair


@dataclass(frozen=True)
class Candidate:
    cause: str
    repair: Repair
    affected: tuple[str, ...]
    search_space: int = 1
    competing_matches: int = 1
    evidence: tuple[str, ...] = ()
    doc_signal: float = 1.0
    corroboration: float = 1.0

    @property
    def resources(self):
        resources = []
        for op in self.repair.ops:
            if op.txn_id:
                resources.append(("transaction", op.txn_id))
            if op.txn:
                resources.append(("transaction", op.txn.txn_id))
            if op.count_id:
                resources.append(("count", op.count_id))
        return set(resources)


@dataclass
class Context:
    replay: Replayer
    tier: int
    master: dict
    discrepancies: dict
    pair_windows: dict
    by_count_end: dict
    by_count_start: dict
    candidate_cap: int = 50
    truncations: dict | None = None
    use_docs: bool = True

    def verify(self, candidate):
        movements, counts = [], []
        for identifier in candidate.affected:
            window = self.discrepancies[identifier]
            key = window.item, window.location
            end = (
                window.count_ts + timedelta(minutes=30)
                if candidate.cause == "cutoff_timing"
                else window.count_ts
            )
            movements.extend(self.replay.transactions(key, window.prev_count_ts, end))
            anchor, current = None, self.replay.counts[window.count_id]
            for count in self.replay.counts_for(key):
                if count.count_ts == window.prev_count_ts:
                    anchor = count
                    break
            if anchor is None:
                return False
            counts.extend((anchor, current))
        projected = Replayer(movements, counts, self.replay.losses)
        fixed = projected.apply(candidate.repair)
        gaps = {row.count_id: row.gap for row in fixed.windows() if row.anchored}
        return all(
            abs(gaps.get(self.discrepancies[identifier].count_id, float("inf")))
            <= EPSILON
            for identifier in candidate.affected
        )


class Operator(Protocol):
    cause: str
    min_tier: int

    def generate(self, d, window, ctx) -> list[Candidate]: ...


def set_quantity(row, quantity):
    return EditOp(
        op="set_field",
        txn_id=row.txn_id,
        field="qty_delta",
        from_value=row.qty_delta,
        to_value=quantity,
    )


def candidate(cause, edits, windows, evidence, doc_signal=1.0, corroboration=1.0):
    return Candidate(
        cause,
        Repair(ops=edits),
        tuple(sorted(row.id for row in windows)),
        evidence=(evidence,),
        doc_signal=doc_signal,
        corroboration=corroboration,
    )


def tally(proposals, opportunities, ctx, inferred_matches=None):
    matches = [proposal for proposal in proposals if ctx.verify(proposal)]
    count = inferred_matches if inferred_matches is not None else len(matches)
    if len(matches) > ctx.candidate_cap and ctx.truncations is not None:
        cause = matches[0].cause
        ctx.truncations[cause] = (
            ctx.truncations.get(cause, 0) + len(matches) - ctx.candidate_cap
        )
    return [
        replace(
            proposal,
            search_space=max(1, opportunities),
            competing_matches=max(1, count),
        )
        for proposal in matches[: ctx.candidate_cap]
    ]
