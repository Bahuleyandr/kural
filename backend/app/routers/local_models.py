import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import settings
from ..local_models.asr import align_audio, transcribe_audio
from ..local_models.registry import local_model_inventory
from ..local_models.translation import LocalModelUnavailable, translate_text
from ..models import (
    AlignmentResponse,
    AlignmentWord,
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
        loop = asyncio.get_running_loop()
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
        loop = asyncio.get_running_loop()
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


@router.post("/align", response_model=AlignmentResponse)
async def align(
    file: UploadFile = File(..., description="Synthesized audio to align"),
    expected_text: str | None = Form(
        default=None,
        description="Optional ground-truth text. If provided, the response includes overrun_ms when alignment exceeds the expected duration.",
        max_length=20000,
    ),
    expected_duration_ms: int | None = Form(default=None, ge=0),
    language: str | None = Form(default=None, min_length=2, max_length=16),
) -> AlignmentResponse:
    """Word-level forced alignment used by the dubbing workspace.

    Returns word boundaries from faster-whisper's word_timestamps. When
    `expected_duration_ms` is supplied, also reports how many ms the audio
    overruns its budget so the frontend can suggest a speed bump.
    """
    content_type = file.content_type or "application/octet-stream"
    if content_type not in _ACCEPTED_TRANSCRIBE_MIME:
        raise HTTPException(
            status_code=415,
            detail=_error(
                "unsupported_media_type",
                f"Unsupported media type: {content_type}.",
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
                f"Alignment media must be {settings.transcribe_max_upload_mb} MB or smaller.",
            ),
        )

    try:
        loop = asyncio.get_running_loop()
        alignment = await loop.run_in_executor(
            _executor,
            lambda: align_audio(
                media_bytes,
                filename=file.filename,
                content_type=content_type,
                language=language,
            ),
        )
    except LocalModelUnavailable as exc:
        raise HTTPException(
            status_code=503,
            detail=_error("alignment_unavailable", str(exc)),
        ) from exc

    overrun = None
    if expected_duration_ms is not None and expected_duration_ms > 0:
        overrun = max(0, alignment.duration_ms - expected_duration_ms)

    return AlignmentResponse(
        provider=alignment.provider,
        duration_ms=alignment.duration_ms,
        transcript=alignment.transcript,
        language=alignment.language,
        expected_text=expected_text,
        expected_duration_ms=expected_duration_ms,
        overrun_ms=overrun,
        words=[
            AlignmentWord(
                text=word.text,
                start_ms=word.start_ms,
                end_ms=word.end_ms,
                probability=word.probability,
            )
            for word in alignment.words
        ],
    )
