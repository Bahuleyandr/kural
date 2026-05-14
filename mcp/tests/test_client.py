"""Unit tests for the Kural MCP HTTP client."""
from __future__ import annotations

import httpx
import pytest

from kural_mcp.client import DEFAULT_HOST, KuralBackendError, KuralClient, _explain


def test_host_defaults_and_env(monkeypatch):
    monkeypatch.delenv("KURAL_HOST", raising=False)
    assert KuralClient().host == DEFAULT_HOST

    monkeypatch.setenv("KURAL_HOST", "http://10.0.0.5:8000/")
    # Trailing slash is stripped so base_url joins don't double up.
    assert KuralClient().host == "http://10.0.0.5:8000"


def test_api_key_header_only_sent_when_set(monkeypatch):
    monkeypatch.delenv("KURAL_API_KEY", raising=False)
    assert KuralClient()._headers() == {}

    assert KuralClient(api_key="secret")._headers() == {"X-API-Key": "secret"}


def test_explain_connect_error_names_host_and_fix():
    err = _explain("http://localhost:8000", httpx.ConnectError("refused"))
    assert isinstance(err, KuralBackendError)
    # The message must be actionable for an MCP client to surface verbatim.
    assert "http://localhost:8000" in str(err)
    assert "uvicorn" in str(err)


def test_explain_http_status_error_includes_backend_code():
    request = httpx.Request("POST", "http://localhost:8000/api/synthesize")
    response = httpx.Response(
        503,
        request=request,
        json={"detail": {"code": "tts_unavailable", "message": "model missing"}},
    )
    err = _explain(
        "http://localhost:8000",
        httpx.HTTPStatusError("503", request=request, response=response),
    )
    assert "503" in str(err)
    assert "tts_unavailable" in str(err)
    assert "model missing" in str(err)


def test_transcribe_rejects_missing_file(tmp_path):
    missing = tmp_path / "nope.wav"
    with pytest.raises(KuralBackendError, match="not found"):
        KuralClient().transcribe(missing)
