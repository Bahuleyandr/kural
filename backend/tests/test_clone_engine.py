import io
import json
import uuid
import zipfile

import numpy as np
import pytest
import soundfile as sf

from app.config import settings
from app.tts.chatterbox_engine import (
    delete_cloned_voice,
    export_cloned_voices,
    import_voice_archive,
    list_cloned_voices,
    save_voice_sample,
    synthesize_cloned,
)


@pytest.fixture(autouse=True)
def clone_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "clone_cache_dir", str(tmp_path))
    monkeypatch.setattr(settings, "clone_min_duration_s", 5.0)
    monkeypatch.setattr(settings, "clone_max_duration_s", 30.0)
    yield tmp_path


def wav_bytes(duration_s: float, sample_rate: int = 8000) -> bytes:
    samples = np.zeros(int(duration_s * sample_rate), dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def test_save_list_and_delete_clone():
    meta = save_voice_sample(wav_bytes(5.0), "  Test voice  ", consent_confirmed=True)

    assert uuid.UUID(meta["id"])
    assert meta["name"] == "Test voice"
    assert meta["duration_s"] == 5.0
    assert meta["consent_confirmed"] is True
    assert meta["watermark"] == "kural-voice-clone-consent-v1"
    assert list_cloned_voices()[0]["id"] == meta["id"]
    assert delete_cloned_voice(meta["id"]) is True
    assert list_cloned_voices() == []


@pytest.mark.parametrize("bad_id", [".", "..", "../outside", "not-a-uuid"])
def test_clone_ids_are_uuid_only(bad_id):
    with pytest.raises(ValueError):
        delete_cloned_voice(bad_id)

    with pytest.raises(ValueError):
        synthesize_cloned("hello", bad_id)


def test_rejects_blank_voice_name():
    with pytest.raises(ValueError, match="blank"):
        save_voice_sample(wav_bytes(5.0), "   ")


def test_rejects_short_and_long_samples():
    with pytest.raises(ValueError, match="too short"):
        save_voice_sample(wav_bytes(4.9), "Too short")

    with pytest.raises(ValueError, match="too long"):
        save_voice_sample(wav_bytes(30.1), "Too long")


def test_export_import_clone_archive_roundtrip():
    meta = save_voice_sample(wav_bytes(5.0), "Portable voice", consent_confirmed=True)
    archive = export_cloned_voices([meta["id"]])

    assert delete_cloned_voice(meta["id"]) is True

    imported = import_voice_archive(archive)

    assert len(imported) == 1
    assert imported[0]["id"] == meta["id"]
    assert imported[0]["name"] == "Portable voice"
    assert imported[0]["consent_confirmed"] is True
    assert imported[0]["watermark"] == "kural-voice-clone-consent-v1"
    assert list_cloned_voices()[0]["id"] == meta["id"]


def test_import_clone_archive_dedupes_id_and_name():
    meta = save_voice_sample(wav_bytes(5.0), "Portable voice", consent_confirmed=True)
    archive = export_cloned_voices([meta["id"]])

    imported = import_voice_archive(archive)

    assert len(imported) == 1
    assert imported[0]["id"] != meta["id"]
    assert imported[0]["name"] == "Portable voice (imported)"
    assert len(list_cloned_voices()) == 2


def test_import_clone_archive_rejects_path_traversal():
    voice_id = str(uuid.uuid4())
    manifest = {
        "schema_version": "kural.voice-archive.v1",
        "voices": [
            {
                "id": voice_id,
                "name": "Bad path",
                "sample_path": "../sample.wav",
            }
        ],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("../sample.wav", wav_bytes(5.0))

    with pytest.raises(ValueError, match="Unsafe archive path"):
        import_voice_archive(buf.getvalue())


def test_import_rejects_oversized_manifest(monkeypatch):
    from app.tts.chatterbox_engine import archive as archive_mod

    monkeypatch.setattr(archive_mod, "_ARCHIVE_MAX_MANIFEST_BYTES", 8)
    meta = save_voice_sample(wav_bytes(5.0), "Big manifest", consent_confirmed=True)
    archive = export_cloned_voices([meta["id"]])
    delete_cloned_voice(meta["id"])

    with pytest.raises(ValueError, match="too large"):
        import_voice_archive(archive)


def test_import_writes_consent_ledger_entry(monkeypatch, tmp_path):
    consent_log = tmp_path / "consent.log"
    monkeypatch.setattr(settings, "consent_log_path", str(consent_log))

    meta = save_voice_sample(wav_bytes(5.0), "Ledger voice", consent_confirmed=True)
    archive = export_cloned_voices([meta["id"]])
    delete_cloned_voice(meta["id"])

    import_voice_archive(archive)

    entries = [json.loads(line) for line in consent_log.read_text(encoding="utf-8").splitlines() if line]
    imported_entries = [e for e in entries if e.get("source") == "archive-import"]
    assert imported_entries, "import must leave a consent-ledger entry"
    assert imported_entries[0]["consent_confirmed"] is True
