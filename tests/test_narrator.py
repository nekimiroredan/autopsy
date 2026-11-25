import json
from pathlib import Path

from narrator.llm import paraphrase
from narrator.templates import answer, narrate
from narrator.validator import valid
from schemas.validate import ADAPTER

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
CASES = ADAPTER.validate_json((FIXTURES / "evidence_fake.json").read_bytes())


def test_template_and_evidence_only_questions():
    assert all(narrate(case) for case in CASES)
    assert "opening balance" in narrate(CASES[1])
    assert answer(CASES[0], "What should I check?") == CASES[0].suggested_check
    assert "not in the evidence" in answer(CASES[0], "Which worker should be disciplined?")


def test_bad_output_falls_back():
    baseline = narrate(CASES[0])
    corpus = (FIXTURES / "hallucination_corpus.jsonl").read_text().splitlines()
    assert len(corpus) >= 30
    for line in corpus:
        text = json.loads(line)["text"]
        assert not valid(text, baseline)
        assert paraphrase(CASES[0], lambda _, text=text: text) == baseline
