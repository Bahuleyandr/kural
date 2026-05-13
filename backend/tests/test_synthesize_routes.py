from fastapi.testclient import TestClient

from app.main import app
from app.routers import synthesize as synthesize_router


def test_synthesize_returns_structured_validation_error(monkeypatch):
    def fail(*_args, **_kwargs):
        raise ValueError("bad voice")

    monkeypatch.setattr(synthesize_router, "synthesize", fail)

    res = TestClient(app).post(
        "/api/synthesize",
        json={"text": "hello", "voice": "missing", "format": "wav"},
    )

    assert res.status_code == 422
    assert res.json()["detail"] == {
        "code": "invalid_synthesis_request",
        "message": "bad voice",
    }


def test_synthesize_reports_missing_models(monkeypatch):
    def fail(*_args, **_kwargs):
        raise RuntimeError("Kokoro model files not found")

    monkeypatch.setattr(synthesize_router, "synthesize", fail)

    res = TestClient(app).post(
        "/api/synthesize",
        json={"text": "hello", "voice": "af_bella", "format": "wav"},
    )

    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "tts_unavailable"


def test_synthesize_dispatches_supertonic_voices(monkeypatch):
    """A voice id with the ``st_`` prefix must route to the Supertonic engine,
    not the Kokoro engine — otherwise multilingual voices silently fall back
    to a Kokoro voice that mispronounces the target language."""
    kokoro_calls: list[tuple] = []
    supertonic_calls: list[tuple] = []

    def fake_kokoro(text, voice, speed):
        kokoro_calls.append((text, voice, speed))
        return b"RIFF\x00\x00\x00\x00WAVE"

    def fake_supertonic(text, voice):
        supertonic_calls.append((text, voice))
        # Minimal valid WAV header so process_wav_audio doesn't choke
        import io
        import wave
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(b"\x00\x00" * 1024)
        return buf.getvalue()

    monkeypatch.setattr(synthesize_router, "synthesize", fake_kokoro)
    monkeypatch.setattr(synthesize_router, "synthesize_supertonic", fake_supertonic)

    res = TestClient(app).post(
        "/api/synthesize",
        json={"text": "namaste", "voice": "st_m1_hi", "format": "wav"},
    )

    assert res.status_code == 200
    assert supertonic_calls == [("namaste", "st_m1_hi")]
    assert kokoro_calls == []
