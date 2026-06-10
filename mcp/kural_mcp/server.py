"""Kural MCP server — exposes the Kural TTS platform to MCP clients.

Wraps a running Kural backend so MCP clients (Claude Code, Cursor, etc.)
can synthesize speech, list voices, and transcribe audio. The server is a
thin protocol adapter — all model work happens in the Kural backend.

Configuration (environment variables):
  KURAL_HOST     Backend base URL (default: http://localhost:8000)
  KURAL_API_KEY  Shared secret, only needed if the backend sets one

Deliberately omitted: voice cloning. Creating a cloned voice is
consent-gated in Kural and should stay a deliberate human action in the
UI or CLI, not something an autonomous agent triggers. This server can
*use* existing cloned voices but cannot create them.
"""
from __future__ import annotations

import os
import tempfile
import wave
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .client import KuralBackendError, KuralClient

mcp = FastMCP("kural")
_client = KuralClient()


def _wav_duration_s(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            return round(frames / rate, 2) if rate else None
    except (wave.Error, OSError):
        return None


def _resolve_output_path(output_path: str, fmt: str) -> Path:
    if output_path.strip():
        path = Path(output_path).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path
    fd, name = tempfile.mkstemp(prefix="kural_", suffix=f".{fmt}")
    os.close(fd)
    return Path(name)


@mcp.tool()
def list_voices(engine: str = "", language: str = "") -> list[dict]:
    """List available Kural TTS voices.

    Args:
        engine: Optional engine filter — "kokoro" or "supertonic".
        language: Optional language/locale filter, matched as a prefix
            (e.g. "en" matches en-US and en-GB; "hi" matches hi-IN).

    Returns a list of voice records with id, name, language, engine, and
    gender. Pass an `id` from this list as the `voice` argument to
    `synthesize`.
    """
    voices = _client.get_voices()
    if engine:
        voices = [v for v in voices if v.get("engine") == engine]
    if language:
        lang = language.lower()
        voices = [
            v
            for v in voices
            if str(v.get("language", "")).lower().startswith(lang)
            or str(v.get("locale", "")).lower().startswith(lang)
        ]
    return voices


@mcp.tool()
def list_cloned_voices() -> list[dict]:
    """List cloned voices saved in the Kural backend.

    Returns a list of cloned-voice records with id, name, and language.
    Pass an `id` from this list as the `voice_id` argument to
    `synthesize_with_cloned_voice`. To *create* a cloned voice, use the
    Kural desktop app or CLI — cloning is consent-gated and not exposed
    over MCP.
    """
    return _client.list_clones()


@mcp.tool()
def list_model_packs(category: str = "", include_jobs: bool = True) -> dict:
    """List Kural local model packs and background jobs.

    Args:
        category: Optional workflow filter — "tts", "asr", or
            "translation". Empty returns every pack.
        include_jobs: Include recent background job state.

    Returns model-pack records with id, status, license, capabilities,
    install path, and safe backend-supported actions. This is intentionally
    read-only from MCP: use the Kural app or HTTP API for installs/removals so
    license gates and large-download confirmations stay human-visible.
    """
    payload = _client.list_model_packs()
    packs = payload.get("packs", [])
    if category:
        if category not in {"tts", "asr", "translation"}:
            raise KuralBackendError(
                f"Unsupported category {category!r}; use 'tts', 'asr', or 'translation'."
            )
        packs = [pack for pack in packs if pack.get("category") == category]
    return {
        "packs": packs,
        "total": len(packs),
        "jobs": payload.get("jobs", []) if include_jobs else [],
    }


@mcp.tool()
def synthesize(
    text: str,
    voice: str = "af_bella",
    output_path: str = "",
    speed: float = 1.0,
    fmt: str = "wav",
) -> str:
    """Synthesize speech from text and write it to an audio file.

    Args:
        text: The text to speak.
        voice: A voice id from `list_voices` (default: af_bella, a Kokoro
            English voice). Supertonic voice ids look like `st_m1_hi`.
        output_path: Where to write the audio. If empty, a temp file is
            created and its path returned.
        speed: Speech rate, 0.5–2.0. Ignored by the Supertonic engine.
        fmt: "wav" or "mp3".

    Returns a human-readable summary including the absolute output path.
    """
    if fmt not in ("wav", "mp3"):
        raise KuralBackendError(f"Unsupported format {fmt!r}; use 'wav' or 'mp3'.")
    audio = _client.synthesize(text, voice=voice, speed=speed, fmt=fmt)
    path = _resolve_output_path(output_path, fmt)
    path.write_bytes(audio)
    duration = _wav_duration_s(path) if fmt == "wav" else None
    size_kb = round(len(audio) / 1024, 1)
    detail = f"{duration}s, " if duration else ""
    return f"Wrote {detail}{size_kb} KB to {path.resolve()} (voice: {voice})"


@mcp.tool()
def synthesize_with_cloned_voice(
    text: str,
    voice_id: str,
    output_path: str = "",
) -> str:
    """Synthesize speech using a previously cloned voice.

    Args:
        text: The text to speak.
        voice_id: A cloned-voice id from `list_cloned_voices`.
        output_path: Where to write the WAV. If empty, a temp file is
            created and its path returned.

    Cloned-voice synthesis always returns WAV. Returns a human-readable
    summary including the absolute output path.
    """
    audio = _client.synthesize(text, voice_id=voice_id, fmt="wav")
    path = _resolve_output_path(output_path, "wav")
    path.write_bytes(audio)
    duration = _wav_duration_s(path)
    size_kb = round(len(audio) / 1024, 1)
    detail = f"{duration}s, " if duration else ""
    return f"Wrote {detail}{size_kb} KB to {path.resolve()} (cloned voice: {voice_id})"


@mcp.tool()
def transcribe(audio_path: str, language: str = "", provider: str = "auto") -> dict:
    """Transcribe a local audio or video file using Kural's offline ASR.

    Args:
        audio_path: Path to a local audio or video file.
        language: Optional BCP-47 language hint (e.g. "en", "hi"). Empty
            lets the ASR engine auto-detect.
        provider: ASR provider — "auto", "faster-whisper", "vosk", or
            "whisper-cpp". "auto" picks the first configured provider.

    Returns the transcript text, detected language, provider, and
    timestamped segments. Requires the optional local-models runtime to
    be installed and provisioned in the backend.
    """
    return _client.transcribe(
        audio_path,
        language=language or None,
        provider=provider,
    )


def main() -> None:
    """Console-script entry point — runs the server over stdio."""
    mcp.run()


if __name__ == "__main__":
    main()
