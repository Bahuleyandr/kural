import io
import uuid

import numpy as np
import pytest
import soundfile as sf

from app.config import settings
from app.tts.chatterbox_engine import (
    delete_cloned_voice,
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
