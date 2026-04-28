from fastapi.testclient import TestClient

from app.main import app


def test_voices_include_multilingual_readiness_metadata():
    res = TestClient(app).get("/api/voices")

    assert res.status_code == 200
    voice = res.json()["voices"][0]
    assert voice["locale"]
    assert voice["engine"] == "kokoro"
    assert "advanced-controls" in voice["capabilities"]
