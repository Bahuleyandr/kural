"""Voice-cloning routes — upload a sample to create a persistent cloned voice."""
import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from ..models import ClonedVoiceInfo, ClonesListResponse
from ..tts.chatterbox_engine import (
    delete_cloned_voice,
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


@router.post("/voices/clone", response_model=ClonedVoiceInfo, status_code=201)
async def clone_voice(
    file: UploadFile = File(..., description="WAV or MP3 audio sample (5–30 s)"),
    name: str = Form(..., min_length=1, max_length=100),
) -> ClonedVoiceInfo:
    """Upload an audio sample and create a persistent cloned voice."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    try:
        loop = asyncio.get_event_loop()
        meta = await loop.run_in_executor(
            _executor,
            lambda: save_voice_sample(audio_bytes, name.strip()),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ClonedVoiceInfo(**meta)


@router.get("/voices/clones", response_model=ClonesListResponse)
async def list_clones() -> ClonesListResponse:
    """List all saved cloned voices."""
    clones = list_cloned_voices()
    return ClonesListResponse(
        clones=[ClonedVoiceInfo(**c) for c in clones],
        total=len(clones),
    )


@router.delete("/voices/clones/{voice_id}", status_code=204, response_class=Response)
async def delete_clone(voice_id: str) -> None:
    """Permanently delete a cloned voice and its sample file."""
    if not delete_cloned_voice(voice_id):
        raise HTTPException(status_code=404, detail=f"Cloned voice not found: {voice_id}")
