"""Create a Python runtime directory for bundled desktop releases."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


def runtime_python(runtime_dir: Path) -> Path:
    if os.name == "nt":
        return runtime_dir / "Scripts" / "python.exe"
    return runtime_dir / "bin" / "python"


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target",
        default=str(repo_root / "desktop" / "runtime" / "python"),
        help="Target virtual environment directory bundled as the desktop Python runtime.",
    )
    parser.add_argument(
        "--with-clone",
        action="store_true",
        help="Install Chatterbox clone dependencies as well as the core backend.",
    )
    args = parser.parse_args()

    target = Path(args.target).resolve()
    backend_dir = repo_root / "backend"
    requirements = [backend_dir / "requirements.txt"]
    if args.with_clone:
        requirements.append(backend_dir / "requirements-clone.txt")

    if not runtime_python(target).exists():
        subprocess.run([sys.executable, "-m", "venv", str(target)], check=True)

    python = runtime_python(target)
    subprocess.run([str(python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    for req in requirements:
        subprocess.run([str(python), "-m", "pip", "install", "-r", str(req)], check=True)

    manifest = {
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "python": str(python),
        "requirements": [str(path.relative_to(repo_root)) for path in requirements],
        "with_clone": args.with_clone,
    }
    (target / "kural-runtime-manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )
    print(f"Provisioned backend runtime at {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
