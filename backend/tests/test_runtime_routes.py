from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_runtime_health_checks_are_structured(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "model_pack_root", str(tmp_path / "models"))
    monkeypatch.setattr(settings, "model_cache_dir", str(tmp_path / "kokoro"))
    monkeypatch.setattr(settings, "clone_cache_dir", str(tmp_path / "clones"))

    res = TestClient(app).get("/api/runtime/health-checks")

    assert res.status_code == 200
    payload = res.json()
    assert payload["status"] in {"ready", "needs_setup", "error"}
    ids = {check["id"] for check in payload["checks"]}
    assert {"kokoro-models", "clone-storage", "ffmpeg", "lip-sync"}.issubset(ids)
    assert "model_pack_root" in payload["storage"]


def test_lip_sync_status_reports_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "lip_sync_binary", "")

    res = TestClient(app).get("/api/lip-sync/status")

    assert res.status_code == 200
    payload = res.json()
    assert payload["available"] is False
    assert payload["safe_action"] == "configure_lip_sync_binary"


def test_runtime_repair_creates_clone_storage(tmp_path, monkeypatch):
    clone_root = tmp_path / "clones"
    monkeypatch.setattr(settings, "clone_cache_dir", str(clone_root))
    monkeypatch.setattr(settings, "model_pack_root", str(tmp_path / "models"))
    monkeypatch.setattr(settings, "model_cache_dir", str(tmp_path / "kokoro"))

    res = TestClient(app).post(
        "/api/runtime/repair",
        json={"action": "create_clone_folder"},
    )

    assert res.status_code == 202
    payload = res.json()
    assert payload["status"] == "complete"
    assert clone_root.exists()
    clone_check = next(check for check in payload["runtime"]["checks"] if check["id"] == "clone-storage")
    assert clone_check["status"] == "ready"
    assert clone_check["repair_action"] is None


def test_runtime_repair_rejects_manual_ffmpeg_install():
    res = TestClient(app).post(
        "/api/runtime/repair",
        json={"action": "install_ffmpeg"},
    )

    assert res.status_code == 409
    payload = res.json()
    assert payload["detail"]["code"] == "manual_repair_required"
    assert "trusted source" in payload["detail"]["message"]


def test_runtime_repair_rejects_unsafe_clone_storage(monkeypatch):
    monkeypatch.setattr(settings, "clone_cache_dir", "/")

    res = TestClient(app).post(
        "/api/runtime/repair",
        json={"action": "create_clone_folder"},
    )

    assert res.status_code == 400
    payload = res.json()
    assert payload["detail"]["code"] == "unsafe_repair_path"


def test_provenance_sidecar_shape():
    res = TestClient(app).post(
        "/api/provenance/sidecar",
        json={
            "project_id": "project-1",
            "project_name": "Launch",
            "asset_name": "launch.wav",
            "voice_label": "Bella",
            "language": "en-US",
            "text_sha256": "sha256:" + "a" * 64,
            "export_format": "wav",
            "watermark_enabled": True,
            "segments": [{"id": "seg-1", "start_ms": 0, "end_ms": 1200}],
        },
    )

    assert res.status_code == 200
    payload = res.json()
    assert payload["kind"] == "kural-synthetic-audio-provenance"
    assert payload["local_only"] is True
    assert payload["payload"]["project"]["id"] == "project-1"
    assert payload["payload"]["watermark"]["enabled"] is True
