"""Regenerate the benchmark, calibration artifact, charts and reproducible metrics."""

import json
import os
from argparse import ArgumentParser
from collections import defaultdict
from dataclasses import replace
from hashlib import sha256
from pathlib import Path
from subprocess import DEVNULL, CalledProcessError, check_output
from time import perf_counter

from engine.analyze import analyze
from engine.calibrate import fit, reliability
from eval.baselines import forecast
from eval.hotspots_eval import evaluate as hotspot_checks
from eval.metrics import coverage_curve, samples, summarize
from eval.report import write
from generator.make import package_versions, read_dataset, write_dataset
from generator.sim import generate

DIFFICULTIES = ("easy", "medium", "hard")
ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "eval" / "results"
CACHE = ROOT / "data" / "eval"
BLIND_SEEDS = ROOT / "eval" / "blind" / "seeds.json"


def analyze_bundle(dataset, **options):
    return analyze(
        dataset.movements,
        dataset.counts,
        dataset.master,
        2 if dataset.master else 0,
        **options,
    )


def _dataset(split, seed, difficulty, cache):
    directory = cache / f"v1-{split}-{difficulty}-{seed}"
    if (directory / "manifest.json").exists():
        return read_dataset(directory, verify_hashes=True)
    dataset = generate(seed, 10, 9, difficulty)
    dataset.manifest = write_dataset(dataset, directory)
    return dataset


def _rotation(seed_start, seed_end):
    return [
        (seed, DIFFICULTIES[(seed - seed_start) % 3])
        for seed in range(seed_start, seed_end)
    ]


def split_specs():
    blind = json.loads(BLIND_SEEDS.read_text(encoding="utf-8"))
    return {
        "development": _rotation(1000, 1100),
        "validation": _rotation(2000, 2100),
        "blind": [
            (seed, difficulty)
            for difficulty in DIFFICULTIES
            for seed in blind[difficulty]
        ],
    }


def _binary(rows):
    single = [row for row in rows if len(row.causes) == 1 and row.ranked]
    return [row.confidence for row in single], [int(row.correct) for row in single]


def _by_cause(rows):
    grouped = defaultdict(list)
    totals = defaultdict(list)
    for row in rows:
        if len(row.causes) == 1:
            cause = next(iter(row.causes))
            grouped[row.difficulty, cause].append(row)
            totals[cause].append(row)
    tables = [
        {"difficulty": difficulty, "cause": cause, **summarize(group)}
        for (difficulty, cause), group in sorted(grouped.items())
    ]
    supported = [
        (summarize(group)["top1"], cause)
        for cause, group in totals.items()
        if len(group) >= 20
    ]
    return tables, min(supported)[1] if supported else None


def _git_sha():
    try:
        return check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, stderr=DEVNULL, text=True
        ).strip()
    except (OSError, CalledProcessError):
        return "unavailable"


def _write_json(path, document):
    path.write_text(
        json.dumps(document, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def run(*, cache=CACHE, results=RESULTS, limit=None, feedback=True):
    started = perf_counter()
    specs = split_specs()
    config = {"threshold": 0, "margin": 0}
    splits = {}
    manifest_hashes = defaultdict(list)
    validation = []
    for split in ("development", "validation"):
        subset = specs[split][:limit] if limit else specs[split]
        rows = []
        for seed, difficulty in subset:
            dataset = _dataset(split, seed, difficulty, cache)
            manifest_hashes[split].append(dataset.manifest["dataset_hash"])
            rows.extend(samples(dataset, analyze_bundle(dataset, **config))[0])
        split_causes, _ = _by_cause(rows)
        splits[split] = {
            **summarize(rows),
            "by_cause": split_causes,
            "hard_coverage_curve": coverage_curve(
                [row for row in rows if row.difficulty == "hard"]
            ),
        }
        if split == "validation":
            validation = rows

    x, y = _binary(validation)
    versions = package_versions()
    calibrator = fit(
        x,
        y,
        {
            "git_sha": _git_sha(),
            "package_versions": versions,
            "split_seed_range": [2000, 2099],
        },
    )
    raw, production = [], []
    detection = [0, 0, 0]
    standard = {}
    baseline_rows = defaultdict(list)
    ablation_rows = defaultdict(list)
    options = {
        "uniform_chance": {"uniform_chance": True},
        "greedy_assignment": {"greedy": True},
        "no_doc_number": {"use_docs": False},
    }
    subset = specs["blind"]
    if limit:
        subset = [
            row
            for difficulty in DIFFICULTIES
            for row in [pair for pair in specs["blind"] if pair[1] == difficulty][
                :limit
            ]
        ]
    for seed, difficulty in subset:
        dataset = _dataset("blind", seed, difficulty, cache)
        manifest_hashes["blind"].append(dataset.manifest["dataset_hash"])
        before, _ = samples(dataset, analyze_bundle(dataset, **config))
        after, counts = samples(dataset, analyze_bundle(dataset, calibrator=calibrator))
        raw.extend(before)
        production.extend(after)
        for index, count in enumerate(counts):
            detection[index] += count
        for name in ("prior_only", "flag_only", "naive"):
            baseline_rows[name].extend(forecast(dataset, before, name))
        for name, params in options.items():
            ablation_rows[name].extend(
                samples(
                    dataset, analyze_bundle(dataset, calibrator=calibrator, **params)
                )[0]
            )
        ablation_rows["no_calibration"].extend(
            samples(dataset, analyze_bundle(dataset))[0]
        )
        ablation_rows["no_abstention"].extend(
            replace(row, answered=bool(row.ranked)) for row in after
        )
    for difficulty in DIFFICULTIES:
        standard[difficulty] = summarize(
            [row for row in production if row.difficulty == difficulty]
        )
    raw_x, raw_y = _binary(raw)
    blind_reliability = reliability(calibrator.predict(raw_x), raw_y)
    validation_reliability = calibrator.metadata["cross_fit"] or reliability([], [])
    summary = summarize(production, detection)
    stats, weakest = _by_cause(production)
    curve = coverage_curve(production)
    hard_curve = coverage_curve([row for row in production if row.difficulty == "hard"])
    threshold_points = {}
    for difficulty in DIFFICULTIES:
        rows = [row for row in production if row.difficulty == difficulty and len(row.causes) == 1]
        threshold_points[difficulty] = []
        for threshold in (0.5, 0.65, 0.778, 0.9):
            selected = [row for row in rows if row.confidence >= threshold]
            threshold_points[difficulty].append({
                "threshold": threshold,
                "coverage": len(selected) / len(rows) if rows else None,
                "accuracy": sum(row.correct for row in selected) / len(selected) if selected else None,
                "support": len(selected),
            })
    hotspots = hotspot_checks()
    easy_delta = (
        standard["easy"]["top1"]
        - summarize(
            [row for row in baseline_rows["prior_only"] if row.difficulty == "easy"]
        )["top1"]
    )
    hard_delta = (
        hard_curve[9]["accuracy"] - hard_curve[-1]["accuracy"] if hard_curve else 0
    )

    def variants(collection):
        variants = {}
        for name, rows in collection.items():
            report = summarize(rows)
            variants[name] = {
                **report,
                "delta_top1": round(report["top1"] - summary["top1"], 8),
                "delta_coverage": round(report["coverage"] - summary["coverage"], 8),
            }
        return variants

    metrics = {
        "synthetic": True,
        "summary": summary,
        "splits": splits,
        "by_difficulty": standard,
        "reliability": {
            "blind": blind_reliability,
            "validation": validation_reliability,
            "raw_blind": reliability(raw_x, raw_y),
            "threshold": calibrator.threshold,
            "threshold_rule": calibrator.metadata["threshold_rule"],
            "method": calibrator.method,
            "validation_samples": len(y),
        },
        "coverage_curve": curve,
        "hard_coverage_curve": hard_curve,
        "coverage_at_threshold_by_difficulty": threshold_points,
        "by_cause": stats,
        "weakest_cause": weakest,
        "hotspots": hotspots,
        "baselines": {
            **variants(baseline_rows),
            "raw_csv_llm": {
                "status": "Optional, run separately with python -m eval.raw_csv_llm"
            },
        },
        "ablations": variants(ablation_rows),
        "gates": {
            "easy improvement over prior only": {
                "actual": round(easy_delta, 8),
                "target": 0.10,
                "pass": easy_delta >= 0.10,
            },
            "hard improvement at half coverage": {
                "actual": round(hard_delta, 8),
                "target": 0.10,
                "pass": hard_delta >= 0.10,
            },
            "validation ECE": {
                "actual": validation_reliability["ece"],
                "target": 0.05,
                "pass": validation_reliability["ece"] is not None
                and validation_reliability["ece"] <= 0.05,
            },
            "blind ECE": {
                "actual": blind_reliability["ece"],
                "target": 0.08,
                "pass": blind_reliability["ece"] is not None
                and blind_reliability["ece"] <= 0.08,
            },
            "null hotspot discovery": {
                "actual": hotspots["null_false_discoveries"],
                "target": 0,
                "pass": hotspots["null_false_discoveries"] == 0,
            },
            "planted hotspot recovery": {
                "actual": hotspots["planted_recovery"],
                "target": 1,
                "pass": hotspots["planted_recovery"] == 1,
            },
        },
    }
    if feedback:
        from eval.feedback_sim import simulate

        metrics["feedback"] = simulate(cache=cache)
    run_id = ("preview-" if limit else "synthetic-") + sha256(
        json.dumps(metrics, sort_keys=True).encode()
    ).hexdigest()[:12]
    directory = results / run_id
    directory.mkdir(parents=True, exist_ok=True)
    _write_json(directory / "metrics.json", metrics)
    _write_json(
        directory / "results.json",
        {
            "run_id": run_id,
            "git_sha": _git_sha(),
            "package_versions": versions,
            "split_dataset_counts": {
                **{
                    split: len(items[:limit] if limit else items)
                    for split, items in specs.items()
                    if split != "blind"
                },
                "blind": len(subset),
            },
            "split_data_sha256": {
                split: sha256("\n".join(hashes).encode()).hexdigest()
                for split, hashes in manifest_hashes.items()
            },
            "metrics": metrics,
        },
    )
    calibrator.save(directory / "calibrator.json")
    write(directory, metrics)
    if feedback:
        from eval.feedback_sim import write_artifacts

        write_artifacts(directory, metrics["feedback"])
    pointer = "preview-latest" if limit else "latest"
    link = results / f".{pointer}-{os.getpid()}"
    link.symlink_to(run_id, target_is_directory=True)
    link.replace(results / pointer)
    print(
        f"Generated {directory.relative_to(ROOT) if directory.is_relative_to(ROOT) else directory} in {perf_counter() - started:.2f} s"
    )
    return metrics


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument("--results", type=Path, default=RESULTS)
    parser.add_argument(
        "--limit",
        type=int,
        help="Preview subset size per training split and per blind difficulty",
    )
    parser.add_argument("--skip-feedback", action="store_true")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit nonzero when a benchmark gate is missed",
    )
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    metrics = run(
        cache=args.cache,
        results=args.results,
        limit=args.limit,
        feedback=not args.skip_feedback,
    )
    for label, gate in metrics["gates"].items():
        print(f"{'PASS' if gate['pass'] else 'MISS'} {label}")
    if args.strict and any(not gate["pass"] for gate in metrics["gates"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
