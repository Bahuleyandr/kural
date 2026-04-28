from fastapi.testclient import TestClient

from app.main import app
from app.routers import synthesize as synthesize_router


def test_synthesize_returns_structured_validation_error(monkeypatch):
    def fail(*_args, **_kwargs):
        raise ValueError("bad voice")

    monkeypatch.setattr(synthesize_router, "synthesize", fail)

    res = TestClient(app).post(
        "/api/synthesize",
        json={"text": "hello", "voice": "missing", "format": "wav"},
    )

    assert res.status_code == 422
    assert res.json()["detail"] == {
        "code": "invalid_synthesis_request",
        "message": "bad voice",
    }


def test_synthesize_reports_missing_models(monkeypatch):
    def fail(*_args, **_kwargs):
        raise RuntimeError("Kokoro model files not found")

    monkeypatch.setattr(synthesize_router, "synthesize", fail)

    res = TestClient(app).post(
        "/api/synthesize",
        json={"text": "hello", "voice": "af_bella", "format": "wav"},
    )

    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "tts_unavailable"
