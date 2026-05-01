"""Single source of truth for the desktop installer/release pipeline.

Both ``build-installer.{sh,ps1}`` and ``build-release.{sh,ps1}`` are now thin
wrappers around this script. Logic that used to be duplicated across four
shell flavours lives here exactly once.

Usage:
    python build_desktop.py installer [options] [-- TAURI_ARGS...]
    python build_desktop.py release   [options] [-- TAURI_ARGS...]
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Sequence

SCRIPT_DIR = Path(__file__).resolve().parent
DESKTOP_DIR = SCRIPT_DIR.parent
REPO_ROOT = DESKTOP_DIR.parent
FRONTEND_DIR = REPO_ROOT / "frontend"


def _parse_args(argv: Sequence[str]) -> tuple[argparse.Namespace, list[str]]:
    parser = argparse.ArgumentParser(prog="build_desktop.py", description=__doc__)
    parser.add_argument("mode", choices=("installer", "release"))
    parser.add_argument(
        "--with-clone",
        dest="with_clone",
        action="store_true",
        default=None,
        help="Bundle the Chatterbox voice-clone runtime. Enabled by default.",
    )
    parser.add_argument(
        "--without-clone",
        dest="with_clone",
        action="store_false",
        help="Build a smaller Kokoro-only desktop runtime without cloned-voice synthesis.",
    )
    parser.add_argument(
        "--with-local-models",
        action="store_true",
        help="(installer only) bundle ASR/translation packs",
    )
    parser.add_argument("--skip-runtime-provision", action="store_true")
    parser.add_argument("--skip-model-provision", action="store_true")
    parser.add_argument("--skip-smoke", action="store_true")
    parser.add_argument(
        "--python",
        default=os.environ.get("KURAL_DESKTOP_BUILD_PYTHON")
        or ("python" if os.name == "nt" else "python3"),
        help="Python interpreter used to provision the bundled runtime.",
    )
    parser.add_argument(
        "--local-models-root",
        default=os.environ.get("KURAL_LOCAL_MODELS_ROOT", ""),
        help="Pre-staged local-models directory; otherwise provisioned in-tree.",
    )
    args, tauri_args = parser.parse_known_args(argv)
    if args.with_clone is None:
        args.with_clone = True
    if tauri_args and tauri_args[0] == "--":
        tauri_args = tauri_args[1:]
    return args, tauri_args


def _runtime_python_exe(runtime_python_dir: Path) -> Path:
    candidates = (
        runtime_python_dir / "Scripts" / "python.exe",
        runtime_python_dir / "bin" / "python",
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit(f"Bundled runtime Python was not found in {runtime_python_dir}")


def _run(cmd: Sequence[str | Path], *, env: dict[str, str] | None = None, cwd: Path | None = None) -> None:
    pretty = " ".join(str(part) for part in cmd)
    print(f"+ {pretty}", flush=True)
    subprocess.run([str(part) for part in cmd], check=True, env=env, cwd=cwd)


def _require_release_env() -> None:
    missing = [
        var
        for var in ("KURAL_UPDATER_PUBLIC_KEY", "TAURI_SIGNING_PRIVATE_KEY")
        if not os.environ.get(var)
    ]
    if missing:
        raise SystemExit(
            "Release builds require these env vars: " + ", ".join(missing)
        )


def _provision_runtime(args: argparse.Namespace, target: Path) -> None:
    cmd: list[str | Path] = [
        args.python,
        SCRIPT_DIR / "provision-backend-runtime.py",
        "--target",
        target,
        "--python",
        args.python,
    ]
    if args.with_clone:
        cmd.append("--with-clone")
    if args.with_local_models:
        cmd.append("--with-local-models")
    _run(cmd)


def _provision_models(runtime_python: Path, kokoro_dir: Path) -> None:
    env = os.environ.copy()
    env["MODEL_CACHE_DIR"] = str(kokoro_dir)
    _run([runtime_python, REPO_ROOT / "backend" / "scripts" / "download_models.py"], env=env)


def _stage_local_models(
    runtime_python: Path,
    runtime_models: Path,
    local_models_root: str,
) -> None:
    if not local_models_root:
        local_models_root = str(runtime_models / "local-source")
        _run(
            [
                runtime_python,
                REPO_ROOT / "backend" / "scripts" / "provision_local_models.py",
                "--root",
                local_models_root,
            ]
        )

    pairs = (
        (Path(local_models_root) / "asr" / "faster-whisper-tiny", runtime_models / "asr" / "faster-whisper-tiny"),
        (Path(local_models_root) / "translation" / "argos" / "packages", runtime_models / "translation" / "argos" / "packages"),
    )
    for source, destination in pairs:
        if not source.exists():
            print(f"warning: local-models source not found: {source}", file=sys.stderr)
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination)


def _render_config(runtime_python: Path, mode: str, with_local_models: bool) -> Path:
    target_dir = DESKTOP_DIR / "target"
    target_dir.mkdir(parents=True, exist_ok=True)
    if mode == "installer":
        config_path = target_dir / "tauri-installer.conf.json"
        cmd: list[str | Path] = [
            runtime_python,
            SCRIPT_DIR / "render-installer-config.py",
            "--output",
            config_path,
        ]
        if with_local_models:
            cmd.append("--with-local-models")
    else:
        config_path = target_dir / "tauri-release.conf.json"
        cmd = [
            runtime_python,
            SCRIPT_DIR / "render-release-config.py",
            "--output",
            config_path,
        ]
    _run(cmd)
    return config_path


def _build_frontend() -> None:
    npx_command = "npx.cmd" if os.name == "nt" else "npx"
    _run([npx_command, "pnpm@9.15.9", "run", "build:desktop"], cwd=FRONTEND_DIR)


def _build_tauri(config_path: Path, tauri_args: list[str]) -> None:
    npx_command = "npx.cmd" if os.name == "nt" else "npx"
    cmd: list[str | Path] = [
        npx_command,
        "@tauri-apps/cli@^2",
        "build",
        "--config",
        config_path,
    ]
    cmd.extend(tauri_args)
    _run(cmd, cwd=DESKTOP_DIR)


def _smoke(runtime_python: Path, *, require_signatures: bool) -> None:
    cmd: list[str | Path] = [runtime_python, SCRIPT_DIR / "smoke-release-artifacts.py"]
    if require_signatures:
        cmd.append("--require-signatures")
    _run(cmd)


def main(argv: Sequence[str]) -> int:
    args, tauri_args = _parse_args(argv)
    if args.mode == "release":
        _require_release_env()

    runtime_dir = DESKTOP_DIR / "runtime"
    runtime_python_dir = runtime_dir / "python"
    runtime_models = runtime_dir / "models"
    runtime_models.mkdir(parents=True, exist_ok=True)

    if not args.skip_runtime_provision:
        _provision_runtime(args, runtime_python_dir)
    runtime_python = _runtime_python_exe(runtime_python_dir)

    if args.mode == "installer" and not args.skip_model_provision:
        _provision_models(runtime_python, runtime_models / "kokoro")

    if args.mode == "installer" and args.with_local_models:
        _stage_local_models(runtime_python, runtime_models, args.local_models_root)

    config_path = _render_config(runtime_python, args.mode, args.with_local_models)
    _build_frontend()
    _build_tauri(config_path, tauri_args)

    if not args.skip_smoke:
        _smoke(runtime_python, require_signatures=(args.mode == "release"))

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
