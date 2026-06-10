"""Unit tests for the Kural MCP server tools (mocked backend client)."""
from __future__ import annotations

import io
import wave

import pytest

from kural_mcp import server
from kural_mcp.client import KuralBackendError


def _wav_bytes(seconds: float = 1.0, rate: int = 24000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


class _FakeClient:
    def __init__(self):
        self.calls: list[tuple] = []

    def get_voices(self):
        return [
            {"id": "af_bella", "name": "Bella", "language": "en-US", "engine": "kokoro"},
            {"id": "st_m1_hi", "name": "M1 (Hindi)", "language": "hi", "engine": "supertonic"},
            {"id": "st_m1_en", "name": "M1 (English)", "language": "en", "engine": "supertonic"},
        ]

    def list_clones(self):
        return [{"id": "clone-1", "name": "My Voice", "language": "en-US"}]

    def list_model_packs(self):
        return {
            "packs": [
                {"id": "kokoro-v1-onnx", "category": "tts", "status": "ready"},
                {"id": "faster-whisper", "category": "asr", "status": "not_configured"},
            ],
            "jobs": [{"id": "job-1", "kind": "model-pack:install:kokoro-v1-onnx"}],
            "total": 2,
        }

    def synthesize(self, text, *, voice="af_bella", voice_id=None, speed=1.0, fmt="wav"):
        self.calls.append(("synthesize", text, voice, voice_id, speed, fmt))
        return _wav_bytes()

    def transcribe(self, audio_path, *, language=None, provider="auto"):
        self.calls.append(("transcribe", str(audio_path), language, provider))
        return {"text": "hello world", "language": "en", "provider": "faster-whisper", "segments": []}


@pytest.fixture
def fake(monkeypatch):
    client = _FakeClient()
    monkeypatch.setattr(server, "_client", client)
    return client


def test_list_voices_unfiltered(fake):
    voices = server.list_voices()
    assert {v["id"] for v in voices} == {"af_bella", "st_m1_hi", "st_m1_en"}


def test_list_voices_filtered_by_engine(fake):
    voices = server.list_voices(engine="supertonic")
    assert all(v["engine"] == "supertonic" for v in voices)
    assert len(voices) == 2


def test_list_voices_filtered_by_language_prefix(fake):
    # "en" must match both the bare "en" language tag and the "en-US"
    # locale — otherwise Supertonic and Kokoro voices filter differently.
    voices = server.list_voices(language="en")
    assert {v["id"] for v in voices} == {"af_bella", "st_m1_en"}

    hi = server.list_voices(language="hi")
    assert {v["id"] for v in hi} == {"st_m1_hi"}


def test_list_cloned_voices(fake):
    clones = server.list_cloned_voices()
    assert clones[0]["id"] == "clone-1"


def test_list_model_packs_filters_by_category(fake):
    payload = server.list_model_packs(category="tts", include_jobs=False)

    assert payload["total"] == 1
    assert payload["packs"][0]["id"] == "kokoro-v1-onnx"
    assert payload["jobs"] == []


def test_list_model_packs_rejects_unknown_category(fake):
    with pytest.raises(KuralBackendError, match="Unsupported category"):
        server.list_model_packs(category="agents")


def test_synthesize_writes_file_and_reports_path(fake, tmp_path):
    out = tmp_path / "speech.wav"
    result = server.synthesize("Hello there.", voice="st_m1_en", output_path=str(out))

    assert out.is_file()
    assert out.read_bytes()[:4] == b"RIFF"
    # The summary must name the resolved path so the MCP client can act on it.
    assert str(out.resolve()) in result
    assert "st_m1_en" in result
    assert fake.calls[0] == ("synthesize", "Hello there.", "st_m1_en", None, 1.0, "wav")


def test_synthesize_defaults_to_temp_file(fake):
    result = server.synthesize("No path given.")
    # Even without output_path, the tool must report where it wrote.
    assert "kural_" in result
    assert ".wav" in result


def test_synthesize_rejects_bad_format(fake):
    with pytest.raises(KuralBackendError, match="Unsupported format"):
        server.synthesize("text", fmt="ogg")


def test_synthesize_with_cloned_voice_routes_voice_id(fake, tmp_path):
    out = tmp_path / "cloned.wav"
    result = server.synthesize_with_cloned_voice(
        "Cloned speech.", "clone-1", output_path=str(out)
    )
    assert out.is_file()
    assert "clone-1" in result
    # Must go through the voice_id path, not the plain voice path.
    call = fake.calls[0]
    assert call[3] == "clone-1"  # voice_id positional in the fake signature


def test_transcribe_passes_through(fake, tmp_path):
    audio = tmp_path / "clip.wav"
    audio.write_bytes(_wav_bytes())
    result = server.transcribe(str(audio), language="en", provider="faster-whisper")
    assert result["text"] == "hello world"
    assert fake.calls[0] == ("transcribe", str(audio), "en", "faster-whisper")


def test_transcribe_empty_language_becomes_none(fake, tmp_path):
    audio = tmp_path / "clip.wav"
    audio.write_bytes(_wav_bytes())
    server.transcribe(str(audio))
    # Empty string must become None so the backend auto-detects.
    assert fake.calls[0] == ("transcribe", str(audio), None, "auto")
