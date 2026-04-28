"""Chatterbox TTS engine — voice cloning from audio samples (MIT license)."""
import io
import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

from ..config import settings

_chatterbox_instance = None


def _clone_dir() -> Path:
    d = Path(settings.clone_cache_dir).expanduser()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _meta_path(voice_id: str) -> Path:
    return _clone_dir() / voice_id / "meta.json"


def _sample_path(voice_id: str) -> Path:
    return _clone_dir() / voice_id / "sample.wav"


def _get_chatterbox():
    global _chatterbox_instance
    if _chatterbox_instance is not None:
        return _chatterbox_instance

    try:
        from chatterbox.tts import ChatterboxTTS
    except ImportError as exc:
        raise RuntimeError(
            "chatterbox-tts not installed. Run: pip install chatterbox-tts"
        ) from exc

    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    _chatterbox_instance = ChatterboxTTS.from_pretrained(device=device)
    return _chatterbox_instance


def _ndarray_to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


# ---------------------------------------------------------------------------
# Voice management
# ---------------------------------------------------------------------------

def list_cloned_voices() -> list[dict]:
    clones = []
    for meta_file in _clone_dir().glob("*/meta.json"):
        try:
            with open(meta_file) as f:
                clones.append(json.load(f))
        except Exception:
            pass
    return sorted(clones, key=lambda v: v.get("created_at", ""))


def get_clone_meta(voice_id: str) -> Optional[dict]:
    path = _meta_path(voice_id)
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def delete_cloned_voice(voice_id: str) -> bool:
    voice_dir = _clone_dir() / voice_id
    if not voice_dir.exists():
        return False
    shutil.rmtree(voice_dir)
    return True


def save_voice_sample(audio_bytes: bytes, name: str) -> dict:
    """Persist a WAV sample and return a new cloned voice record."""
    voice_id = str(uuid.uuid4())
    voice_dir = _clone_dir() / voice_id
    voice_dir.mkdir(parents=True)

    sample = voice_dir / "sample.wav"
    sample.write_bytes(audio_bytes)

    # Validate it's readable audio and get duration
    try:
        data, sr = sf.read(io.BytesIO(audio_bytes))
        duration = len(data) / sr
    except Exception as exc:
        shutil.rmtree(voice_dir)
        raise ValueError(f"Cannot read audio file: {exc}") from exc

    if duration < 5:
        shutil.rmtree(voice_dir)
        raise ValueError(f"Sample too short ({duration:.1f}s); minimum is 5 seconds.")

    import datetime
    meta = {
        "id": voice_id,
        "name": name,
        "engine": "chatterbox",
        "duration_s": round(duration, 2),
        "sample_rate": sr,
        "created_at": datetime.datetime.utcnow().isoformat() + "Z",
    }
    with open(voice_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    return meta


# ---------------------------------------------------------------------------
# Synthesis with cloned voice
# ---------------------------------------------------------------------------

def synthesize_cloned(text: str, voice_id: str) -> bytes:
    """Synthesize text using a cloned voice. Requires chatterbox-tts."""
    sample = _sample_path(voice_id)
    if not sample.exists():
        raise ValueError(f"Cloned voice not found: {voice_id}")

    model = _get_chatterbox()

    import torch
    wav_tensor = model.generate(text, audio_prompt_path=str(sample))

    if hasattr(wav_tensor, "numpy"):
        audio = wav_tensor.squeeze().numpy()
    else:
        import torchaudio
        audio = wav_tensor.squeeze().cpu().numpy()

    sample_rate = model.sr if hasattr(model, "sr") else 24000
    return _ndarray_to_wav_bytes(audio, sample_rate)
