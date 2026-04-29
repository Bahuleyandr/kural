"""Test-wide fixtures.

- Bump rate limits to effectively unbounded so the test suite can drive the
  endpoints in tight loops without colliding with the production defaults.
- Redirect the consent log to a tmp path so tests do not append to the
  developer's home directory.
- Reset the TTS engine registry so engine state from one test does not leak
  into the next.
"""
import pytest

from app.config import settings
from app.tts.registry import registry


@pytest.fixture(autouse=True)
def _disable_rate_limits(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_synthesize", "10000/minute")
    monkeypatch.setattr(settings, "rate_limit_clone", "10000/minute")


@pytest.fixture(autouse=True)
def _ephemeral_consent_log(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "consent_log_path", str(tmp_path / "consent.log"))


@pytest.fixture(autouse=True)
def _reset_engine_registry():
    registry.reset()
    yield
    registry.reset()
