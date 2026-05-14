"""HTTP client for the Kural backend API.

Mirrors the architecture of the Kural CLI: the MCP server is a thin
protocol adapter that talks to a running Kural backend over HTTP, so it
never loads TTS/ASR models itself and works against local or remote
backends alike.
"""
from __future__ import annotations

import os
from pathlib import Path

import httpx

DEFAULT_HOST = "http://localhost:8000"
# Synthesis and transcription are CPU-heavy; allow a long read window.
_TIMEOUT = httpx.Timeout(connect=5.0, read=600.0, write=60.0, pool=5.0)


class KuralBackendError(RuntimeError):
    """Raised when the Kural backend is unreachable or returns an error.

    The message is shaped for an MCP client (e.g. Claude Code) to surface
    directly to the user — it names the host and, where available, the
    backend's structured error code.
    """


def _explain(host: str, exc: Exception) -> KuralBackendError:
    if isinstance(exc, httpx.ConnectError):
        return KuralBackendError(
            f"Cannot reach the Kural backend at {host}. Start it with "
            "`uvicorn app.main:app` in backend/, or set KURAL_HOST."
        )
    if isinstance(exc, httpx.HTTPStatusError):
        detail = ""
        try:
            body = exc.response.json().get("detail", {})
            if isinstance(body, dict):
                detail = f" [{body.get('code', '')}] {body.get('message', '')}".rstrip()
        except Exception:
            detail = ""
        return KuralBackendError(
            f"Kural backend returned {exc.response.status_code}.{detail}"
        )
    return KuralBackendError(f"Kural backend request failed: {exc}")


class KuralClient:
    def __init__(self, host: str | None = None, api_key: str | None = None) -> None:
        self.host = (host or os.environ.get("KURAL_HOST") or DEFAULT_HOST).rstrip("/")
        # The backend only requires X-API-Key when KURAL_API_KEY is set on
        # the server. Sending an empty header is harmless when it isn't.
        self.api_key = api_key if api_key is not None else os.environ.get("KURAL_API_KEY", "")

    def _headers(self) -> dict[str, str]:
        return {"X-API-Key": self.api_key} if self.api_key else {}

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.host, timeout=_TIMEOUT, headers=self._headers())

    def health(self) -> dict:
        try:
            with self._client() as client:
                resp = client.get("/healthz")
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            raise _explain(self.host, exc) from exc

    def get_voices(self) -> list[dict]:
        try:
            with self._client() as client:
                resp = client.get("/api/voices")
                resp.raise_for_status()
                return resp.json()["voices"]
        except Exception as exc:
            raise _explain(self.host, exc) from exc

    def list_clones(self) -> list[dict]:
        try:
            with self._client() as client:
                resp = client.get("/api/voices/clones")
                resp.raise_for_status()
                return resp.json()["clones"]
        except Exception as exc:
            raise _explain(self.host, exc) from exc

    def synthesize(
        self,
        text: str,
        *,
        voice: str = "af_bella",
        voice_id: str | None = None,
        speed: float = 1.0,
        fmt: str = "wav",
    ) -> bytes:
        body: dict = {"text": text, "format": fmt}
        if voice_id:
            body["voice_id"] = voice_id
        else:
            body["voice"] = voice
            body["speed"] = speed
        try:
            with self._client() as client:
                resp = client.post("/api/synthesize", json=body)
                resp.raise_for_status()
                return resp.content
        except Exception as exc:
            raise _explain(self.host, exc) from exc

    def transcribe(
        self,
        audio_path: str | Path,
        *,
        language: str | None = None,
        provider: str = "auto",
    ) -> dict:
        audio_path = Path(audio_path)
        if not audio_path.is_file():
            raise KuralBackendError(f"Audio file not found: {audio_path}")
        data = {"provider": provider}
        if language:
            data["language"] = language
        try:
            with self._client() as client:
                with open(audio_path, "rb") as fh:
                    resp = client.post(
                        "/api/transcribe",
                        files={"file": (audio_path.name, fh, "application/octet-stream")},
                        data=data,
                    )
                resp.raise_for_status()
                return resp.json()
        except KuralBackendError:
            raise
        except Exception as exc:
            raise _explain(self.host, exc) from exc
