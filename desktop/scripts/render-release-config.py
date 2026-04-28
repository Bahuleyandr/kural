"""Render the Tauri release config overlay from signing environment variables."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


DEFAULT_ENDPOINT = (
    "https://github.com/Bahuleyandr/kural/releases/latest/download/latest.json"
)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=str(repo_root / "desktop" / "target" / "tauri-release.conf.json"),
        help="Output config overlay path.",
    )
    args = parser.parse_args()

    public_key = os.environ.get("KURAL_UPDATER_PUBLIC_KEY", "").strip()
    if not public_key:
        raise SystemExit("KURAL_UPDATER_PUBLIC_KEY is required for release config rendering.")

    endpoint = os.environ.get("KURAL_UPDATE_ENDPOINT", DEFAULT_ENDPOINT).strip()
    config = {
        "bundle": {
            "createUpdaterArtifacts": True,
            "resources": {
                "../../backend/app": "backend/app",
                "../../backend/scripts": "backend/scripts",
                "../../backend/requirements.txt": "backend/requirements.txt",
                "../../desktop/runtime/python": "python",
            },
        },
        "plugins": {
            "updater": {
                "pubkey": public_key,
                "endpoints": [endpoint],
                "windows": {"installMode": "passive"},
            }
        },
    }

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"Rendered release config to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
