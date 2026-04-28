"""Chatterbox TTS engine — voice cloning from audio samples (MIT license)."""
import datetime
import io
import json
import shutil
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Iterable, Optional

import numpy as np
import soundfile as sf

from ..config import settings

_chatterbox_instance = None
_ARCHIVE_SCHEMA = "kural.voice-archive.v1"
_ARCHIVE_MANIFEST = "manifest.json"
_ARCHIVE_MAX_VOICES = 200
_CLONE_NAME_MAX = 100
_CONSENT_WATERMARK = "kural-voice-clone-consent-v1"


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


def _validate_archive_path(name: str) -> str:
    if not name or "\\" in name or name.startswith("/") or "//" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    path = PurePosixPath(name)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"Unsafe archive path: {name}")
    return path.as_posix()


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
) -> dict:
    """Persist a WAV sample and return a new cloned voice record."""
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Voice name cannot be blank.")

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
    }
    return _write_clone_record(meta, audio_bytes)


def export_cloned_voices(voice_ids: Iterable[str] | None = None) -> bytes:
    """Export cloned voices as a portable Kural zip archive."""
    if voice_ids:
        clones: list[dict] = []
        for voice_id in voice_ids:
            meta = get_clone_meta(voice_id)
            if meta is None:
                raise ValueError(f"Cloned voice not found: {voice_id}")
            clones.append(meta)
    else:
        clones = list_cloned_voices()

    manifest_voices: list[dict] = []
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for meta in clones:
            voice_id = str(uuid.UUID(meta["id"]))
            sample = _sample_path(voice_id)
            if not sample.exists():
                raise ValueError(f"Missing sample for cloned voice: {voice_id}")

            sample_path = f"voices/{voice_id}/sample.wav"
            exported_meta = {
                "id": voice_id,
                "name": meta.get("name", ""),
                "engine": meta.get("engine", "chatterbox"),
                "duration_s": meta.get("duration_s"),
                "sample_rate": meta.get("sample_rate"),
                "created_at": meta.get("created_at"),
                "consent_confirmed": bool(meta.get("consent_confirmed", False)),
                "watermark": meta.get("watermark"),
                "language": meta.get("language"),
                "locale": meta.get("locale") or meta.get("language"),
                "capabilities": meta.get("capabilities", ["voice-clone", "wav"]),
                "sample_path": sample_path,
            }
            manifest_voices.append(exported_meta)
            archive.write(sample, sample_path)

        manifest = {
            "schema_version": _ARCHIVE_SCHEMA,
            "exported_at": _utc_now(),
            "voices": manifest_voices,
        }
        archive.writestr(_ARCHIVE_MANIFEST, json.dumps(manifest, indent=2))

    return output.getvalue()


def import_voice_archive(archive_bytes: bytes) -> list[dict]:
    """Import cloned voices from a Kural zip archive."""
    try:
        archive = zipfile.ZipFile(io.BytesIO(archive_bytes))
    except zipfile.BadZipFile as exc:
        raise ValueError("Voice archive is not a valid zip file.") from exc

    with archive:
        entries: dict[str, zipfile.ZipInfo] = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            safe_name = _validate_archive_path(info.filename)
            if safe_name in entries:
                raise ValueError(f"Duplicate archive entry: {safe_name}")
            entries[safe_name] = info

        if _ARCHIVE_MANIFEST not in entries:
            raise ValueError("Voice archive is missing manifest.json.")

        try:
            manifest = json.loads(archive.read(entries[_ARCHIVE_MANIFEST]))
        except json.JSONDecodeError as exc:
            raise ValueError("Voice archive manifest is not valid JSON.") from exc

        if manifest.get("schema_version") != _ARCHIVE_SCHEMA:
            raise ValueError("Voice archive schema version is not supported.")

        voices = manifest.get("voices")
        if not isinstance(voices, list):
            raise ValueError("Voice archive manifest must contain a voices list.")
        if len(voices) > _ARCHIVE_MAX_VOICES:
            raise ValueError(f"Voice archive contains more than {_ARCHIVE_MAX_VOICES} voices.")

        existing_ids = _existing_clone_ids()
        existing_names = {
            str(meta.get("name", "")).casefold()
            for meta in list_cloned_voices()
            if meta.get("name")
        }
        imported: list[dict] = []
        written_ids: list[str] = []

        try:
            for raw_meta in voices:
                if not isinstance(raw_meta, dict):
                    raise ValueError("Voice archive manifest contains an invalid voice entry.")

                try:
                    original_id = str(uuid.UUID(str(raw_meta.get("id"))))
                except ValueError as exc:
                    raise ValueError("Voice archive contains an invalid voice ID.") from exc

                sample_path = _validate_archive_path(str(raw_meta.get("sample_path", "")))
                if sample_path not in entries:
                    raise ValueError(f"Voice archive is missing sample: {sample_path}")

                sample_info = entries[sample_path]
                max_sample_bytes = settings.clone_max_upload_mb * 1024 * 1024
                if sample_info.file_size > max_sample_bytes:
                    raise ValueError(
                        f"Imported sample for {original_id} exceeds "
                        f"{settings.clone_max_upload_mb} MB."
                    )

                sample_bytes = archive.read(sample_info)
                duration, sr = _read_sample_info(sample_bytes)

                imported_id = original_id
                if imported_id in existing_ids or _voice_dir(imported_id).exists():
                    imported_id = str(uuid.uuid4())
                existing_ids.add(imported_id)

                name = _dedupe_name(raw_meta.get("name"), existing_names)
                consent_confirmed = bool(raw_meta.get("consent_confirmed", False))
                watermark = raw_meta.get("watermark")
                if consent_confirmed and not watermark:
                    watermark = _CONSENT_WATERMARK
                if not isinstance(watermark, str):
                    watermark = None
                created_at = raw_meta.get("created_at")
                if not isinstance(created_at, str) or not created_at.strip():
                    created_at = _utc_now()

                meta = {
                    "id": imported_id,
                    "name": name,
                    "engine": "chatterbox",
                    "duration_s": duration,
                    "sample_rate": sr,
                    "created_at": created_at,
                    "consent_confirmed": consent_confirmed,
                    "watermark": watermark,
                    "language": raw_meta.get("language") if isinstance(raw_meta.get("language"), str) else None,
                    "locale": raw_meta.get("locale") if isinstance(raw_meta.get("locale"), str) else None,
                    "capabilities": raw_meta.get("capabilities")
                    if isinstance(raw_meta.get("capabilities"), list)
                    else ["voice-clone", "wav", "advanced-controls"],
                }
                imported.append(_write_clone_record(meta, sample_bytes))
                written_ids.append(imported_id)
        except Exception:
            for voice_id in written_ids:
                shutil.rmtree(_voice_dir(voice_id), ignore_errors=True)
            raise

    return imported


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
