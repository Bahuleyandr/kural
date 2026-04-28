import io
import wave

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.routers import synthesize as synthesize_router
from app.tts.ssml import BreakSegment, TextSegment, parse_ssml, stitch_wav_sequence


def wav_bytes(frames: int = 8, sample_rate: int = 8000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(b"\x01\x00" * frames)
    return output.getvalue()


def wav_frame_count(data: bytes) -> int:
    with wave.open(io.BytesIO(data), "rb") as reader:
        return reader.getnframes()


def test_parse_ssml_supports_breaks_substitutions_and_say_as():
    segments = parse_ssml(
        '<speak>Hello <break time="250ms"/>'
        '<sub alias="Kural">குரல்</sub> '
        '<say-as interpret-as="characters">AI</say-as></speak>'
    )

    assert segments == [
        TextSegment("Hello"),
        BreakSegment(250),
        TextSegment("Kural A I"),
    ]


def test_parse_ssml_supports_prosody_phoneme_and_pronunciation_rules():
    segments = parse_ssml(
        '<speak><prosody rate="slow" pitch="+1st">Kural</prosody> '
        '<phoneme alphabet="ipa" ph="a i">AI</phoneme></speak>',
        pronunciation_rules=[
            {
                "id": "rule-1",
                "pattern": "Kural",
                "replacement": "koo-ral",
                "mode": "word",
                "enabled": True,
                "priority": 1,
            }
        ],
    )

    assert segments == [TextSegment("koo-ral AI")]


def test_parse_ssml_accepts_namespaced_speak_documents():
    segments = parse_ssml(
        '<speak xmlns="http://www.w3.org/2001/10/synthesis">'
        'Hello <break strength="weak"/>world'
        "</speak>"
    )

    assert segments == [TextSegment("Hello"), BreakSegment(250), TextSegment("world")]


def test_parse_ssml_rejects_unsupported_tags():
    with pytest.raises(ValueError, match="not supported"):
        parse_ssml('<speak>Hello <audio src="remote.wav"/></speak>')


def test_stitch_wav_sequence_inserts_silence_between_chunks():
    stitched = stitch_wav_sequence(
        [wav_bytes(frames=10), BreakSegment(100), wav_bytes(frames=5)]
    )

    assert wav_frame_count(stitched) == 10 + 800 + 5


def test_stitch_wav_sequence_scales_ssml_pauses():
    stitched = stitch_wav_sequence(
        [wav_bytes(frames=10), BreakSegment(100), wav_bytes(frames=5)],
        pause_scale=2.0,
    )

    assert wav_frame_count(stitched) == 10 + 1600 + 5


def test_synthesize_ssml_stitches_backend_segments(monkeypatch):
    calls: list[str] = []

    def fake_synthesize(text: str, *_args, **_kwargs) -> bytes:
        calls.append(text)
        return wav_bytes(frames=4)

    monkeypatch.setattr(synthesize_router, "synthesize", fake_synthesize)

    res = TestClient(app).post(
        "/api/synthesize",
        json={
            "text": 'Hello <break time="100ms"/><sub alias="world">W</sub>',
            "voice": "af_bella",
            "format": "wav",
            "ssml": True,
        },
    )

    assert res.status_code == 200
    assert calls == ["Hello", "world"]
    assert wav_frame_count(res.content) == 4 + 800 + 4


def test_synthesize_ssml_returns_structured_validation_error():
    res = TestClient(app).post(
        "/api/synthesize",
        json={
            "text": '<speak>Hello <audio src="remote.wav"/></speak>',
            "voice": "af_bella",
            "format": "wav",
            "ssml": True,
        },
    )

    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "invalid_synthesis_request"


def test_leading_ssml_break_uses_first_audio_sample_rate(monkeypatch):
    monkeypatch.setattr(settings, "sample_rate", 1000)

    stitched = stitch_wav_sequence([BreakSegment(50), wav_bytes(frames=5, sample_rate=8000)])

    assert wav_frame_count(stitched) == 400 + 5
