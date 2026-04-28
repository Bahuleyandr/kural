"""HTTP client for the Kural backend API."""

import httpx

DEFAULT_HOST = "http://localhost:8000"
_TIMEOUT = httpx.Timeout(connect=5.0, read=300.0, write=30.0, pool=5.0)


def get_voices(host: str = DEFAULT_HOST) -> list[dict]:
    """Return the voice list from GET /api/voices."""
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
) -> bytes:
    """POST /api/synthesize and return raw audio bytes."""
    with httpx.Client(base_url=host, timeout=_TIMEOUT) as client:
        resp = client.post(
            "/api/synthesize",
            json={"text": text, "voice": voice, "speed": speed, "format": fmt},
        )
        resp.raise_for_status()
        return resp.content
