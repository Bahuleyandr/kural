"""Supertonic ONNX TTS adapter.

Supertonic is an MIT-licensed, ONNX-based multilingual TTS model from
Supertone Inc. v3 ships native synthesis for 31 languages from a single
~99M-parameter model — much smaller than Kokoro+espeak and natively
multilingual where the Kokoro path relies on translate-then-speak.

This adapter exposes a curated subset of (voice style, language) pairs
through the same `/api/voices` surface that Kokoro uses, with voice IDs
prefixed `st_` so the synthesize router can dispatch unambiguously.

Voice ID convention: ``st_<style>_<lang>`` (e.g. ``st_m1_en``, ``st_f2_hi``).
The Supertonic SDK takes (voice_style, lang) as orthogonal inputs; we
encode both into the ID so the existing voice-picker UI works unchanged.

Notes on Supertonic versus Kokoro:
- Speed is not exposed by the Supertonic SDK. Speed adjustments still work
  via ``process_wav_audio`` post-processing in the synthesize router.
- Streaming is not supported by Supertonic; only the non-stream endpoint
  routes here. ``/api/synthesize/stream`` stays Kokoro-only.
- Supertonic's expressive tags (``<laugh>``, ``<breath>``, ``<sigh>``) pass
  through as literal text in synthesized output because Kural's SSML
  parser strips unknown tags — this is harmless; supporting them is a
  follow-up if/when the SSML parser learns about engine-specific tags.
"""
from __future__ import annotations

import io
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from ..config import settings
from .registry import registry

_log = logging.getLogger(__name__)

VOICE_ID_PREFIX = "st_"

# Curated voice style × language matrix. Start narrow — Supertonic v3
# supports 11+ voice styles and 31 languages (= 300+ permutations), but
# dumping all of them swamps the voice picker. Expand by editing this
# table; no other code changes needed.
_STYLES = [
    ("m1", "M1", "male", "warm and grounded"),
    ("m2", "M2", "male", "bright and confident"),
    ("f1", "F1", "female", "clear and articulate"),
    ("f2", "F2", "female", "expressive and lively"),
]

_LANGS = [
    ("en", "en-US", "English"),
    ("hi", "hi-IN", "Hindi"),
    ("ja", "ja-JP", "Japanese"),
    ("de", "de-DE", "German"),
    ("fr", "fr-FR", "French"),
    ("es", "es-ES", "Spanish"),
]


def _build_catalog() -> list[dict]:
    catalog: list[dict] = []
    for style_id, style_name, gender, style_desc in _STYLES:
        for lang_code, locale, lang_name in _LANGS:
            catalog.append(
                {
                    "id": f"{VOICE_ID_PREFIX}{style_id}_{lang_code}",
                    "name": f"{style_name} ({lang_name})",
                    "language": lang_code,
                    "locale": locale,
                    "engine": "supertonic",
                    "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
                    "gender": gender,
                    "description": f"Supertonic — {style_desc} ({lang_name})",
                }
            )
    return catalog


SUPERTONIC_VOICES: list[dict] = _build_catalog()


def _model_dir() -> Path:
    d = Path(os.path.expanduser(settings.supertonic_model_dir))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _build_supertonic() -> Any:
    """Load the Supertonic TTS engine, redirecting model cache to model_dir."""
    try:
        from supertonic import TTS
    except ImportError as exc:
        raise RuntimeError(
            "supertonic not installed. Run: pip install supertonic"
        ) from exc

    model_dir = _model_dir()
    # The supertonic SDK reads HF_HOME / HUGGINGFACE_HUB_CACHE; point those
    # at our cache dir so models don't leak into the global HF cache.
    os.environ.setdefault("HF_HOME", str(model_dir))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(model_dir))

    try:
        return TTS(auto_download=True)
    except Exception as exc:
        raise RuntimeError(
            f"Supertonic failed to initialize from {model_dir}. "
            "Run: python scripts/download_models.py --supertonic"
        ) from exc


def _get_supertonic() -> Any:
    return registry.supertonic(_build_supertonic)


def _parse_voice_id(voice_id: str) -> tuple[str, str]:
    """Split ``st_<style>_<lang>`` into the SDK's voice_name and lang inputs."""
    if not voice_id.startswith(VOICE_ID_PREFIX):
        raise ValueError(f"Not a Supertonic voice id: {voice_id!r}")
    rest = voice_id[len(VOICE_ID_PREFIX):]
    style, _, lang = rest.partition("_")
    if not style or not lang:
        raise ValueError(
            f"Malformed Supertonic voice id {voice_id!r}; expected st_<style>_<lang>"
        )
    return style.upper(), lang


def _ndarray_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


def get_voices() -> list[dict]:
    return list(SUPERTONIC_VOICES)


def is_supertonic_voice(voice: str | None) -> bool:
    return bool(voice) and voice.startswith(VOICE_ID_PREFIX)


def synthesize(text: str, voice: str) -> bytes:
    """Synthesize ``text`` using the Supertonic engine. Returns WAV bytes."""
    style, lang = _parse_voice_id(voice)
    tts = _get_supertonic()
    try:
        voice_style = tts.get_voice_style(voice_name=style)
    except Exception as exc:
        raise ValueError(
            f"Unknown Supertonic voice style {style!r} (voice id {voice!r})"
        ) from exc

    result = tts.synthesize(text, voice_style=voice_style, lang=lang)
    # The SDK returns (wav, duration); older snapshots return just wav.
    if isinstance(result, tuple):
        wav = result[0]
    else:
        wav = result

    if hasattr(wav, "cpu"):
        samples = wav.squeeze().cpu().numpy()
    elif hasattr(wav, "numpy"):
        samples = wav.squeeze().numpy()
    else:
        samples = np.asarray(wav).squeeze()

    sample_rate = getattr(tts, "sample_rate", None) or getattr(tts, "sr", None) or 24000
    return _ndarray_to_wav_bytes(samples, int(sample_rate))
