"""Locale negotiation and shared presentation catalogs."""
import json
from functools import lru_cache
from pathlib import Path

LANGUAGES = {
    "en": "English",
    "uz": "O‘zbekcha",
    "uz-Cyrl": "Ўзбекча (кирилл)",
    "ru": "Русский",
    "tr": "Türkçe",
    "kk": "Қазақша",
    "zh": "简体中文",
    "es": "Español",
    "ar": "العربية",
}

RTL_LANGUAGES = {"ar"}
_LOOKUP = {code.lower(): code for code in LANGUAGES}


def match_locale(tag):
    """Resolve a BCP-47 tag, including script variants such as ``uz-Cyrl``."""
    if not tag:
        return None
    normalized = tag.strip().replace("_", "-")
    parts = normalized.split("-")
    candidates = [normalized]
    if len(parts) > 1:
        candidates.append("-".join(parts[:2]))
    candidates.append(parts[0])
    for candidate in candidates:
        if locale := _LOOKUP.get(candidate.lower()):
            return locale
    return None


def resolve_locale(request):
    for tag in (request.args.get("lang"), request.cookies.get("autopsy-lang"),
                *(tag for tag, quality in request.accept_languages if quality > 0)):
        if locale := match_locale(tag):
            return locale
    return "en"


def is_rtl(locale):
    return match_locale(locale) in RTL_LANGUAGES


@lru_cache(maxsize=len(LANGUAGES))
def strings(locale):
    locale = match_locale(locale) or "en"
    path = Path(__file__).with_name("static") / f"locale-{locale}.json"
    return json.loads(path.read_text(encoding="utf-8"))["strings"]
