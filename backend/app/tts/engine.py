"""TTS engine — wraps kokoro-onnx (lightweight, no torch required)."""
import io
import os
from pathlib import Path
from typing import AsyncGenerator

import numpy as np
import soundfile as sf

from ..config import settings

KOKORO_VOICES = [
    {
        "id": "af_bella",
        "name": "Bella",
        "language": "en-US",
        "gender": "female",
        "description": "American English — warm and expressive",
    },
    {
        "id": "af_sarah",
        "name": "Sarah",
        "language": "en-US",
        "gender": "female",
        "description": "American English — clear and professional",
    },
    {
        "id": "af_nicole",
        "name": "Nicole",
        "language": "en-US",
        "gender": "female",
        "description": "American English — friendly and upbeat",
    },
    {
        "id": "af_sky",
        "name": "Sky",
        "language": "en-US",
        "gender": "female",
        "description": "American English — bright and energetic",
    },
    {
        "id": "af",
        "name": "Default Female",
        "language": "en-US",
        "gender": "female",
        "description": "American English — versatile default voice",
    },
    {
        "id": "am_adam",
        "name": "Adam",
        "language": "en-US",
        "gender": "male",
        "description": "American English — deep and authoritative",
    },
    {
        "id": "am_michael",
        "name": "Michael",
        "language": "en-US",
        "gender": "male",
        "description": "American English — natural and conversational",
    },
    {
        "id": "bf_emma",
        "name": "Emma",
        "language": "en-GB",
        "gender": "female",
        "description": "British English — polished and articulate",
    },
    {
        "id": "bf_isabella",
        "name": "Isabella",
        "language": "en-GB",
        "gender": "female",
        "description": "British English — refined and confident",
    },
    {
        "id": "bm_george",
        "name": "George",
        "language": "en-GB",
        "gender": "male",
        "description": "British English — distinguished and calm",
    },
    {
        "id": "bm_lewis",
        "name": "Lewis",
        "language": "en-GB",
        "gender": "male",
        "description": "British English — crisp and direct",
    },
]

_kokoro_instance = None


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


def _get_kokoro():
    global _kokoro_instance
    if _kokoro_instance is not None:
        return _kokoro_instance

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

    _kokoro_instance = Kokoro(
        str(model_path), str(voices_path), espeak_config=_espeak_config()
    )
    return _kokoro_instance


def _lang_for_voice(voice: str) -> str:
    return "en-gb" if voice.startswith("b") else "en-us"


def get_voices() -> list[dict]:
    return KOKORO_VOICES


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
