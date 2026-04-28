from fastapi import APIRouter
from ..models import VoiceInfo, VoicesResponse
from ..tts.engine import get_voices

router = APIRouter(tags=["voices"])


@router.get("/voices", response_model=VoicesResponse)
async def list_voices() -> VoicesResponse:
    raw = get_voices()
    voices = [VoiceInfo(**v) for v in raw]
    return VoicesResponse(voices=voices, total=len(voices))
