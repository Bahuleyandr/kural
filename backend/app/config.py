from pydantic_settings import BaseSettings, SettingsConfigDict

from .version import APP_VERSION


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

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

    # Optional shared-secret API key. When set (KURAL_API_KEY env var), all
    # /api/* requests must send X-API-Key. Empty string disables auth — the
    # default for local single-user installs.
    api_key: str = ""

    # Per-IP rate limits, slowapi syntax. Synthesis is CPU-heavy; cloning
    # writes durable state, so it stays tighter.
    rate_limit_synthesize: str = "30/minute"
    rate_limit_clone: str = "5/minute"

    # Append-only consent audit log location.
    consent_log_path: str = "~/.cache/kural/consent.log"

    # Vendor-neutral, opt-in error reporting. Both must be set for any
    # outbound network traffic to occur.
    telemetry_opt_in: bool = False
    telemetry_endpoint: str = ""

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

    # Chatterbox cloned voice storage
    clone_cache_dir: str = "~/.cache/kural/clones"
    clone_min_duration_s: float = 5.0
    clone_max_duration_s: float = 30.0
    clone_max_upload_mb: int = 25
    clone_archive_max_upload_mb: int = 250

    # Optional offline model packs for multilingual dubbing.
    # Kural never downloads these implicitly; point these at local model folders
    # after provisioning packs outside the app bundle.
    local_asr_engine: str = "auto"
    local_translation_engine: str = "auto"
    transcribe_max_upload_mb: int = 250
    faster_whisper_model_dir: str = "~/.cache/kural/asr/faster-whisper"
    vosk_model_dir: str = "~/.cache/kural/asr/vosk"
    whisper_cpp_binary: str = ""
    whisper_cpp_model_file: str = ""
    argos_package_dir: str = "~/.local/share/argos-translate/packages"
    argos_packages_dir: str = "~/.local/share/argos-translate/packages"
    indictrans2_model_dir: str = "~/.cache/kural/translation/indictrans2"
    enable_nllb: bool = False
    nllb_model_dir: str = "~/.cache/kural/translation/nllb"


settings = Settings()
