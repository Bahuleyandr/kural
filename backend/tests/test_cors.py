import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.parametrize(
    "origin",
    ["http://tauri.localhost", "https://tauri.localhost"],
)
def test_tauri_desktop_origin_is_allowed_for_api_requests(origin: str):
    res = TestClient(app).options(
        "/api/voices",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == origin
