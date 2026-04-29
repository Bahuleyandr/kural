"""Append-only consent audit trail for voice-clone uploads.

Each accepted /api/voices/clone request appends one JSON line containing
the voice ID, a SHA-256 of the sample, the requesting client host, and the
exact consent statement that was in effect at the time. The file is local
to the deployment; nothing is sent off-machine.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import settings

CONSENT_TEXT_VERSION = "v1"
CONSENT_TEXT = (
    "I confirm I have the right to clone this voice and that the speaker has "
    "given explicit, revocable consent to its synthesis."
)

_log = logging.getLogger(__name__)
_lock = threading.Lock()


def _resolve_path() -> Path:
    return Path(os.path.expanduser(settings.consent_log_path)).resolve()


def record_consent(
    *,
    voice_id: str,
    voice_name: str,
    sample_bytes: bytes,
    client_host: str | None,
    language: str | None,
) -> None:
    """Append a consent record. Best-effort — never raises into the caller."""
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "voice_id": voice_id,
        "voice_name": voice_name,
        "language": language,
        "client_host": client_host,
        "sample_sha256": hashlib.sha256(sample_bytes).hexdigest(),
        "sample_bytes": len(sample_bytes),
        "consent_text_version": CONSENT_TEXT_VERSION,
        "consent_text": CONSENT_TEXT,
    }
    line = json.dumps(record, separators=(",", ":")) + "\n"
    path = _resolve_path()
    try:
        with _lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as fh:
                fh.write(line)
    except OSError as exc:
        _log.warning("Failed to append consent record for %s: %s", voice_id, exc)
