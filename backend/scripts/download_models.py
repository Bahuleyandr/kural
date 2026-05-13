#!/usr/bin/env python3
"""Download TTS engine assets.

Default: provision Kokoro ONNX into ~/.cache/kural/kokoro/.
Pass --supertonic to also pre-warm the Supertonic model cache so first-use
synthesis works fully offline.
"""
import argparse
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


def _progress(count, block_size, total_size):
    if total_size > 0:
        pct = int(count * block_size * 100 / total_size)
        sys.stdout.write(f"\r  {min(pct, 100):3d}%")
        sys.stdout.flush()


def download_kokoro():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for filename, url in FILES.items():
        dest = MODEL_DIR / filename
        if dest.exists():
            print(f"  {filename} — already cached, skipping")
            continue
        print(f"  Downloading {filename} ...")
        urllib.request.urlretrieve(url, dest, reporthook=_progress)
        print(f"\r  {filename} — done ({dest.stat().st_size // 1024 // 1024} MB)")
    print(f"\nKokoro saved to {MODEL_DIR}")


def download_supertonic():
    """Pre-warm the Supertonic Hugging Face cache by instantiating the SDK once."""
    SUPERTONIC_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(SUPERTONIC_DIR)
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(SUPERTONIC_DIR)
    try:
        from supertonic import TTS
    except ImportError:
        print(
            "supertonic not installed. Run: pip install -r backend/requirements.txt",
            file=sys.stderr,
        )
        sys.exit(2)
    print(f"  Provisioning Supertonic into {SUPERTONIC_DIR} ...")
    TTS(auto_download=True)
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
