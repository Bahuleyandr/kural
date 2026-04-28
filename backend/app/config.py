from pydantic_settings import BaseSettings


class Settings(BaseSettings):
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

    class Config:
        env_file = ".env"


settings = Settings()
