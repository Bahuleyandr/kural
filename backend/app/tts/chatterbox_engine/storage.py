"""Cloned-voice storage primitives — paths, metadata, sample I/O."""
from __future__ import annotations

import datetime
import hashlib
import io
import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

import soundfile as sf

from ...config import settings

_CLONE_NAME_MAX = 100
_CONSENT_WATERMARK = "kural-voice-clone-consent-v1"
_ALLOWED_USES = {"personal", "commercial", "parody", "internal", "restricted"}
_CLONE_TIERS = {"quick", "professional"}


def _clone_dir() -> Path:
    d = Path(settings.clone_cache_dir).expanduser().resolve()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _voice_dir(voice_id: str) -> Path:
    try:
        normalized_id = str(uuid.UUID(voice_id))
    except ValueError as exc:
        raise ValueError(f"Invalid cloned voice ID: {voice_id}") from exc

    base = _clone_dir()
    path = (base / normalized_id).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise ValueError(f"Invalid cloned voice path: {voice_id}") from exc
    return path


def _meta_path(voice_id: str) -> Path:
    return _voice_dir(voice_id) / "meta.json"


def _sample_path(voice_id: str) -> Path:
    return _voice_dir(voice_id) / "sample.wav"


def _utc_now() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")


def _existing_clone_ids() -> set[str]:
    ids: set[str] = set()
    for child in _clone_dir().iterdir():
        if not child.is_dir():
            continue
        try:
            ids.add(str(uuid.UUID(child.name)))
        except ValueError:
            continue
    return ids


def _dedupe_name(name: object, existing_names: set[str]) -> str:
    base = str(name or "").strip()
    if not base:
        raise ValueError("Imported voice name cannot be blank.")
    base = base[:_CLONE_NAME_MAX]
    if base.casefold() not in existing_names:
        existing_names.add(base.casefold())
        return base

    stem = base
    for index in range(2, 1000):
        suffix = " (imported)" if index == 2 else f" (imported {index})"
        candidate = f"{stem[: _CLONE_NAME_MAX - len(suffix)]}{suffix}"
        if candidate.casefold() not in existing_names:
            existing_names.add(candidate.casefold())
            return candidate
    raise ValueError(f"Could not create a unique name for imported voice: {base}")


def _read_sample_info(audio_bytes: bytes) -> tuple[float, int]:
    try:
        data, sr = sf.read(io.BytesIO(audio_bytes))
        duration = len(data) / sr
    except Exception as exc:
        raise ValueError(f"Cannot read audio file: {exc}") from exc

    if duration < settings.clone_min_duration_s:
        raise ValueError(
            f"Sample too short ({duration:.1f}s); minimum is "
            f"{settings.clone_min_duration_s:.0f} seconds."
        )

    if duration > settings.clone_max_duration_s:
        raise ValueError(
            f"Sample too long ({duration:.1f}s); maximum is "
            f"{settings.clone_max_duration_s:.0f} seconds."
        )

    return round(duration, 2), sr


def _write_clone_record(meta: dict, sample_bytes: bytes) -> dict:
    voice_dir = _voice_dir(meta["id"])
    if voice_dir.exists():
        raise ValueError(f"Cloned voice already exists: {meta['id']}")

    voice_dir.mkdir(parents=False)
    try:
        (voice_dir / "sample.wav").write_bytes(sample_bytes)
        with open(voice_dir / "meta.json", "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
    except Exception:
        shutil.rmtree(voice_dir, ignore_errors=True)
        raise
    return meta


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_cloned_voices() -> list[dict]:
    clones = []
    for meta_file in _clone_dir().glob("*/meta.json"):
        try:
            _voice_dir(meta_file.parent.name)
            with open(meta_file, encoding="utf-8") as f:
                clones.append(json.load(f))
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    return sorted(clones, key=lambda v: v.get("created_at", ""))


def get_clone_meta(voice_id: str) -> Optional[dict]:
    path = _meta_path(voice_id)
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def delete_cloned_voice(voice_id: str) -> bool:
    voice_dir = _voice_dir(voice_id)
    if not voice_dir.exists():
        return False
    shutil.rmtree(voice_dir)
    return True


def save_voice_sample(
    audio_bytes: bytes,
    name: str,
    consent_confirmed: bool = False,
    language: str | None = None,
    allowed_uses: list[str] | None = None,
    clone_tier: str = "quick",
    quality_score: int | None = None,
) -> dict:
    """Persist a WAV sample and return a new cloned voice record."""
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Voice name cannot be blank.")
    clean_uses = [use for use in (allowed_uses or ["personal"]) if use in _ALLOWED_USES]
    if not clean_uses:
        clean_uses = ["personal"]
    clean_tier = clone_tier if clone_tier in _CLONE_TIERS else "quick"
    clean_quality = None
    if quality_score is not None:
        clean_quality = max(0, min(100, int(quality_score)))

    duration, sr = _read_sample_info(audio_bytes)
    voice_id = str(uuid.uuid4())
    meta = {
        "id": voice_id,
        "name": clean_name,
        "engine": "chatterbox",
        "duration_s": duration,
        "sample_rate": sr,
        "created_at": _utc_now(),
        "consent_confirmed": consent_confirmed,
        "watermark": _CONSENT_WATERMARK if consent_confirmed else None,
        "language": language,
        "locale": language,
        "capabilities": ["voice-clone", "wav", "advanced-controls"],
        "sample_sha256": hashlib.sha256(audio_bytes).hexdigest(),
        "allowed_uses": clean_uses,
        "clone_tier": clean_tier,
        "quality_score": clean_quality,
    }
    return _write_clone_record(meta, audio_bytes)
