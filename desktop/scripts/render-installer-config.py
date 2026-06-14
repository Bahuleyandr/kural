"""Render a Tauri config overlay for unsigned local installer builds."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def _resource(resources: dict[str, str], source: Path, dest: str, config_base: Path) -> None:
    if source.exists():
        resources[Path(os.path.relpath(source, config_base)).as_posix()] = dest


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default=str(repo_root / "desktop" / "target" / "tauri-installer.conf.json"),
    )
    parser.add_argument(
        "--target",
        choices=["all", "windows", "macos", "linux"],
        default="all",
        help="Installer target family. Tauri still builds only targets supported by the host OS.",
    )
    parser.add_argument(
        "--with-local-models",
        action="store_true",
        help="Bundle optional ASR/translation model packs from desktop/runtime/models.",
    )
    args = parser.parse_args()

    runtime_dir = repo_root / "desktop" / "runtime"
    config_base = repo_root / "desktop" / "src-tauri"
    resources: dict[str, str] = {
        "../../backend/app": "backend/app",
        "../../backend/scripts": "backend/scripts",
        "../../backend/requirements.txt": "backend/requirements.txt",
    }

    _resource(resources, runtime_dir / "python", "python", config_base)
    _resource(resources, runtime_dir / "models" / "kokoro", "models/kokoro", config_base)

    if args.with_local_models:
        _resource(
            resources,
            runtime_dir / "models" / "asr" / "faster-whisper-tiny",
            "models/asr/faster-whisper-tiny",
            config_base,
        )
        _resource(
            resources,
            runtime_dir / "models" / "translation" / "argos" / "packages",
            "models/translation/argos/packages",
            config_base,
        )

    bundle_targets = {
        "all": "all",
        "windows": ["nsis", "msi"],
        "macos": ["dmg"],
        "linux": ["deb", "appimage"],
    }[args.target]

    config = {
        "bundle": {
            "active": True,
            "targets": bundle_targets,
            "resources": resources,
        },
        # No updater for local/unsigned installer builds. In Tauri v2 the updater
        # is gated by endpoints + pubkey + createUpdaterArtifacts (set only by the
        # release overlay), so omitting it here disables auto-update. (The old
        # ``updater.active`` flag was a Tauri v1 leftover and is not a v2 field.)
        "plugins": {},
    }

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"Rendered installer config to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
