"""Run the local Public Beta RC1 release gate.

The default gate is intentionally local and deterministic: backend tests,
frontend install/lint/unit/build, and desktop release-config sanity. Heavier
checks such as Playwright and Docker compose are opt-in flags so developers can
run a fast gate often and a full gate before tagging.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PNPM = ["npx", "pnpm@9.15.9"]


@dataclass
class Step:
    name: str
    command: list[str]
    cwd: Path
    env: dict[str, str] | None = None
    optional_executable: str | None = None


def run_step(step: Step) -> None:
    if step.optional_executable and not shutil.which(step.optional_executable):
        raise SystemExit(f"{step.name}: required executable not found: {step.optional_executable}")
    command = list(step.command)
    executable = shutil.which(command[0])
    if executable:
        command[0] = executable
    print(f"\n==> {step.name}")
    subprocess.run(
        command,
        cwd=step.cwd,
        env={**os.environ, **(step.env or {})},
        check=True,
    )


def render_release_config() -> None:
    with tempfile.TemporaryDirectory(prefix="kural-rc1-") as temp_dir:
        run_step(
            Step(
                name="Desktop release config render",
                command=[
                    sys.executable,
                    "desktop/scripts/render-release-config.py",
                    "--output",
                    str(Path(temp_dir) / "tauri-release.conf.json"),
                ],
                cwd=REPO_ROOT,
                env={"KURAL_UPDATER_PUBLIC_KEY": os.environ.get("KURAL_UPDATER_PUBLIC_KEY", "test-public-key")},
            )
        )


def smoke_fake_artifacts() -> None:
    with tempfile.TemporaryDirectory(prefix="kural-artifacts-") as temp_dir:
        artifact_dir = Path(temp_dir)
        (artifact_dir / "Kural.AppImage").write_text("artifact", encoding="utf-8")
        (artifact_dir / "Kural.AppImage.sig").write_text("signature", encoding="utf-8")
        (artifact_dir / "latest.json").write_text('{"version":"0.2.0"}', encoding="utf-8")
        run_step(
            Step(
                name="Desktop artifact smoke checker",
                command=[
                    sys.executable,
                    "desktop/scripts/smoke-release-artifacts.py",
                    "--bundle-dir",
                    str(artifact_dir),
                    "--require-signatures",
                ],
                cwd=REPO_ROOT,
            )
        )


def wait_for_url(url: str, timeout_s: int) -> None:
    deadline = time.monotonic() + timeout_s
    last_error = ""
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if 200 <= response.status < 300:
                    return
        except (OSError, urllib.error.URLError) as exc:
            last_error = str(exc)
        time.sleep(2)
    raise SystemExit(f"Timed out waiting for {url}: {last_error}")


def run_docker_gate() -> None:
    docker_bin = shutil.which("docker") or "docker"
    run_step(
        Step(
            name="Docker compose config",
            command=["docker", "compose", "config", "--quiet"],
            cwd=REPO_ROOT,
            optional_executable="docker",
        )
    )
    try:
        run_step(
            Step(
                name="Docker compose build",
                command=["docker", "compose", "build"],
                cwd=REPO_ROOT,
                env={"KURAL_FLAVOUR": "lite"},
            )
        )
        run_step(
            Step(
                name="Docker compose up",
                command=["docker", "compose", "up", "-d", "--wait", "--wait-timeout", "180"],
                cwd=REPO_ROOT,
                env={"KURAL_FLAVOUR": "lite"},
            )
        )
        wait_for_url("http://127.0.0.1:8000/healthz", 120)
        wait_for_url("http://127.0.0.1:3000", 120)
    finally:
        subprocess.run([docker_bin, "compose", "down"], cwd=REPO_ROOT, check=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-playwright", action="store_true", help="Run frontend Playwright smoke tests.")
    parser.add_argument("--include-docker", action="store_true", help="Build and boot docker-compose.yml.")
    parser.add_argument("--skip-desktop", action="store_true", help="Skip desktop Cargo/release-config checks.")
    args = parser.parse_args()

    steps = [
        Step("Backend pytest", [sys.executable, "-m", "pytest"], REPO_ROOT / "backend"),
        Step("Frontend install", [*PNPM, "install", "--frozen-lockfile"], REPO_ROOT / "frontend", optional_executable="npx"),
        Step("Frontend lint", [*PNPM, "run", "lint"], REPO_ROOT / "frontend"),
        Step("Frontend unit tests", [*PNPM, "run", "test:unit"], REPO_ROOT / "frontend"),
        Step("Frontend build", [*PNPM, "run", "build"], REPO_ROOT / "frontend"),
    ]

    if args.include_playwright:
        steps.append(Step("Frontend Playwright smoke", [*PNPM, "run", "test:e2e"], REPO_ROOT / "frontend"))

    for step in steps:
        run_step(step)

    if not args.skip_desktop:
        run_step(
            Step(
                "Desktop script syntax",
                [sys.executable, "-m", "compileall", "desktop/scripts"],
                REPO_ROOT,
            )
        )
        render_release_config()
        smoke_fake_artifacts()
        run_step(
            Step(
                "Desktop Cargo check",
                ["cargo", "check"],
                REPO_ROOT / "desktop" / "src-tauri",
                optional_executable="cargo",
            )
        )

    if args.include_docker:
        run_docker_gate()

    print("\nRC1 release gate passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
