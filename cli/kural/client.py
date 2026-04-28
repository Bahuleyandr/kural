"""HTTP client for the Kural backend API."""
from pathlib import Path

import httpx

DEFAULT_HOST = "http://localhost:8000"
_TIMEOUT = httpx.Timeout(connect=5.0, read=300.0, write=30.0, pool=5.0)


def get_voices(host: str = DEFAULT_HOST) -> list[dict]:
    """Return the Kokoro voice list from GET /api/voices."""
    with httpx.Client(base_url=host, timeout=_TIMEOUT) as client:
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

    with httpx.Client(base_url=host, timeout=_TIMEOUT) as client:
        resp = client.post("/api/synthesize", json=body)
        resp.raise_for_status()
        return resp.content


def list_clones(host: str = DEFAULT_HOST) -> list[dict]:
    """Return saved cloned voices from GET /api/voices/clones."""
    with httpx.Client(base_url=host, timeout=_TIMEOUT) as client:
        resp = client.get("/api/voices/clones")
        resp.raise_for_status()
        return resp.json()["clones"]


def clone_voice(
    audio_path: str | Path,
    name: str,
    host: str = DEFAULT_HOST,
) -> dict:
    """Upload an audio sample to POST /api/voices/clone and return the clone metadata."""
    audio_path = Path(audio_path)
    with httpx.Client(base_url=host, timeout=_TIMEOUT) as client:
        with open(audio_path, "rb") as fh:
            resp = client.post(
                "/api/voices/clone",
                files={"file": (audio_path.name, fh, "audio/wav")},
                data={"name": name},
            )
        resp.raise_for_status()
        return resp.json()


def delete_clone(voice_id: str, host: str = DEFAULT_HOST) -> None:
    """DELETE /api/voices/clones/{voice_id}."""
    with httpx.Client(base_url=host, timeout=_TIMEOUT) as client:
        resp = client.delete(f"/api/voices/clones/{voice_id}")
        resp.raise_for_status()
