from pydantic import BaseModel, Field
from typing import Literal


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    voice: str = Field(default="af_bella")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    format: Literal["wav", "mp3"] = Field(default="wav")


class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str
    gender: str
    description: str


class VoicesResponse(BaseModel):
    voices: list[VoiceInfo]
    total: int


class HealthResponse(BaseModel):
    status: str
    version: str
    engine: str
