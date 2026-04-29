"""Chatterbox model load + inference."""
from __future__ import annotations

import io

import numpy as np
import soundfile as sf

from ..registry import registry
from .storage import _sample_path


def _build_chatterbox():
    try:
        from chatterbox.tts import ChatterboxTTS
    except ImportError as exc:
        raise RuntimeError(
            "chatterbox-tts not installed. Run: pip install chatterbox-tts"
        ) from exc

    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    return ChatterboxTTS.from_pretrained(device=device)


def _get_chatterbox():
    return registry.chatterbox(_build_chatterbox)


def _ndarray_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


def synthesize_cloned(text: str, voice_id: str) -> bytes:
    """Synthesize text using a cloned voice. Requires chatterbox-tts."""
    sample = _sample_path(voice_id)
    if not sample.exists():
        raise ValueError(f"Cloned voice not found: {voice_id}")

    model = _get_chatterbox()
    wav_tensor = model.generate(text, audio_prompt_path=str(sample))

    if hasattr(wav_tensor, "numpy"):
        audio = wav_tensor.squeeze().numpy()
    else:
        audio = wav_tensor.squeeze().cpu().numpy()

    sample_rate = model.sr if hasattr(model, "sr") else 24000
    return _ndarray_to_wav_bytes(audio, sample_rate)
