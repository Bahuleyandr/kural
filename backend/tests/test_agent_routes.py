from fastapi.testclient import TestClient

from app.main import app


def test_agent_response_is_local_and_structured():
    res = TestClient(app).post(
        "/api/agent/respond",
        json={
            "message": "Help me clone a voice sample",
            "project_language": "en-US",
            "tool_context": ["clone-studio"],
        },
    )

    assert res.status_code == 200
    payload = res.json()
    assert payload["intent"] == "clone"
    assert payload["local_only"] is True
    assert payload["interruptible"] is True
    assert payload["llm_provider"] == "deterministic"
    assert "open_clone_studio" in payload["tool_plan"]


def test_agent_ollama_request_falls_back_to_deterministic(monkeypatch):
    monkeypatch.setattr("app.config.settings.ollama_url", "http://127.0.0.1:9")

    res = TestClient(app).post(
        "/api/agent/respond",
        json={
            "message": "Say hello",
            "use_llm": True,
            "llm_provider": "ollama",
            "llm_model": "missing-local-model",
        },
    )

    assert res.status_code == 200
    payload = res.json()
    assert payload["llm_provider"] == "deterministic"
    assert payload["local_only"] is True
