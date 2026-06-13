import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from ..config import settings
from .translation import LocalModelUnavailable


@dataclass(frozen=True)
class AsrSegment:
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None


@dataclass(frozen=True)
class AsrResult:
    text: str
    provider: str
    language: str | None
    segments: list[AsrSegment]


@dataclass(frozen=True)
class AlignedWord:
    text: str
    start_ms: int
    end_ms: int
    probability: float | None


@dataclass(frozen=True)
class AlignmentResult:
    provider: str
    duration_ms: int
    transcript: str
    language: str | None
    words: list[AlignedWord]


_faster_whisper_model = None
_vosk_model = None


def _expand(value: str) -> Path | None:
    clean = value.strip()
    return Path(clean).expanduser() if clean else None


def _has_files(path: Path | None) -> bool:
    return bool(path and path.exists() and any(path.iterdir()))


def _lang_code(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip().lower().replace("_", "-").split("-")[0]


def _suffix(filename: str | None, content_type: str | None) -> str:
    if filename and "." in filename:
        return Path(filename).suffix[:12] or ".audio"
    if content_type == "audio/wav":
        return ".wav"
    if content_type in {"audio/mpeg", "audio/mp3"}:
        return ".mp3"
    if content_type == "video/mp4":
        return ".mp4"
    return ".audio"


def _write_temp_audio(audio_bytes: bytes, filename: str | None, content_type: str | None) -> Path:
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=_suffix(filename, content_type))
    try:
        handle.write(audio_bytes)
        return Path(handle.name)
    finally:
        handle.close()


def _transcribe_faster_whisper(
    audio_bytes: bytes,
    filename: str | None,
    content_type: str | None,
    language: str | None,
) -> AsrResult:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise LocalModelUnavailable("faster-whisper is not installed.") from exc

    model_dir = _expand(settings.faster_whisper_model_dir)
    if not _has_files(model_dir):
        raise LocalModelUnavailable("FASTER_WHISPER_MODEL_DIR must point at a local faster-whisper model folder.")

    global _faster_whisper_model
    if _faster_whisper_model is None:
        _faster_whisper_model = WhisperModel(str(model_dir), device="cpu", compute_type="int8")

    temp_path = _write_temp_audio(audio_bytes, filename, content_type)
    try:
        raw_segments, info = _faster_whisper_model.transcribe(str(temp_path), language=_lang_code(language))
        segments = [
            AsrSegment(
                start_ms=max(0, int(segment.start * 1000)),
                end_ms=max(0, int(segment.end * 1000)),
                text=segment.text.strip(),
            )
            for segment in raw_segments
            if segment.text.strip()
        ]
    finally:
        temp_path.unlink(missing_ok=True)

    text = " ".join(segment.text for segment in segments).strip()
    detected_language = getattr(info, "language", None) or _lang_code(language)
    return AsrResult(text=text, provider="faster-whisper", language=detected_language, segments=segments)


def _ffmpeg_to_pcm16(audio_bytes: bytes) -> bytes:
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "pipe:1",
            ],
            input=audio_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
    except FileNotFoundError as exc:
        raise LocalModelUnavailable("Vosk transcription requires ffmpeg on the backend host.") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise LocalModelUnavailable(f"Could not decode audio for Vosk: {detail}") from exc
    return result.stdout


def _load_vosk_model():
    """Import vosk and load the configured model, caching it process-wide.

    Raises LocalModelUnavailable with an actionable hint when vosk isn't
    installed or VOSK_MODEL_DIR isn't pointed at a model folder. Shared by
    the batch transcription path and the streaming WebSocket transcriber.
    """
    try:
        from vosk import Model
    except ImportError as exc:
        raise LocalModelUnavailable("vosk is not installed.") from exc

    model_dir = _expand(settings.vosk_model_dir)
    if not _has_files(model_dir):
        raise LocalModelUnavailable("VOSK_MODEL_DIR must point at one local Vosk model folder.")

    global _vosk_model
    if _vosk_model is None:
        _vosk_model = Model(str(model_dir))
    return _vosk_model


def _transcribe_vosk(audio_bytes: bytes, language: str | None) -> AsrResult:
    try:
        from vosk import KaldiRecognizer
    except ImportError as exc:
        raise LocalModelUnavailable("vosk is not installed.") from exc

    model = _load_vosk_model()
    pcm = _ffmpeg_to_pcm16(audio_bytes)
    recognizer = KaldiRecognizer(model, 16000)
    recognizer.SetWords(True)
    fragments: list[str] = []
    for offset in range(0, len(pcm), 4000):
        if recognizer.AcceptWaveform(pcm[offset : offset + 4000]):
            data = json.loads(recognizer.Result())
            if data.get("text"):
                fragments.append(data["text"])
    final = json.loads(recognizer.FinalResult())
    if final.get("text"):
        fragments.append(final["text"])
    text = " ".join(fragments).strip()
    segment = AsrSegment(start_ms=0, end_ms=0, text=text) if text else None
    return AsrResult(
        text=text,
        provider="vosk",
        language=_lang_code(language),
        segments=[segment] if segment else [],
    )


class StreamingTranscriber:
    """Incremental Vosk transcription for the streaming WebSocket endpoint.

    Vosk is the only one of Kural's three ASR engines that is natively
    streaming — faster-whisper and whisper.cpp are batch-only — so the
    streaming dictation path is Vosk-backed. Construct one per WebSocket
    connection; it owns a KaldiRecognizer and is not thread-safe.

    Audio contract: callers feed raw little-endian PCM16 mono samples at
    ``sample_rate`` Hz. The streaming path deliberately does not run
    ffmpeg per chunk — streamed chunks are not independently decodable,
    so the client is responsible for delivering raw PCM.
    """

    def __init__(self, language: str | None = None, sample_rate: int = 16000) -> None:
        try:
            from vosk import KaldiRecognizer
        except ImportError as exc:
            raise LocalModelUnavailable("vosk is not installed.") from exc

        model = _load_vosk_model()
        self.sample_rate = sample_rate
        self.language = _lang_code(language)
        self._recognizer = KaldiRecognizer(model, float(sample_rate))
        self._recognizer.SetWords(False)

    def accept(self, pcm_chunk: bytes) -> dict:
        """Feed one PCM16 chunk. Returns a partial or final result dict.

        A "final" result means Vosk detected an utterance boundary; a
        "partial" result is the in-progress hypothesis for the current
        utterance.
        """
        if self._recognizer.AcceptWaveform(pcm_chunk):
            text = json.loads(self._recognizer.Result()).get("text", "").strip()
            return {"type": "final", "text": text}
        partial = json.loads(self._recognizer.PartialResult()).get("partial", "").strip()
        return {"type": "partial", "text": partial}

    def finalize(self) -> dict:
        """Flush the recognizer and return the trailing utterance."""
        text = json.loads(self._recognizer.FinalResult()).get("text", "").strip()
        return {"type": "final", "text": text, "complete": True}


def _transcribe_whisper_cpp(
    audio_bytes: bytes,
    filename: str | None,
    content_type: str | None,
    language: str | None,
) -> AsrResult:
    binary = _expand(settings.whisper_cpp_binary)
    model_file = _expand(settings.whisper_cpp_model_file)
    if not binary or not binary.is_file() or not model_file or not model_file.is_file():
        raise LocalModelUnavailable("WHISPER_CPP_BINARY and WHISPER_CPP_MODEL_FILE must point at local files.")

    temp_path = _write_temp_audio(audio_bytes, filename, content_type)
    out_prefix = Path(tempfile.NamedTemporaryFile(delete=True).name)
    command = [str(binary), "-m", str(model_file), "-f", str(temp_path), "-otxt", "-of", str(out_prefix)]
    lang = _lang_code(language)
    if lang:
        command.extend(["-l", lang])
    try:
        subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        text_path = out_prefix.with_suffix(".txt")
        text = text_path.read_text(encoding="utf-8").strip()
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise LocalModelUnavailable(f"whisper.cpp failed: {detail}") from exc
    finally:
        temp_path.unlink(missing_ok=True)
        out_prefix.with_suffix(".txt").unlink(missing_ok=True)

    segment = AsrSegment(start_ms=0, end_ms=0, text=text) if text else None
    return AsrResult(
        text=text,
        provider="whisper.cpp",
        language=lang,
        segments=[segment] if segment else [],
    )


def align_audio(
    audio_bytes: bytes,
    filename: str | None = None,
    content_type: str | None = None,
    language: str | None = None,
) -> AlignmentResult:
    """Transcribe with word-level timestamps via faster-whisper.

    Used by the dubbing workspace to detect overruns and suggest retiming.
    Requires the faster-whisper model bundle; raises LocalModelUnavailable
    otherwise.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise LocalModelUnavailable("faster-whisper is not installed.") from exc

    model_dir = _expand(settings.faster_whisper_model_dir)
    if not _has_files(model_dir):
        raise LocalModelUnavailable(
            "FASTER_WHISPER_MODEL_DIR must point at a local faster-whisper model folder."
        )

    global _faster_whisper_model
    if _faster_whisper_model is None:
        _faster_whisper_model = WhisperModel(str(model_dir), device="cpu", compute_type="int8")

    temp_path = _write_temp_audio(audio_bytes, filename, content_type)
    try:
        raw_segments, info = _faster_whisper_model.transcribe(
            str(temp_path),
            language=_lang_code(language),
            word_timestamps=True,
        )
        words: list[AlignedWord] = []
        transcript_parts: list[str] = []
        max_end = 0.0
        for segment in raw_segments:
            transcript_parts.append(segment.text.strip())
            for word in getattr(segment, "words", None) or []:
                start = max(0.0, float(word.start or 0.0))
                end = max(start, float(word.end or start))
                max_end = max(max_end, end)
                words.append(
                    AlignedWord(
                        text=word.word.strip(),
                        start_ms=int(start * 1000),
                        end_ms=int(end * 1000),
                        probability=getattr(word, "probability", None),
                    )
                )
    finally:
        temp_path.unlink(missing_ok=True)

    transcript = " ".join(part for part in transcript_parts if part).strip()
    detected_language = getattr(info, "language", None) or _lang_code(language)
    duration_ms = int(max_end * 1000)
    if duration_ms == 0 and words:
        duration_ms = words[-1].end_ms
    return AlignmentResult(
        provider="faster-whisper",
        duration_ms=duration_ms,
        transcript=transcript,
        language=detected_language,
        words=words,
    )


def transcribe_audio(
    audio_bytes: bytes,
    filename: str | None = None,
    content_type: str | None = None,
    language: str | None = None,
    provider: str = "auto",
) -> AsrResult:
    selected = settings.local_asr_engine if provider == "auto" else provider
    if selected in {"auto", "faster-whisper"}:
        try:
            return _transcribe_faster_whisper(audio_bytes, filename, content_type, language)
        except LocalModelUnavailable:
            if selected == "faster-whisper":
                raise

    if selected in {"auto", "vosk"}:
        try:
            return _transcribe_vosk(audio_bytes, language)
        except LocalModelUnavailable:
            if selected == "vosk":
                raise

    if selected in {"auto", "whisper.cpp"}:
        try:
            return _transcribe_whisper_cpp(audio_bytes, filename, content_type, language)
        except LocalModelUnavailable:
            if selected == "whisper.cpp":
                raise

    raise LocalModelUnavailable(
        "No local ASR provider is ready. Configure faster-whisper, Vosk, or whisper.cpp model files."
    )
