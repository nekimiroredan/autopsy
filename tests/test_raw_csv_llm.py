import io
import json
import sys

import pytest

from engine.replay import Replayer
from eval import raw_csv_llm
from eval.metrics import observed_truth
from generator.make import write_dataset
from generator.sim import generate


def test_raw_csv_baseline_is_opt_in(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(sys, "argv", [
        "raw_csv_llm", "--dataset", str(tmp_path), "--model", "test-model",
    ])
    with pytest.raises(SystemExit, match="2"):
        raw_csv_llm.main()


def test_raw_csv_baseline_sends_only_verified_csv_and_scores_response(tmp_path, monkeypatch, capsys):
    dataset = generate(seed=2025, days=12, errors=5, difficulty="easy")
    manifest = write_dataset(dataset, tmp_path)
    truth = observed_truth(dataset)
    windows = [window for window in Replayer(dataset.movements, dataset.counts).windows()
               if window.anchored]
    detected = next(window for window in windows if len(truth.get(window.id, ())) == 1)
    false_positive = next(window for window in windows if window.id not in truth)
    predictions = [
        {"count_id": detected.count_id, "causes": sorted(truth[detected.id])},
        {"count_id": false_positive.count_id, "causes": []},
    ]
    sent = []

    def mock_api(request, timeout):
        sent.append(json.loads(request.data))
        assert request.get_header("Authorization") == "Bearer test-key"
        return io.StringIO(json.dumps({"choices": [{"message": {
            "content": json.dumps({"predictions": predictions}),
        }}]}))

    monkeypatch.setattr(raw_csv_llm, "urlopen", mock_api)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(sys, "argv", [
        "raw_csv_llm", "--dataset", str(tmp_path), "--model", "test-model", "--send-synthetic-csv",
    ])
    raw_csv_llm.main()
    output = json.loads(capsys.readouterr().out)
    assert output["dataset_hash"] == manifest["dataset_hash"]
    assert output["detection"] == {
        "true_positive": 1, "false_positive": 1, "false_negative": len(truth) - 1,
    }
    assert output["selective_accuracy"] == 1
    assert sent[0]["model"] == "test-model"
    csvs = json.loads(sent[0]["messages"][1]["content"])
    assert csvs == {name: (tmp_path / name).read_bytes().decode("utf-8")
                    for name in ("movements.csv", "counts.csv", "items.csv")}

    (tmp_path / "counts.csv").write_text("modified")
    with pytest.raises(ValueError, match="checksums"):
        raw_csv_llm.main()
    assert len(sent) == 1
