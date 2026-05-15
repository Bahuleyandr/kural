import asyncio
import json
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from ..auth import check_api_key
from ..config import settings
from ..local_models.asr import StreamingTranscriber, align_audio, transcribe_audio
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
# The WebSocket streaming route lives on its own router because the main
# router's require_api_key dependency uses APIKeyHeader, an HTTP-only
# Security scheme that can't resolve against a WebSocket handshake. The
# streaming route below self-authenticates via auth.check_api_key.
stream_router = APIRouter(tags=["local-models"])
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


@stream_router.websocket("/transcribe/stream")
async def transcribe_stream(websocket: WebSocket) -> None:
    """Incremental speech-to-text over WebSocket, backed by Vosk.

    Powers the desktop dictation widget. Protocol:
      - Connect with optional ``?language=<bcp47>&sample_rate=<hz>`` query
        params (sample_rate defaults to 16000).
      - Send binary frames of little-endian PCM16 mono audio.
      - Receive JSON frames: ``{"type": "partial"|"final", "text": ...}``.
        A "partial" is the in-progress hypothesis; a "final" lands when
        Vosk detects an utterance boundary.
      - Send ``{"type": "done"}`` (or just disconnect) to flush the
        trailing utterance — the server replies with one
        ``{"type": "final", "text": ..., "complete": true}`` and closes.

    Streaming is Vosk-only: faster-whisper and whisper.cpp are batch
    engines. If Vosk isn't configured the server accepts the socket,
    sends one ``{"type": "error", ...}`` frame, and closes — the widget
    can fall back to the batch `/api/transcribe` endpoint.

    Auth: when KURAL_API_KEY is set, pass it as the ``X-API-Key`` header
    or — for browser WebSocket clients that cannot set headers — as an
    ``?api_key=`` query param.
    """
    # Self-authenticate: this route isn't on the require_api_key router.
    # Browser WebSocket clients (the dictation widget) cannot set headers,
    # so a query param is accepted as a fallback.
    provided_key = (
        websocket.headers.get("x-api-key") or websocket.query_params.get("api_key")
    )
    if not check_api_key(provided_key):
        await websocket.close(code=1008)  # policy violation
        return

    await websocket.accept()

    language = websocket.query_params.get("language") or None
    try:
        sample_rate = int(websocket.query_params.get("sample_rate", "16000"))
    except ValueError:
        sample_rate = 16000

    try:
        transcriber = StreamingTranscriber(language=language, sample_rate=sample_rate)
    except LocalModelUnavailable as exc:
        await websocket.send_json(
            {"type": "error", "code": "local_asr_unavailable", "message": str(exc)}
        )
        await websocket.close(code=1011)
        return

    loop = asyncio.get_running_loop()
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break

            chunk = message.get("bytes")
            if chunk is not None:
                if not chunk:
                    continue
                result = await loop.run_in_executor(_executor, transcriber.accept, chunk)
                await websocket.send_json(result)
                continue

            text = message.get("text")
            if text is not None:
                try:
                    payload = json.loads(text)
                except ValueError:
                    continue
                if payload.get("type") == "done":
                    final = await loop.run_in_executor(_executor, transcriber.finalize)
                    await websocket.send_json(final)
                    break
    except WebSocketDisconnect:
        pass
    finally:
        # The client may already be gone (disconnect); closing twice is
        # harmless but can raise, so swallow it.
        try:
            await websocket.close()
        except RuntimeError:
            pass


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
