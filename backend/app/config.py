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
    ]
    max_text_length: int = 10000

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


settings = Settings()
