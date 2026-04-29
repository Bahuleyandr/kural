"""Voice-archive (.kural) export and import."""
from __future__ import annotations

import io
import json
import shutil
import uuid
import zipfile
from pathlib import PurePosixPath
from typing import Iterable

from ...config import settings
from .storage import (
    _CONSENT_WATERMARK,
    _dedupe_name,
    _existing_clone_ids,
    _read_sample_info,
    _sample_path,
    _utc_now,
    _voice_dir,
    _write_clone_record,
    get_clone_meta,
    list_cloned_voices,
)

_ARCHIVE_SCHEMA = "kural.voice-archive.v1"
_ARCHIVE_MANIFEST = "manifest.json"
_ARCHIVE_MAX_VOICES = 200


def _validate_archive_path(name: str) -> str:
    if not name or "\\" in name or name.startswith("/") or "//" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    path = PurePosixPath(name)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"Unsafe archive path: {name}")
    return path.as_posix()


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
