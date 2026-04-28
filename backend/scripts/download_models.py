#!/usr/bin/env python3
"""Download Kokoro ONNX model files to ~/.cache/kural/kokoro/."""
import os
import sys
import urllib.request
from pathlib import Path

MODEL_DIR = Path(
    os.path.expanduser(os.environ.get("MODEL_CACHE_DIR", "~/.cache/kural/kokoro"))
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


def download():
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for filename, url in FILES.items():
        dest = MODEL_DIR / filename
        if dest.exists():
            print(f"  {filename} — already cached, skipping")
            continue
        print(f"  Downloading {filename} ...")
        urllib.request.urlretrieve(url, dest, reporthook=_progress)
        print(f"\r  {filename} — done ({dest.stat().st_size // 1024 // 1024} MB)")
    print(f"\nModels saved to {MODEL_DIR}")


if __name__ == "__main__":
    download()
