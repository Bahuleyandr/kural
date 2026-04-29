"""First-run setup orchestration.

Reports model presence and optionally triggers the bundled
`scripts/download_models.py` to fetch the Kokoro ONNX bundle. Used by the
desktop and web frontends to render an actionable "install models" banner
when the engine is missing its weights.

Status transitions are append-only state on the module: a single download
is tracked at a time, the rest enqueue or are rejected.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import settings

router = APIRouter(tags=["setup"])

ProvisionState = Literal["idle", "running", "complete", "error"]


class _State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.status: ProvisionState = "idle"
        self.detail: str | None = None


_state = _State()


def _model_dir() -> Path:
    return Path(os.path.expanduser(settings.model_cache_dir)).resolve()


def _models_ready() -> bool:
    base = _model_dir()
    return (
        (base / settings.kokoro_model_file).exists()
        and (base / settings.kokoro_voices_file).exists()
    )


class SetupStatusResponse(BaseModel):
    kokoro_ready: bool
    model_dir: str
    model_files: list[str]
    provision_status: ProvisionState
    provision_detail: str | None = None


@router.get("/setup/status", response_model=SetupStatusResponse)
async def setup_status() -> SetupStatusResponse:
    base = _model_dir()
    return SetupStatusResponse(
        kokoro_ready=_models_ready(),
        model_dir=str(base),
        model_files=[settings.kokoro_model_file, settings.kokoro_voices_file],
        provision_status=_state.status,
        provision_detail=_state.detail,
    )


def _run_provisioner(model_dir: Path) -> None:
    script = Path(__file__).resolve().parents[2] / "scripts" / "download_models.py"
    if not script.exists():
        with _state.lock:
            _state.status = "error"
            _state.detail = f"download_models.py not found at {script}"
        return

    env = os.environ.copy()
    env["MODEL_CACHE_DIR"] = str(model_dir)
    try:
        result = subprocess.run(
            [sys.executable, str(script)],
            check=False,
            env=env,
            capture_output=True,
            text=True,
            timeout=60 * 30,
        )
    except subprocess.TimeoutExpired:
        with _state.lock:
            _state.status = "error"
            _state.detail = "Model download timed out after 30 minutes."
        return
    except OSError as exc:
        with _state.lock:
            _state.status = "error"
            _state.detail = f"Could not launch downloader: {exc}"
        return

    with _state.lock:
        if result.returncode == 0 and _models_ready():
            _state.status = "complete"
            _state.detail = None
        else:
            _state.status = "error"
            tail = (result.stderr or result.stdout or "").strip().splitlines()[-1:]
            _state.detail = tail[0] if tail else f"Exit code {result.returncode}"


@router.post("/setup/provision-models", response_model=SetupStatusResponse, status_code=202)
async def provision_models() -> SetupStatusResponse:
    if _models_ready():
        with _state.lock:
            _state.status = "complete"
            _state.detail = None
        return await setup_status()

    with _state.lock:
        if _state.status == "running":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "provision_in_progress",
                    "message": "A model download is already running.",
                },
            )
        _state.status = "running"
        _state.detail = None

    model_dir = _model_dir()
    loop = asyncio.get_running_loop()
    loop.run_in_executor(None, _run_provisioner, model_dir)
    return await setup_status()
