"""Voice-cloning routes — upload a sample to create a persistent cloned voice."""
import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response

from ..config import settings
from ..models import ClonedVoiceInfo, ClonesImportResponse, ClonesListResponse
from ..tts.chatterbox_engine import (
    delete_cloned_voice,
    export_cloned_voices,
    import_voice_archive,
    list_cloned_voices,
    save_voice_sample,
)

router = APIRouter(tags=["voice-cloning"])
_executor = ThreadPoolExecutor(max_workers=1)

_ACCEPTED_MIME = {
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "application/octet-stream",  # some browsers send this for WAV
}
_ACCEPTED_ARCHIVE_MIME = {
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
}


def _error(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


@router.post("/voices/clone", response_model=ClonedVoiceInfo, status_code=201)
async def clone_voice(
    file: UploadFile = File(..., description="WAV or MP3 audio sample (5–30 s)"),
    name: str = Form(..., min_length=1, max_length=100),
    consent_confirmed: bool = Form(
        False,
        description="Must be true to confirm consent to clone this voice.",
    ),
) -> ClonedVoiceInfo:
    """Upload an audio sample and create a persistent cloned voice."""
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(
            status_code=422,
            detail=_error("blank_voice_name", "Voice name cannot be blank."),
        )

    if not consent_confirmed:
        raise HTTPException(
            status_code=422,
            detail=_error(
                "voice_consent_required",
                "Confirm you have consent to clone this voice before uploading.",
            ),
        )

    content_type = file.content_type or "application/octet-stream"
    if content_type not in _ACCEPTED_MIME:
        raise HTTPException(
            status_code=415,
            detail=_error(
                "unsupported_audio_type",
                f"Unsupported audio type: {content_type}. Upload WAV or MP3 audio.",
            ),
        )

    max_bytes = settings.clone_max_upload_mb * 1024 * 1024
    audio_bytes = await file.read(max_bytes + 1)
    if not audio_bytes:
        raise HTTPException(
            status_code=422,
            detail=_error("empty_upload", "Uploaded file is empty."),
        )
    if len(audio_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=_error(
                "upload_too_large",
                f"Audio sample must be {settings.clone_max_upload_mb} MB or smaller.",
            ),
        )

    try:
        loop = asyncio.get_event_loop()
        meta = await loop.run_in_executor(
            _executor,
            lambda: save_voice_sample(audio_bytes, clean_name, consent_confirmed=True),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=_error("invalid_audio_sample", str(exc)),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=_error("voice_clone_unavailable", str(exc)),
        ) from exc

    return ClonedVoiceInfo(**meta)


@router.get("/voices/clones", response_model=ClonesListResponse)
async def list_clones() -> ClonesListResponse:
    """List all saved cloned voices."""
    clones = list_cloned_voices()
    return ClonesListResponse(
        clones=[ClonedVoiceInfo(**c) for c in clones],
        total=len(clones),
    )


@router.get("/voices/clones/export")
async def export_clones(
    voice_id: list[str] | None = Query(
        default=None,
        description="Optional cloned voice IDs to include. Defaults to all clones.",
    ),
) -> Response:
    """Export cloned voices as a portable Kural zip archive."""
    try:
        archive_bytes = export_cloned_voices(voice_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=_error("invalid_voice_archive_request", str(exc)),
        ) from exc

    return Response(
        content=archive_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="kural-voices.zip"'},
    )


@router.post("/voices/clones/import", response_model=ClonesImportResponse)
async def import_clones(
    file: UploadFile = File(..., description="Kural voice archive zip"),
) -> ClonesImportResponse:
    """Import cloned voices from a Kural zip archive."""
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _ACCEPTED_ARCHIVE_MIME:
        raise HTTPException(
            status_code=415,
            detail=_error(
                "unsupported_archive_type",
                f"Unsupported archive type: {content_type}. Upload a zip file.",
            ),
        )

    max_bytes = settings.clone_archive_max_upload_mb * 1024 * 1024
    archive_bytes = await file.read(max_bytes + 1)
    if not archive_bytes:
        raise HTTPException(
            status_code=422,
            detail=_error("empty_archive", "Uploaded archive is empty."),
        )
    if len(archive_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=_error(
                "archive_too_large",
                f"Voice archive must be {settings.clone_archive_max_upload_mb} MB or smaller.",
            ),
        )

    try:
        loop = asyncio.get_event_loop()
        imported = await loop.run_in_executor(
            _executor,
            lambda: import_voice_archive(archive_bytes),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=_error("invalid_voice_archive", str(exc)),
        ) from exc

    return ClonesImportResponse(
        imported=[ClonedVoiceInfo(**meta) for meta in imported],
        total=len(imported),
    )


@router.delete("/voices/clones/{voice_id}", status_code=204, response_class=Response)
async def delete_clone(voice_id: str) -> None:
    """Permanently delete a cloned voice and its sample file."""
    try:
        deleted = delete_cloned_voice(voice_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=_error("invalid_voice_id", str(exc)),
        ) from exc
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=_error("voice_not_found", f"Cloned voice not found: {voice_id}"),
        )
