"""Guards on the bundled model-download script.

The script lives in backend/scripts (not the importable app package), so it is
loaded by path. These tests stop the pinned digests from silently regressing to
empty — which would turn integrity verification back off.
"""
import importlib.util
import re
from pathlib import Path


def _load_download_models():
    path = Path(__file__).resolve().parents[1] / "scripts" / "download_models.py"
    spec = importlib.util.spec_from_file_location("kural_download_models", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_pinned_kokoro_digests_are_well_formed():
    module = _load_download_models()
    assert set(module._PINNED_SHA256) == {"kokoro-v1.0.int8.onnx", "voices-v1.0.bin"}
    for name, digest in module._PINNED_SHA256.items():
        assert re.fullmatch(r"[0-9a-f]{64}", digest), f"{name} pin must be 64 lowercase hex chars"


def test_verification_is_on_by_default(monkeypatch):
    monkeypatch.delenv("KURAL_KOKORO_MODEL_SHA256", raising=False)
    monkeypatch.delenv("KURAL_KOKORO_VOICES_SHA256", raising=False)
    module = _load_download_models()
    # With no override, EXPECTED falls back to the baked-in pins (verification on).
    assert module.EXPECTED_SHA256 == module._PINNED_SHA256
