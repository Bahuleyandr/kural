"""Smoke-check Tauri release artifacts without uploading them anywhere."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


ARTIFACT_SUFFIXES = (
    ".AppImage",
    ".app.tar.gz",
    ".deb",
    ".dmg",
    ".msi",
    ".exe",
    ".zip",
)


def is_artifact(path: Path) -> bool:
    name = path.name
    return any(name.endswith(suffix) for suffix in ARTIFACT_SUFFIXES)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bundle-dir",
        default=str(repo_root / "desktop" / "src-tauri" / "target" / "release" / "bundle"),
    )
    parser.add_argument(
        "--require-signatures",
        action="store_true",
        help="Require at least one updater .sig file.",
    )
    args = parser.parse_args()

    bundle_dir = Path(args.bundle_dir).resolve()
    if not bundle_dir.exists():
        raise SystemExit(f"Bundle directory does not exist: {bundle_dir}")

    artifacts = sorted(path for path in bundle_dir.rglob("*") if path.is_file() and is_artifact(path))
    if not artifacts:
        raise SystemExit(f"No release artifacts found under {bundle_dir}")

    empty = [path for path in artifacts if path.stat().st_size <= 0]
    if empty:
        raise SystemExit(f"Empty release artifact: {empty[0]}")

    signatures = sorted(bundle_dir.rglob("*.sig"))
    if args.require_signatures and not signatures:
        raise SystemExit("No updater signature artifacts (*.sig) found.")

    latest_files = sorted(bundle_dir.rglob("latest.json"))
    for latest in latest_files:
        try:
            payload = json.loads(latest.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Invalid updater JSON {latest}: {exc}") from exc
        if "version" not in payload:
            raise SystemExit(f"Updater JSON is missing version: {latest}")

    desktop_index = repo_root / "frontend" / "out" / "index.html"
    if desktop_index.exists():
        html = desktop_index.read_text(encoding="utf-8")
        if re.search(r"""(?:href|src)=["']/_next/""", html):
            raise SystemExit(
                "Desktop frontend export uses absolute /_next asset URLs; "
                "Tauri installers require relative ./_next URLs."
            )

    print(f"Found {len(artifacts)} artifact(s) under {bundle_dir}")
    print(f"Found {len(signatures)} updater signature(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
