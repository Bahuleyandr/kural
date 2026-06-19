from pydantic import BaseModel, Field
from typing import Literal, Optional


LocalModelCategory = Literal["tts", "asr", "translation"]
LocalModelStatus = Literal["ready", "not_configured", "not_installed", "disabled", "error"]
ModelPackAction = Literal["install", "update", "remove"]
BackgroundJobStatus = Literal["queued", "running", "succeeded", "failed", "canceled"]
CloneTier = Literal["quick", "professional"]
AllowedVoiceUse = Literal["personal", "commercial", "parody", "internal", "restricted"]


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
    trust_level: Optional[
        Literal["built_in", "verified_manifest", "user_supplied", "external_runtime"]
    ] = None
    manifest_digest: Optional[str] = None
    recommended: bool = False
    quality_score: int = Field(default=0, ge=0, le=100)
    latency_tier: Literal["realtime", "interactive", "batch", "manual"] = "manual"
    routing_hints: list[str] = Field(default_factory=list)
    compatibility: dict[str, str | int | bool | list[str]] = Field(default_factory=dict)
    community_pack: bool = False
    provenance_required: bool = False
    detail: Optional[str] = None
    actions: list[ModelPackAction] = Field(default_factory=list)


class ModelPacksResponse(BaseModel):
    packs: list[ModelPackInfo]
    jobs: list[BackgroundJob] = Field(default_factory=list)
    total: int


class ModelPackBenchmark(BaseModel):
    id: str
    name: str
    category: LocalModelCategory
    status: LocalModelStatus
    quality_score: int = Field(default=0, ge=0, le=100)
    naturalness_score: int = Field(default=0, ge=0, le=100)
    language_quality: int = Field(default=0, ge=0, le=100)
    latency_ms_estimate: int = Field(..., ge=0)
    memory_mb_estimate: int = Field(..., ge=0)
    best_for: list[str] = Field(default_factory=list)
    measured: bool = False
    detail: Optional[str] = None


class ModelPackBenchmarksResponse(BaseModel):
    benchmarks: list[ModelPackBenchmark]
    total: int


class ModelRouteRecommendation(BaseModel):
    language: str
    capability: str
    pack: Optional[ModelPackInfo] = None
    reason: str


class VoiceQualityBenchmarkRequest(BaseModel):
    language: str = Field(default="en-US", min_length=2, max_length=16)
    capability: str = Field(default="tts", max_length=40)
    use_case: Literal["narration", "dubbing", "clone", "agent", "audiobook"] = "narration"
    sample_scripts: list[str] = Field(default_factory=list, max_length=6)


class VoiceQualityBenchmarkResult(BaseModel):
    id: str
    name: str
    category: LocalModelCategory
    status: LocalModelStatus
    score: int = Field(..., ge=0, le=100)
    naturalness_score: int = Field(..., ge=0, le=100)
    language_quality: int = Field(..., ge=0, le=100)
    noise_score: int = Field(..., ge=0, le=100)
    latency_ms: int = Field(..., ge=0)
    memory_mb: int = Field(..., ge=0)
    measured: bool
    route_rank: int = Field(..., ge=1)
    best_for: list[str] = Field(default_factory=list)
    detail: Optional[str] = None


class VoiceQualityBenchmarkResponse(BaseModel):
    measured_at: str
    language: str
    capability: str
    use_case: str
    sample_scripts: list[str]
    results: list[VoiceQualityBenchmarkResult]
    recommendation: Optional[ModelRouteRecommendation] = None


class MarketplacePackManifest(BaseModel):
    id: str = Field(..., min_length=3, max_length=100)
    name: str = Field(..., min_length=1, max_length=120)
    version: str = Field(..., min_length=1, max_length=40)
    pack_type: Literal["voice", "model"]
    category: Optional[LocalModelCategory] = None
    provider: str = Field(default="community", max_length=80)
    source_url: Optional[str] = Field(default=None, max_length=500)
    checksum: Optional[str] = Field(default=None, max_length=96)
    license: str = Field(default="", max_length=120)
    languages: list[str] = Field(default_factory=list, max_length=64)
    capabilities: list[str] = Field(default_factory=list, max_length=64)
    allowed_uses: list[AllowedVoiceUse] = Field(default_factory=list)
    consent_proof: Optional[str] = Field(default=None, max_length=500)
    sample_sha256: Optional[str] = Field(default=None, max_length=96)
    signature: Optional[str] = Field(default=None, max_length=512)
    provenance_required: bool = True
    watermark_required: bool = True
    compatibility: dict[str, str | int | bool | list[str]] = Field(default_factory=dict)


class MarketplaceValidationIssue(BaseModel):
    code: str
    severity: Literal["error", "warning"]
    message: str


class MarketplaceValidationResponse(BaseModel):
    accepted: bool
    installable: bool
    # "signed" means a signature is present and there are no blocking errors —
    # NOT that Kural cryptographically verified it (it does not, yet).
    trust_level: Literal["signed", "review_required", "blocked"]
    score: int = Field(..., ge=0, le=100)
    manifest_digest: str
    errors: list[MarketplaceValidationIssue] = Field(default_factory=list)
    warnings: list[MarketplaceValidationIssue] = Field(default_factory=list)


class RuntimeCheck(BaseModel):
    id: str
    label: str
    status: Literal["ready", "warning", "missing", "error"]
    detail: str
    repair_action: Optional[str] = None


class RuntimeHealthChecksResponse(BaseModel):
    status: Literal["ready", "needs_setup", "error"]
    checks: list[RuntimeCheck]
    storage: dict[str, str | int | bool]


class RuntimeRepairRequest(BaseModel):
    action: Literal[
        "provision_kokoro",
        "create_clone_folder",
        "install_ffmpeg",
        "configure_lip_sync_binary",
    ]


class RuntimeRepairResponse(BaseModel):
    action: str
    status: Literal["complete", "started", "manual"]
    message: str
    runtime: RuntimeHealthChecksResponse


class LipSyncStatusResponse(BaseModel):
    available: bool
    provider: str = "none"
    detail: str
    supported_formats: list[str] = Field(default_factory=lambda: ["mp4", "wav"])
    safe_action: Optional[str] = None


class ProvenanceSidecarRequest(BaseModel):
    project_id: str = Field(..., min_length=1, max_length=160)
    project_name: str = Field(default="Kural project", max_length=200)
    asset_name: str = Field(default="Kural export", max_length=200)
    voice_label: str = Field(default="local voice", max_length=200)
    language: Optional[str] = Field(default=None, max_length=16)
    text_sha256: Optional[str] = Field(default=None, max_length=96)
    export_format: str = Field(default="wav", max_length=16)
    watermark_enabled: bool = False
    segments: list[dict[str, str | int | float | bool | None]] = Field(default_factory=list)


class ProvenanceSidecarResponse(BaseModel):
    schema_version: int = 1
    kind: str = "kural-synthetic-audio-provenance"
    generated_at: str
    local_only: bool = True
    disclosure: str
    payload: dict[str, object]


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


class TranslationGlossaryTerm(BaseModel):
    term: str = Field(..., min_length=1, max_length=200)
    replacement: str = Field(..., min_length=1, max_length=200)
    language: Optional[str] = Field(default=None, max_length=16)
    case_sensitive: bool = False


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    voice: str = Field(default="af_bella")
    voice_id: Optional[str] = Field(default=None, description="Cloned voice ID (overrides `voice` when set)")
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    format: Literal["wav", "mp3"] = Field(default="wav")
    ssml: bool = Field(default=False, description="Parse text as Kural's supported SSML subset.")
    controls: Optional[AudioControls] = None
    pronunciation_rules: list[PronunciationRule] = Field(default_factory=list, max_length=200)
    language: Optional[str] = Field(default=None, max_length=16)


class TranslationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    source_language: str = Field(..., min_length=2, max_length=16)
    target_language: str = Field(..., min_length=2, max_length=16)
    provider: Literal["auto", "argos", "indictrans2", "nllb"] = "auto"
    glossary: list[TranslationGlossaryTerm] = Field(default_factory=list)


class TranslationResponse(BaseModel):
    text: str
    source_language: str
    target_language: str
    provider: str


class TranscriptionSegment(BaseModel):
    start_ms: int = Field(..., ge=0)
    end_ms: int = Field(..., ge=0)
    text: str
    speaker: Optional[str] = None


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
    sample_sha256: Optional[str] = None
    allowed_uses: list[AllowedVoiceUse] = Field(default_factory=list)
    clone_tier: CloneTier = "quick"
    quality_score: Optional[int] = Field(default=None, ge=0, le=100)


class AgentTurnRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    mode: Literal["assistant", "workflow", "voiceover"] = "assistant"
    project_language: Optional[str] = Field(default=None, max_length=16)
    tool_context: list[str] = Field(default_factory=list)
    use_llm: bool = False
    llm_provider: Literal["deterministic", "ollama"] = "deterministic"
    llm_model: Optional[str] = Field(default=None, max_length=120)


class AgentTurnResponse(BaseModel):
    text: str
    intent: str
    tool_plan: list[str] = Field(default_factory=list)
    interruptible: bool = True
    local_only: bool = True
    llm_provider: str = "deterministic"
    llm_model: Optional[str] = None


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
