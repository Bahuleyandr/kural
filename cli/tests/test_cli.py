from click.testing import CliRunner

from kural import cli as cli_module


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
