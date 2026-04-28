from ..config import settings
from ..models import TranslationRequest


class LocalModelUnavailable(RuntimeError):
    """Raised when an optional local model runtime or model pack is unavailable."""


def _lang_code(value: str) -> str:
    return value.strip().lower().replace("_", "-").split("-")[0]


def _translate_argos(req: TranslationRequest) -> tuple[str, str]:
    try:
        from argostranslate import translate
    except ImportError as exc:
        raise LocalModelUnavailable(
            "Argos Translate is not installed. Install backend/requirements-local-models.txt and Argos language packages."
        ) from exc

    source_code = _lang_code(req.source_language)
    target_code = _lang_code(req.target_language)
    languages = translate.get_installed_languages()
    source = next((language for language in languages if language.code.lower() == source_code), None)
    target = next((language for language in languages if language.code.lower() == target_code), None)

    if source is None or target is None:
        raise LocalModelUnavailable(
            f"Argos language package missing for {req.source_language}->{req.target_language}."
        )

    translation = source.get_translation(target)
    if translation is None:
        raise LocalModelUnavailable(
            f"Argos translation package missing for {req.source_language}->{req.target_language}."
        )
    return translation.translate(req.text), "argos"


def _translate_indictrans2(_req: TranslationRequest) -> tuple[str, str]:
    raise LocalModelUnavailable(
        "IndicTrans2 is registered as a local model-pack target, but its inference adapter is not enabled yet."
    )


def _translate_nllb(_req: TranslationRequest) -> tuple[str, str]:
    if not settings.enable_nllb:
        raise LocalModelUnavailable(
            "NLLB is disabled by default because its model license is non-commercial. Set ENABLE_NLLB=true only for eligible use."
        )
    raise LocalModelUnavailable("NLLB runtime is not enabled in this build.")


def translate_text(req: TranslationRequest) -> tuple[str, str]:
    provider = req.provider
    if provider == "auto":
        provider = settings.local_translation_engine

    if provider in {"auto", "argos"}:
        try:
            return _translate_argos(req)
        except LocalModelUnavailable:
            if provider == "argos":
                raise

    if provider == "indictrans2":
        return _translate_indictrans2(req)
    if provider == "nllb":
        return _translate_nllb(req)

    raise LocalModelUnavailable("No local translation provider is ready. Install Argos packages or configure a model pack.")
