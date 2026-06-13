from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..models import (
    LipSyncStatusResponse,
    ProvenanceSidecarRequest,
    ProvenanceSidecarResponse,
    RuntimeCheck,
    RuntimeHealthChecksResponse,
    RuntimeRepairRequest,
    RuntimeRepairResponse,
)

router = APIRouter(tags=["runtime"])


def _expand(path: str) -> Path:
    return Path(path).expanduser().resolve()


def _kokoro_ready() -> bool:
    root = _expand(settings.model_cache_dir)
    return (root / settings.kokoro_model_file).exists() and (root / settings.kokoro_voices_file).exists()


def _dir_size(path: Path, max_files: int = 2000) -> tuple[int, int]:
    if not path.exists():
        return 0, 0
    total = 0
    count = 0
    for child in path.rglob("*"):
        if count >= max_files:
            break
        if child.is_file():
            count += 1
            try:
                total += child.stat().st_size
            except OSError:
                continue
    return total, count


def _assert_repair_path(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if resolved == resolved.parent:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "unsafe_repair_path",
                "message": f"{label} points at a filesystem root and will not be modified.",
            },
        )
    return resolved


@router.get("/runtime/health-checks", response_model=RuntimeHealthChecksResponse)
async def runtime_health_checks() -> RuntimeHealthChecksResponse:
    model_root = _expand(settings.model_pack_root)
    clone_root = _expand(settings.clone_cache_dir)
    kokoro_root = _expand(settings.model_cache_dir)
    ffmpeg = shutil.which("ffmpeg")
    lip_sync = settings.lip_sync_binary.strip()
    checks: list[RuntimeCheck] = [
        RuntimeCheck(
            id="kokoro-models",
            label="Kokoro model files",
            status="ready" if _kokoro_ready() else "missing",
            detail=str(kokoro_root),
            repair_action=None if _kokoro_ready() else "provision_kokoro",
        ),
        RuntimeCheck(
            id="clone-storage",
            label="Voice clone storage",
            status="ready" if clone_root.exists() else "warning",
            detail=str(clone_root),
            repair_action=None if clone_root.exists() else "create_clone_folder",
        ),
        RuntimeCheck(
            id="ffmpeg",
            label="ffmpeg mux/export",
            status="ready" if ffmpeg else "missing",
            detail=ffmpeg or "ffmpeg not found on PATH",
            repair_action=None if ffmpeg else "install_ffmpeg",
        ),
        RuntimeCheck(
            id="lip-sync",
            label="Optional lip-sync runtime",
            status="ready" if lip_sync and Path(lip_sync).expanduser().exists() else "missing",
            detail=lip_sync or "No KURAL_LIP_SYNC_BINARY configured",
            repair_action=None if lip_sync else "configure_lip_sync_binary",
        ),
    ]
    storage_bytes, storage_files = _dir_size(model_root)
    status = "ready" if all(check.status == "ready" for check in checks[:2]) else "needs_setup"
    return RuntimeHealthChecksResponse(
        status=status,
        checks=checks,
        storage={
            "model_pack_root": str(model_root),
            "clone_cache_dir": str(clone_root),
            "model_bytes_sampled": storage_bytes,
            "model_files_sampled": storage_files,
            "ffmpeg_available": bool(ffmpeg),
        },
    )


@router.post("/runtime/repair", response_model=RuntimeRepairResponse, status_code=202)
async def repair_runtime(req: RuntimeRepairRequest) -> RuntimeRepairResponse:
    if req.action == "create_clone_folder":
        clone_root = _assert_repair_path(_expand(settings.clone_cache_dir), "Clone storage")
        clone_root.mkdir(parents=True, exist_ok=True)
        return RuntimeRepairResponse(
            action=req.action,
            status="complete",
            message=f"Created local voice clone storage at {clone_root}.",
            runtime=await runtime_health_checks(),
        )

    if req.action == "provision_kokoro":
        from .setup import provision_models

        setup_status = await provision_models()
        return RuntimeRepairResponse(
            action=req.action,
            status="complete" if setup_status.kokoro_ready else "started",
            message=(
                "Kokoro model files are ready."
                if setup_status.kokoro_ready
                else f"Started Kokoro model provisioning in {setup_status.model_dir}."
            ),
            runtime=await runtime_health_checks(),
        )

    if req.action == "install_ffmpeg":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "manual_repair_required",
                "message": "Install ffmpeg from a trusted source, then restart Kural so the local engine can find it on PATH.",
            },
        )

    raise HTTPException(
        status_code=409,
        detail={
            "code": "manual_repair_required",
            "message": "Configure KURAL_LIP_SYNC_BINARY to a vetted local lip-sync binary, then restart Kural.",
        },
    )


@router.get("/lip-sync/status", response_model=LipSyncStatusResponse)
async def lip_sync_status() -> LipSyncStatusResponse:
    configured = settings.lip_sync_binary.strip()
    if configured:
        binary = Path(configured).expanduser()
        if binary.exists():
            return LipSyncStatusResponse(
                available=True,
                provider=binary.name,
                detail=f"Configured local lip-sync binary: {binary}",
                safe_action="render_lip_sync",
            )
        return LipSyncStatusResponse(
            available=False,
            detail=f"Configured lip-sync binary does not exist: {binary}",
            safe_action="configure_lip_sync_binary",
        )
    return LipSyncStatusResponse(
        available=False,
        detail="Optional local lip-sync is not configured. Set KURAL_LIP_SYNC_BINARY to a vetted local binary.",
        safe_action="configure_lip_sync_binary",
    )


@router.post("/provenance/sidecar", response_model=ProvenanceSidecarResponse)
async def provenance_sidecar(req: ProvenanceSidecarRequest) -> ProvenanceSidecarResponse:
    generated_at = datetime.now(timezone.utc).isoformat()
    payload: dict[str, object] = {
        "project": {
            "id": req.project_id,
            "name": req.project_name,
        },
        "asset": {
            "name": req.asset_name,
            "format": req.export_format,
            "language": req.language,
            "text_sha256": req.text_sha256,
        },
        "voice": {
            "label": req.voice_label,
        },
        "watermark": {
            "enabled": req.watermark_enabled,
            "method": "sidecar-disclosure",
        },
        "segments": req.segments,
    }
    return ProvenanceSidecarResponse(
        generated_at=generated_at,
        disclosure="Synthetic audio generated locally with Kural.",
        payload=payload,
    )
