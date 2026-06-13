"""Local voice-agent foundation routes."""
from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request

from fastapi import APIRouter

from ..config import settings
from ..models import AgentTurnRequest, AgentTurnResponse

router = APIRouter(tags=["agent"])


def _classify(message: str) -> tuple[str, list[str], str]:
    text = message.strip()
    lowered = text.lower()
    if any(token in lowered for token in ("transcribe", "subtitle", "srt", "vtt")):
        return (
            "dubbing",
            ["open_dubbing", "import_media_or_transcript", "run_local_asr", "review_segments"],
            "Open Dubbing Studio, import the media or transcript, then run local transcription and review speaker segments.",
        )
    if any(token in lowered for token in ("clone", "voice sample", "consent")):
        return (
            "clone",
            ["open_clone_studio", "record_guided_sample", "score_sample", "confirm_consent"],
            "Open Clone Studio, record a guided sample, check the readiness score, then confirm consent before creating the voice.",
        )
    if any(token in lowered for token in ("model", "install", "pack", "kokoro", "whisper", "argos")):
        return (
            "models",
            ["open_model_manager", "check_license", "install_pack", "rerun_benchmark"],
            "Open Model Packs, review license and disk size, then install the local pack and rerun the benchmark panel.",
        )
    if lowered.startswith("say "):
        return ("say", ["synthesize_response"], text[4:].strip() or "What would you like me to say?")
    if any(token in lowered for token in ("script", "ssml", "pronunciation", "glossary")):
        return (
            "script",
            ["open_script_studio", "validate_ssml", "apply_glossary", "save_restore_point"],
            "Use Script Studio to validate SSML, apply pronunciation rules, and save a restore point before rendering.",
        )
    return (
        "assistant",
        ["answer_locally", "optionally_synthesize_response"],
        "I can help with local voiceover, model packs, cloning, dubbing, SSML, pronunciation, and project export workflows.",
    )


def _ollama_generate(req: AgentTurnRequest, fallback: str) -> tuple[str, str] | None:
    base = settings.ollama_url.rstrip("/")
    if not base.startswith(("http://127.0.0.1", "http://localhost")):
        return None
    model = req.llm_model or settings.ollama_model
    prompt = (
        "You are Kural's local offline voice-workstation agent. "
        "Be concise, practical, and do not suggest cloud services. "
        f"Project language: {req.project_language or 'unknown'}.\n"
        f"Available tools: {', '.join(req.tool_context[:8]) or 'tts,dubbing,models,clone-studio'}.\n"
        f"User: {req.message.strip()}\n"
        f"Fallback answer if unsure: {fallback}"
    )
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.2},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    text = str(data.get("response") or "").strip()
    if not text:
        return None
    return text, model


@router.post("/agent/respond", response_model=AgentTurnResponse)
async def respond(req: AgentTurnRequest) -> AgentTurnResponse:
    """Return a local assistant turn.

    By default this stays deterministic and dependency-light. When the user
    opts in, Kural can call a loopback Ollama endpoint; failures fall back to
    the deterministic tool plan instead of breaking the workflow.
    """
    intent, tool_plan, response = _classify(req.message)
    language_note = f" Project language: {req.project_language}." if req.project_language else ""
    context_note = (
        f" Active tools: {', '.join(req.tool_context[:4])}."
        if req.tool_context
        else ""
    )
    provider = "deterministic"
    model = None
    if req.use_llm and req.llm_provider == "ollama":
        ollama = await asyncio.to_thread(_ollama_generate, req, response)
        if ollama is not None:
            response, model = ollama
            provider = "ollama"
    return AgentTurnResponse(
        text=f"{response}{language_note}{context_note}",
        intent=intent,
        tool_plan=tool_plan,
        interruptible=True,
        local_only=True,
        llm_provider=provider,
        llm_model=model,
    )
