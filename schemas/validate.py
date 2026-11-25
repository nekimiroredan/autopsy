"""Validate evidence JSON or a warehouse data bundle."""
import argparse
import json
from pathlib import Path

from pydantic import TypeAdapter

from schemas.models import EvidenceObject

ADAPTER = TypeAdapter(EvidenceObject | list[EvidenceObject])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    if args.source.suffix.lower() == ".json":
        ADAPTER.validate_json(args.source.read_bytes())
        print("Evidence valid")
    else:
        from ingest.preflight import load_bundle

        path = args.source
        if path.is_dir():
            path = path / "movements.csv"
            counts = path.with_name("counts.csv")
            master = path.with_name("items.csv")
            if not master.exists():
                master = path.with_name("master.csv")
            _, _, _, report = load_bundle(path, counts, master if master.exists() else None)
        else:
            _, _, _, report = load_bundle(path)
        print(report.model_dump_json(indent=2))
        if sum(report.rows_dropped.values()):
            raise SystemExit(1)

    Path(__file__).with_name("evidence.schema.json").write_text(
        json.dumps(EvidenceObject.model_json_schema(), indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
