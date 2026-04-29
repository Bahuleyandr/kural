"""Vendor-neutral, opt-in error reporting.

`record_event` fires-and-forgets a small JSON POST to
`KURAL_TELEMETRY_ENDPOINT` whenever `KURAL_TELEMETRY_OPT_IN=true`. Both knobs
are off by default, so a fresh install ships zero data anywhere.

There is no SDK, no batching, no PII sniffing. The endpoint can be a
self-hosted log collector, an HTTP-bridge to Sentry/PostHog, or omitted.
Failures are swallowed — telemetry must never break the app.
"""
from __future__ import annotations

import json
import logging
import threading
import urllib.error
import urllib.request
from typing import Any, Mapping

from .config import settings

_log = logging.getLogger(__name__)


def is_enabled() -> bool:
    return bool(settings.telemetry_opt_in) and bool(settings.telemetry_endpoint.strip())


def record_event(payload: Mapping[str, Any]) -> None:
    if not is_enabled():
        return
    endpoint = settings.telemetry_endpoint.strip()
    body = json.dumps(dict(payload), separators=(",", ":")).encode("utf-8")

    def _post() -> None:
        request = urllib.request.Request(
            endpoint,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            urllib.request.urlopen(request, timeout=5).close()
        except (urllib.error.URLError, OSError) as exc:
            _log.debug("telemetry post failed: %s", exc)

    threading.Thread(target=_post, daemon=True).start()
