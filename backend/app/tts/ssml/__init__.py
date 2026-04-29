"""SSML subset parser and audio stitcher.

Re-exports the public surface so existing call sites
(`from ..tts.ssml import parse_ssml, stitch_wav_sequence, BreakSegment, TextSegment`)
keep working after the module was split into focused submodules.
"""
from .stitch import stitch_wav_sequence
from .parser import parse_ssml
from .types import BreakSegment, SpeechSegment, TextSegment

__all__ = [
    "BreakSegment",
    "SpeechSegment",
    "TextSegment",
    "parse_ssml",
    "stitch_wav_sequence",
]
