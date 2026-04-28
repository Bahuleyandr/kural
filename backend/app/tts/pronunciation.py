from __future__ import annotations

import re
from typing import Any, Iterable


def _get(rule: Any, key: str, default: Any = None) -> Any:
    if isinstance(rule, dict):
        return rule.get(key, default)
    return getattr(rule, key, default)


def apply_pronunciation_rules(
    text: str,
    rules: Iterable[Any] | None,
    language: str | None = None,
) -> str:
    if not rules:
        return text

    output = text
    sorted_rules = sorted(
        list(rules),
        key=lambda rule: int(_get(rule, "priority", 0) or 0),
        reverse=True,
    )
    for rule in sorted_rules:
        if not _get(rule, "enabled", True):
            continue

        rule_language = _get(rule, "language")
        if language and rule_language and str(rule_language).lower() != language.lower():
            continue

        pattern = str(_get(rule, "pattern", "")).strip()
        replacement = str(_get(rule, "replacement", "")).strip()
        if not pattern or not replacement:
            continue

        flags = 0 if _get(rule, "case_sensitive", False) else re.IGNORECASE
        escaped = re.escape(pattern)
        if _get(rule, "mode", "literal") == "word":
            regex = re.compile(rf"(?<!\w){escaped}(?!\w)", flags)
        else:
            regex = re.compile(escaped, flags)
        output = regex.sub(replacement, output)

    return output
