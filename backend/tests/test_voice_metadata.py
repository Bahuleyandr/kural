from fastapi.testclient import TestClient

from app.main import app


def test_voices_include_multilingual_readiness_metadata():
    res = TestClient(app).get("/api/voices")

    assert res.status_code == 200
    voice = res.json()["voices"][0]
    assert voice["locale"]
    assert voice["engine"] == "kokoro"
    assert "advanced-controls" in voice["capabilities"]


def test_voices_includes_supertonic_engine():
    res = TestClient(app).get("/api/voices")

    assert res.status_code == 200
    engines = {v["engine"] for v in res.json()["voices"]}
    assert {"kokoro", "supertonic"} <= engines


def test_voices_supertonic_entries_cover_curated_languages():
    res = TestClient(app).get("/api/voices")
    supertonic = [v for v in res.json()["voices"] if v["engine"] == "supertonic"]

    assert supertonic, "expected at least one Supertonic voice"
    langs = {v["language"] for v in supertonic}
    # Hindi coverage is the headline win versus the Kokoro-only baseline.
    assert "hi" in langs
    assert "en" in langs
