"""Shared types and the defusedxml ElementTree shim."""
from __future__ import annotations

from dataclasses import dataclass
from xml.etree import ElementTree as _StdElementTree

# defusedxml hardens stdlib ElementTree against billion-laughs / external-entity
# / DTD-bomb payloads in user-supplied SSML. Parsing only goes through it.
from defusedxml import ElementTree as _DefusedElementTree


class ElementTree:
    """Shim — parser comes from defusedxml; types and ParseError stay from stdlib."""

    Element = _StdElementTree.Element
    ParseError = _StdElementTree.ParseError
    fromstring = staticmethod(_DefusedElementTree.fromstring)


ParseError = _StdElementTree.ParseError


@dataclass(frozen=True)
class TextSegment:
    text: str


@dataclass(frozen=True)
class BreakSegment:
    milliseconds: int


SpeechSegment = TextSegment | BreakSegment
WaveParams = tuple[int, int, int, int, str, str]
