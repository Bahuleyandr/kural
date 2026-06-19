from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .version import APP_VERSION


def _kural_alias(*names: str) -> AliasChoices:
    """Accept both the documented ``KURAL_``-prefixed env var and the bare name.

    pydantic-settings binds a field to an env var matching the field name, so
    without an explicit alias a field like ``api_key`` only reads ``API_KEY`` —
    never ``KURAL_API_KEY``, which is what the docs, docker-compose, the desktop
    shell, and the MCP client all set. Listing both names here keeps the
    prefixed form (which everything actually exports) working while preserving
    the bare name for backwards compatibility.
    """
    return AliasChoices(*names)


class Settings(BaseSettings):
    # populate_by_name lets code still construct Settings(api_key=...) even
    # though the field carries a validation_alias.
    model_config = SettingsConfigDict(env_file=".env", populate_by_name=True)

    app_version: str = APP_VERSION
    tts_engine: str = "kokoro-onnx"
    sample_rate: int = 24000
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ]
    max_text_length: int = 10000

    # Optional shared-secret API key. When set (KURAL_API_KEY env var, or the
    # legacy bare API_KEY), all /api/* requests must send X-API-Key. Empty
    # string disables auth — the default for local single-user installs.
    api_key: str = Field(default="", validation_alias=_kural_alias("KURAL_API_KEY", "API_KEY"))

    # Per-IP rate limits, slowapi syntax. Synthesis is CPU-heavy; cloning
    # writes durable state, so it stays tighter.
    rate_limit_synthesize: str = "30/minute"
    rate_limit_clone: str = "5/minute"

    # Append-only consent audit log location.
    consent_log_path: str = "~/.cache/kural/consent.log"

    # Vendor-neutral, opt-in error reporting. Both must be set for any
    # outbound network traffic to occur.
    telemetry_opt_in: bool = Field(
        default=False,
        validation_alias=_kural_alias("KURAL_TELEMETRY_OPT_IN", "TELEMETRY_OPT_IN"),
    )
    telemetry_endpoint: str = Field(
        default="",
        validation_alias=_kural_alias("KURAL_TELEMETRY_ENDPOINT", "TELEMETRY_ENDPOINT"),
    )

    # Optional path to a JSON file describing extra Kokoro voice IDs the
    # frontend should expose. Each entry follows the same shape as the
    # built-in voices (id/name/language/locale/gender/description). The IDs
    # must already be present in the installed voices_file; this config is
    # only an alias / surfacing layer, not a model loader.
    user_voices_file: str = ""

    # Kokoro model file locations (relative to model_cache_dir)
    model_cache_dir: str = "~/.cache/kural/kokoro"
    kokoro_model_file: str = "kokoro-v1.0.int8.onnx"
    kokoro_voices_file: str = "voices-v1.0.bin"

    # Supertonic ONNX TTS — native multilingual (31 langs in v3). MIT-licensed
    # open weights from Hugging Face Supertone/supertonic-3. The supertonic
    # pip package handles the download into HF_HOME on first use; setting
    # this path overrides where the model and preset voices are cached.
    supertonic_model_dir: str = "~/.cache/kural/supertonic"

    # Chatterbox cloned voice storage
    clone_cache_dir: str = "~/.cache/kural/clones"
    clone_min_duration_s: float = 5.0
    clone_max_duration_s: float = 30.0
    clone_max_upload_mb: int = 25
    clone_archive_max_upload_mb: int = 250

    # Optional offline model packs for multilingual dubbing.
    # Kural never downloads these implicitly; point these at local model folders
    # after provisioning packs outside the app bundle.
    model_pack_root: str = "~/.cache/kural"
    local_asr_engine: str = "auto"
    local_translation_engine: str = "auto"
    transcribe_max_upload_mb: int = 250
    # Cap on concurrent /api/transcribe/stream WebSocket sessions (DoS guard).
    transcribe_stream_max_concurrent: int = 4
    faster_whisper_model_dir: str = "~/.cache/kural/asr/faster-whisper"
    vosk_model_dir: str = "~/.cache/kural/asr/vosk"
    whisper_cpp_binary: str = ""
    whisper_cpp_model_file: str = ""
    argos_package_dir: str = "~/.local/share/argos-translate/packages"
    argos_packages_dir: str = "~/.local/share/argos-translate/packages"
    indictrans2_model_dir: str = "~/.cache/kural/translation/indictrans2"
    enable_nllb: bool = False
    nllb_model_dir: str = "~/.cache/kural/translation/nllb"

    # Allow loading model directories with transformers `trust_remote_code=True`
    # (executes arbitrary Python shipped inside the checkpoint). OFF by default:
    # only enable if every configured model dir is fully trusted.
    allow_remote_model_code: bool = Field(
        default=False,
        validation_alias=_kural_alias(
            "KURAL_ALLOW_REMOTE_MODEL_CODE", "ALLOW_REMOTE_MODEL_CODE"
        ),
    )

    # Optional local agent and media tools. These are never launched from the
    # browser UI; Kural only probes or calls known local endpoints/binaries.
    ollama_url: str = Field(
        default="http://127.0.0.1:11434",
        validation_alias=_kural_alias("KURAL_OLLAMA_URL", "OLLAMA_URL"),
    )
    ollama_model: str = Field(
        default="llama3.1:8b",
        validation_alias=_kural_alias("KURAL_OLLAMA_MODEL", "OLLAMA_MODEL"),
    )
    lip_sync_binary: str = Field(
        default="",
        validation_alias=_kural_alias("KURAL_LIP_SYNC_BINARY", "LIP_SYNC_BINARY"),
    )


settings = Settings()
