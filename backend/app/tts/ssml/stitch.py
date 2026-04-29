"""Concatenate WAV chunks and silent pauses into a single playable WAV."""
from __future__ import annotations

import io
import wave
from typing import Iterable

from ...config import settings
from .types import BreakSegment, WaveParams


def stitch_wav_sequence(
    parts: Iterable[bytes | BreakSegment], pause_scale: float = 1.0
) -> bytes:
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
