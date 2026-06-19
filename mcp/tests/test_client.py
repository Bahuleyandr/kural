"""Unit tests for the Kural MCP HTTP client."""
from __future__ import annotations

import httpx
import pytest

from kural_mcp.client import (
    DEFAULT_HOST,
    KuralBackendError,
    KuralClient,
    _explain,
    _validate_host,
)


def test_validate_host_rejects_bad_scheme():
    with pytest.raises(KuralBackendError, match="http"):
        _validate_host("file:///etc/passwd")


def test_validate_host_accepts_loopback_http_and_strips_slash():
    assert _validate_host("http://127.0.0.1:8000/") == "http://127.0.0.1:8000"


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


def test_list_model_packs_uses_model_pack_endpoint(monkeypatch):
    captured: dict[str, str] = {}

    class _Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"packs": [{"id": "kokoro-v1-onnx"}], "jobs": [], "total": 1}

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, path):
            captured["path"] = path
            return _Response()

    monkeypatch.setattr(KuralClient, "_client", lambda _self: _Client())

    assert KuralClient().list_model_packs()["total"] == 1
    assert captured["path"] == "/api/model-packs"
