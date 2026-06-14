#!/usr/bin/env python3
"""Download TTS engine assets.

Default: provision Kokoro ONNX into ~/.cache/kural/kokoro/.
Pass --supertonic to also pre-warm the Supertonic model cache so first-use
synthesis works fully offline.

Hardening:
- Network reads use ``KURAL_DOWNLOAD_TIMEOUT_S`` (default 300s) so a hung or
  throttled mirror fails fast instead of blocking app startup forever.
- Each file streams to a ``.part`` temp and is only renamed into place on
  success, so an interrupted download never leaves a half-written model that
  looks valid to the engine.
- Files are verified against a pinned SHA-256 **by default** (the official
  upstream digests are baked in below). Override per-file with
  ``KURAL_KOKORO_MODEL_SHA256`` / ``KURAL_KOKORO_VOICES_SHA256``, or set either
  to empty to skip that file. ``KURAL_REQUIRE_MODEL_CHECKSUM=1`` refuses any
  download that ends up unpinned.
"""
import argparse
import hashlib
import os
import sys
import urllib.request
from pathlib import Path

MODEL_DIR = Path(
    os.path.expanduser(os.environ.get("MODEL_CACHE_DIR", "~/.cache/kural/kokoro"))
)
SUPERTONIC_DIR = Path(
    os.path.expanduser(
        os.environ.get("SUPERTONIC_MODEL_DIR", "~/.cache/kural/supertonic")
    )
)

# int8 quantized model — 88 MB, fast on CPU, quality on par with full for English TTS
_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

FILES = {
    "kokoro-v1.0.int8.onnx": f"{_BASE}/kokoro-v1.0.int8.onnx",
    "voices-v1.0.bin": f"{_BASE}/voices-v1.0.bin",
}

# Pinned digests close the supply-chain gap: a compromised or redirected mirror
# is rejected before the file is used. These are the official upstream
# model-files-v1.0 assets (verified over HTTPS from the canonical release), so
# verification is ON by default. Override per-file via env to pin a different
# upstream, or set the var to empty to skip verification for that file.
_PINNED_SHA256 = {
    "kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
EXPECTED_SHA256 = {
    "kokoro-v1.0.int8.onnx": os.environ.get(
        "KURAL_KOKORO_MODEL_SHA256", _PINNED_SHA256["kokoro-v1.0.int8.onnx"]
    ).strip().lower(),
    "voices-v1.0.bin": os.environ.get(
        "KURAL_KOKORO_VOICES_SHA256", _PINNED_SHA256["voices-v1.0.bin"]
    ).strip().lower(),
}

DOWNLOAD_TIMEOUT_S = int(os.environ.get("KURAL_DOWNLOAD_TIMEOUT_S", "300"))
_REQUIRE_CHECKSUM = os.environ.get("KURAL_REQUIRE_MODEL_CHECKSUM", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
_CHUNK = 256 * 1024


def _progress(read_bytes: int, total_size: int) -> None:
    if total_size > 0:
        pct = int(read_bytes * 100 / total_size)
        sys.stdout.write(f"\r  {min(pct, 100):3d}%")
        sys.stdout.flush()


def _download(filename: str, url: str, dest: Path) -> None:
    expected = EXPECTED_SHA256.get(filename, "")
    if not expected and _REQUIRE_CHECKSUM:
        raise SystemExit(
            f"Refusing to download {filename} without a pinned checksum "
            "(KURAL_REQUIRE_MODEL_CHECKSUM is set)."
        )

    tmp = dest.with_name(dest.name + ".part")
    digest = hashlib.sha256()
    request = urllib.request.Request(url, headers={"User-Agent": "kural-model-downloader"})
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_S) as response:
            total = int(response.headers.get("Content-Length") or 0)
            read = 0
            with open(tmp, "wb") as handle:
                while True:
                    chunk = response.read(_CHUNK)
                    if not chunk:
                        break
                    handle.write(chunk)
                    digest.update(chunk)
                    read += len(chunk)
                    _progress(read, total)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"Failed to download {filename}: {exc}") from exc

    actual = digest.hexdigest()
    if expected:
        if actual != expected:
            tmp.unlink(missing_ok=True)
            raise SystemExit(
                f"Checksum mismatch for {filename}: expected {expected}, got {actual}. "
                "Refusing to install a model that does not match its pinned digest."
            )
    else:
        print(
            f"\n  WARNING: {filename} installed WITHOUT checksum verification "
            "(its KURAL_KOKORO_*_SHA256 override was set empty).",
            file=sys.stderr,
        )
    tmp.replace(dest)


def download_kokoro():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for filename, url in FILES.items():
        dest = MODEL_DIR / filename
        if dest.exists():
            print(f"  {filename} — already cached, skipping")
            continue
        print(f"  Downloading {filename} ...")
        _download(filename, url, dest)
        print(f"\r  {filename} — done ({dest.stat().st_size // 1024 // 1024} MB)")
    print(f"\nKokoro saved to {MODEL_DIR}")


def download_supertonic():
    """Pre-warm the Supertonic model cache by instantiating the SDK once."""
    SUPERTONIC_DIR.mkdir(parents=True, exist_ok=True)
    try:
        from supertonic import TTS
    except ImportError:
        print(
            "supertonic not installed. Run:\n"
            "  pip install -r backend/requirements-supertonic.txt\n"
            "  pip install --no-deps supertonic>=1.2.0",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"  Provisioning Supertonic into {SUPERTONIC_DIR} ...")
    TTS(model_dir=str(SUPERTONIC_DIR), auto_download=True)
    print("  Supertonic ready.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--supertonic",
        action="store_true",
        help="Also provision the Supertonic ONNX model cache.",
    )
    parser.add_argument(
        "--skip-kokoro",
        action="store_true",
        help="Skip the Kokoro download (e.g. when only provisioning Supertonic).",
    )
    args = parser.parse_args()

    if not args.skip_kokoro:
        download_kokoro()
    if args.supertonic:
        download_supertonic()


if __name__ == "__main__":
    main()
