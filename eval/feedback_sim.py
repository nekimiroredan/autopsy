"""Measure five rounds of noisy validation feedback on a fixed development holdout."""

import json
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path
from random import Random

from eval.metrics import observed_truth, samples, summarize
from eval.report import chart
from eval.run_all import CACHE, RESULTS, _dataset, analyze_bundle
from generator.injectors.base import CAUSES


def simulate(*, cache=CACHE):
    training = [
        _dataset(
            "validation", seed, ("easy", "medium", "hard")[(seed - 2000) % 3], cache
        )
        for seed in range(2000, 2015)
    ]
    holdout = [
        _dataset(
            "development", seed, ("easy", "medium", "hard")[(seed - 1000) % 3], cache
        )
        for seed in range(1000, 1006)
    ]
    labels = [
        next(iter(causes))
        for dataset in training
        for _, causes in sorted(observed_truth(dataset).items())
        if len(causes) == 1
    ]
    series = []
    for seed in (1, 2, 3, 4, 5):
        random = Random(seed)
        pool = list(labels)
        random.shuffle(pool)
        chosen = Counter()
        rounds = []
        for step in range(5):
            for true in pool[step * 20 : (step + 1) * 20]:
                wrong = [cause for cause in CAUSES if cause != true]
                chosen[true if random.random() < 0.8 else random.choice(wrong)] += 1
            rows = []
            for dataset in holdout:
                evidence = analyze_bundle(
                    dataset, priors={"global": chosen}, threshold=0, margin=0
                )
                rows.extend(samples(dataset, evidence)[0])
            rounds.append(
                {
                    "round": step + 1,
                    "labels": sum(chosen.values()),
                    "accuracy": summarize(rows)["top1"],
                }
            )
        series.append({"simulation": seed, "rounds": rounds})
    improved = sum(
        row["rounds"][-1]["accuracy"] > row["rounds"][0]["accuracy"] for row in series
    )
    return {
        "simulations": series,
        "improved": improved,
        "target": 3,
        "pass": improved >= 3,
        "label_reliability": 0.8,
        "interpretation": "Five independent noise schedules. Capped prior updates and noisy labels can limit gains on the fixed holdout.",
    }


def write_artifacts(directory, result):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Feedback simulation",
        "",
        result["interpretation"],
        "",
        "| Simulation | Round 1 | Round 2 | Round 3 | Round 4 | Round 5 |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    series = result["simulations"]
    for row in series:
        values = " | ".join(f"{entry['accuracy']:.1%}" for entry in row["rounds"])
        lines.append(f"| {row['simulation']} | {values} |")
    lines.extend(
        [
            "",
            f"Improved in {result['improved']} of {len(series)} simulations (target {result['target']}).",
        ]
    )
    (directory / "feedback.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (directory / "feedback.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    means = [
        (step + 1, sum(row["rounds"][step]["accuracy"] for row in series) / len(series))
        for step in range(5)
    ]
    chart(
        directory / "feedback.png",
        "Mean accuracy after noisy feedback",
        "Progress through five rounds",
        "Accuracy",
        [(step / 5, accuracy) for step, accuracy in means],
    )


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=RESULTS / "feedback")
    parser.add_argument("--cache", type=Path, default=CACHE)
    args = parser.parse_args()
    result = simulate(cache=args.cache)
    write_artifacts(args.out, result)
    print(
        f"Improved in {result['improved']} of {len(result['simulations'])} simulations"
    )


if __name__ == "__main__":
    main()
