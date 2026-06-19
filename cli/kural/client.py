"""HTTP client for the Kural backend API."""
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import click
import httpx

DEFAULT_HOST = "http://localhost:8000"
_TIMEOUT = httpx.Timeout(connect=5.0, read=300.0, write=30.0, pool=5.0)
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _headers() -> dict[str, str]:
    """Attach X-API-Key when KURAL_API_KEY is set so the CLI keeps working
    against a backend hardened with an API key. Empty when unset."""
    key = os.environ.get("KURAL_API_KEY", "")
    return {"X-API-Key": key} if key else {}


def validate_host(host: str) -> str:
    """Validate the backend base URL before sending requests (and the API key)
    to it. Rejects non-http(s) schemes outright; warns on cleartext http to a
    non-loopback host (set KURAL_ALLOW_INSECURE_HOST=1 to silence)."""
    parsed = urlparse(host)
    if parsed.scheme not in ("http", "https"):
        raise click.ClickException(
            f"--host/KURAL_HOST must start with http:// or https:// (got {host!r})."
        )
    hostname = (parsed.hostname or "").lower()
    if hostname not in _LOOPBACK_HOSTS and parsed.scheme == "http":
        allow = os.environ.get("KURAL_ALLOW_INSECURE_HOST", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if not allow:
            print(
                "Warning: sending requests (and any API key) to a non-loopback host "
                f"over cleartext http: {host}. Prefer https://; set "
                "KURAL_ALLOW_INSECURE_HOST=1 to silence.",
                file=sys.stderr,
            )
    return host.rstrip("/")


def _client(host: str) -> httpx.Client:
    return httpx.Client(base_url=validate_host(host), timeout=_TIMEOUT, headers=_headers())


def get_voices(host: str = DEFAULT_HOST) -> list[dict]:
    """Return the Kokoro voice list from GET /api/voices."""
    with _client(host) as client:
        resp = client.get("/api/voices")
        resp.raise_for_status()
        return resp.json()["voices"]


def synthesize(
    text: str,
    voice: str = "af_bella",
    speed: float = 1.0,
    fmt: str = "wav",
    host: str = DEFAULT_HOST,
    voice_id: str | None = None,
) -> bytes:
    """POST /api/synthesize and return raw audio bytes.

    Pass voice_id to use a Chatterbox cloned voice instead of Kokoro.
    """
    body: dict = {"text": text, "format": fmt}
    if voice_id:
        body["voice_id"] = voice_id
    else:
        body["voice"] = voice
        body["speed"] = speed

    with _client(host) as client:
        resp = client.post("/api/synthesize", json=body)
        resp.raise_for_status()
        return resp.content


def list_clones(host: str = DEFAULT_HOST) -> list[dict]:
    """Return saved cloned voices from GET /api/voices/clones."""
    with _client(host) as client:
        resp = client.get("/api/voices/clones")
        resp.raise_for_status()
        return resp.json()["clones"]


def list_model_packs(host: str = DEFAULT_HOST) -> dict:
    """Return local model-pack inventory from GET /api/model-packs."""
    with _client(host) as client:
        resp = client.get("/api/model-packs")
        resp.raise_for_status()
        return resp.json()


def clone_voice(
    audio_path: str | Path,
    name: str,
    host: str = DEFAULT_HOST,
    consent_confirmed: bool = False,
) -> dict:
    """Upload an audio sample to POST /api/voices/clone and return the clone metadata."""
    audio_path = Path(audio_path)
    with _client(host) as client:
        with open(audio_path, "rb") as fh:
            resp = client.post(
                "/api/voices/clone",
                files={"file": (audio_path.name, fh, "audio/wav")},
                data={"name": name, "consent_confirmed": str(consent_confirmed).lower()},
            )
        resp.raise_for_status()
        return resp.json()


def delete_clone(voice_id: str, host: str = DEFAULT_HOST) -> None:
    """DELETE /api/voices/clones/{voice_id}."""
    with _client(host) as client:
        resp = client.delete(f"/api/voices/clones/{voice_id}")
        resp.raise_for_status()


def export_clones(host: str = DEFAULT_HOST, voice_ids: list[str] | None = None) -> bytes:
    """GET /api/voices/clones/export and return a zip archive."""
    params = [("voice_id", voice_id) for voice_id in voice_ids or []]
    with _client(host) as client:
        resp = client.get("/api/voices/clones/export", params=params)
        resp.raise_for_status()
        return resp.content


def import_clones(archive_path: str | Path, host: str = DEFAULT_HOST) -> list[dict]:
    """Upload a Kural voice archive to POST /api/voices/clones/import."""
    archive_path = Path(archive_path)
    with _client(host) as client:
        with open(archive_path, "rb") as fh:
            resp = client.post(
                "/api/voices/clones/import",
                files={"file": (archive_path.name, fh, "application/zip")},
            )
        resp.raise_for_status()
        return resp.json()["imported"]
