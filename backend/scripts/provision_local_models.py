"""Provision optional offline ASR and translation packs.

This script intentionally installs model files only; Python package installation
stays explicit via requirements-local-models.txt.

Integrity posture:
- Faster-Whisper is pulled from the Hugging Face hub, which is content-addressed
  (huggingface_hub verifies each blob's hash). We additionally pin the model
  *revision* (commit SHA) so the download is reproducible and locked to a
  known-good tree (KURAL_WHISPER_REVISION overrides).
- Argos packages are fetched over HTTPS via argostranslate's package index;
  the library exposes no per-file pin hook, so integrity rests on TLS + the
  official index.
- All network reads honour KURAL_DOWNLOAD_TIMEOUT_S so a stalled mirror fails
  fast instead of hanging a build.
"""

from __future__ import annotations

import argparse
import os
import socket
from pathlib import Path

# Pinned commit of Systran/faster-whisper-tiny on the HF hub (override with
# KURAL_WHISPER_REVISION). Pinning the revision makes the download reproducible
# and locks it to a known-good, hash-verified tree.
_DEFAULT_WHISPER_REVISION = "d90ca5fe260221311c53c58e660288d3deb8d356"


DEFAULT_ARGOS_PAIRS = [
    "en:hi",
    "hi:en",
    "en:bn",
    "bn:en",
    "en:es",
    "es:en",
]


def _pair(value: str) -> tuple[str, str]:
    if ":" not in value and "->" not in value:
        raise argparse.ArgumentTypeError("Use source:target, for example en:hi")
    separator = ":" if ":" in value else "->"
    source, target = [part.strip().lower() for part in value.split(separator, 1)]
    if not source or not target:
        raise argparse.ArgumentTypeError("Both source and target languages are required")
    return source, target


def _download_faster_whisper(repo_id: str, target: Path, revision: str | None = None) -> Path:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise SystemExit(
            "huggingface_hub is required. Install backend/requirements-local-models.txt first."
        ) from exc

    target.mkdir(parents=True, exist_ok=True)
    return Path(snapshot_download(repo_id=repo_id, local_dir=str(target), revision=revision))


def _install_argos_pairs(pairs: list[tuple[str, str]], package_dir: Path) -> list[str]:
    try:
        from argostranslate import package
    except ImportError as exc:
        raise SystemExit(
            "argostranslate is required. Install backend/requirements-local-models.txt first."
        ) from exc

    package_dir.mkdir(parents=True, exist_ok=True)
    os.environ["ARGOS_PACKAGES_DIR"] = str(package_dir)
    package.update_package_index()
    available = package.get_available_packages()
    installed: list[str] = []

    for source, target in pairs:
        match = next(
            (candidate for candidate in available if candidate.from_code == source and candidate.to_code == target),
            None,
        )
        if match is None:
            print(f"Argos package not available: {source}->{target}")
            continue
        path = match.download()
        package.install_from_path(path)
        installed.append(f"{source}->{target}")

    return installed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=os.environ.get("KURAL_LOCAL_MODELS_ROOT", "~/.cache/kural"),
        help="Root folder for optional local model packs.",
    )
    parser.add_argument(
        "--whisper-repo",
        default="Systran/faster-whisper-tiny",
        help="Hugging Face repo ID for a CTranslate2 faster-whisper model.",
    )
    parser.add_argument(
        "--skip-whisper",
        action="store_true",
        help="Do not download a faster-whisper model.",
    )
    parser.add_argument(
        "--whisper-revision",
        default=os.environ.get("KURAL_WHISPER_REVISION", _DEFAULT_WHISPER_REVISION),
        help="HF commit/revision to pin the faster-whisper download to.",
    )
    parser.add_argument(
        "--argos-pair",
        action="append",
        type=_pair,
        help="Argos package pair to install, for example en:hi. Can be repeated.",
    )
    args = parser.parse_args()
    # Bound every network read (HF snapshot + Argos index/package) so a stalled
    # mirror fails fast instead of hanging the provisioner.
    socket.setdefaulttimeout(int(os.environ.get("KURAL_DOWNLOAD_TIMEOUT_S", "300")))

    root = Path(args.root).expanduser()
    whisper_target = root / "asr" / Path(args.whisper_repo).name
    argos_target = root / "translation" / "argos" / "packages"

    if not args.skip_whisper:
        path = _download_faster_whisper(args.whisper_repo, whisper_target, args.whisper_revision)
        print(f"FASTER_WHISPER_MODEL_DIR={path}")

    pairs = args.argos_pair or [_pair(value) for value in DEFAULT_ARGOS_PAIRS]
    installed = _install_argos_pairs(pairs, argos_target)
    print(f"ARGOS_PACKAGES_DIR={argos_target}")
    print(f"Installed Argos pairs: {', '.join(installed) if installed else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
