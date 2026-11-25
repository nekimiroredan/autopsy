"""Optional provider adapter. The default path is the deterministic template."""
import logging

from narrator.templates import narrate
from narrator.validator import valid

LOGGER = logging.getLogger(__name__)


def paraphrase(case, provider=None, *, locale="en"):
    baseline = narrate(case, locale)
    if provider is None:
        return baseline
    try:
        result = provider(baseline)
        if valid(result, baseline):
            return result
    except Exception:  # noqa: BLE001 — provider adapters may raise provider-specific errors
        LOGGER.warning("Narration provider failed. Using evidence template.")
    else:
        LOGGER.warning("Narration introduced unsupported entities. Using evidence template.")
    return baseline
