from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.local_models.translation import LocalModelUnavailable
from app.main import app
from app.routers import local_models as local_models_router


def test_local_models_inventory_lists_optional_adapters():
    res = TestClient(app).get("/api/local-models")

    assert res.status_code == 200
    payload = res.json()
    providers = {model["provider"] for model in payload["models"]}
    assert {"kokoro", "faster-whisper", "vosk", "argos"}.issubset(providers)


def test_translate_returns_structured_unavailable_error(monkeypatch):
    def fail(_req):
        raise LocalModelUnavailable("No Argos packages")

    monkeypatch.setattr(local_models_router, "translate_text", fail)

    res = TestClient(app).post(
        "/api/translate",
        json={
            "text": "Hello",
            "source_language": "en-US",
            "target_language": "hi-IN",
        },
    )

    assert res.status_code == 503
    assert res.json()["detail"] == {
        "code": "local_translation_unavailable",
        "message": "No Argos packages",
    }


def test_translate_returns_local_provider(monkeypatch):
    def translate(req):
        return f"{req.text} translated", "argos"

    monkeypatch.setattr(local_models_router, "translate_text", translate)

    res = TestClient(app).post(
        "/api/translate",
        json={
            "text": "Hello",
            "source_language": "en-US",
            "target_language": "es-ES",
        },
    )

    assert res.status_code == 200
    assert res.json() == {
        "text": "Hello translated",
        "source_language": "en-US",
        "target_language": "es-ES",
        "provider": "argos",
    }


def test_transcribe_rejects_empty_upload():
    res = TestClient(app).post(
        "/api/transcribe",
        files={"file": ("empty.wav", b"", "audio/wav")},
    )

    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "empty_upload"


def test_transcribe_returns_segments(monkeypatch):
    def transcribe(*_args, **_kwargs):
        return SimpleNamespace(
            text="hello world",
            provider="faster-whisper",
            language="en",
            segments=[SimpleNamespace(start_ms=100, end_ms=900, text="hello world")],
        )

    monkeypatch.setattr(local_models_router, "transcribe_audio", transcribe)

    res = TestClient(app).post(
        "/api/transcribe",
        files={"file": ("clip.wav", b"RIFFdata", "audio/wav")},
        data={"language": "en-US"},
    )

    assert res.status_code == 200
    assert res.json() == {
        "text": "hello world",
        "language": "en",
        "provider": "faster-whisper",
        "segments": [{"start_ms": 100, "end_ms": 900, "text": "hello world"}],
    }
