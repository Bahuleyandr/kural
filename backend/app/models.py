from pydantic import BaseModel, Field
from typing import Literal, Optional


LocalModelCategory = Literal["tts", "asr", "translation"]
LocalModelStatus = Literal["ready", "not_configured", "not_installed", "disabled", "error"]
ModelPackAction = Literal["install", "update", "remove"]
BackgroundJobStatus = Literal["queued", "running", "succeeded", "failed", "canceled"]


class LocalModelInfo(BaseModel):
    id: str
    name: str
    category: LocalModelCategory
    provider: str
    status: LocalModelStatus
    languages: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    license: Optional[str] = None
    path: Optional[str] = None
    detail: Optional[str] = None


class LocalModelsResponse(BaseModel):
    models: list[LocalModelInfo]
    total: int


class BackgroundJob(BaseModel):
    id: str
    kind: str
    status: BackgroundJobStatus
    progress: int = Field(default=0, ge=0, le=100)
    message: str = ""
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None


class ModelPackInfo(BaseModel):
    id: str
    name: str
    category: LocalModelCategory
    provider: str
    status: LocalModelStatus
    version: str
    source_url: Optional[str] = None
    checksum: Optional[str] = None
    license: Optional[str] = None
    disk_size_mb: Optional[int] = None
    installed_path: Optional[str] = None
    languages: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    requires_confirmation: bool = False
    non_commercial: bool = False
    detail: Optional[str] = None
    actions: list[ModelPackAction] = Field(default_factory=list)


class ModelPacksResponse(BaseModel):
    packs: list[ModelPackInfo]
    jobs: list[BackgroundJob] = Field(default_factory=list)
    total: int


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


class TranslationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    source_language: str = Field(..., min_length=2, max_length=16)
    target_language: str = Field(..., min_length=2, max_length=16)
    provider: Literal["auto", "argos", "indictrans2", "nllb"] = "auto"


class TranslationResponse(BaseModel):
    text: str
    source_language: str
    target_language: str
    provider: str


class TranscriptionSegment(BaseModel):
    start_ms: int = Field(..., ge=0)
    end_ms: int = Field(..., ge=0)
    text: str


class TranscriptionResponse(BaseModel):
    text: str
    language: Optional[str] = None
    provider: str
    segments: list[TranscriptionSegment] = Field(default_factory=list)


class AlignmentWord(BaseModel):
    text: str
    start_ms: int = Field(..., ge=0)
    end_ms: int = Field(..., ge=0)
    probability: Optional[float] = None


class AlignmentResponse(BaseModel):
    provider: str
    duration_ms: int = Field(..., ge=0)
    transcript: str
    language: Optional[str] = None
    expected_text: Optional[str] = None
    expected_duration_ms: Optional[int] = Field(default=None, ge=0)
    overrun_ms: Optional[int] = Field(default=None, ge=0)
    words: list[AlignmentWord] = Field(default_factory=list)


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
