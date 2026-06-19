import json
import zipfile

import click
import pytest
from click.testing import CliRunner

from kural import cli as cli_module
from kural import client as client_module


def test_client_sends_api_key_header_when_set(monkeypatch):
    monkeypatch.setenv("KURAL_API_KEY", "s3cret")
    assert client_module._headers() == {"X-API-Key": "s3cret"}
    monkeypatch.delenv("KURAL_API_KEY", raising=False)
    assert client_module._headers() == {}


def test_validate_host_rejects_non_http_scheme():
    with pytest.raises(click.ClickException):
        client_module.validate_host("ftp://backend/api")


def test_validate_host_accepts_loopback_and_strips_slash():
    assert client_module.validate_host("http://localhost:8000/") == "http://localhost:8000"


def test_voices_export_writes_archive(tmp_path, monkeypatch):
    def fake_export_clones(host: str, voice_ids: list[str] | None = None) -> bytes:
        assert host == "http://backend"
        assert voice_ids == ["voice-1"]
        return b"zip-bytes"

    monkeypatch.setattr(cli_module, "export_clones", fake_export_clones)
    output = tmp_path / "voices.zip"

    result = CliRunner().invoke(
        cli_module.cli,
        [
            "voices",
            "--host",
            "http://backend",
            "export",
            str(output),
            "--voice-id",
            "voice-1",
        ],
    )

    assert result.exit_code == 0
    assert output.read_bytes() == b"zip-bytes"


def test_voices_import_prints_imported_clones(tmp_path, monkeypatch):
    archive = tmp_path / "voices.zip"
    archive.write_bytes(b"zip-bytes")

    def fake_import_clones(archive_path: str, host: str):
        assert archive_path == str(archive)
        assert host == "http://backend"
        return [
            {
                "id": "voice-1",
                "name": "Portable",
                "duration_s": 5.0,
            }
        ]

    monkeypatch.setattr(cli_module, "import_clones", fake_import_clones)

    result = CliRunner().invoke(
        cli_module.cli,
        ["voices", "--host", "http://backend", "import", str(archive)],
    )

    assert result.exit_code == 0
    assert "Portable" in result.output


def test_models_lists_model_packs(monkeypatch):
    def fake_list_model_packs(host: str):
        assert host == "http://backend"
        return {
            "packs": [
                {
                    "id": "kokoro-v1-onnx",
                    "category": "tts",
                    "status": "ready",
                    "version": "1.0",
                    "license": "Apache-2.0",
                    "installed_path": "/models/kokoro",
                },
                {
                    "id": "argos-translate",
                    "category": "translation",
                    "status": "not_installed",
                    "version": "starter",
                    "license": "MIT",
                    "installed_path": "",
                },
            ],
            "jobs": [
                {
                    "kind": "model-pack:install:kokoro-v1-onnx",
                    "status": "succeeded",
                    "progress": 100,
                    "message": "done",
                }
            ],
            "total": 2,
        }

    monkeypatch.setattr(cli_module, "list_model_packs", fake_list_model_packs)

    result = CliRunner().invoke(
        cli_module.cli,
        ["models", "--host", "http://backend", "--category", "tts"],
    )

    assert result.exit_code == 0
    assert "kokoro-v1-onnx" in result.output
    assert "argos-translate" not in result.output
    assert "model-pack:install:kokoro-v1-onnx" in result.output


def test_projects_inspect_summarizes_kuralproj(tmp_path):
    archive = tmp_path / "sample.kuralproj"
    manifest = {
        "schemaVersion": 1,
        "exportedAt": "2026-06-13T00:00:00Z",
        "project": {
            "id": "project-1",
            "name": "Launch read",
            "sourceLanguage": "en-US",
            "targetLanguage": "hi-IN",
            "tags": ["beta"],
            "documents": [{"id": "doc-1"}],
            "voicePresets": [{"id": "preset-1"}],
            "pronunciationProfiles": [{"id": "pron-1"}],
            "dubbingSegments": [{"id": "dub-1"}, {"id": "dub-2"}],
        },
        "assets": [{"id": "asset-1", "path": "audio/asset-1.wav"}],
    }
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))

    result = CliRunner().invoke(cli_module.cli, ["projects", "inspect", str(archive), "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["project_name"] == "Launch read"
    assert payload["audio_assets"] == 1
    assert payload["dubbing_segments"] == 2


def test_agent_profile_reports_local_capabilities(monkeypatch):
    monkeypatch.setattr(
        cli_module,
        "get_voices",
        lambda host: [{"id": "af_bella"}],
    )
    monkeypatch.setattr(
        cli_module,
        "list_clones",
        lambda host: [{"id": "clone-1"}],
    )
    monkeypatch.setattr(
        cli_module,
        "list_model_packs",
        lambda host: {
            "packs": [
                {"id": "kokoro-v1-onnx", "category": "tts", "status": "ready"},
                {"id": "faster-whisper", "category": "asr", "status": "ready"},
            ],
            "jobs": [],
            "total": 2,
        },
    )

    result = CliRunner().invoke(
        cli_module.cli,
        ["agent", "profile", "--host", "http://backend", "--json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["capabilities"]["tts"] is True
    assert payload["capabilities"]["asr"] is True
    assert payload["capabilities"]["voice_clone_create"] == "human-consent-required"
