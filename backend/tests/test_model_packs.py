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
    kokoro = next(pack for pack in payload["packs"] if pack["id"] == "kokoro-v1-onnx")
    assert kokoro["recommended"] is True
    assert kokoro["trust_level"] == "built_in"
    assert kokoro["manifest_digest"].startswith("sha256:")
    assert kokoro["quality_score"] >= 80
    assert kokoro["latency_tier"] == "interactive"
    assert "default-tts" in kokoro["routing_hints"]
    assert all(pack["manifest_digest"].startswith("sha256:") for pack in payload["packs"])
    assert payload["total"] == len(payload["packs"])


def test_model_pack_benchmarks_and_recommendation_are_available():
    client = TestClient(app)
    bench_res = client.get("/api/model-packs/benchmarks")

    assert bench_res.status_code == 200
    benchmarks = bench_res.json()["benchmarks"]
    assert benchmarks
    assert all(item["latency_ms_estimate"] >= 0 for item in benchmarks)
    assert all(item["memory_mb_estimate"] >= 0 for item in benchmarks)

    rec_res = client.get("/api/model-packs/recommend?language=en-US&capability=tts")
    assert rec_res.status_code == 200
    payload = rec_res.json()
    assert payload["pack"]["category"] == "tts"
    assert "best local score" in payload["reason"]


def test_model_pack_benchmark_run_ranks_candidates():
    res = TestClient(app).post(
        "/api/model-packs/benchmarks/run",
        json={
            "language": "en-US",
            "capability": "tts",
            "use_case": "dubbing",
            "sample_scripts": ["This translated line should fit the original timing."],
        },
    )

    assert res.status_code == 200
    payload = res.json()
    assert payload["language"] == "en-US"
    assert payload["sample_scripts"]
    assert payload["results"]
    assert payload["results"][0]["route_rank"] == 1
    assert payload["results"][0]["score"] >= 0
    assert payload["recommendation"]["capability"] == "tts"


def test_marketplace_manifest_validation_blocks_unsigned_voice_pack():
    res = TestClient(app).post(
        "/api/marketplace/validate",
        json={
            "id": "community-demo",
            "name": "Community Demo",
            "version": "1.0.0",
            "pack_type": "voice",
            "category": "tts",
            "provider": "community",
            "checksum": "sha256:" + "1" * 64,
            "license": "creator-specified",
            "languages": ["en-US"],
            "capabilities": ["voice-clone", "wav"],
            "allowed_uses": ["personal"],
            "consent_proof": "signed consent record",
            "sample_sha256": "sha256:" + "2" * 64,
            "provenance_required": True,
            "watermark_required": True,
            "compatibility": {"cpu": "x64", "gpu": False, "ram_mb": 4096},
        },
    )

    assert res.status_code == 200
    payload = res.json()
    assert payload["accepted"] is True
    assert payload["installable"] is False
    assert payload["trust_level"] == "review_required"
    assert any(issue["code"] == "signature_missing" for issue in payload["warnings"])


def test_marketplace_manifest_requires_voice_consent_and_hash():
    res = TestClient(app).post(
        "/api/marketplace/validate",
        json={
            "id": "bad-voice",
            "name": "Bad Voice",
            "version": "1",
            "pack_type": "voice",
            "checksum": "sha256:" + "1" * 64,
            "license": "unknown",
        },
    )

    assert res.status_code == 200
    payload = res.json()
    assert payload["accepted"] is False
    assert payload["trust_level"] == "blocked"
    codes = {issue["code"] for issue in payload["errors"]}
    assert {"consent_proof_required", "sample_hash_required", "allowed_uses_required"}.issubset(codes)


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
