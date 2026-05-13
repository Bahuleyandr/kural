"""Unit tests for the Supertonic engine adapter (mocked SDK, no real model)."""
from __future__ import annotations

import io
import wave
from types import SimpleNamespace

import numpy as np
import pytest

from app.tts import supertonic_engine
from app.tts.registry import registry


def _silent_wav() -> np.ndarray:
    return np.zeros(24000, dtype=np.float32)


class _FakeTTS:
    """Stand-in for the supertonic.TTS class — records calls for assertions."""

    sample_rate = 24000

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def get_voice_style(self, voice_name: str):
        return SimpleNamespace(voice_name=voice_name)

    def synthesize(self, text: str, voice_style, lang: str):
        self.calls.append({"text": text, "voice": voice_style.voice_name, "lang": lang})
        return _silent_wav(), 1.0


def test_is_supertonic_voice_prefix():
    assert supertonic_engine.is_supertonic_voice("st_m1_en")
    assert supertonic_engine.is_supertonic_voice("st_f2_hi")
    assert not supertonic_engine.is_supertonic_voice("af_bella")
    assert not supertonic_engine.is_supertonic_voice("")
    assert not supertonic_engine.is_supertonic_voice(None)


def test_parse_voice_id_splits_style_and_lang():
    assert supertonic_engine._parse_voice_id("st_m1_en") == ("M1", "en")
    assert supertonic_engine._parse_voice_id("st_f2_hi") == ("F2", "hi")


def test_parse_voice_id_rejects_non_supertonic():
    with pytest.raises(ValueError):
        supertonic_engine._parse_voice_id("af_bella")


def test_parse_voice_id_rejects_malformed():
    with pytest.raises(ValueError):
        supertonic_engine._parse_voice_id("st_only")
    with pytest.raises(ValueError):
        supertonic_engine._parse_voice_id("st__en")


def test_get_voices_contains_curated_matrix():
    voices = supertonic_engine.get_voices()
    ids = {v["id"] for v in voices}

    # Spot-check a few combinations from the curated style × lang table.
    assert "st_m1_en" in ids
    assert "st_f1_hi" in ids
    assert "st_m2_ja" in ids
    # Every voice must declare itself as a Supertonic voice.
    assert all(v["engine"] == "supertonic" for v in voices)
    # Every voice must be language-tagged so the picker can group by locale.
    assert all(v["language"] and v["locale"] for v in voices)


def test_synthesize_routes_through_sdk(monkeypatch):
    fake = _FakeTTS()
    registry.reset()
    monkeypatch.setattr(supertonic_engine, "_build_supertonic", lambda: fake)

    wav_bytes = supertonic_engine.synthesize("hello world", "st_m1_en")

    assert wav_bytes[:4] == b"RIFF"
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
        assert wav.getframerate() == 24000

    assert fake.calls == [{"text": "hello world", "voice": "M1", "lang": "en"}]


def test_synthesize_rejects_non_supertonic_voice(monkeypatch):
    monkeypatch.setattr(supertonic_engine, "_build_supertonic", lambda: _FakeTTS())

    with pytest.raises(ValueError):
        supertonic_engine.synthesize("hello", "af_bella")


def test_build_supertonic_raises_when_sdk_missing(monkeypatch):
    """If the supertonic pip package isn't installed, surfacing a clear error
    is the difference between an actionable hint and an opaque ImportError."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "supertonic":
            raise ImportError("No module named 'supertonic'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    registry.reset()

    with pytest.raises(RuntimeError, match="supertonic not installed"):
        supertonic_engine._build_supertonic()


def test_split_sentences_keeps_punctuation():
    """Each chunk must carry its terminal punctuation; Supertonic uses
    sentence-final marks for prosody, so stripping them would flatten
    the speech."""
    sents = supertonic_engine._split_sentences(
        "Hello there. How are you? I am fine!"
    )
    assert sents == ["Hello there.", "How are you?", "I am fine!"]


def test_split_sentences_handles_no_terminator():
    """Inputs without a final period must still produce a chunk —
    otherwise short utterances would round-trip as silence."""
    sents = supertonic_engine._split_sentences("Just three words")
    assert sents == ["Just three words"]


def test_split_sentences_empty_input():
    assert supertonic_engine._split_sentences("") == []
    assert supertonic_engine._split_sentences("   ") == []


@pytest.mark.anyio
async def test_synthesize_stream_yields_one_wav_per_sentence(monkeypatch):
    """Two sentences in, two WAVs out. This is what makes first-audio
    latency feel fast on long inputs."""
    fake = _FakeTTS()
    registry.reset()
    monkeypatch.setattr(supertonic_engine, "_build_supertonic", lambda: fake)

    chunks: list[bytes] = []
    async for chunk in supertonic_engine.synthesize_stream(
        "Hello there. How are you?", "st_m1_en"
    ):
        chunks.append(chunk)

    assert len(chunks) == 2
    assert all(c[:4] == b"RIFF" for c in chunks)
    assert [call["text"] for call in fake.calls] == [
        "Hello there.",
        "How are you?",
    ]


@pytest.fixture
def anyio_backend():
    return "asyncio"
