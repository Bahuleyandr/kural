import asyncio
import base64
import json
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

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
# Batch ASR/translation/alignment work.
_executor = ThreadPoolExecutor(max_workers=1)
# Dedicated pool for streaming dictation so long-lived sockets can't starve the
# batch endpoints (and vice-versa). Sized to the concurrency cap.
_stream_executor = ThreadPoolExecutor(
    max_workers=max(1, settings.transcribe_stream_max_concurrent)
)

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
_ACCEPTED_MUX_MEDIA_MIME = {
    "video/mp4",
    "video/quicktime",
    "application/octet-stream",
}
_ACCEPTED_MUX_AUDIO_MIME = {
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
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
            {
                "start_ms": segment.start_ms,
                "end_ms": segment.end_ms,
                "text": segment.text,
                "speaker": segment.speaker,
            }
            for segment in result.segments
        ],
    )


@router.post("/mux")
async def mux_dubbed_video(
    original: UploadFile = File(..., description="Original MP4/MOV video"),
    dubbed_audio: UploadFile = File(..., description="Kural-rendered WAV timeline"),
    output_name: str = Form("kural-dubbed.mp4", max_length=120),
) -> Response:
    """Mux a rendered Kural WAV timeline into an original video with ffmpeg.

    The command is fixed and argument-vector based. The UI supplies media
    bytes only; it cannot inject arbitrary shell commands.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(
            status_code=503,
            detail=_error("ffmpeg_unavailable", "Install ffmpeg on this computer to export muxed MP4."),
        )

    original_type = original.content_type or "application/octet-stream"
    audio_type = dubbed_audio.content_type or "application/octet-stream"
    if original_type not in _ACCEPTED_MUX_MEDIA_MIME:
        raise HTTPException(
            status_code=415,
            detail=_error("unsupported_media_type", f"Unsupported original media type: {original_type}."),
        )
    if audio_type not in _ACCEPTED_MUX_AUDIO_MIME:
        raise HTTPException(
            status_code=415,
            detail=_error("unsupported_audio_type", f"Unsupported dubbed audio type: {audio_type}."),
        )

    max_bytes = settings.transcribe_max_upload_mb * 1024 * 1024
    original_bytes = await original.read(max_bytes + 1)
    audio_bytes = await dubbed_audio.read(max_bytes + 1)
    if not original_bytes or not audio_bytes:
        raise HTTPException(
            status_code=422,
            detail=_error("empty_upload", "Original media and dubbed audio are both required."),
        )
    if len(original_bytes) > max_bytes or len(audio_bytes) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=_error(
                "upload_too_large",
                f"Mux inputs must each be {settings.transcribe_max_upload_mb} MB or smaller.",
            ),
        )

    safe_name = Path(output_name).name
    if not safe_name.lower().endswith(".mp4"):
        safe_name = f"{safe_name}.mp4"

    with tempfile.TemporaryDirectory(prefix="kural-mux-") as temp_dir:
        root = Path(temp_dir)
        original_path = root / "original.mp4"
        audio_path = root / "dubbed.wav"
        output_path = root / "dubbed.mp4"
        original_path.write_bytes(original_bytes)
        audio_path.write_bytes(audio_bytes)
        command = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(original_path),
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-shortest",
            str(output_path),
        ]
        try:
            subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=600)
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.decode("utf-8", errors="replace").strip() or "ffmpeg failed."
            raise HTTPException(
                status_code=422,
                detail=_error("mux_failed", detail[-800:]),
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(
                status_code=504,
                detail=_error("mux_timeout", "ffmpeg did not finish within 10 minutes."),
            ) from exc

        return Response(
            content=output_path.read_bytes(),
            media_type="video/mp4",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
        )


# Number of in-flight dictation streams (capped by
# settings.transcribe_stream_max_concurrent). Mutated only from the asyncio
# event loop, so a plain int is safe.
_active_streams = 0


_WS_KEY_SUBPROTOCOL_PREFIX = "kural-apikey."
_WS_SUBPROTOCOL = "kural.v1"


def _ws_offered_protocols(websocket: WebSocket) -> list[str]:
    raw = websocket.headers.get("sec-websocket-protocol", "")
    return [p.strip() for p in raw.split(",") if p.strip()]


def _ws_api_key(websocket: WebSocket) -> str | None:
    """Resolve the API key for a WebSocket handshake, preferring channels that
    keep the secret OUT of the URL/query string (which lands in access logs):

      1. ``X-API-Key`` header (non-browser clients).
      2. A ``kural-apikey.<base64url(key)>`` subprotocol token — browsers can't
         set headers but can offer subprotocols, which travel in the
         Sec-WebSocket-Protocol request header, not the URL.
      3. ``?api_key=`` query param — DEPRECATED (logged); kept for back-compat.
    """
    header_key = websocket.headers.get("x-api-key")
    if header_key:
        return header_key
    for proto in _ws_offered_protocols(websocket):
        if proto.startswith(_WS_KEY_SUBPROTOCOL_PREFIX):
            token = proto[len(_WS_KEY_SUBPROTOCOL_PREFIX) :]
            try:
                pad = "=" * (-len(token) % 4)
                return base64.urlsafe_b64decode(token + pad).decode("utf-8")
            except (ValueError, UnicodeDecodeError):
                return None
    return websocket.query_params.get("api_key")


@stream_router.websocket("/transcribe/stream")
async def transcribe_stream(websocket: WebSocket) -> None:
    """Incremental speech-to-text over WebSocket, backed by Vosk.

    Powers the desktop dictation widget. Protocol:
      - Connect with optional ``?language=<bcp47>&sample_rate=<hz>`` query
        params (sample_rate defaults to 16000, clamped to 8000-48000).
      - Send binary frames of little-endian PCM16 mono audio (each frame
        capped at ``transcribe_stream_max_frame_bytes``).
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

    Auth: when KURAL_API_KEY is set, pass it as the ``X-API-Key`` header,
    a ``kural-apikey.<base64url(key)>`` WebSocket subprotocol (browsers), or
    — deprecated — an ``?api_key=`` query param. See ``_ws_api_key``.
    """
    # Self-authenticate: this route isn't on the require_api_key router.
    if not check_api_key(_ws_api_key(websocket)):
        await websocket.close(code=1008)  # policy violation
        return

    # Cap concurrent streams so one client can't exhaust the executor / memory
    # by opening many sockets. Reject early (before accept) with 1013 "try again
    # later" rather than accepting and immediately tearing down.
    global _active_streams
    if _active_streams >= settings.transcribe_stream_max_concurrent:
        await websocket.close(code=1013)
        return

    # Echo back the non-secret subprotocol when offered so the browser's
    # subprotocol negotiation succeeds (it requires the server to select one).
    subprotocol = (
        _WS_SUBPROTOCOL if _WS_SUBPROTOCOL in _ws_offered_protocols(websocket) else None
    )
    await websocket.accept(subprotocol=subprotocol)
    _active_streams += 1
    try:
        language = websocket.query_params.get("language") or None
        try:
            sample_rate = int(websocket.query_params.get("sample_rate", "16000"))
        except ValueError:
            sample_rate = 16000
        sample_rate = max(8000, min(sample_rate, 48000))

        try:
            transcriber = StreamingTranscriber(language=language, sample_rate=sample_rate)
        except LocalModelUnavailable as exc:
            await websocket.send_json(
                {"type": "error", "code": "local_asr_unavailable", "message": str(exc)}
            )
            await websocket.close(code=1011)
            return

        loop = asyncio.get_running_loop()
        max_frame = settings.transcribe_stream_max_frame_bytes
        idle_timeout = settings.transcribe_stream_idle_timeout_s
        try:
            while True:
                try:
                    message = await asyncio.wait_for(websocket.receive(), timeout=idle_timeout)
                except asyncio.TimeoutError:
                    await websocket.close(code=1000)  # idle: normal closure
                    break
                if message["type"] == "websocket.disconnect":
                    break

                chunk = message.get("bytes")
                if chunk is not None:
                    if not chunk:
                        continue
                    if len(chunk) > max_frame:
                        await websocket.close(code=1009)  # message too big
                        break
                    if len(chunk) % 2:
                        # PCM16 is 2 bytes/sample; drop malformed odd-length frames.
                        continue
                    result = await loop.run_in_executor(
                        _stream_executor, transcriber.accept, chunk
                    )
                    await websocket.send_json(result)
                    continue

                text = message.get("text")
                if text is not None:
                    try:
                        payload = json.loads(text)
                    except ValueError:
                        continue
                    if payload.get("type") == "done":
                        final = await loop.run_in_executor(
                            _stream_executor, transcriber.finalize
                        )
                        await websocket.send_json(final)
                        break
        except WebSocketDisconnect:
            pass
    finally:
        _active_streams -= 1
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
