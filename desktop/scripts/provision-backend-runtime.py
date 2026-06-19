"""Create a *relocatable* Python runtime for bundled desktop releases.

Uses python-build-standalone (astral-sh) instead of ``python -m venv``. A venv is
NOT relocatable: its ``python.exe`` shim resolves the standard library via
``pyvenv.cfg``'s ``home`` entry, which points at the *build machine's* base
Python install. Copied into a user's ``Program Files`` on a machine that has no
Python, that shim can fail to launch. A python-build-standalone ``install_only``
build is a self-contained interpreter that runs on a clean machine.

Layout after provisioning (``--target <dir>``):
    Windows:  <dir>/python.exe
    Unix:     <dir>/bin/python3

Version + release are pinned (overridable via env) for reproducible builds:
    KURAL_PYTHON_VERSION   default 3.12.8
    KURAL_PBS_RELEASE      default 20241219   (python-build-standalone GitHub tag)
    KURAL_PBS_BASE_URL     default github.com/astral-sh/python-build-standalone

If the pinned (version, release) pair does not exist for your platform the
download 404s with a clear error — set the two env vars to a valid pair from
https://github.com/astral-sh/python-build-standalone/releases . Use ``--dry-run``
to print the resolved asset URL and target paths without downloading.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

PY_VERSION = os.environ.get("KURAL_PYTHON_VERSION", "3.12.8").strip()
PBS_RELEASE = os.environ.get("KURAL_PBS_RELEASE", "20241219").strip()
PBS_BASE_URL = (
    os.environ.get(
        "KURAL_PBS_BASE_URL",
        "https://github.com/astral-sh/python-build-standalone/releases/download",
    )
    .strip()
    .rstrip("/")
)
DOWNLOAD_TIMEOUT_S = int(os.environ.get("KURAL_DOWNLOAD_TIMEOUT_S", "600"))


def _triple() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    arm = machine in {"arm64", "aarch64"}
    if system == "Windows":
        return "aarch64-pc-windows-msvc" if arm else "x86_64-pc-windows-msvc"
    if system == "Darwin":
        return "aarch64-apple-darwin" if arm else "x86_64-apple-darwin"
    if system == "Linux":
        return "aarch64-unknown-linux-gnu" if arm else "x86_64-unknown-linux-gnu"
    raise SystemExit(f"Unsupported platform for bundled runtime: {system}/{machine}")


def _asset_url() -> str:
    asset = f"cpython-{PY_VERSION}+{PBS_RELEASE}-{_triple()}-install_only.tar.gz"
    return f"{PBS_BASE_URL}/{PBS_RELEASE}/{asset}"


def runtime_python(runtime_dir: Path) -> Path:
    if os.name == "nt":
        return runtime_dir / "python.exe"
    return runtime_dir / "bin" / "python3"


def _download(url: str, dest: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "kural-runtime-provisioner"})
    tmp = dest.with_name(dest.name + ".part")
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_S) as response:
            with open(tmp, "wb") as handle:
                shutil.copyfileobj(response, handle)
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"Failed to download {url}: {exc}") from exc
    tmp.replace(dest)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_checksum(archive: Path, url: str) -> None:
    """Verify the archive against PBS's published ``<asset>.sha256`` when reachable."""
    require = os.environ.get("KURAL_REQUIRE_RUNTIME_CHECKSUM", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "",
    )
    try:
        request = urllib.request.Request(
            url + ".sha256", headers={"User-Agent": "kural-runtime-provisioner"}
        )
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_S) as response:
            expected = response.read().decode("utf-8").split()[0].strip().lower()
    except OSError as exc:
        # Fail closed by default: the bundled interpreter is the most
        # security-critical download (it *is* the code-execution environment),
        # so a fetch failure must not silently downgrade to "no verification".
        if require:
            archive.unlink(missing_ok=True)
            raise SystemExit(
                f"Could not fetch runtime checksum for verification ({exc}). "
                "Refusing to use an unverified interpreter. Set "
                "KURAL_REQUIRE_RUNTIME_CHECKSUM=0 to bypass (NOT recommended)."
            ) from exc
        print(
            "  WARNING: could not fetch runtime checksum; skipping verification "
            "(KURAL_REQUIRE_RUNTIME_CHECKSUM=0).",
            file=sys.stderr,
        )
        return
    actual = _sha256(archive)
    if actual != expected:
        archive.unlink(missing_ok=True)
        raise SystemExit(
            f"Runtime archive checksum mismatch: expected {expected}, got {actual}"
        )


def _extract(archive: Path, into: Path) -> None:
    with tarfile.open(archive, mode="r:gz") as tar:
        try:
            tar.extractall(into, filter="data")  # py3.12+: blocks path traversal
        except TypeError:
            tar.extractall(into)


def _provision_interpreter(target: Path) -> None:
    if runtime_python(target).exists():
        print(f"  Bundled runtime already present at {target}")
        return
    url = _asset_url()
    print(f"  Downloading standalone Python: {url}")
    with tempfile.TemporaryDirectory(prefix="kural-pbs-") as tmpdir:
        tmp = Path(tmpdir)
        archive = tmp / "python.tar.gz"
        _download(url, archive)
        _verify_checksum(archive, url)
        _extract(archive, tmp)
        extracted = tmp / "python"
        if not extracted.exists():
            raise SystemExit(f"Unexpected archive layout: {extracted} not found")
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(extracted), str(target))
    if not runtime_python(target).exists():
        raise SystemExit(
            f"Standalone Python not found after extraction: {runtime_python(target)}"
        )


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        default=str(repo_root / "desktop" / "runtime" / "python"),
        help="Directory to populate with the bundled relocatable Python runtime.",
    )
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="(unused) host interpreter; the bundled runtime is python-build-standalone.",
    )
    parser.add_argument(
        "--with-clone",
        action="store_true",
        help="Install Chatterbox clone dependencies as well as the core backend.",
    )
    parser.add_argument(
        "--with-local-models",
        action="store_true",
        help="Install optional local ASR/translation adapter dependencies.",
    )
    parser.add_argument(
        "--with-supertonic",
        action="store_true",
        help="Install the Supertonic multilingual TTS engine.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the resolved download plan and exit without downloading.",
    )
    args = parser.parse_args()

    target = Path(args.target).resolve()
    backend_dir = repo_root / "backend"
    requirements = [backend_dir / "requirements.txt"]
    if args.with_local_models:
        requirements.append(backend_dir / "requirements-local-models.txt")
    if args.with_clone:
        requirements.append(backend_dir / "requirements-clone.txt")
    if args.with_supertonic:
        requirements.append(backend_dir / "requirements-supertonic.txt")

    if args.dry_run:
        print(
            json.dumps(
                {
                    "asset_url": _asset_url(),
                    "triple": _triple(),
                    "python_version": PY_VERSION,
                    "pbs_release": PBS_RELEASE,
                    "target": str(target),
                    "runtime_python": str(runtime_python(target)),
                    "requirements": [str(r.relative_to(repo_root)) for r in requirements],
                },
                indent=2,
            )
        )
        return 0

    _provision_interpreter(target)
    python = runtime_python(target)

    subprocess.run([str(python), "-m", "pip", "install", "--upgrade", "pip"], check=True)
    for req in requirements:
        # Install the base runtime from its hash-pinned lock when present
        # (--require-hashes); the optional clone/supertonic/local-models layers
        # stay on their plain requirement files until they're locked too.
        lock = req.with_name("requirements.lock") if req.name == "requirements.txt" else None
        if lock is not None and lock.exists():
            subprocess.run(
                [str(python), "-m", "pip", "install", "--require-hashes", "-r", str(lock)],
                check=True,
            )
        else:
            subprocess.run([str(python), "-m", "pip", "install", "-r", str(req)], check=True)
    if args.with_clone:
        # Chatterbox needs PyTorch, which ships from a dedicated CPU index and is
        # NOT listed in requirements-clone.txt (the CI installs it separately).
        # Install it explicitly so the bundled clone runtime can actually import
        # chatterbox at runtime instead of failing on `import torch`.
        torch_spec = os.environ.get(
            "KURAL_TORCH_SPEC", "torch==2.6.0+cpu torchaudio==2.6.0+cpu"
        ).split()
        subprocess.run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                *torch_spec,
                "--index-url",
                "https://download.pytorch.org/whl/cpu",
            ],
            check=True,
        )
        subprocess.run(
            [str(python), "-m", "pip", "install", "--no-deps", "chatterbox-tts==0.1.7"],
            check=True,
        )
    if args.with_supertonic:
        # --no-deps so the upstream numpy<2 pin doesn't downgrade the
        # numpy 2.x that kokoro-onnx + kural-backend depend on.
        subprocess.run(
            [str(python), "-m", "pip", "install", "--no-deps", "supertonic>=1.2.0"],
            check=True,
        )

    manifest = {
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "runtime": "python-build-standalone",
        "python_version": PY_VERSION,
        "pbs_release": PBS_RELEASE,
        "triple": _triple(),
        "python": str(python),
        "relocatable": True,
        "requirements": [str(path.relative_to(repo_root)) for path in requirements],
        "with_clone": args.with_clone,
        "with_local_models": args.with_local_models,
        "with_supertonic": args.with_supertonic,
    }
    (target / "kural-runtime-manifest.json").write_text(
        json.dumps(manifest, indent=2),
        encoding="utf-8",
    )
    print(f"Provisioned relocatable backend runtime at {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
