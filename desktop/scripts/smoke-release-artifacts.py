"""Smoke-check Tauri release artifacts without uploading them anywhere."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
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


def _verify_authenticode(artifacts: list[Path]) -> None:
    """Require every Windows installer to carry a valid Authenticode signature.

    Opt-in (the public beta ships unsigned by design). When enabled, this is a
    real cryptographic check — not the mere existence of a ``.sig`` file — so a
    build signed with a bogus/expired cert fails instead of passing.
    """
    if not artifacts:
        raise SystemExit(
            "--verify-authenticode set but no Windows .exe/.msi artifacts were found."
        )
    signtool = shutil.which("signtool") or shutil.which("signtool.exe")
    if not signtool:
        raise SystemExit(
            "--verify-authenticode set but signtool was not found on PATH "
            "(run from a Windows SDK / Visual Studio developer prompt)."
        )
    for artifact in artifacts:
        result = subprocess.run(
            [signtool, "verify", "/pa", "/q", str(artifact)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise SystemExit(
                f"Authenticode verification failed for {artifact.name}: "
                f"{(result.stderr or result.stdout).strip()}"
            )
        print(f"  signtool verify OK: {artifact.name}")


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
        help="Require at least one (non-empty) updater .sig file.",
    )
    parser.add_argument(
        "--verify-authenticode",
        action="store_true",
        help="Require every Windows .exe/.msi to pass `signtool verify /pa`. "
        "Off by default so the documented unsigned beta still smoke-passes.",
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
    if args.require_signatures:
        if not signatures:
            raise SystemExit("No updater signature artifacts (*.sig) found.")
        empty_sigs = [sig for sig in signatures if sig.stat().st_size <= 0]
        if empty_sigs:
            raise SystemExit(f"Empty updater signature: {empty_sigs[0]}")

    if args.verify_authenticode:
        _verify_authenticode([a for a in artifacts if a.suffix.lower() in {".exe", ".msi"}])

    latest_files = sorted(bundle_dir.rglob("latest.json"))
    for latest in latest_files:
        try:
            payload = json.loads(latest.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Invalid updater JSON {latest}: {exc}") from exc
        if "version" not in payload:
            raise SystemExit(f"Updater JSON is missing version: {latest}")

    out_dir = repo_root / "frontend" / "out"
    for page in ("index.html", "dictation.html"):
        page_path = out_dir / page
        if page_path.exists():
            html = page_path.read_text(encoding="utf-8")
            if re.search(r"""(?:href|src)=["']/_next/""", html):
                raise SystemExit(
                    f"Desktop frontend export ({page}) uses absolute /_next asset "
                    "URLs; Tauri installers require relative ./_next URLs."
                )

    print(f"Found {len(artifacts)} artifact(s) under {bundle_dir}")
    print(f"Found {len(signatures)} updater signature(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
