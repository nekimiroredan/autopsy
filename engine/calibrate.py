"""Persist confidence mappings and evaluate calibration on held-out data."""

import json
from dataclasses import asdict, dataclass, field
from itertools import pairwise
from pathlib import Path

import numpy as np


@dataclass
class Calibrator:
    method: str
    model: dict
    threshold: float = 0.7
    metadata: dict = field(default_factory=dict)

    def predict(self, score):
        scores = np.asarray(score)
        if self.method == "isotonic":
            result = np.interp(scores, self.model["x"], self.model["y"])
        elif self.method == "platt":
            from scipy.special import expit

            result = expit(self.model["slope"] * scores + self.model["intercept"])
        else:
            result = np.full_like(scores, self.model["probability"], dtype=float)
        clipped = np.clip(result, 0.01, 0.99)
        return float(clipped) if np.ndim(clipped) == 0 else clipped

    def save(self, path):
        Path(path).write_text(json.dumps(asdict(self), indent=2, sort_keys=True) + "\n")

    @classmethod
    def load(cls, path):
        return cls(**json.loads(Path(path).read_text()))


def _model(x, y, isotonic=None):
    if len(np.unique(y)) < 2:
        return Calibrator(
            "constant", {"probability": float((sum(y) + 0.5) / (len(y) + 1))}
        )
    if isotonic is None:
        isotonic = len(y) >= 500
    if isotonic:
        from sklearn.isotonic import IsotonicRegression

        estimator = IsotonicRegression(out_of_bounds="clip").fit(x, y)
        return Calibrator(
            "isotonic",
            {
                "x": estimator.X_thresholds_.tolist(),
                "y": estimator.y_thresholds_.tolist(),
            },
        )
    from sklearn.linear_model import LogisticRegression

    estimator = LogisticRegression(C=100).fit(x.reshape(-1, 1), y)
    return Calibrator(
        "platt",
        {
            "slope": float(estimator.coef_[0, 0]),
            "intercept": float(estimator.intercept_[0]),
        },
    )


def reliability(probabilities, labels, n_bins=15):
    probabilities = np.asarray(probabilities)
    labels = np.asarray(labels)
    if not len(labels):
        return {"ece": None, "brier": None, "bins": []}
    order = np.argsort(probabilities, kind="stable")
    # Keep identical predictions in the same bin. Splitting an isotonic plateau
    # would make its measured accuracy depend on input order.
    sorted_scores = probabilities[order]
    boundaries = np.flatnonzero(np.diff(sorted_scores)) + 1
    cuts = {0, len(labels)}
    for ideal in np.linspace(0, len(labels), min(n_bins, len(labels)) + 1)[1:-1]:
        if len(boundaries):
            cuts.add(int(boundaries[np.argmin(np.abs(boundaries - ideal))]))
    bins = []
    positions = sorted(cuts)
    for left, right in pairwise(positions):
        indices = order[left:right]
        bins.append(
            {
                "confidence": float(probabilities[indices].mean()),
                "accuracy": float(labels[indices].mean()),
                "count": len(indices),
            }
        )
    return {
        "ece": sum(
            abs(item["confidence"] - item["accuracy"]) * item["count"] for item in bins
        )
        / len(labels),
        "brier": float(np.mean((probabilities - labels) ** 2)),
        "bins": bins,
    }


def cross_fit(probabilities, labels):
    from sklearn.model_selection import StratifiedKFold

    x, y = np.asarray(probabilities), np.asarray(labels, dtype=int)
    support = np.bincount(y, minlength=2)
    folds = min(5, min(support))
    if folds < 2:
        return None
    held_out = np.empty(len(y))
    for train, test in StratifiedKFold(folds, shuffle=True, random_state=0).split(x, y):
        held_out[test] = _model(x[train], y[train], isotonic=len(y) >= 500).predict(
            x[test]
        )
    return held_out


def fit(probabilities, labels, metadata=None, target=0.90):
    x, y = np.asarray(probabilities, dtype=float), np.asarray(labels, dtype=int)
    if not len(x) or x.shape != y.shape or not set(y).issubset({0, 1}):
        raise ValueError("Calibration needs matched scores and binary labels")
    model = _model(x, y)
    held_out = cross_fit(x, y)
    values = model.predict(x) if held_out is None else held_out
    best, selected = (-1.0, 0.0), None
    for threshold in sorted(set(values)):
        predictions = values >= threshold
        hits = (predictions & (y == 1)).sum()
        precision = hits / predictions.sum()
        if precision >= target:
            selected = float(threshold)
            break
        f1 = 2 * hits / (predictions.sum() + y.sum())
        if f1 > best[0]:
            best = (f1, float(threshold))
    model.threshold = (
        selected if selected is not None else (1.0 if not y.sum() else best[1])
    )
    model.metadata = {
        **(metadata or {}),
        "fit_split": "validation",
        "samples": len(y),
        "threshold_rule": "precision_target" if selected is not None else "best_f1",
        "cross_fit": None if held_out is None else reliability(values, y),
    }
    return model
