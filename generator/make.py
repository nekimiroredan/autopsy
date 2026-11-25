"""Create or read a deterministic local inventory benchmark bundle."""

import json
from argparse import ArgumentParser
from collections import Counter
from csv import DictReader, DictWriter
from hashlib import sha256
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from generator.sim import Dataset, generate
from schemas.models import Count, GroundTruthRecord, ItemMaster, Movement


def package_versions():
    packages = (
        "pydantic",
        "numpy",
        "scipy",
        "scikit-learn",
        "pulp",
        "pandas",
        "openpyxl",
        "pillow",
        "rapidfuzz",
    )
    found = {}
    for package in packages:
        try:
            found[package] = version(package)
        except PackageNotFoundError:
            found[package] = "unavailable"
    return found


def _csv(path, rows, model):
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = DictWriter(stream, list(model.model_fields), lineterminator="\n")
        writer.writeheader()
        writer.writerows(row.model_dump(mode="json") for row in rows)


def write_dataset(dataset, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    files = {
        "movements.csv": (dataset.movements, Movement),
        "counts.csv": (dataset.counts, Count),
        "items.csv": (dataset.master, ItemMaster),
    }
    for name, (rows, model) in files.items():
        _csv(directory / name, rows, model)
    truth_path = directory / "ground_truth.jsonl"
    truth_path.write_text(
        "".join(
            record.model_dump_json(by_alias=True) + "\n" for record in dataset.truth
        ),
        encoding="utf-8",
    )
    hashes = {
        name: sha256((directory / name).read_bytes()).hexdigest()
        for name in (*files, truth_path.name)
    }
    manifest = {
        **dataset.manifest,
        "package_versions": package_versions(),
        "hashes": hashes,
        "dataset_hash": sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest(),
        "errors_by_cause": dict(Counter(row.cause for row in dataset.truth)),
    }
    (directory / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return manifest


def read_dataset(directory, *, load_truth=True, verify_hashes=False):
    directory = Path(directory)

    def rows(name, model):
        with (directory / name).open(newline="", encoding="utf-8-sig") as stream:
            return [
                model.model_validate(
                    {key: value for key, value in row.items() if value}, strict=False
                )
                for row in DictReader(stream)
            ]

    manifest_path = directory / "manifest.json"
    truth_path = directory / "ground_truth.jsonl"
    items_path = directory / "items.csv"
    manifest = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.exists()
        else {}
    )
    if verify_hashes:
        names = ("movements.csv", "counts.csv", "items.csv", "ground_truth.jsonl")
        hashes = {
            name: sha256((directory / name).read_bytes()).hexdigest() for name in names
        }
        if hashes != manifest.get("hashes"):
            raise ValueError(f"Dataset does not match recorded checksums: {directory}")
    return Dataset(
        rows("movements.csv", Movement),
        rows("counts.csv", Count),
        rows(items_path.name, ItemMaster) if items_path.exists() else [],
        [
            GroundTruthRecord.model_validate_json(line)
            for line in truth_path.read_text(encoding="utf-8").splitlines()
        ]
        if load_truth and truth_path.exists()
        else [],
        manifest,
    )


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=2025)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--errors", type=int, default=24)
    parser.add_argument(
        "--difficulty", choices=("easy", "medium", "hard"), default="medium"
    )
    parser.add_argument(
        "--retail", type=Path, help="Optional prepared UCI StockCode,Quantity CSV"
    )
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(
        json.dumps(
            write_dataset(
                generate(
                    args.seed,
                    args.days,
                    args.errors,
                    args.difficulty,
                    retail=args.retail,
                ),
                args.out,
            ),
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
