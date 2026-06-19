"""Tier-2 hardening guards: input caps + ASR subprocess timeouts."""
import subprocess

import pytest
from pydantic import ValidationError

from app.local_models import asr
from app.local_models.translation import LocalModelUnavailable
from app.models import SynthesizeRequest


def _rule(i: int) -> dict:
    return {"id": f"r{i}", "pattern": f"a{i}", "replacement": "b"}


def test_pronunciation_rules_capped():
    with pytest.raises(ValidationError):
        SynthesizeRequest(text="hi", pronunciation_rules=[_rule(i) for i in range(201)])


def test_pronunciation_rules_within_cap_ok():
    req = SynthesizeRequest(text="hi", pronunciation_rules=[_rule(i) for i in range(10)])
    assert len(req.pronunciation_rules) == 10


def test_ffmpeg_decode_timeout_maps_to_unavailable(monkeypatch):
    def boom(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=1)

    monkeypatch.setattr(asr.subprocess, "run", boom)
    with pytest.raises(LocalModelUnavailable):
        asr._ffmpeg_to_pcm16(b"\x00\x00")
