"""Run storage and evidence data sources for the local dashboard."""
import json
import os
from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Lock
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Run:
    source: str
    tier: int
    movements: list
    evidence: list
    hotspots: list
    counts: list
    master: list | None
    report: dict | None = None


runs = OrderedDict()
lock = Lock()


def analyze_run(movements, counts, master, tier, source):
    from engine.analyze import analyze
    from engine.hotspots import hotspots

    kwargs = {"feedback": source == "Uploaded data" and feedback_enabled()}
    calibrator = load_calibrator()
    if calibrator is not None:
        kwargs["calibrator"] = calibrator
    cases = analyze(movements, counts, master=master, tier=tier, **kwargs)
    return Run(source, tier, movements, cases, hotspots(movements, cases, tier=tier, master=master), counts, master)


def load_calibrator():
    from engine.calibrate import Calibrator

    artifact = ROOT / "eval/results/latest/calibrator.json"
    return Calibrator.load(artifact) if artifact.is_file() else None


@lru_cache(maxsize=1)
def demo_run():
    from demo.experiments import sample

    data = sample()
    return analyze_run(data.movements, data.counts, data.master, 2, "Synthetic demo")


def store(run):
    run_id = uuid4().hex
    with lock:
        runs[run_id] = run
        while len(runs) > 16:
            runs.popitem(last=False)
    return run_id


def get_run(run_id):
    if run_id == "demo":
        return demo_run()
    with lock:
        return runs[run_id]


def load_evidence(run_id):
    return get_run(run_id).evidence


def load_hotspots(run_id):
    return get_run(run_id).hotspots


def load_trust():
    root = ROOT / "eval/results"
    latest = root / "latest/results.json"
    if not latest.is_file() and (root / "latest").is_file():
        latest = root / (root / "latest").read_text().strip() / "results.json"
    if not latest.is_file():
        return None
    result = json.loads(latest.read_text())
    report = latest.with_name("RESULTS.md")
    if report.is_file():
        content = report.read_text(encoding="utf-8")
        result["limitations"] = report_section(content, "Limitations")
        result["missed_gates"] = []
        for line in report_section(content, "Gates"):
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if len(cells) == 4 and cells[1] == "Missed":
                result["missed_gates"].append({
                    "name": cells[0], "measured": cells[2], "target": cells[3],
                })
    return result


def report_section(content, title):
    _, heading, body = content.partition(f"\n## {title}\n")
    return body.split("\n## ", 1)[0].strip().splitlines() if heading else []


def shift_tiles(run):
    if run.tier < 1:
        return []
    linked = {
        edit.txn_id
        for case in run.evidence if not case.abstain and case.hypotheses
        for edit in case.hypotheses[0].repair.ops if edit.txn_id
    }
    groups = {}
    for row in run.movements:
        if row.shift:
            counts = groups.setdefault((row.location, row.shift), [0, 0])
            counts[0] += row.txn_id in linked
            counts[1] += 1
    return [
        {"location": location, "shift": shift, "errors": errors, "exposure": exposure, "rate": errors / exposure}
        for (location, shift), (errors, exposure) in sorted(groups.items())
    ]


def feedback_enabled():
    return os.getenv("AUTOPSY_FEEDBACK", "1") != "0"


def submit_feedback(discrepancy_id, cause, correct, label=None, *, source, location):
    from engine.feedback import submit_feedback as append

    path = None if source == "Uploaded data" else ROOT / "data/feedback_demo.jsonl"
    return append(discrepancy_id, cause, correct, label=label, context=f"location:{location}", path=path)
