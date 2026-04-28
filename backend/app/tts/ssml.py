from __future__ import annotations

import io
import re
import wave
from dataclasses import dataclass
from typing import Any, Iterable, Sequence
from xml.etree import ElementTree

from ..config import settings
from .pronunciation import apply_pronunciation_rules


@dataclass(frozen=True)
class TextSegment:
    text: str


@dataclass(frozen=True)
class BreakSegment:
    milliseconds: int


SpeechSegment = TextSegment | BreakSegment
WaveParams = tuple[int, int, int, int, str, str]

_ALLOWED_TAGS = {
    "speak",
    "break",
    "sub",
    "say-as",
    "emphasis",
    "prosody",
    "phoneme",
    "p",
    "s",
}
_BREAK_STRENGTHS_MS = {
    "none": 0,
    "x-weak": 125,
    "weak": 250,
    "medium": 500,
    "strong": 750,
    "x-strong": 1000,
}
_TIME_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)(ms|s)\s*$", re.IGNORECASE)
_TEXT_SPLIT_LIMIT = 3200
_MAX_BREAK_MS = 5000


def _normalize_text(value: str) -> str:
    return " ".join(value.split())


def _tag_name(node: ElementTree.Element) -> str:
    return node.tag.rsplit("}", 1)[-1] if isinstance(node.tag, str) else ""


def _add_text(
    segments: list[SpeechSegment],
    value: str,
    pronunciation_rules: Sequence[Any] | None = None,
    language: str | None = None,
) -> None:
    text = _normalize_text(value)
    if not text:
        return
    text = apply_pronunciation_rules(text, pronunciation_rules, language)
    if segments and isinstance(segments[-1], TextSegment):
        segments[-1] = TextSegment(f"{segments[-1].text} {text}")
    else:
        segments.append(TextSegment(text))


def _parse_break_ms(node: ElementTree.Element) -> int:
    time_value = node.attrib.get("time")
    if time_value:
        match = _TIME_RE.match(time_value)
        if not match:
            raise ValueError("SSML break time must use milliseconds or seconds.")
        amount = float(match.group(1))
        unit = match.group(2).lower()
        milliseconds = int(amount if unit == "ms" else amount * 1000)
    else:
        strength = node.attrib.get("strength", "medium").lower()
        if strength not in _BREAK_STRENGTHS_MS:
            raise ValueError("SSML break strength is not supported.")
        milliseconds = _BREAK_STRENGTHS_MS[strength]

    if milliseconds < 0 or milliseconds > _MAX_BREAK_MS:
        raise ValueError(f"SSML break time must be between 0 and {_MAX_BREAK_MS} ms.")
    return milliseconds


def _inner_text(node: ElementTree.Element) -> str:
    return _normalize_text(" ".join(node.itertext()))


def _say_as_text(node: ElementTree.Element) -> str:
    text = _inner_text(node)
    interpret_as = node.attrib.get("interpret-as", "").lower()
    if interpret_as in {"characters", "spell-out"}:
        return " ".join(ch for ch in text if not ch.isspace())
    if interpret_as in {"digits", "telephone"}:
        return " ".join(ch for ch in text if ch.isdigit())
    if interpret_as in {
        "number",
        "cardinal",
        "ordinal",
        "date",
        "time",
        "currency",
        "unit",
        "",
    }:
        return text
    raise ValueError("SSML say-as interpret-as value is not supported.")


def _emphasis_text(node: ElementTree.Element) -> str:
    text = _inner_text(node)
    level = node.attrib.get("level", "moderate").lower()
    if level not in {"reduced", "moderate", "strong"}:
        raise ValueError("SSML emphasis level is not supported.")
    if level == "strong" and text and text[-1] not in ".!?":
        return f"{text}!"
    if level == "reduced" and text and text[-1] not in ",.;":
        return f"{text},"
    return text


def _validate_prosody(node: ElementTree.Element) -> None:
    allowed = {"rate", "pitch", "volume"}
    unknown = set(node.attrib) - allowed
    if unknown:
        raise ValueError("SSML prosody only supports rate, pitch, and volume attributes.")

    rate = node.attrib.get("rate", "medium").lower()
    if rate not in {"x-slow", "slow", "medium", "fast", "x-fast", "default"}:
        if not re.match(r"^\d{1,3}%$", rate):
            raise ValueError("SSML prosody rate is not supported.")

    pitch = node.attrib.get("pitch", "medium").lower()
    if pitch not in {"x-low", "low", "medium", "high", "x-high", "default"}:
        if not re.match(r"^[+-]?\d+(?:\.\d+)?(?:st|%)$", pitch):
            raise ValueError("SSML prosody pitch is not supported.")

    volume = node.attrib.get("volume", "medium").lower()
    if volume not in {"silent", "x-soft", "soft", "medium", "loud", "x-loud", "default"}:
        if not re.match(r"^[+-]?\d+(?:\.\d+)?db$", volume):
            raise ValueError("SSML prosody volume is not supported.")


def _phoneme_text(node: ElementTree.Element) -> str:
    alphabet = node.attrib.get("alphabet", "ipa").lower()
    if alphabet not in {"ipa", "x-sampa"}:
        raise ValueError("SSML phoneme alphabet is not supported.")
    return _inner_text(node) or _normalize_text(node.attrib.get("ph", ""))


def _walk(
    node: ElementTree.Element,
    segments: list[SpeechSegment],
    pronunciation_rules: Sequence[Any] | None = None,
    language: str | None = None,
) -> None:
    node_tag = _tag_name(node)
    if node_tag not in _ALLOWED_TAGS:
        raise ValueError(f"SSML tag <{node_tag}> is not supported.")

    if node_tag == "prosody":
        _validate_prosody(node)

    if node_tag in {"speak", "p", "s", "prosody"} and node.text:
        _add_text(segments, node.text, pronunciation_rules, language)

    for child in node:
        child_tag = _tag_name(child)
        if child_tag not in _ALLOWED_TAGS:
            raise ValueError(f"SSML tag <{child_tag}> is not supported.")

        if child_tag == "break":
            segments.append(BreakSegment(_parse_break_ms(child)))
        elif child_tag == "sub":
            _add_text(
                segments,
                child.attrib.get("alias") or _inner_text(child),
                pronunciation_rules,
                language,
            )
        elif child_tag == "say-as":
            _add_text(segments, _say_as_text(child), pronunciation_rules, language)
        elif child_tag == "emphasis":
            _add_text(segments, _emphasis_text(child), pronunciation_rules, language)
        elif child_tag == "phoneme":
            _add_text(segments, _phoneme_text(child), pronunciation_rules, language)
        else:
            _walk(child, segments, pronunciation_rules, language)

        if child.tail:
            _add_text(segments, child.tail, pronunciation_rules, language)

    if node_tag == "p":
        segments.append(BreakSegment(650))
    elif node_tag == "s":
        segments.append(BreakSegment(300))


def _split_text(value: str, limit: int = _TEXT_SPLIT_LIMIT) -> list[str]:
    if len(value) <= limit:
        return [value]

    chunks: list[str] = []
    remaining = value
    min_cut = int(limit * 0.5)

    while len(remaining) > limit:
        window = remaining[: limit + 1]
        sentence_cut = max(
            window.rfind(". "),
            window.rfind("! "),
            window.rfind("? "),
        )
        comma_cut = window.rfind(", ")
        space_cut = window.rfind(" ")
        if sentence_cut >= min_cut:
            cut = sentence_cut + 1
        elif comma_cut >= int(limit * 0.65):
            cut = comma_cut + 1
        elif space_cut >= min_cut:
            cut = space_cut
        else:
            cut = limit

        chunks.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()

    if remaining:
        chunks.append(remaining)
    return chunks


def parse_ssml(
    value: str,
    pronunciation_rules: Sequence[Any] | None = None,
    language: str | None = None,
) -> list[SpeechSegment]:
    source = value.strip()
    if not source:
        raise ValueError("SSML text cannot be blank.")

    xml_source = source if source.startswith("<speak") else f"<speak>{source}</speak>"
    try:
        root = ElementTree.fromstring(xml_source)
    except ElementTree.ParseError as exc:
        raise ValueError(f"Invalid SSML: {exc}") from exc

    if _tag_name(root) != "speak":
        raise ValueError("SSML input must use <speak> as the root element.")

    segments: list[SpeechSegment] = []
    _walk(root, segments, pronunciation_rules, language)

    expanded: list[SpeechSegment] = []
    for segment in segments:
        if isinstance(segment, TextSegment):
            expanded.extend(TextSegment(chunk) for chunk in _split_text(segment.text))
        elif segment.milliseconds > 0:
            expanded.append(segment)

    if not any(isinstance(segment, TextSegment) for segment in expanded):
        raise ValueError("SSML must contain text to synthesize.")
    return expanded


def stitch_wav_sequence(parts: Iterable[bytes | BreakSegment], pause_scale: float = 1.0) -> bytes:
    params: WaveParams | None = None
    frames: list[bytes] = []
    pending_break_ms = 0

    def silence(milliseconds: int, wav_params: WaveParams) -> bytes:
        channels, sample_width, sample_rate = wav_params[:3]
        frame_count = int(sample_rate * milliseconds / 1000)
        return b"\x00" * frame_count * sample_width * channels

    for part in parts:
        if isinstance(part, BreakSegment):
            milliseconds = int(part.milliseconds * pause_scale)
            if params is None:
                pending_break_ms += milliseconds
                continue
            frames.append(silence(milliseconds, params))
            continue

        with wave.open(io.BytesIO(part), "rb") as reader:
            current = reader.getparams()
            current_params: WaveParams = (
                current.nchannels,
                current.sampwidth,
                current.framerate,
                0,
                current.comptype,
                current.compname,
            )
            if params is None:
                params = current_params
                if pending_break_ms:
                    frames.append(silence(pending_break_ms, params))
                    pending_break_ms = 0
            elif (
                current_params[0] != params[0]
                or current_params[1] != params[1]
                or current_params[2] != params[2]
                or current_params[4] != params[4]
            ):
                raise ValueError("Generated audio chunks used incompatible WAV settings.")
            frames.append(reader.readframes(reader.getnframes()))

    if params is None:
        params = (1, 2, settings.sample_rate, 0, "NONE", "not compressed")
        if pending_break_ms:
            frames.append(silence(pending_break_ms, params))

    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setparams(params)
        writer.writeframes(b"".join(frames))
    return output.getvalue()
