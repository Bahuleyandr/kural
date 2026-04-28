import io
import wave

from fastapi.testclient import TestClient

from app.main import app
from app.models import AudioControls
from app.routers import synthesize as synthesize_router
from app.tts.audio import process_wav_audio, wav_duration_ms


def wav_bytes(frames: int = 800, sample_rate: int = 8000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(b"\x20\x03" * frames)
    return output.getvalue()


def test_process_wav_audio_applies_gain_and_keeps_valid_wav():
    processed = process_wav_audio(
        wav_bytes(),
        AudioControls(volume_db=-6.0, normalize=True, trim_silence=False),
    )

    assert processed.startswith(b"RIFF")
    assert wav_duration_ms(processed) == 100


def test_synthesize_controls_speed_overrides_legacy_speed(monkeypatch):
    calls: list[float] = []

    def fake_synthesize(_text: str, _voice: str, speed: float) -> bytes:
        calls.append(speed)
        return wav_bytes()

    monkeypatch.setattr(synthesize_router, "synthesize", fake_synthesize)

    res = TestClient(app).post(
        "/api/synthesize",
        json={
            "text": "hello",
            "voice": "af_bella",
            "speed": 0.75,
            "format": "wav",
            "controls": {"speed": 1.25},
        },
    )

    assert res.status_code == 200
    assert calls == [1.25]


def test_synthesize_applies_pronunciation_rules_before_engine(monkeypatch):
    calls: list[str] = []

    def fake_synthesize(text: str, _voice: str, _speed: float) -> bytes:
        calls.append(text)
        return wav_bytes()

    monkeypatch.setattr(synthesize_router, "synthesize", fake_synthesize)

    res = TestClient(app).post(
        "/api/synthesize",
        json={
            "text": "Kural ships offline",
            "voice": "af_bella",
            "format": "wav",
            "pronunciation_rules": [
                {
                    "id": "kural",
                    "pattern": "Kural",
                    "replacement": "koo-ral",
                    "mode": "word",
                    "enabled": True,
                    "priority": 1,
                }
            ],
        },
    )

    assert res.status_code == 200
    assert calls == ["koo-ral ships offline"]


def test_invalid_audio_controls_return_422():
    res = TestClient(app).post(
        "/api/synthesize",
        json={
            "text": "hello",
            "voice": "af_bella",
            "format": "wav",
            "controls": {"pitch_semitones": 9},
        },
    )

    assert res.status_code == 422
