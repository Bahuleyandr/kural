import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture(autouse=True)
def clone_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "clone_cache_dir", str(tmp_path))
    monkeypatch.setattr(settings, "clone_min_duration_s", 5.0)
    monkeypatch.setattr(settings, "clone_max_duration_s", 30.0)
    monkeypatch.setattr(settings, "clone_max_upload_mb", 25)


@pytest.fixture()
def client():
    return TestClient(app)


def wav_bytes(duration_s: float = 5.0, sample_rate: int = 8000) -> bytes:
    samples = np.zeros(int(duration_s * sample_rate), dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def test_clone_upload_roundtrip(client):
    res = client.post(
        "/api/voices/clone",
        data={"name": "Route voice", "language": "en-US", "consent_confirmed": "true"},
        files={"file": ("voice.wav", wav_bytes(), "audio/wav")},
    )

    assert res.status_code == 201
    clone_id = res.json()["id"]
    assert res.json()["language"] == "en-US"
    assert "voice-clone" in res.json()["capabilities"]

    list_res = client.get("/api/voices/clones")
    assert list_res.status_code == 200
    assert list_res.json()["total"] == 1
    assert list_res.json()["clones"][0]["id"] == clone_id

    delete_res = client.delete(f"/api/voices/clones/{clone_id}")
    assert delete_res.status_code == 204
    assert client.get("/api/voices/clones").json()["total"] == 0


def test_clone_upload_rejects_bad_mime(client):
    res = client.post(
        "/api/voices/clone",
        data={"name": "Nope", "consent_confirmed": "true"},
        files={"file": ("voice.txt", b"hello", "text/plain")},
    )

    assert res.status_code == 415
    assert res.json()["detail"]["code"] == "unsupported_audio_type"


def test_clone_upload_rejects_blank_name(client):
    res = client.post(
        "/api/voices/clone",
        data={"name": "   "},
        files={"file": ("voice.wav", wav_bytes(), "audio/wav")},
    )

    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "blank_voice_name"


def test_clone_upload_rejects_oversize(client, monkeypatch):
    monkeypatch.setattr(settings, "clone_max_upload_mb", 0)
    res = client.post(
        "/api/voices/clone",
        data={"name": "Too large", "consent_confirmed": "true"},
        files={"file": ("voice.wav", wav_bytes(), "audio/wav")},
    )

    assert res.status_code == 413
    assert res.json()["detail"]["code"] == "upload_too_large"


def test_delete_rejects_invalid_id(client):
    res = client.delete("/api/voices/clones/not-a-uuid")

    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "invalid_voice_id"


def test_clone_upload_requires_consent(client):
    res = client.post(
        "/api/voices/clone",
        data={"name": "No consent"},
        files={"file": ("voice.wav", wav_bytes(), "audio/wav")},
    )

    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "voice_consent_required"


def test_clone_export_import_routes(client):
    created = client.post(
        "/api/voices/clone",
        data={"name": "Portable route", "consent_confirmed": "true"},
        files={"file": ("voice.wav", wav_bytes(), "audio/wav")},
    ).json()

    export_res = client.get(f"/api/voices/clones/export?voice_id={created['id']}")
    assert export_res.status_code == 200
    assert export_res.headers["content-type"] == "application/zip"

    client.delete(f"/api/voices/clones/{created['id']}")
    import_res = client.post(
        "/api/voices/clones/import",
        files={
            "file": (
                "voices.zip",
                export_res.content,
                "application/zip",
            )
        },
    )

    assert import_res.status_code == 200
    assert import_res.json()["total"] == 1
    assert import_res.json()["imported"][0]["name"] == "Portable route"


def test_clone_import_rejects_non_zip(client):
    res = client.post(
        "/api/voices/clones/import",
        files={"file": ("voices.zip", b"not a zip", "application/zip")},
    )

    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "invalid_voice_archive"
