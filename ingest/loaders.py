from __future__ import annotations

import csv
from io import BytesIO, StringIO
from pathlib import Path
from typing import BinaryIO
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

import pandas as pd
from openpyxl.utils.exceptions import InvalidFileException

Source = str | Path | bytes | BinaryIO


def read_source(source: Source, filename: str | None = None) -> dict[str, pd.DataFrame]:
    """Load an export without coercing IDs, dates, or display values."""
    if isinstance(source, (str, Path)):
        path = Path(source)
        data = path.read_bytes()
        filename = filename or path.name
    elif isinstance(source, bytes):
        data = source
    else:
        source.seek(0)
        data = source.read()
        filename = filename or str(
            getattr(source, "filename", None) or getattr(source, "name", "")
        )
        source.seek(0)

    suffix = Path(filename or "").suffix.lower()
    if suffix in {".xlsx", ".xlsm"} or (not suffix and data.startswith(b"PK\x03\x04")):
        try:
            sheets = pd.read_excel(
                BytesIO(data),
                sheet_name=None,
                dtype=str,
                keep_default_na=False,
                engine="openpyxl",
            )
        except (BadZipFile, InvalidFileException, ParseError, KeyError) as exc:
            raise ValueError("The Excel workbook could not be read.") from exc
        if not sheets:
            raise ValueError("The Excel workbook has no readable sheets.")
        return sheets
    if suffix not in {"", ".csv", ".tsv", ".txt"}:
        raise ValueError("Choose a CSV, TSV, or XLSX export.")

    try:
        decoded = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = data.decode("latin-1")
    if not decoded.strip():
        raise ValueError("The export is empty.")
    try:
        delimiter = csv.Sniffer().sniff(decoded[:8192], delimiters=",;\t|").delimiter
    except csv.Error:
        delimiter = "\t" if suffix == ".tsv" else ","
    return {
        "CSV": pd.read_csv(
            StringIO(decoded), sep=delimiter, dtype=str, keep_default_na=False
        )
    }
