"""Metrics on observable anchored windows, split from dataset generation."""

from collections import defaultdict
from dataclasses import dataclass
from itertools import groupby


@dataclass(frozen=True)
class Observation:
    causes: frozenset[str]
    ranked: tuple[str, ...]
    confidence: float
    margin: float
    answered: bool
    value: float
    difficulty: str

    @property
    def correct(self):
        return bool(self.ranked and self.ranked[0] in self.causes)


def observed_truth(dataset):
    effects = defaultdict(list)
    for record in dataset.truth:
        for identifier, effect in record.effects.items():
            effects[identifier].append((record.cause, effect))
    return {
        identifier: frozenset(cause for cause, _ in rows)
        for identifier, rows in effects.items()
        if abs(sum(effect for _, effect in rows)) > 1e-6
    }


def rank(evidence):
    return tuple(hypothesis.cause for hypothesis in evidence.hypotheses)


def samples(dataset, evidence):
    truth = observed_truth(dataset)
    by_id = {row.id: row for row in evidence if row.anchored}
    result = []
    for identifier in sorted(truth):
        row = by_id.get(identifier)
        if row is None:
            result.append(
                Observation(
                    truth[identifier],
                    (),
                    0,
                    0,
                    False,
                    0,
                    dataset.manifest.get("difficulty", "unknown"),
                )
            )
            continue
        probabilities = [hypothesis.confidence for hypothesis in row.hypotheses]
        confidence = probabilities[0] if probabilities else 0
        margin = confidence - (probabilities[1] if len(probabilities) > 1 else 0)
        result.append(
            Observation(
                truth[identifier],
                rank(row),
                confidence,
                margin,
                not row.abstain,
                row.value_at_risk or 0,
                dataset.manifest.get("difficulty", "unknown"),
            )
        )
    return result, (
        len(set(truth) & set(by_id)),
        len(set(by_id) - set(truth)),
        len(set(truth) - set(by_id)),
    )


def fraction(numerator, denominator):
    return round(numerator / denominator, 8) if denominator else None


def summarize(observations, counts=None):
    single = [row for row in observations if len(row.causes) == 1]
    multi = [row for row in observations if len(row.causes) > 1]
    answered = [row for row in single if row.answered]
    summary = {
        "support": len(observations),
        "single_support": len(single),
        "multi_support": len(multi),
        "top1": fraction(sum(row.correct for row in single), len(single)),
        "top3": fraction(
            sum(bool(row.causes.intersection(row.ranked[:3])) for row in single),
            len(single),
        ),
        "cause_set_recall": fraction(
            sum(
                len(row.causes.intersection(row.ranked[:3])) / len(row.causes)
                for row in multi
            ),
            len(multi),
        ),
        "coverage": fraction(
            sum(row.answered for row in observations), len(observations)
        ),
        "selective_accuracy": fraction(
            sum(row.correct for row in answered), len(answered)
        ),
        "value_weighted_recall": fraction(
            sum(row.value for row in answered if row.correct),
            sum(row.value for row in single),
        ),
    }
    if counts is not None:
        tp, fp, fn = counts
        summary.update(
            detection_f1=fraction(2 * tp, 2 * tp + fp + fn),
            detection_precision=fraction(tp, tp + fp),
            detection_recall=fraction(tp, tp + fn),
            detection={"true_positive": tp, "false_positive": fp, "false_negative": fn},
        )
    return summary


def coverage_curve(rows):
    single = sorted(
        (row for row in rows if len(row.causes) == 1), key=lambda row: -row.confidence
    )
    if not single:
        return []
    groups = [
        (confidence, list(rows))
        for confidence, rows in groupby(single, key=lambda row: row.confidence)
    ]
    result = []
    for step in range(1, 21):
        count = (len(single) * step + 19) // 20
        remaining, correct = count, 0.0
        for threshold, tied in groups:
            included = min(remaining, len(tied))
            # If a percentile lands inside a tied score, report its expected
            # accuracy under label-independent selection within that tie.
            correct += included * sum(row.correct for row in tied) / len(tied)
            remaining -= included
            if not remaining:
                break
        result.append(
            {
                "threshold": threshold,
                "coverage": fraction(count, len(single)),
                "accuracy": fraction(correct, count),
                "support": count,
            }
        )
    return result
