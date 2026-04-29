import asyncio
import subprocess
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from ..config import settings
from ..models import SynthesizeRequest
from ..rate_limit import limiter
from ..tts.audio import process_wav_audio
from ..tts.pronunciation import apply_pronunciation_rules
from ..tts.ssml import BreakSegment, TextSegment, parse_ssml, stitch_wav_sequence
from ..tts.engine import synthesize, synthesize_stream

router = APIRouter(tags=["synthesis"])
_executor = ThreadPoolExecutor(max_workers=2)
_FFMPEG_TIMEOUT_S = 60


def _error(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _wav_to_mp3(audio_bytes: bytes) -> bytes:
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "mp3",
                "-codec:a",
                "libmp3lame",
                "pipe:1",
            ],
            input=audio_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            timeout=_FFMPEG_TIMEOUT_S,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("MP3 export requires ffmpeg on the backend host.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"MP3 export timed out after {_FFMPEG_TIMEOUT_S}s.") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"MP3 export failed: {detail}") from exc
    return result.stdout


def _controls(req: SynthesizeRequest):
    return req.controls


def _effective_speed(req: SynthesizeRequest) -> float:
    return req.controls.speed if req.controls else req.speed


def _pause_scale(req: SynthesizeRequest) -> float:
    return req.controls.pause_scale if req.controls else 1.0


def _prepared_text(req: SynthesizeRequest) -> str:
    return apply_pronunciation_rules(req.text, req.pronunciation_rules, req.language)


def _synthesize_ssml(req: SynthesizeRequest) -> bytes:
    segments = parse_ssml(req.text, req.pronunciation_rules, req.language)
    parts: list[bytes | BreakSegment] = []
    speed = _effective_speed(req)

    if req.voice_id:
        from ..tts.chatterbox_engine import synthesize_cloned

        for segment in segments:
            if isinstance(segment, TextSegment):
                parts.append(synthesize_cloned(segment.text, req.voice_id))
            else:
                parts.append(segment)
        return stitch_wav_sequence(parts, pause_scale=_pause_scale(req))

    for segment in segments:
        if isinstance(segment, TextSegment):
            parts.append(synthesize(segment.text, req.voice, speed))
        else:
            parts.append(segment)
    return stitch_wav_sequence(parts, pause_scale=_pause_scale(req))


@router.post("/synthesize")
@limiter.limit(lambda: settings.rate_limit_synthesize)
async def synthesize_audio(request: Request, req: SynthesizeRequest) -> Response:
    try:
        loop = asyncio.get_running_loop()

        if req.voice_id:
            # Cloned-voice path via Chatterbox
            from ..tts.chatterbox_engine import synthesize_cloned
            audio_bytes = await loop.run_in_executor(
                _executor,
                lambda: _synthesize_ssml(req)
                if req.ssml
                else synthesize_cloned(_prepared_text(req), req.voice_id),
            )
            audio_bytes = await loop.run_in_executor(
                _executor,
                lambda: process_wav_audio(audio_bytes, _controls(req)),
            )
            media_type = "audio/wav"
            filename = "kural_speech.wav"
        else:
            # Standard Kokoro path
            audio_bytes = await loop.run_in_executor(
                _executor,
                lambda: _synthesize_ssml(req)
                if req.ssml
                else synthesize(_prepared_text(req), req.voice, _effective_speed(req)),
            )
            audio_bytes = await loop.run_in_executor(
                _executor,
                lambda: process_wav_audio(audio_bytes, _controls(req)),
            )
            if req.format == "mp3":
                audio_bytes = await loop.run_in_executor(
                    _executor,
                    lambda: _wav_to_mp3(audio_bytes),
                )
            media_type = "audio/mpeg" if req.format == "mp3" else "audio/wav"
            filename = f"kural_speech.{req.format}"

    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=_error("tts_unavailable", str(exc)),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=_error("invalid_synthesis_request", str(exc)),
        ) from exc

    return Response(
        content=audio_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/synthesize/stream")
@limiter.limit(lambda: settings.rate_limit_synthesize)
async def synthesize_stream_audio(
    request: Request,
    text: str = Query(..., min_length=1, max_length=10000),
    voice: str = Query(default="af_bella"),
    speed: float = Query(default=1.0, ge=0.5, le=2.0),
) -> StreamingResponse:
    async def _gen():
        try:
            async for chunk in synthesize_stream(text, voice, speed):
                yield chunk
        except RuntimeError as exc:
            raise exc

    return StreamingResponse(
        _gen(),
        media_type="audio/wav",
        headers={"X-Accel-Buffering": "no"},
    )
