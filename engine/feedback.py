"""Append human labels and rebuild capped prior counts from the audit log."""

import json
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import UTC, datetime
from fcntl import LOCK_EX, flock
from pathlib import Path

from engine.scoring import PRIORS

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "data" / "feedback.jsonl"


@contextmanager
def audit_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        flock(stream.fileno(), LOCK_EX)
        yield


def submit_feedback(
    discrepancy_id, cause, correct, label=None, context="global", path=None
):
    if cause not in PRIORS:
        raise ValueError("Feedback must refer to a displayed repair cause")
    chosen = cause if correct else label or "not sure"
    if chosen != "not sure" and chosen not in PRIORS:
        raise ValueError("Unknown feedback cause")
    file = Path(path or DEFAULT_PATH)
    record = {
        "discrepancy_id": discrepancy_id,
        "displayed_cause": cause,
        "label": chosen,
        "context": context,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    with audit_lock(file.with_name(file.name + ".lock")), file.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record) + "\n")
    return record


def label_counts(path=None):
    source = Path(path or DEFAULT_PATH)
    counts = defaultdict(Counter)
    try:
        lines = source.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return counts
    latest = {}
    for line in lines:
        record = json.loads(line)
        latest[record["discrepancy_id"]] = record
    for record in latest.values():
        if record["label"] not in PRIORS:
            continue
        for bucket in {"global", record["context"]}:
            counts[bucket][record["label"]] += 1
    return counts
