"""Prepare an optional anonymous order-size profile from UCI Online Retail II."""

from argparse import ArgumentParser
from csv import writer
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZipFile

from openpyxl import load_workbook

URL = "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip"
MAX_BYTES = 100 * 1024 * 1024


def prepare(workbook_path, destination):
    workbook = load_workbook(workbook_path, read_only=True, data_only=True)
    identifiers = {}
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with destination.open("w", newline="", encoding="utf-8") as stream:
            csv = writer(stream)
            csv.writerow(("StockCode", "Quantity"))
            for sheet in workbook.worksheets:
                rows = iter(sheet.values)
                header = [str(name).casefold() for name in next(rows)]
                item_column, qty_column = (
                    header.index("stockcode"),
                    header.index("quantity"),
                )
                for row in rows:
                    sku, qty = row[item_column], row[qty_column]
                    if sku is None or not isinstance(qty, (int, float)) or qty <= 0:
                        continue
                    anonymized = identifiers.setdefault(sku, len(identifiers) + 1)
                    csv.writerow((anonymized, int(qty)))
    finally:
        workbook.close()


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--sha256", help="Trusted SHA-256 of the official downloaded ZIP"
    )
    source.add_argument("--workbook", type=Path, help="Use a locally obtained workbook")
    args = parser.parse_args()
    if args.workbook:
        prepare(args.workbook, args.out)
    else:
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with urlopen(URL, timeout=45) as response:
                payload = response.read(MAX_BYTES + 1)
            if (
                len(payload) > MAX_BYTES
                or sha256(payload).hexdigest() != args.sha256.lower()
            ):
                raise SystemExit(
                    "Archive exceeds size limit or checksum does not match"
                )
            archive = directory / "retail.zip"
            archive.write_bytes(payload)
            workbook = directory / "source.xlsx"
            with ZipFile(archive) as zipped:
                name = next(
                    name for name in zipped.namelist() if name.lower().endswith(".xlsx")
                )
                workbook.write_bytes(zipped.read(name))
            prepare(workbook, args.out)
    print(f"Saved order profile to {args.out}")


if __name__ == "__main__":
    main()
