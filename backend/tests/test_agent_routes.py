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
    assert "open_clone_studio" in payload["tool_plan"]
