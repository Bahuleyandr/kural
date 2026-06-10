from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.local_models import model_packs
from app.local_models.model_packs import ModelPackError
from app.main import app


@pytest.fixture(autouse=True)
def _reset_model_pack_jobs():
    with model_packs._lock:
        model_packs._jobs.clear()
        model_packs._processes.clear()
        model_packs._canceled.clear()


def test_model_pack_inventory_lists_public_beta_packs():
    res = TestClient(app).get("/api/model-packs")

    assert res.status_code == 200
    payload = res.json()
    ids = {pack["id"] for pack in payload["packs"]}
    assert {
        "kokoro-v1-onnx",
        "supertonic-3-onnx",
        "chatterbox-local",
        "faster-whisper",
        "vosk",
        "argos-translate",
        "indictrans2",
    }.issubset(ids)
    assert payload["total"] == len(payload["packs"])


def test_model_pack_unknown_pack_returns_structured_404():
    res = TestClient(app).post("/api/model-packs/nope/install")

    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "model_pack_not_found"


def test_model_pack_manual_runtime_remove_is_rejected():
    res = TestClient(app).delete("/api/model-packs/chatterbox-local")

    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "model_pack_action_unavailable"


def test_validate_checksum_reports_mismatch(tmp_path):
    payload = tmp_path / "model.bin"
    payload.write_bytes(b"not-the-model")

    with pytest.raises(ModelPackError, match="Checksum mismatch"):
        model_packs.validate_checksum(payload, "sha256:" + "0" * 64)


def test_safe_delete_rejects_paths_outside_model_roots(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "model_pack_root", str(tmp_path / "root"))
    outside = tmp_path / "outside"
    outside.mkdir()

    with pytest.raises(ModelPackError, match="outside Kural model roots"):
        model_packs._assert_safe_delete_target(outside)


def test_cancel_queued_model_pack_job(monkeypatch):
    submitted: list[tuple] = []

    def fake_submit(*args):
        submitted.append(args)
        return None

    monkeypatch.setattr(model_packs._executor, "submit", fake_submit)

    job = model_packs.start_model_pack_job("kokoro-v1-onnx", "install")
    canceled = model_packs.cancel_model_pack_job(job.id)

    assert submitted
    assert canceled.status == "canceled"
    assert canceled.progress == 100


def test_safe_delete_allows_configured_model_child(tmp_path, monkeypatch):
    root = tmp_path / "root"
    target = root / "kokoro"
    target.mkdir(parents=True)
    monkeypatch.setattr(settings, "model_pack_root", str(root))
    monkeypatch.setattr(settings, "model_cache_dir", str(target))

    model_packs._assert_safe_delete_target(target)
    model_packs._assert_safe_delete_target(Path(target / "nested"))
