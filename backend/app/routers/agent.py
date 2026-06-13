"""Local voice-agent foundation routes."""
from fastapi import APIRouter

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


@router.post("/agent/respond", response_model=AgentTurnResponse)
async def respond(req: AgentTurnRequest) -> AgentTurnResponse:
    """Return a local, deterministic assistant turn.

    Public Beta keeps this local and dependency-light. A future local LLM
    adapter can swap in behind the same response shape without changing the UI.
    """
    intent, tool_plan, response = _classify(req.message)
    language_note = f" Project language: {req.project_language}." if req.project_language else ""
    context_note = (
        f" Active tools: {', '.join(req.tool_context[:4])}."
        if req.tool_context
        else ""
    )
    return AgentTurnResponse(
        text=f"{response}{language_note}{context_note}",
        intent=intent,
        tool_plan=tool_plan,
        interruptible=True,
        local_only=True,
    )
