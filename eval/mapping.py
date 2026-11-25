from __future__ import annotations

import argparse
import json
from pathlib import Path

from ingest.mapping import propose_mapping
from ingest.preflight import inspect_bundle, load_bundle

FIXTURES = (
    Path("fixtures/messy_1.csv"),
    Path("fixtures/messy_2.csv"),
    Path("fixtures/messy_3.xlsx"),
)
GOLDEN_DIR = Path("fixtures/golden")


def snapshot(path: Path) -> dict:
    frames = inspect_bundle(path)
    movements, counts, _, report = load_bundle(path)
    return {
        "mapping": {
            kind: propose_mapping(frame.columns, kind) for kind, frame in frames.items()
        },
        "movements": {
            row.txn_id: [row.ts.isoformat(), row.qty_delta, row.event_type]
            for row in movements
        },
        "counts": {
            row.count_id: [row.count_ts.isoformat(), row.counted_qty] for row in counts
        },
        "report": report.model_dump(mode="json"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Check automatic mapping against reviewed fixtures."
    )
    parser.add_argument("--fixtures", nargs="+", type=Path, default=FIXTURES)
    args = parser.parse_args()
    for path in args.fixtures:
        actual = snapshot(path)
        expected = json.loads(
            (GOLDEN_DIR / f"{path.stem}.json").read_text(encoding="utf-8")
        )
        if actual != expected:
            raise SystemExit(
                f"{path}: column mapping or imported data changed from golden fixture."
            )
        if any(actual["report"]["rows_dropped"].values()):
            raise SystemExit(f"{path}: import dropped source rows.")
        print(
            f"{path}: {len(actual['movements'])} movements and {len(actual['counts'])} counts matched."
        )


if __name__ == "__main__":
    main()
