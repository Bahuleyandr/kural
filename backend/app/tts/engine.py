"""TTS engine — wraps kokoro-onnx (lightweight, no torch required)."""
import io
import json
import logging
import os
from pathlib import Path
from typing import AsyncGenerator

import numpy as np
import soundfile as sf

from ..config import settings
from .registry import registry

_log = logging.getLogger(__name__)

KOKORO_VOICES = [
    {
        "id": "af_bella",
        "name": "Bella",
        "language": "en-US",
        "locale": "en-US",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "American English — warm and expressive",
    },
    {
        "id": "af_sarah",
        "name": "Sarah",
        "language": "en-US",
        "locale": "en-US",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "American English — clear and professional",
    },
    {
        "id": "af_nicole",
        "name": "Nicole",
        "language": "en-US",
        "locale": "en-US",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "American English — friendly and upbeat",
    },
    {
        "id": "af_sky",
        "name": "Sky",
        "language": "en-US",
        "locale": "en-US",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "American English — bright and energetic",
    },
    {
        "id": "af",
        "name": "Default Female",
        "language": "en-US",
        "locale": "en-US",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "American English — versatile default voice",
    },
    {
        "id": "am_adam",
        "name": "Adam",
        "language": "en-US",
        "locale": "en-US",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "American English — deep and authoritative",
    },
    {
        "id": "am_michael",
        "name": "Michael",
        "language": "en-US",
        "locale": "en-US",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "American English — natural and conversational",
    },
    {
        "id": "bf_emma",
        "name": "Emma",
        "language": "en-GB",
        "locale": "en-GB",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "British English — polished and articulate",
    },
    {
        "id": "bf_isabella",
        "name": "Isabella",
        "language": "en-GB",
        "locale": "en-GB",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "British English — refined and confident",
    },
    {
        "id": "bm_george",
        "name": "George",
        "language": "en-GB",
        "locale": "en-GB",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "British English — distinguished and calm",
    },
    {
        "id": "bm_lewis",
        "name": "Lewis",
        "language": "en-GB",
        "locale": "en-GB",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "British English — crisp and direct",
    },
    # Japanese voices
    {
        "id": "jf_alpha",
        "name": "Alpha",
        "language": "ja-JP",
        "locale": "ja-JP",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Japanese — bright and articulate",
    },
    {
        "id": "jf_gongitsune",
        "name": "Gongitsune",
        "language": "ja-JP",
        "locale": "ja-JP",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Japanese — warm narrative voice",
    },
    {
        "id": "jm_kumo",
        "name": "Kumo",
        "language": "ja-JP",
        "locale": "ja-JP",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "Japanese — calm and measured",
    },
    # Mandarin Chinese voices
    {
        "id": "zf_xiaobei",
        "name": "Xiaobei",
        "language": "zh-CN",
        "locale": "zh-CN",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Mandarin — clear and standard Putonghua",
    },
    {
        "id": "zf_xiaoxiao",
        "name": "Xiaoxiao",
        "language": "zh-CN",
        "locale": "zh-CN",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Mandarin — friendly and conversational",
    },
    {
        "id": "zm_yunjian",
        "name": "Yunjian",
        "language": "zh-CN",
        "locale": "zh-CN",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "Mandarin — authoritative news read",
    },
    # Italian voices
    {
        "id": "if_sara",
        "name": "Sara",
        "language": "it-IT",
        "locale": "it-IT",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Italian — bright and precise",
    },
    {
        "id": "im_nicola",
        "name": "Nicola",
        "language": "it-IT",
        "locale": "it-IT",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "Italian — confident and grounded",
    },
    # French voices
    {
        "id": "ff_siwis",
        "name": "Siwis",
        "language": "fr-FR",
        "locale": "fr-FR",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "French — articulate and refined",
    },
    # Spanish voices
    {
        "id": "ef_dora",
        "name": "Dora",
        "language": "es-ES",
        "locale": "es-ES",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Spanish — warm and natural",
    },
    {
        "id": "em_alex",
        "name": "Alex",
        "language": "es-ES",
        "locale": "es-ES",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "Spanish — clear and direct",
    },
    # Hindi voices
    {
        "id": "hf_alpha",
        "name": "Alpha",
        "language": "hi-IN",
        "locale": "hi-IN",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Hindi — crisp and conversational",
    },
    {
        "id": "hm_omega",
        "name": "Omega",
        "language": "hi-IN",
        "locale": "hi-IN",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "Hindi — measured and grounded",
    },
    # Portuguese voices
    {
        "id": "pf_dora",
        "name": "Dora",
        "language": "pt-BR",
        "locale": "pt-BR",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "female",
        "description": "Brazilian Portuguese — warm and lively",
    },
    {
        "id": "pm_alex",
        "name": "Alex",
        "language": "pt-BR",
        "locale": "pt-BR",
        "engine": "kokoro",
        "capabilities": ["tts", "ssml", "mp3", "wav", "advanced-controls"],
        "gender": "male",
        "description": "Brazilian Portuguese — confident and clear",
    },
]

def _model_dir() -> Path:
    d = Path(os.path.expanduser(settings.model_cache_dir))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _espeak_config():
    """Build EspeakConfig preferring the system espeak-ng over the bundled one."""
    try:
        from kokoro_onnx.config import EspeakConfig
    except ImportError:
        return None

    # Prefer system espeak-ng-data if it's present (avoids espeakng-loader
    # path issues when the bundled .so was built on a different machine).
    _SYSTEM_CANDIDATES = [
        "/usr/lib/x86_64-linux-gnu/espeak-ng-data",
        "/usr/lib/aarch64-linux-gnu/espeak-ng-data",
        "/usr/share/espeak-ng-data",
    ]
    _LIB_CANDIDATES = [
        "/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1",
        "/usr/lib/aarch64-linux-gnu/libespeak-ng.so.1",
    ]
    data_path = next((p for p in _SYSTEM_CANDIDATES if os.path.exists(p)), None)
    lib_path = next((p for p in _LIB_CANDIDATES if os.path.exists(p)), None)

    if data_path and lib_path:
        return EspeakConfig(lib_path=lib_path, data_path=data_path)

    # Fall back to the bundled espeakng_loader
    try:
        import espeakng_loader
        return EspeakConfig(
            lib_path=espeakng_loader.get_library_path(),
            data_path=espeakng_loader.get_data_path(),
        )
    except Exception:
        return None


def _build_kokoro():
    try:
        from kokoro_onnx import Kokoro
    except ImportError as exc:
        raise RuntimeError(
            "kokoro-onnx not installed. Run: pip install kokoro-onnx"
        ) from exc

    model_dir = _model_dir()
    model_path = model_dir / settings.kokoro_model_file
    voices_path = model_dir / settings.kokoro_voices_file

    if not model_path.exists() or not voices_path.exists():
        raise RuntimeError(
            f"Kokoro model files not found in {model_dir}. "
            "Run: python scripts/download_models.py"
        )

    return Kokoro(str(model_path), str(voices_path), espeak_config=_espeak_config())


def _get_kokoro():
    return registry.kokoro(_build_kokoro)


_VOICE_PREFIX_LANG = {
    "a": "en-us",
    "b": "en-gb",
    "j": "ja",
    "z": "cmn",
    "i": "it",
    "f": "fr-fr",
    "e": "es",
    "h": "hi",
    "p": "pt-br",
}


def _lang_for_voice(voice: str) -> str:
    """Map a Kokoro voice ID prefix to the language tag espeak / kokoro expects.

    Voice IDs follow a convention: `{lang}{gender}_<name>`. Defaults to
    American English when the prefix is unknown so synthesis still works.
    """
    if not voice:
        return "en-us"
    prefix = voice[0].lower()
    return _VOICE_PREFIX_LANG.get(prefix, "en-us")


_USER_VOICE_REQUIRED_KEYS = {"id", "name", "language", "gender", "description"}


def _load_user_voices() -> list[dict]:
    """Read KURAL_USER_VOICES_FILE and return validated extra voice descriptors.

    Validation is intentionally lenient — bad entries are skipped with a log
    line so a malformed user file never breaks the running engine.
    """
    raw_path = settings.user_voices_file.strip()
    if not raw_path:
        return []
    path = Path(os.path.expanduser(raw_path))
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _log.warning("Failed to parse user voices file %s: %s", path, exc)
        return []
    if not isinstance(data, list):
        _log.warning("User voices file %s must contain a JSON list", path)
        return []

    builtin_ids = {voice["id"] for voice in KOKORO_VOICES}
    extra: list[dict] = []
    seen: set[str] = set()
    for entry in data:
        if not isinstance(entry, dict):
            continue
        missing = _USER_VOICE_REQUIRED_KEYS - entry.keys()
        if missing:
            _log.warning("User voice entry missing keys %s: %s", missing, entry)
            continue
        voice_id = str(entry["id"])
        if voice_id in builtin_ids or voice_id in seen:
            continue
        seen.add(voice_id)
        extra.append(
            {
                "id": voice_id,
                "name": str(entry["name"]),
                "language": str(entry["language"]),
                "locale": str(entry.get("locale") or entry["language"]),
                "engine": str(entry.get("engine") or "kokoro"),
                "capabilities": list(
                    entry.get("capabilities") or ["tts", "ssml", "wav", "mp3", "advanced-controls"]
                ),
                "gender": str(entry["gender"]),
                "description": str(entry["description"]),
            }
        )
    return extra


def get_voices() -> list[dict]:
    return KOKORO_VOICES + _load_user_voices()


def _ndarray_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


def synthesize(text: str, voice: str, speed: float) -> bytes:
    kokoro = _get_kokoro()
    lang = _lang_for_voice(voice)
    samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    return _ndarray_to_wav_bytes(samples, sample_rate)


async def synthesize_stream(
    text: str, voice: str, speed: float
) -> AsyncGenerator[bytes, None]:
    kokoro = _get_kokoro()
    lang = _lang_for_voice(voice)
    async for samples, sample_rate in kokoro.create_stream(
        text, voice=voice, speed=speed, lang=lang
    ):
        yield _ndarray_to_wav_bytes(samples, sample_rate)
