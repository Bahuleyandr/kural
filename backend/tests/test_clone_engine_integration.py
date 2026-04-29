"""Real Chatterbox cloning smoke test.

Skipped by default — opt in by setting KURAL_RUN_INTEGRATION=1 with the
clone runtime installed (`pip install -r requirements-clone.txt`). Like the
Kokoro smoke test, this catches a chatterbox-tts upgrade regression that
the mocked tests can never see.

Asserts: a 5s WAV sample turns into a non-empty, non-silent WAV when fed
through synthesize_cloned. Heavy because it loads the real ChatterboxTTS
model — runs on CPU, taking 60–120s.
"""
from __future__ import annotations

import io
import os
import wave

import numpy as np
import pytest
import soundfile as sf

pytestmark = pytest.mark.skipif(
    os.environ.get("KURAL_RUN_INTEGRATION") != "1",
    reason="set KURAL_RUN_INTEGRATION=1 to run real Chatterbox inference",
)


def _five_second_silence_wav(sample_rate: int = 22050) -> bytes:
    samples = np.zeros(int(5.0 * sample_rate), dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def test_chatterbox_clones_and_synthesizes(tmp_path, monkeypatch):
    pytest.importorskip("chatterbox", reason="chatterbox-tts is not installed")

    from app.config import settings
    from app.tts.chatterbox_engine import save_voice_sample, synthesize_cloned

    monkeypatch.setattr(settings, "clone_cache_dir", str(tmp_path))
    monkeypatch.setattr(settings, "clone_min_duration_s", 5.0)
    monkeypatch.setattr(settings, "clone_max_duration_s", 30.0)

    sample_bytes = _five_second_silence_wav()
    meta = save_voice_sample(sample_bytes, "Integration voice", consent_confirmed=True)
    assert meta["id"]

    audio = synthesize_cloned("Kural integration test.", meta["id"])
    assert isinstance(audio, bytes)
    assert len(audio) > 1024, "Cloned WAV is suspiciously small"

    with wave.open(io.BytesIO(audio), "rb") as wav:
        assert wav.getframerate() >= 16000
        frames = wav.readframes(wav.getnframes())
        assert len(frames) > 0
        assert any(b != 0 for b in frames[:4096])
