from fastapi import APIRouter
from ..models import VoiceInfo, VoicesResponse
from ..tts.engine import get_voices as get_kokoro_voices
from ..tts.supertonic_engine import get_voices as get_supertonic_voices

router = APIRouter(tags=["voices"])


@router.get("/voices", response_model=VoicesResponse)
async def list_voices() -> VoicesResponse:
    raw = [*get_kokoro_voices(), *get_supertonic_voices()]
    voices = [VoiceInfo(**v) for v in raw]
    return VoicesResponse(voices=voices, total=len(voices))
