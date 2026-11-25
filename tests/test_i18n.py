import csv
import io
import json
import re
from pathlib import Path
from typing import get_args

import yaml

from app.Home import app
from app.i18n import LANGUAGES, match_locale, strings
from narrator.llm import paraphrase
from narrator.templates import answer, narrate, quantity, suggested_check
from narrator.validator import valid
from schemas.models import Cause
from schemas.validate import ADAPTER

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"
FIXTURES = ROOT / "fixtures"
CASES = ADAPTER.validate_json((FIXTURES / "evidence_fake.json").read_bytes())
CORPUS = [json.loads(line)["text"] for line in (FIXTURES / "hallucination_corpus.jsonl").read_text().splitlines()]
LOCALES = list(LANGUAGES)
CSV_FIELDS = ("id", "item", "location", "expected", "counted", "gap", "value_at_risk", "cause", "abstained")


def catalog(locale):
    return strings(locale)


def placeholders(text):
    return set(re.findall(r"\{(\w+)\}", text))


def test_every_locale_has_the_same_complete_catalog():
    expected = catalog("en")
    assert set(LANGUAGES) == {"en", "uz", "uz-Cyrl", "ru", "tr", "kk", "zh", "es", "ar"}
    for locale in LOCALES:
        path = STATIC / f"locale-{locale}.json"
        assert path.exists(), locale
        strings_for_locale = catalog(locale)
        assert set(strings_for_locale) == set(expected), locale
        assert all(isinstance(value, str) and value.strip() for value in strings_for_locale.values()), locale


def test_machine_translation_and_review_flags_are_explicit():
    english = json.loads((STATIC / "locale-en.json").read_text())
    assert english["locale"] == "en"
    assert english["needs_native_review"] is False
    assert english["translation_status"] == "human"
    for locale in LOCALES[1:]:
        data = json.loads((STATIC / f"locale-{locale}.json").read_text())
        assert data["locale"] == locale
        assert data["needs_native_review"] is True, locale
        assert data["translation_status"] == "machine", locale
        assert not any("ZXQ" in value or "⟦" in value for value in data["strings"].values()), locale


def test_placeholders_match_english_for_every_key():
    expected = catalog("en")
    for locale in LOCALES[1:]:
        strings_for_locale = catalog(locale)
        for key, value in expected.items():
            assert placeholders(strings_for_locale[key]) == placeholders(value), (locale, key)


def test_checks_causes_csv_and_question_keys_are_translated_by_id():
    checks = yaml.safe_load((ROOT / "engine" / "checks.yaml").read_text())
    required = [f"check.{identifier}" for identifier in checks] + [
        "check.opening_balance", "check.verify_original_count",
    ]
    required += [f"cause.{cause}" for cause in get_args(Cause)]
    required += [f"narrative.cause.{cause}" for cause in get_args(Cause)]
    required += ["question.check", "question.summary", "question.cause"]
    required += ["answer.no_check", "answer.no_cause", "answer.unknown"]
    required += [f"csv.{field}" for field in CSV_FIELDS]
    for locale in LOCALES:
        available = catalog(locale)
        assert not [key for key in required if key not in available], locale


def test_ui_source_keys_used_by_javascript_and_template_exist_in_every_locale():
    javascript = (STATIC / "app.js").read_text()
    template = (ROOT / "app" / "templates" / "index.html").read_text()
    keys = {key for key in re.findall(r'\b(?:t|ht)\("([^"]+)"', javascript) if not key.endswith(".")}
    keys |= set(re.findall(r"t\[['\"]([^'\"]+)['\"]\]", template))
    for locale in LOCALES:
        assert keys <= set(catalog(locale)), locale


def test_narrator_renders_every_case_in_every_locale_without_raw_placeholders():
    for locale in LOCALES:
        for case in CASES:
            narrative = narrate(case, locale)
            assert narrative.strip()
            assert "{" not in narrative and "}" not in narrative
            if case.anchored:
                assert case.item in narrative
                assert case.location in narrative
            if case.check_id or not case.anchored or case.abstain:
                check = suggested_check(case, locale, count_id="C-2031")
                assert check and "{" not in check and "}" not in check
                assert answer(case, catalog(locale)["question.cause"], locale, check=check).strip()
                assert answer(case, catalog(locale)["question.check"], locale, check=check) == check


def test_numbers_and_identifiers_remain_grounded_in_every_locale():
    for locale in LOCALES:
        baseline = narrate(CASES[0], locale)
        assert valid(baseline, baseline)
        assert "SKU123" in baseline and "B-12" in baseline
        assert "140" in baseline and "40" in baseline
    assert quantity(-1234.5, "en", signed=True) == "-1,234.5"
    assert quantity(-1234.5, "uz", signed=True) == "-1\u00a0234,5"
    assert quantity(-1234.5, "ru", signed=True) == "-1\u00a0234,5"
    assert quantity(-1234.5, "tr", signed=True) == "-1.234,5"
    assert quantity(-1234.5, "es", signed=True) == "-1.234,5"
    assert quantity(-1234.5, "zh", signed=True) == "-1,234.5"
    assert quantity(-1234.5, "ar", signed=True) == "-1,234.5"


def test_hallucination_corpus_fails_closed_for_every_locale():
    for locale in LOCALES:
        baseline = narrate(CASES[0], locale)
        for text in CORPUS:
            assert not valid(text, baseline), (locale, text)
            assert paraphrase(CASES[0], lambda _, text=text: text, locale=locale) == baseline


def test_locale_negotiation_query_cookie_and_accept_language():
    assert match_locale("uz-Cyrl") == "uz-Cyrl"
    assert match_locale("uz-Cyrl-UZ") == "uz-Cyrl"
    assert match_locale("uz_UZ") == "uz"
    assert match_locale("uz_Cyrl") == "uz-Cyrl"
    assert match_locale("ar-EG") == "ar"
    assert match_locale("de-DE") is None

    client = app.test_client()
    chosen = client.get("/?lang=uz-Cyrl")
    assert chosen.headers["Content-Language"] == "uz-Cyrl"
    assert b'lang="uz-Cyrl"' in chosen.data
    assert b'dir="ltr"' in chosen.data
    assert client.get("/").headers["Content-Language"] == "uz-Cyrl"
    assert client.get("/", headers={"Accept-Language": "ru-RU,ru;q=0.9"}).headers["Content-Language"] == "uz-Cyrl"
    arabic = client.get("/?lang=ar")
    assert arabic.headers["Content-Language"] == "ar"
    assert b'lang="ar"' in arabic.data and b'dir="rtl"' in arabic.data
    assert client.get("/", headers={"Accept-Language": "ar-EG,ar;q=0.9"}).headers["Content-Language"] == "ar"
    fresh = app.test_client()
    fallback = fresh.get("/", headers={"Accept-Language": "de-DE,de;q=0.9"})
    assert fallback.headers["Content-Language"] == "en"
    assert b'lang="en"' in fallback.data


def test_language_switcher_lists_every_language():
    html = app.test_client().get("/").get_data(as_text=True)
    for locale, label in LANGUAGES.items():
        assert f'value="{locale}"' in html, locale
        assert label in html, locale


def test_localized_csv_headers_preserve_canonical_english_by_default():
    client = app.test_client()
    canonical = next(csv.reader(io.StringIO(client.get("/api/runs/demo/export").get_data(as_text=True))))
    assert canonical == list(CSV_FIELDS)
    for locale in LOCALES:
        text = client.get(f"/api/runs/demo/export?lang={locale}&headers=localized").get_data(as_text=True)
        assert next(csv.reader(io.StringIO(text))) == [catalog(locale)[f"csv.{field}"] for field in CSV_FIELDS]


def test_api_narratives_are_localized_and_source_data_stays_canonical():
    client = app.test_client()
    for locale in LOCALES:
        response = client.get(f"/api/runs/demo?lang={locale}")
        assert response.headers["Content-Language"] == locale
        run = response.get_json()
        assert run["source"] == "Synthetic demo"
        assert all(case["narrative"].strip() for case in run["cases"])
