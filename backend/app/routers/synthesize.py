import asyncio
import subprocess
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse

from ..models import SynthesizeRequest
from ..tts.engine import synthesize, synthesize_stream

router = APIRouter(tags=["synthesis"])
_executor = ThreadPoolExecutor(max_workers=2)


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
        )
    except FileNotFoundError as exc:
        raise RuntimeError("MP3 export requires ffmpeg on the backend host.") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"MP3 export failed: {detail}") from exc
    return result.stdout


@router.post("/synthesize")
async def synthesize_audio(req: SynthesizeRequest) -> Response:
    try:
        loop = asyncio.get_event_loop()

        if req.voice_id:
            # Cloned-voice path via Chatterbox
            from ..tts.chatterbox_engine import synthesize_cloned
            audio_bytes = await loop.run_in_executor(
                _executor,
                lambda: synthesize_cloned(req.text, req.voice_id),
            )
            media_type = "audio/wav"
            filename = "kural_speech.wav"
        else:
            # Standard Kokoro path
            audio_bytes = await loop.run_in_executor(
                _executor,
                lambda: synthesize(req.text, req.voice, req.speed),
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
async def synthesize_stream_audio(
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
