"""Verify optional narration against trusted deterministic text."""


def valid(text: str, evidence_text: str) -> bool:
    """Accept only the trusted text, allowing surrounding whitespace.

    A token whitelist cannot verify relationships between familiar entities.
    Comparing the grounded rendering also preserves identifiers and localized
    quantities without language-specific tokenization.
    """
    return isinstance(text, str) and bool(text.strip()) and text.strip() == evidence_text.strip()
