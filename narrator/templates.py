"""Deterministic presentation of structured evidence."""
from decimal import Decimal

from app.i18n import strings
from schemas.models import EvidenceObject

try:  # Babel is optional; the fallback keeps the narrator runnable everywhere.
    from babel.numbers import format_decimal as _format_decimal
except ImportError:  # pragma: no cover - exercised only in minimal installs
    _format_decimal = None


CAUSE_LABELS = {
    key.removeprefix("cause."): value
    for key, value in strings("en").items()
    if key.startswith("cause.")
}

_NUMBER_FALLBACK = {
    "en": (",", "."), "zh": (",", "."), "ar": (",", "."),
    "uz": ("\u00a0", ","), "uz-Cyrl": ("\u00a0", ","), "ru": ("\u00a0", ","),
    "kk": ("\u00a0", ","), "tr": (".", ","), "es": (".", ","),
}


def quantity(value, locale, signed=False):
    """Format a number for presentation without changing its value."""
    amount = Decimal(str(value))
    if _format_decimal is not None:
        try:
            text = _format_decimal(amount, locale=locale.replace("-", "_"), decimal_quantization=False)
        except Exception:  # noqa: BLE001 - unknown locale data falls back below
            text = None
    else:
        text = None
    if text is None:
        grouping, decimal = _NUMBER_FALLBACK.get(locale, (",", "."))
        text = f"{amount:,.8f}".rstrip("0").rstrip(".").replace(",", "_").replace(".", decimal).replace("_", grouping)
    if signed and amount > 0:
        text = "+" + text
    return text


def _sentence(catalog, key, case, **values):
    return catalog[key].format(item=case.item, location=case.location, **values)


def narrate(case: EvidenceObject, locale="en") -> str:
    catalog = strings(locale)
    counted = quantity(case.counted, locale)
    if not case.anchored:
        return catalog["narrative.opening"].format(counted=counted)
    summary = catalog["narrative.summary"].format(
        expected=quantity(case.expected, locale), counted=counted,
        item=case.item, location=case.location, gap=quantity(case.gap, locale, signed=True),
    )
    if case.abstain or not case.hypotheses:
        return summary + " " + catalog["narrative.abstain"]
    cause = case.hypotheses[0].cause
    return summary + " " + _sentence(catalog, f"narrative.cause.{cause}", case)


def suggested_check(case, locale, count_id=None):
    catalog = strings(locale)
    if not case.anchored:
        template = catalog["check.opening_balance"]
    elif case.abstain:
        template = catalog["check.verify_original_count"]
    else:
        template = catalog.get(f"check.{case.check_id}")
    if not template:
        return None
    txn = next((op.txn_id for op in case.hypotheses[0].repair.ops if op.txn_id), None) if case.hypotheses else None
    if "{txn}" in template and not (txn or count_id):
        return None
    return template.format(item=case.item, location=case.location, txn=txn or count_id)


def question_intent(question, locale):
    question = question.casefold().strip().rstrip("?？")
    for language in (locale, "en"):
        for intent in ("check", "summary", "cause"):
            if question == strings(language)[f"question.{intent}"].casefold().rstrip("?？"):
                return intent
    if any(phrase in question for phrase in ("what should i check", "next step", "suggested check")):
        return "check"
    if any(phrase in question for phrase in ("what happened", "what is the gap", "why abstain")):
        return "summary"
    if any(phrase in question for phrase in ("top cause", "leading hypothesis")):
        return "cause"
    return None


def answer(case: EvidenceObject, question: str, locale="en", *, check=None) -> str:
    catalog = strings(locale)
    intent = question_intent(question, locale)
    if intent == "check":
        return check or (case.suggested_check if locale == "en" else None) or catalog["answer.no_check"]
    if intent == "summary":
        return narrate(case, locale)
    if intent == "cause":
        if case.hypotheses and not case.abstain:
            return catalog[f"cause.{case.hypotheses[0].cause}"]
        return catalog["answer.no_cause"]
    return catalog["answer.unknown"]
