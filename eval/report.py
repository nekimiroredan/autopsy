"""Regenerate published benchmark charts and text from numeric results."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ORANGE = "#FF4B00"
WHITE = "#EBEBEB"
GRAPHITE = "#121212"
GRID = "#424242"


def chart(path, title, x_label, y_label, points, *, diagonal=False):
    image = Image.new("RGB", (960, 550), GRAPHITE)
    draw = ImageDraw.Draw(image)
    heading = ImageFont.load_default(size=26)
    small = ImageFont.load_default(size=16)
    left, right, top, bottom = 100, 907, 95, 453

    def project(x, y):
        return left + (right - left) * x, bottom - (bottom - top) * y

    draw.text((left, 29), title, fill=WHITE, font=heading)
    for percent in range(0, 101, 20):
        x, y = project(percent / 100, percent / 100)
        draw.line((left, y, right, y), fill=GRID)
        draw.line((x, top, x, bottom), fill=GRID)
        draw.text((left - 46, y - 8), f"{percent}%", fill=WHITE, font=small)
        draw.text((x - 15, bottom + 15), f"{percent}%", fill=WHITE, font=small)
    draw.text((left, top - 27), y_label, fill=WHITE, font=small)
    draw.text((right, bottom + 46), x_label, fill=WHITE, font=small, anchor="ra")
    if diagonal:
        draw.line((*project(0, 0), *project(1, 1)), fill="#888888", width=2)
    coordinates = [project(x, y) for x, y in points if x is not None and y is not None]
    if len(coordinates) > 1:
        draw.line(coordinates, fill=ORANGE, width=3)
    for x, y in coordinates:
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=ORANGE)
    image.save(path, format="PNG")


def percentage(value):
    return f"{value:.1%}" if value is not None else "Unavailable"


def write(directory, metrics):
    directory = Path(directory)
    summary = metrics["summary"]
    calibration = metrics["reliability"]
    lines = [
        "# Autopsy evaluation",
        "",
        "All warehouse runs here use synthetic data. Hotspot checks use fixed labeled exposure controls.",
        "The numbers describe these benchmark distributions. A field pilot and timed human study require independent evidence.",
        "",
        f"- Anchored detection F1: {percentage(summary['detection_f1'])}",
        f"- Top-1 accuracy: {percentage(summary['top1'])}",
        f"- Top-3 accuracy: {percentage(summary['top3'])}",
        f"- Aggregate coverage: {percentage(summary['coverage'])}",
        f"- Selective accuracy: {percentage(summary['selective_accuracy'])}",
        f"- Multi-cause recall: {percentage(summary['cause_set_recall'])}",
        f"- Value-weighted recall: {percentage(summary['value_weighted_recall'])}",
        f"- ECE: {percentage(calibration['blind']['ece'])} blind and {percentage(calibration['validation']['ece'])} on cross-fit validation",
        f"- Brier score: {calibration['blind']['brier']:.4f}"
        if calibration["blind"]["brier"] is not None
        else "- Brier score unavailable",
        f"- Weakest supported cause: {metrics['weakest_cause'] or 'Thin support across all causes'}",
        f"- Threshold: {calibration['threshold']:.3f} ({calibration['threshold_rule']})",
        "",
        "## Per-difficulty and cause",
        "",
        "| Difficulty | Cause | Support | Top-1 | Top-3 |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for row in metrics["by_cause"]:
        lines.append(
            f"| {row['difficulty']} | {row['cause']} | {row['support']} | {percentage(row['top1'])} | {percentage(row['top3'])} |"
        )
    for name in ("baselines", "ablations"):
        lines.extend(
            [
                "",
                f"## {name.capitalize()}",
                "",
                "| Variant | Top-1 | Top-1 delta | Coverage | Selective accuracy |",
                "| --- | ---: | ---: | ---: | ---: |",
            ]
        )
        for label, row in metrics[name].items():
            lines.append(
                f"| {label} | {row.get('status') or percentage(row.get('top1'))} | "
                f"{percentage(row.get('delta_top1'))} | {percentage(row.get('coverage'))} | "
                f"{percentage(row.get('selective_accuracy'))} |"
            )
    lines.extend(
        [
            "",
            "## Gates",
            "",
            "| Gate | Result | Measured | Target |",
            "| --- | --- | ---: | ---: |",
        ]
    )
    for name, gate in metrics["gates"].items():
        display = str if name == "null hotspot discovery" else percentage
        lines.append(
            f"| {name} | {'Pass' if gate['pass'] else 'Missed'} | "
            f"{display(gate['actual'])} | {display(gate['target'])} |"
        )
    lines.extend(
        [
            "",
            "## Limitations",
            "",
            "A synthetic prior can differ from a warehouse’s actual error distribution. A retail order profile supplies only popularity and order sizes; synthesized ledger observations do not provide real incident labels.",
            "Unlogged movements and losses can be observationally indistinguishable. Offsetting errors can cancel. Time resolution and missing item master fields constrain the repair search.",
            f"Planted hotspot recovery was {percentage(metrics['hotspots']['planted_recovery'])}; null control discoveries were {metrics['hotspots']['null_false_discoveries']}.",
        ]
    )
    if "feedback" in metrics:
        feedback = metrics["feedback"]
        lines.extend(
            [
                "",
                "## Feedback simulation",
                "",
                f"Round-five accuracy improved in {feedback['improved']} of {len(feedback['simulations'])} simulations.",
                feedback["interpretation"],
            ]
        )
    (directory / "RESULTS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (directory / "slide_numbers.md").write_text(
        "\n".join(lines[:18]) + "\n", encoding="utf-8"
    )
    chart(
        directory / "reliability.png",
        "Blind reliability",
        "Mean confidence",
        "Observed accuracy",
        [(x["confidence"], x["accuracy"]) for x in calibration["blind"]["bins"]],
        diagonal=True,
    )
    chart(
        directory / "coverage_accuracy.png",
        "Coverage and selective accuracy",
        "Coverage",
        "Accuracy",
        [(x["coverage"], x["accuracy"]) for x in metrics["coverage_curve"]],
    )
