from pydantic import BaseModel, Field
from typing import Literal, Optional


class AudioControls(BaseModel):
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    pitch_semitones: float = Field(default=0.0, ge=-6.0, le=6.0)
    volume_db: float = Field(default=0.0, ge=-12.0, le=6.0)
    normalize: bool = False
    trim_silence: bool = False
    pause_scale: float = Field(default=1.0, ge=0.25, le=3.0)


class PronunciationRule(BaseModel):
    id: str = Field(..., min_length=1, max_length=80)
    pattern: str = Field(..., min_length=1, max_length=200)
    replacement: str = Field(..., min_length=1, max_length=200)
    mode: Literal["literal", "word"] = "literal"
    case_sensitive: bool = False
    language: Optional[str] = Field(default=None, max_length=16)
    enabled: bool = True
    priority: int = 0


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    voice: str = Field(default="af_bella")
    voice_id: Optional[str] = Field(default=None, description="Cloned voice ID (overrides `voice` when set)")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    format: Literal["wav", "mp3"] = Field(default="wav")
    ssml: bool = Field(default=False, description="Parse text as Kural's supported SSML subset.")
    controls: Optional[AudioControls] = None
    pronunciation_rules: list[PronunciationRule] = Field(default_factory=list)
    language: Optional[str] = Field(default=None, max_length=16)


class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str
    gender: str
    description: str
    locale: Optional[str] = None
    engine: str = "kokoro"
    capabilities: list[str] = Field(default_factory=list)


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
    language: Optional[str] = None
    locale: Optional[str] = None
    capabilities: list[str] = Field(default_factory=lambda: ["voice-clone", "wav"])


class ClonesListResponse(BaseModel):
    clones: list[ClonedVoiceInfo]
    total: int


class ClonesImportResponse(BaseModel):
    imported: list[ClonedVoiceInfo]
    total: int


class HealthResponse(BaseModel):
    status: str
    version: str
    engine: str
