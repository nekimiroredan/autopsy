from pathlib import Path
from urllib.error import URLError

from app.Home import app
from ingest import mapping_cache

DEMO = Path(__file__).resolve().parents[1] / "demo/messy_movements.csv"
MODEL_MAPPING = {
    "txn_id": "Doc Ref", "ts": "Posting Date", "item": "Material", "location": "Bin",
    "qty_delta": "Quantity", "event_type": "Mvt Type", "doc_no": None,
    "worker": "Operator", "shift": "Shift Code",
}


def inspect(client):
    with DEMO.open("rb") as upload:
        response = client.post("/api/inspect", data={"movements": upload})
    assert response.status_code == 200
    return response.json["movement"]


def test_demo_upload_reuses_successful_response_with_api_disabled(tmp_path, monkeypatch):
    monkeypatch.setitem(app.config, "AUTOPSY_MAPPING_CACHE", tmp_path / "mapping_cache.json")
    monkeypatch.setenv("OPENAI_API_KEY", "stub-key")
    monkeypatch.setenv("AUTOPSY_LLM_MAPPING", "1")
    calls = []

    def provider(headers, rows, kind, key):
        calls.append((headers, rows, kind))
        return MODEL_MAPPING

    monkeypatch.setattr(mapping_cache, "request_mapping", provider)
    client = app.test_client()
    online = inspect(client)
    assert online["mapping_source"] == "llm"
    assert len(calls) == 1
    assert len(calls[0][1]) == 5
    monkeypatch.setenv("AUTOPSY_LLM_MAPPING", "0")
    monkeypatch.delenv("OPENAI_API_KEY")
    offline = inspect(client)
    assert offline["mapping_source"] == "cache"
    assert offline["mapping_hash"] == online["mapping_hash"]
    assert offline["fields"] == online["fields"]
    assert len(calls) == 1


def test_api_failure_uses_deterministic_mapping_on_cache_miss(tmp_path, monkeypatch):
    monkeypatch.setitem(app.config, "AUTOPSY_MAPPING_CACHE", tmp_path / "mapping_cache.json")
    monkeypatch.setenv("AUTOPSY_LLM_MAPPING", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "stub-key")

    def provider(*args):
        raise URLError("unavailable")

    monkeypatch.setattr(mapping_cache, "request_mapping", provider)
    result = inspect(app.test_client())
    assert result["mapping_source"] == "deterministic"
    assert result["fields"]["item"]["column"] == "Material"
    assert not (tmp_path / "mapping_cache.json").exists()
