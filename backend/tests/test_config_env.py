"""Regression tests for environment-variable binding.

Guards the bug where ``api_key`` / ``ollama_*`` / ``lip_sync_binary`` /
``telemetry_*`` only read the bare env name, so the documented ``KURAL_``-prefixed
vars (which the desktop app, docker-compose, and the MCP client all export)
silently did nothing — leaving API-key auth disabled even when an operator set
``KURAL_API_KEY``. The previous test-suite only ever set ``settings.api_key``
directly via monkeypatch, so the env→field binding was never exercised.
"""
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, settings
from app.main import _enforce_network_auth, app

_MANAGED_ENV = (
    "KURAL_API_KEY",
    "API_KEY",
    "KURAL_OLLAMA_URL",
    "OLLAMA_URL",
    "KURAL_OLLAMA_MODEL",
    "OLLAMA_MODEL",
    "KURAL_LIP_SYNC_BINARY",
    "LIP_SYNC_BINARY",
    "KURAL_TELEMETRY_OPT_IN",
    "TELEMETRY_OPT_IN",
    "KURAL_TELEMETRY_ENDPOINT",
    "TELEMETRY_ENDPOINT",
)


def _settings(monkeypatch, **env: str) -> Settings:
    for key in _MANAGED_ENV:
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    # _env_file=None isolates the test from any stray .env in the cwd.
    return Settings(_env_file=None)


def test_kural_api_key_env_binds(monkeypatch):
    assert _settings(monkeypatch, KURAL_API_KEY="s3cret").api_key == "s3cret"


def test_legacy_api_key_env_still_binds(monkeypatch):
    assert _settings(monkeypatch, API_KEY="legacy").api_key == "legacy"


def test_api_key_defaults_empty(monkeypatch):
    assert _settings(monkeypatch).api_key == ""


def test_kural_ollama_and_lip_sync_env_bind(monkeypatch):
    s = _settings(
        monkeypatch,
        KURAL_OLLAMA_URL="http://127.0.0.1:9999",
        KURAL_OLLAMA_MODEL="qwen2.5:7b",
        KURAL_LIP_SYNC_BINARY="/opt/lip/bin",
    )
    assert s.ollama_url == "http://127.0.0.1:9999"
    assert s.ollama_model == "qwen2.5:7b"
    assert s.lip_sync_binary == "/opt/lip/bin"


def test_kural_telemetry_opt_in_binds(monkeypatch):
    assert _settings(monkeypatch, KURAL_TELEMETRY_OPT_IN="true").telemetry_opt_in is True


def test_kural_prefixed_security_envs_bind(monkeypatch):
    """The documented KURAL_ prefix must override security-relevant settings,
    not only the aliased auth/telemetry fields."""
    s = _settings(
        monkeypatch,
        KURAL_RATE_LIMIT_CLONE="2/minute",
        KURAL_CONSENT_LOG_PATH="/tmp/consent.log",
        KURAL_CLONE_MAX_UPLOAD_MB="7",
        KURAL_TRANSCRIBE_STREAM_MAX_CONCURRENT="2",
    )
    assert s.rate_limit_clone == "2/minute"
    assert s.consent_log_path == "/tmp/consent.log"
    assert s.clone_max_upload_mb == 7
    assert s.transcribe_stream_max_concurrent == 2


def test_loopback_bind_starts_without_key(monkeypatch):
    monkeypatch.setattr(settings, "bind_host", "127.0.0.1")
    monkeypatch.setattr(settings, "api_key", "")
    _enforce_network_auth()  # must not raise


def test_network_bind_without_key_refuses_to_start(monkeypatch):
    monkeypatch.setattr(settings, "bind_host", "0.0.0.0")
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.delenv("KURAL_ALLOW_INSECURE_NETWORK", raising=False)
    with pytest.raises(RuntimeError, match="Refusing to start"):
        _enforce_network_auth()


def test_network_bind_with_key_is_allowed(monkeypatch):
    monkeypatch.setattr(settings, "bind_host", "0.0.0.0")
    monkeypatch.setattr(settings, "api_key", "s3cret")
    _enforce_network_auth()  # must not raise


def test_network_bind_insecure_override(monkeypatch):
    monkeypatch.setattr(settings, "bind_host", "0.0.0.0")
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.setenv("KURAL_ALLOW_INSECURE_NETWORK", "1")
    _enforce_network_auth()  # explicit opt-in must not raise


def test_protected_route_requires_key_when_configured(monkeypatch):
    """End-to-end: a configured key actually gates a protected /api/* route."""
    monkeypatch.setattr(settings, "api_key", "s3cret")
    client = TestClient(app)

    assert client.get("/api/runtime/health-checks").status_code == 401
    assert (
        client.get("/api/runtime/health-checks", headers={"X-API-Key": "s3cret"}).status_code
        == 200
    )
