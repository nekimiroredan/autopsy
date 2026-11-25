"""Optional model-assisted column mapping with a local response cache."""

import hashlib
import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from urllib.error import URLError
from urllib.request import Request, urlopen

from ingest.mapping import FIELDS, REQUIRED, propose_mapping

CACHE = Path(__file__).resolve().parents[1] / "demo" / "mapping_cache.json"
CACHE_WRITE_LOCK = Lock()


def fingerprint(frame):
    headers = [str(column) for column in frame.columns]
    rows = [[str(cell) for cell in row] for row in frame.head(5).itertuples(index=False, name=None)]
    payload = json.dumps([headers, rows], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def read_cache(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_cache(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".mapping-cache-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, indent=2, sort_keys=True)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def validate(response, headers, kind):
    if not isinstance(response, dict) or set(response) - set(FIELDS[kind]):
        raise ValueError("Unexpected fields in model mapping")
    columns = [column for column in response.values() if column is not None]
    if any(not isinstance(column, str) or column not in headers for column in columns):
        raise ValueError("Unknown column in model mapping")
    if len(columns) != len(set(columns)) or any(not response.get(field) for field in REQUIRED[kind]):
        raise ValueError("Incomplete or conflicting model mapping")
    if kind == "movement" and not any(response.get(key) for key in ("qty_delta", "qty_in", "qty_out")):
        raise ValueError("Missing movement quantity")
    return response


def request_mapping(headers, rows, kind, key):
    # Send column names and cell shapes only. Source values stay on disk.
    prompt = {
        "role": kind,
        "source_headers": headers,
        "sample_cell_types": rows,
        "allowed_keys": FIELDS[kind],
        "required_keys": REQUIRED[kind],
    }
    body = {
        "model": os.getenv("AUTOPSY_MAPPING_MODEL", "gpt-4o-mini"),
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "Map warehouse columns. Output a JSON object from canonical field names to exact source headers or null. Leave unrelated fields null. For movement quantities choose qty_delta or qty_in/qty_out."},
            {"role": "user", "content": json.dumps(prompt)},
        ],
    }
    request = Request("https://api.openai.com/v1/chat/completions", data=json.dumps(body).encode(),
                      headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urlopen(request, timeout=8) as response:
        document = json.load(response)
    return json.loads(document["choices"][0]["message"]["content"])


def cell_shape(cell):
    value = str(cell).strip()
    if not value:
        return "blank"
    try:
        float(value)
    except ValueError:
        return "text"
    return "number"


def suggest(frame, kind, *, cache_path=None):
    path = Path(cache_path) if cache_path is not None else CACHE
    headers = [str(column) for column in frame.columns]
    digest = fingerprint(frame)
    group = read_cache(path).get(digest, {})
    cached = group.get(kind) if isinstance(group, dict) else None

    def result(mapping, source):
        return ({field: {"column": mapping.get(field), "confidence": 0.89 if mapping.get(field) else 0.0}
                 for field in FIELDS[kind]}, source, digest)

    if cached is not None:
        try:
            return result(validate(cached, headers, kind), "cache")
        except ValueError:
            pass
    key = os.getenv("OPENAI_API_KEY")
    if key and os.getenv("AUTOPSY_LLM_MAPPING", "1") != "0":
        try:
            rows = [[cell_shape(cell) for cell in row]
                    for row in frame.head(5).itertuples(index=False, name=None)]
            mapping = validate(request_mapping(headers, rows, kind, key), headers, kind)
        except (URLError, OSError, ValueError, TypeError, KeyError, IndexError):
            pass
        else:
            try:
                with CACHE_WRITE_LOCK:
                    cache = read_cache(path)
                    entries = cache.get(digest)
                    cache[digest] = {**(entries if isinstance(entries, dict) else {}), kind: mapping}
                    write_cache(path, cache)
            except OSError:
                # A read-only workspace can still use the validated suggestion.
                pass
            return result(mapping, "llm")
    return propose_mapping(headers, kind), "deterministic", digest
