from pydantic import BaseModel, Field
from typing import Literal, Optional


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    voice: str = Field(default="af_bella")
    voice_id: Optional[str] = Field(default=None, description="Cloned voice ID (overrides `voice` when set)")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    format: Literal["wav", "mp3"] = Field(default="wav")
    ssml: bool = Field(default=False, description="Parse text as Kural's supported SSML subset.")


class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str
    gender: str
    description: str


class VoicesResponse(BaseModel):
    voices: list[VoiceInfo]
    total: int


class ClonedVoiceInfo(BaseModel):
    id: str
    name: str
    engine: str = "chatterbox"
    duration_s: float
    sample_rate: int
    created_at: str
    consent_confirmed: bool = False
    watermark: Optional[str] = None


class ClonesListResponse(BaseModel):
    clones: list[ClonedVoiceInfo]
    total: int


class HealthResponse(BaseModel):
    status: str
    version: str
    engine: str
