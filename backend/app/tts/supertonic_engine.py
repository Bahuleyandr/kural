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
- Streaming is synthesised by splitting input on sentence boundaries and
  yielding one WAV per sentence (the SDK has no native streaming
  generator). This still gives a perceptible first-audio latency win for
  long inputs without relying on engine-side streaming.
- Supertonic's expressive tags (``<laugh>``, ``<breath>``, ``<sigh>``) pass
  through as literal text in synthesized output because Kural's SSML
  parser strips unknown tags — this is harmless; supporting them is a
  follow-up if/when the SSML parser learns about engine-specific tags.
"""
from __future__ import annotations

import io
import logging
import os
import re
from pathlib import Path
from typing import Any, AsyncGenerator

import numpy as np
import soundfile as sf

from ..config import settings
from .registry import registry

_log = logging.getLogger(__name__)

VOICE_ID_PREFIX = "st_"

# Full Supertonic v3 voice style × language matrix — every (style, language)
# pair the model ships natively. 10 styles × 31 languages = 310 entries.
# Expand or trim by editing these tables; no other code changes needed.
#
# The "description" snippets on the first four styles are aesthetic labels
# carried over from the curated subset that originally exposed M1/M2/F1/F2.
# Supertonic publishes no per-style personality metadata, so M3–M5 and F3–F5
# use neutral ordinal labels rather than invented characteristics — users
# audition voices to find the one that fits.
_STYLES = [
    ("m1", "M1", "male", "warm and grounded"),
    ("m2", "M2", "male", "bright and confident"),
    ("m3", "M3", "male", "third male voice"),
    ("m4", "M4", "male", "fourth male voice"),
    ("m5", "M5", "male", "fifth male voice"),
    ("f1", "F1", "female", "clear and articulate"),
    ("f2", "F2", "female", "expressive and lively"),
    ("f3", "F3", "female", "third female voice"),
    ("f4", "F4", "female", "fourth female voice"),
    ("f5", "F5", "female", "fifth female voice"),
]

# All 31 languages in Supertonic v3. Locales use the most widely-spoken
# regional variant of each language (e.g. pt-BR rather than pt-PT) to match
# Kokoro's existing locale conventions in `local_models.registry`.
_LANGS = [
    ("en", "en-US", "English"),
    ("hi", "hi-IN", "Hindi"),
    ("ja", "ja-JP", "Japanese"),
    ("ko", "ko-KR", "Korean"),
    ("de", "de-DE", "German"),
    ("fr", "fr-FR", "French"),
    ("es", "es-ES", "Spanish"),
    ("it", "it-IT", "Italian"),
    ("pt", "pt-BR", "Portuguese"),
    ("ru", "ru-RU", "Russian"),
    ("ar", "ar-SA", "Arabic"),
    ("tr", "tr-TR", "Turkish"),
    ("vi", "vi-VN", "Vietnamese"),
    ("id", "id-ID", "Indonesian"),
    ("nl", "nl-NL", "Dutch"),
    ("pl", "pl-PL", "Polish"),
    ("uk", "uk-UA", "Ukrainian"),
    ("cs", "cs-CZ", "Czech"),
    ("ro", "ro-RO", "Romanian"),
    ("el", "el-GR", "Greek"),
    ("hu", "hu-HU", "Hungarian"),
    ("sv", "sv-SE", "Swedish"),
    ("da", "da-DK", "Danish"),
    ("fi", "fi-FI", "Finnish"),
    ("bg", "bg-BG", "Bulgarian"),
    ("hr", "hr-HR", "Croatian"),
    ("sk", "sk-SK", "Slovak"),
    ("sl", "sl-SI", "Slovenian"),
    ("lt", "lt-LT", "Lithuanian"),
    ("lv", "lv-LV", "Latvian"),
    ("et", "et-EE", "Estonian"),
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
    """Load the Supertonic TTS engine, pointing the SDK at our cache dir."""
    try:
        from supertonic import TTS
    except ImportError as exc:
        raise RuntimeError(
            "supertonic not installed. Run: pip install --no-deps supertonic>=1.2.0"
        ) from exc

    model_dir = _model_dir()
    try:
        return TTS(model_dir=str(model_dir), auto_download=True)
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


def _wav_from_sdk_output(tts: Any, result: Any) -> bytes:
    # The SDK returns (wav, duration); older snapshots return just wav.
    wav = result[0] if isinstance(result, tuple) else result
    if hasattr(wav, "cpu"):
        samples = wav.squeeze().cpu().numpy()
    elif hasattr(wav, "numpy"):
        samples = wav.squeeze().numpy()
    else:
        samples = np.asarray(wav).squeeze()
    sample_rate = getattr(tts, "sample_rate", None) or getattr(tts, "sr", None) or 24000
    return _ndarray_to_wav_bytes(samples, int(sample_rate))


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
    return _wav_from_sdk_output(tts, result)


# Sentence-ish splitter. Keep it simple — Supertonic absorbs prosody from
# punctuation, so splitting on `.!?` then re-attaching the delimiter is
# good enough to make first-audio land quickly without breaking phrases.
_SENTENCE_RE = re.compile(r"[^.!?]+[.!?]+|\S+[^.!?]*$", re.UNICODE)


def _split_sentences(text: str) -> list[str]:
    chunks = [m.group(0).strip() for m in _SENTENCE_RE.finditer(text)]
    return [c for c in chunks if c]


async def synthesize_stream(
    text: str, voice: str
) -> AsyncGenerator[bytes, None]:
    """Yield one WAV per sentence so the client hears audio before the full
    paragraph has finished rendering. Supertonic has no native streaming
    generator; this is a pragmatic chunk-by-sentence equivalent."""
    style, lang = _parse_voice_id(voice)
    tts = _get_supertonic()
    try:
        voice_style = tts.get_voice_style(voice_name=style)
    except Exception as exc:
        raise ValueError(
            f"Unknown Supertonic voice style {style!r} (voice id {voice!r})"
        ) from exc

    for sentence in _split_sentences(text) or [text]:
        result = tts.synthesize(sentence, voice_style=voice_style, lang=lang)
        yield _wav_from_sdk_output(tts, result)
