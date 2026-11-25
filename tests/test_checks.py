from engine.analyze import analyze
from engine.calibrate import Calibrator, fit
from engine.feedback import label_counts, submit_feedback
from tests.test_replay import END, START, count, movement


def test_cheaper_document_check_when_document_available():
    moves = [
        movement(f"T{i}", END, qty, doc=f"REF-{i}")
        for i, qty in enumerate((10, 13, 110))
    ]
    counts = [count("A", START, 100), count("B", END, 133)]
    tier0 = analyze(moves, counts, threshold=0.4)[1]
    tier1 = analyze(moves, counts, tier=1, threshold=0.4)[1]
    assert tier0.check_id == "scan_audit"
    assert tier1.check_id == "pull_receiving_doc"
    assert "T2" in tier1.suggested_check


def test_calibration_round_trip(tmp_path):
    model = fit([0.1, 0.2, 0.3, 0.6, 0.7, 0.8], [0, 0, 0, 1, 1, 1])
    artifact = tmp_path / "calibration.json"
    model.save(artifact)
    restored = Calibrator.load(artifact)
    assert restored.predict(0.8) > restored.predict(0.2)
    assert model.predict(0.8) == restored.predict(0.8)
    assert restored.metadata["fit_split"] == "validation"


def test_feedback_audit_uses_latest_known_label(tmp_path):
    audit = tmp_path / "feedback.jsonl"
    submit_feedback("D-1", "qty_typo", True, context="location:B01", path=audit)
    submit_feedback("D-2", "qty_typo", False, path=audit)
    submit_feedback("D-1", "qty_typo", False, "double_scan", "location:B01", path=audit)
    assert len(audit.read_text().splitlines()) == 3
    assert label_counts(audit) == {
        "global": {"double_scan": 1},
        "location:B01": {"double_scan": 1},
    }


def test_calibration_bins_keep_tied_scores_together():
    from engine.calibrate import reliability

    model = reliability([0.6] * 10, [1] * 6 + [0] * 4)
    assert model["ece"] < 1e-12
    assert len(model["bins"]) == 1
