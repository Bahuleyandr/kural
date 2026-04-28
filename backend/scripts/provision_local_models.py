"""Provision optional offline ASR and translation packs.

This script intentionally installs model files only; Python package installation
stays explicit via requirements-local-models.txt.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path


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


def _download_faster_whisper(repo_id: str, target: Path) -> Path:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise SystemExit(
            "huggingface_hub is required. Install backend/requirements-local-models.txt first."
        ) from exc

    target.mkdir(parents=True, exist_ok=True)
    return Path(snapshot_download(repo_id=repo_id, local_dir=str(target)))


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
        "--argos-pair",
        action="append",
        type=_pair,
        help="Argos package pair to install, for example en:hi. Can be repeated.",
    )
    args = parser.parse_args()

    root = Path(args.root).expanduser()
    whisper_target = root / "asr" / Path(args.whisper_repo).name
    argos_target = root / "translation" / "argos" / "packages"

    if not args.skip_whisper:
        path = _download_faster_whisper(args.whisper_repo, whisper_target)
        print(f"FASTER_WHISPER_MODEL_DIR={path}")

    pairs = args.argos_pair or [_pair(value) for value in DEFAULT_ARGOS_PAIRS]
    installed = _install_argos_pairs(pairs, argos_target)
    print(f"ARGOS_PACKAGES_DIR={argos_target}")
    print(f"Installed Argos pairs: {', '.join(installed) if installed else 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
