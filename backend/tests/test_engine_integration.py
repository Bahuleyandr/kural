"""Real Kokoro inference smoke test.

Skipped by default — opt in by setting KURAL_RUN_INTEGRATION=1 (and pointing
MODEL_CACHE_DIR at a populated kokoro model directory). The CI integration
job runs this after `python scripts/download_models.py`.

Asserts: the engine produces a non-empty WAV that is not silent. This is the
one test that would catch a kokoro-onnx upgrade regression — every other
backend test mocks the engines.
"""
from __future__ import annotations

import io
import os
import wave

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("KURAL_RUN_INTEGRATION") != "1",
    reason="set KURAL_RUN_INTEGRATION=1 to run real Kokoro inference",
)


def test_kokoro_synthesizes_audible_wav():
    from app.tts.engine import synthesize

    audio = synthesize("Kural integration test.", voice="af_bella", speed=1.0)
    assert isinstance(audio, bytes)
    assert len(audio) > 1024, "WAV is suspiciously small"

    with wave.open(io.BytesIO(audio), "rb") as wav:
        assert wav.getframerate() >= 16000
        frames = wav.readframes(wav.getnframes())
        assert len(frames) > 0
        # Reject "all zeros" (silent) — engine reported success but produced nothing.
        assert any(b != 0 for b in frames[:4096])
