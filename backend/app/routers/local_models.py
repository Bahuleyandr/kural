import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import settings
from ..local_models.asr import transcribe_audio
from ..local_models.registry import local_model_inventory
from ..local_models.translation import LocalModelUnavailable, translate_text
from ..models import (
    LocalModelsResponse,
    TranscriptionResponse,
    TranslationRequest,
    TranslationResponse,
)

router = APIRouter(tags=["local-models"])
_executor = ThreadPoolExecutor(max_workers=1)

_ACCEPTED_TRANSCRIBE_MIME = {
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "video/mp4",
    "video/quicktime",
    "application/octet-stream",
}


def _error(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


@router.get("/local-models", response_model=LocalModelsResponse)
async def list_local_models() -> LocalModelsResponse:
    models = local_model_inventory()
    return LocalModelsResponse(models=models, total=len(models))


@router.post("/translate", response_model=TranslationResponse)
async def translate(req: TranslationRequest) -> TranslationResponse:
    try:
        loop = asyncio.get_event_loop()
        text, provider = await loop.run_in_executor(_executor, lambda: translate_text(req))
    except LocalModelUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail=_error("local_translation_unavailable", str(exc)),
        ) from exc

    return TranslationResponse(
        text=text,
        source_language=req.source_language,
        target_language=req.target_language,
        provider=provider,
    )


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    file: UploadFile = File(..., description="Audio or video file for local ASR"),
    language: str | None = Form(None, min_length=2, max_length=16),
    provider: str = Form("auto"),
) -> TranscriptionResponse:
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _ACCEPTED_TRANSCRIBE_MIME:
        raise HTTPException(
            status_code=415,
            detail=_error(
                "unsupported_media_type",
                f"Unsupported media type: {content_type}. Upload audio or MP4/MOV video.",
            ),
        )

    max_bytes = settings.transcribe_max_upload_mb * 1024 * 1024
    media_bytes = await file.read(max_bytes + 1)
    if not media_bytes:
        raise HTTPException(
            status_code=422,
            detail=_error("empty_upload", "Uploaded media is empty."),
        )
    if len(media_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=_error(
                "upload_too_large",
                f"Transcription media must be {settings.transcribe_max_upload_mb} MB or smaller.",
            ),
        )

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _executor,
            lambda: transcribe_audio(
                media_bytes,
                filename=file.filename,
                content_type=content_type,
                language=language,
                provider=provider,
            ),
        )
    except LocalModelUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail=_error("local_asr_unavailable", str(exc)),
        ) from exc

    return TranscriptionResponse(
        text=result.text,
        language=result.language,
        provider=result.provider,
        segments=[
            {"start_ms": segment.start_ms, "end_ms": segment.end_ms, "text": segment.text}
            for segment in result.segments
        ],
    )
