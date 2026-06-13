import os
import re
import threading
from pathlib import Path

from ..config import settings
from ..models import TranslationRequest


class LocalModelUnavailable(RuntimeError):
    """Raised when an optional local model runtime or model pack is unavailable."""


# Cached IndicTrans2 model + tokenizer per direction. Each entry is a tuple of
# (tokenizer, model, processor). Direction keys are "en-indic", "indic-en",
# "indic-indic" — matching upstream model variants.
_indictrans2_cache: dict[str, tuple[object, object, object | None]] = {}
_indictrans2_lock = threading.Lock()


def _lang_code(value: str) -> str:
    return value.strip().lower().replace("_", "-").split("-")[0]


def _configure_argos_dir() -> None:
    package_dir = settings.argos_packages_dir or settings.argos_package_dir
    clean = package_dir.strip()
    if clean:
        os.environ["ARGOS_PACKAGES_DIR"] = str(Path(clean).expanduser())


def _translate_argos(req: TranslationRequest) -> tuple[str, str]:
    _configure_argos_dir()
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


_INDIC_LANGUAGE_TAGS: dict[str, str] = {
    # ai4bharat IndicTrans2 uses Flores-200-style script tags for Indic
    # languages; keys here are the lowercase BCP-47 codes the frontend ships.
    "as": "asm_Beng",
    "bn": "ben_Beng",
    "brx": "brx_Deva",
    "doi": "doi_Deva",
    "gom": "gom_Deva",
    "gu": "guj_Gujr",
    "hi": "hin_Deva",
    "kn": "kan_Knda",
    "ks": "kas_Arab",
    "mai": "mai_Deva",
    "ml": "mal_Mlym",
    "mni": "mni_Beng",
    "mr": "mar_Deva",
    "ne": "npi_Deva",
    "or": "ory_Orya",
    "pa": "pan_Guru",
    "sa": "san_Deva",
    "sat": "sat_Olck",
    "sd": "snd_Deva",
    "ta": "tam_Taml",
    "te": "tel_Telu",
    "ur": "urd_Arab",
}
_ENGLISH_TAG = "eng_Latn"


def _is_indic(code: str) -> bool:
    return code in _INDIC_LANGUAGE_TAGS


def _direction(source: str, target: str) -> str:
    if source == "en" and _is_indic(target):
        return "en-indic"
    if _is_indic(source) and target == "en":
        return "indic-en"
    if _is_indic(source) and _is_indic(target):
        return "indic-indic"
    raise LocalModelUnavailable(
        "IndicTrans2 supports en<->indic and indic<->indic pairs only; "
        f"got {source}->{target}."
    )


def _model_dir_for_direction(direction: str) -> Path:
    base = Path(settings.indictrans2_model_dir).expanduser()
    candidates = (base / direction, base, base / direction.replace("-", "_"))
    for candidate in candidates:
        if candidate.exists() and any(candidate.iterdir()):
            return candidate
    raise LocalModelUnavailable(
        f"IndicTrans2 model dir for direction '{direction}' not found at any of: "
        + ", ".join(str(c) for c in candidates)
    )


def _load_indictrans2(direction: str):
    cached = _indictrans2_cache.get(direction)
    if cached is not None:
        return cached
    with _indictrans2_lock:
        cached = _indictrans2_cache.get(direction)
        if cached is not None:
            return cached
        try:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        except ImportError as exc:
            raise LocalModelUnavailable(
                "transformers is required for IndicTrans2. Install backend/requirements-local-models.txt."
            ) from exc

        model_dir = _model_dir_for_direction(direction)
        tokenizer = AutoTokenizer.from_pretrained(str(model_dir), trust_remote_code=True)
        model = AutoModelForSeq2SeqLM.from_pretrained(str(model_dir), trust_remote_code=True)
        model.eval()

        try:
            from IndicTransToolkit import IndicProcessor

            processor = IndicProcessor(inference=True)
        except ImportError:
            processor = None

        cached = (tokenizer, model, processor)
        _indictrans2_cache[direction] = cached
        return cached


def _translate_indictrans2(req: TranslationRequest) -> tuple[str, str]:
    source = _lang_code(req.source_language)
    target = _lang_code(req.target_language)
    direction = _direction(source, target)
    src_tag = _ENGLISH_TAG if source == "en" else _INDIC_LANGUAGE_TAGS[source]
    tgt_tag = _ENGLISH_TAG if target == "en" else _INDIC_LANGUAGE_TAGS[target]

    tokenizer, model, processor = _load_indictrans2(direction)

    sentences = [s.strip() for s in req.text.split("\n") if s.strip()]
    if not sentences:
        return "", "indictrans2"

    if processor is not None:
        prepared = processor.preprocess_batch(sentences, src_lang=src_tag, tgt_lang=tgt_tag)
    else:
        # Fallback when IndicTransToolkit is missing — works for short inputs but
        # quality drops because tokenization/normalization are skipped.
        prepared = [f"{src_tag} {tgt_tag} {sentence}" for sentence in sentences]

    try:
        import torch
    except ImportError as exc:
        raise LocalModelUnavailable(
            "torch is required for IndicTrans2 inference."
        ) from exc

    inputs = tokenizer(
        prepared,
        truncation=True,
        padding="longest",
        return_tensors="pt",
        max_length=512,
    )
    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            max_length=512,
            num_beams=5,
            num_return_sequences=1,
        )
    decoded = tokenizer.batch_decode(
        outputs, skip_special_tokens=True, clean_up_tokenization_spaces=True
    )
    if processor is not None:
        decoded = processor.postprocess_batch(decoded, lang=tgt_tag)
    return "\n".join(decoded), "indictrans2"


def _translate_nllb(_req: TranslationRequest) -> tuple[str, str]:
    if not settings.enable_nllb:
        raise LocalModelUnavailable(
            "NLLB is disabled by default because its model license is non-commercial. Set ENABLE_NLLB=true only for eligible use."
        )
    raise LocalModelUnavailable("NLLB runtime is not enabled in this build.")


def _apply_glossary(text: str, req: TranslationRequest) -> str:
    output = text
    target = _lang_code(req.target_language)
    for item in req.glossary:
        item_language = _lang_code(item.language or req.target_language)
        if item_language and item_language != target:
            continue
        flags = 0 if item.case_sensitive else re.IGNORECASE
        pattern = re.escape(item.term)
        output = re.sub(pattern, item.replacement, output, flags=flags)
    return output


def translate_text(req: TranslationRequest) -> tuple[str, str]:
    provider = req.provider
    if provider == "auto":
        provider = settings.local_translation_engine

    if provider in {"auto", "argos"}:
        try:
            text, used = _translate_argos(req)
            return _apply_glossary(text, req), used
        except LocalModelUnavailable:
            if provider == "argos":
                raise

    if provider == "indictrans2":
        text, used = _translate_indictrans2(req)
        return _apply_glossary(text, req), used
    if provider == "nllb":
        text, used = _translate_nllb(req)
        return _apply_glossary(text, req), used

    raise LocalModelUnavailable("No local translation provider is ready. Install Argos packages or configure a model pack.")
