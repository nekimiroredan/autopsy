import json

import pytest

from engine.feedback import label_counts, submit_feedback
from engine.reset_demo import reset


def test_reset_backs_up_log_and_clears_prior_updates(tmp_path):
    log = tmp_path / "data/feedback.jsonl"
    demo_log = tmp_path / "data/feedback_demo.jsonl"
    record = submit_feedback("D-1", "qty_typo", True, path=log)
    demo_record = submit_feedback("D-2", "double_scan", True, path=demo_log)
    assert label_counts(log)["global"]["qty_typo"] == 1
    assert reset(tmp_path) == 2
    backup = tmp_path / "demo/feedback_backup.json"
    assert json.loads(backup.read_text()) == {"resets": [{
        "data/feedback.jsonl": [record],
        "data/feedback_demo.jsonl": [demo_record],
    }]}
    assert not label_counts(log)
    assert not label_counts(demo_log)
    original = backup.read_bytes()
    assert reset(tmp_path) == 0
    assert backup.read_bytes() == original


@pytest.mark.parametrize("relative", ["data/feedback.jsonl", "demo/feedback_backup.json"])
def test_reset_refuses_links_into_blind(tmp_path, relative):
    protected = tmp_path / "data/blind/keep.txt"
    protected.parent.mkdir(parents=True)
    protected.write_text("keep")
    link = tmp_path / relative
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(protected)
    with pytest.raises(ValueError, match="Refusing unsafe feedback path"):
        reset(tmp_path)
    assert protected.read_text() == "keep"
    assert link.is_symlink()
