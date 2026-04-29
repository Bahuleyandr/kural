import importlib.util
import os
from pathlib import Path

from ..config import settings
from ..models import LocalModelInfo


def _expand(value: str) -> Path | None:
    clean = value.strip()
    return Path(clean).expanduser() if clean else None


def _module_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _has_files(path: Path | None) -> bool:
    return bool(path and path.exists() and any(path.iterdir()))


def _file_ready(path: str) -> bool:
    candidate = _expand(path)
    return bool(candidate and candidate.is_file())


def _path_text(path: Path | None) -> str | None:
    return str(path) if path else None


def _argos_dir() -> Path | None:
    return _expand(settings.argos_packages_dir or settings.argos_package_dir)


def _configure_argos_dir() -> Path | None:
    argos_dir = _argos_dir()
    if argos_dir:
        os.environ["ARGOS_PACKAGES_DIR"] = str(argos_dir)
    return argos_dir


def _argos_language_pairs() -> list[str]:
    _configure_argos_dir()
    try:
        from argostranslate import translate

        pairs: list[str] = []
        for source in translate.get_installed_languages():
            for target in source.translations_from:
                pairs.append(f"{source.code}->{target.to_lang.code}")
        return sorted(set(pairs))
    except Exception:
        return []


def local_model_inventory() -> list[LocalModelInfo]:
    kokoro_dir = _expand(settings.model_cache_dir)
    kokoro_ready = bool(
        kokoro_dir
        and (kokoro_dir / settings.kokoro_model_file).is_file()
        and (kokoro_dir / settings.kokoro_voices_file).is_file()
    )
    chatterbox_installed = _module_available("chatterbox")

    whisper_dir = _expand(settings.faster_whisper_model_dir)
    vosk_dir = _expand(settings.vosk_model_dir)
    argos_dir = _configure_argos_dir()
    indic_dir = _expand(settings.indictrans2_model_dir)
    nllb_dir = _expand(settings.nllb_model_dir)

    argos_installed = _module_available("argostranslate")
    argos_pairs = _argos_language_pairs() if argos_installed else []
    whisper_installed = _module_available("faster_whisper")
    vosk_installed = _module_available("vosk")
    transformers_installed = _module_available("transformers")

    return [
        LocalModelInfo(
            id="kokoro-v1-onnx",
            name="Kokoro v1.0 ONNX",
            category="tts",
            provider="kokoro",
            status="ready" if kokoro_ready else "not_configured",
            languages=[
                "en-US",
                "en-GB",
                "ja-JP",
                "zh-CN",
                "it-IT",
                "fr-FR",
                "es-ES",
                "hi-IN",
                "pt-BR",
            ],
            capabilities=["tts", "ssml", "wav", "mp3", "advanced-controls"],
            license="Apache-2.0",
            path=_path_text(kokoro_dir),
            detail=None if kokoro_ready else "Run backend/scripts/download_models.py to provision Kokoro files.",
        ),
        LocalModelInfo(
            id="chatterbox-local",
            name="Chatterbox local voice cloning",
            category="tts",
            provider="chatterbox",
            status="ready" if chatterbox_installed else "not_installed",
            languages=["multilingual"],
            capabilities=["voice-clone", "wav", "watermark"],
            license="MIT",
            detail=None if chatterbox_installed else "Install backend/requirements-clone.txt to enable cloning.",
        ),
        LocalModelInfo(
            id="faster-whisper",
            name="faster-whisper",
            category="asr",
            provider="faster-whisper",
            status="ready"
            if whisper_installed and _has_files(whisper_dir)
            else "not_configured"
            if whisper_installed
            else "not_installed",
            languages=["multilingual"],
            capabilities=["transcribe", "segments", "cpu"],
            license="MIT",
            path=_path_text(whisper_dir),
            detail=None
            if whisper_installed and _has_files(whisper_dir)
            else "Install faster-whisper and set FASTER_WHISPER_MODEL_DIR to a local model folder.",
        ),
        LocalModelInfo(
            id="vosk",
            name="Vosk offline ASR",
            category="asr",
            provider="vosk",
            status="ready"
            if vosk_installed and _has_files(vosk_dir)
            else "not_configured"
            if vosk_installed
            else "not_installed",
            languages=["model-dependent"],
            capabilities=["transcribe", "cpu", "small-models"],
            license="Apache-2.0",
            path=_path_text(vosk_dir),
            detail=None if vosk_installed and _has_files(vosk_dir) else "Install vosk and point VOSK_MODEL_DIR at one local model.",
        ),
        LocalModelInfo(
            id="whisper-cpp",
            name="whisper.cpp",
            category="asr",
            provider="whisper.cpp",
            status="ready"
            if _file_ready(settings.whisper_cpp_binary) and _file_ready(settings.whisper_cpp_model_file)
            else "not_configured",
            languages=["multilingual"],
            capabilities=["transcribe", "external-binary", "cpu"],
            license="MIT",
            path=settings.whisper_cpp_model_file or None,
            detail=None
            if _file_ready(settings.whisper_cpp_binary) and _file_ready(settings.whisper_cpp_model_file)
            else "Set WHISPER_CPP_BINARY and WHISPER_CPP_MODEL_FILE to use whisper.cpp.",
        ),
        LocalModelInfo(
            id="argos-translate",
            name="Argos Translate",
            category="translation",
            provider="argos",
            status="ready"
            if argos_installed and argos_pairs
            else "not_configured"
            if argos_installed
            else "not_installed",
            languages=argos_pairs,
            capabilities=["translate", "offline", "package-pairs"],
            license="MIT / CC0 model packages",
            path=_path_text(argos_dir),
            detail=None if argos_pairs else "Install Argos language packages for each offline translation pair.",
        ),
        LocalModelInfo(
            id="indictrans2",
            name="IndicTrans2",
            category="translation",
            provider="indictrans2",
            status="ready"
            if transformers_installed and _has_files(indic_dir)
            else "not_configured"
            if transformers_installed
            else "not_installed",
            languages=["English<->22 Indian languages"],
            capabilities=["translate", "offline"],
            license="MIT",
            path=_path_text(indic_dir),
            detail=None
            if transformers_installed and _has_files(indic_dir)
            else "Install transformers + IndicTransToolkit and point INDICTRANS2_MODEL_DIR at "
            "an ai4bharat/indictrans2-* checkpoint folder.",
        ),
        LocalModelInfo(
            id="nllb-200",
            name="NLLB-200",
            category="translation",
            provider="nllb",
            status="ready"
            if settings.enable_nllb and transformers_installed and _has_files(nllb_dir)
            else "disabled"
            if not settings.enable_nllb
            else "not_configured"
            if transformers_installed
            else "not_installed",
            languages=["200 languages"],
            capabilities=["translate", "offline", "non-commercial-license"],
            license="CC-BY-NC-4.0",
            path=_path_text(nllb_dir),
            detail="Disabled by default because the model license is non-commercial."
            if not settings.enable_nllb
            else "Set NLLB_MODEL_DIR to a local model folder and install transformers.",
        ),
    ]
