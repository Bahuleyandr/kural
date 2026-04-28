from __future__ import annotations

import io
import wave
from typing import Any

import numpy as np
import soundfile as sf


def _get(control: Any, key: str, default: Any = None) -> Any:
    if control is None:
        return default
    if isinstance(control, dict):
        return control.get(key, default)
    return getattr(control, key, default)


def _wav_to_float(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    data, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=True)
    return data, sample_rate


def _float_to_wav(data: np.ndarray, sample_rate: int) -> bytes:
    output = io.BytesIO()
    sf.write(output, np.clip(data, -1.0, 1.0), sample_rate, format="WAV", subtype="PCM_16")
    return output.getvalue()


def _trim_silence(data: np.ndarray, sample_rate: int) -> np.ndarray:
    if data.size == 0:
        return data

    amplitude = np.max(np.abs(data), axis=1)
    threshold = max(float(np.max(amplitude)) * 0.02, 1e-4)
    active = np.flatnonzero(amplitude > threshold)
    if active.size == 0:
        return data

    padding = int(sample_rate * 0.025)
    start = max(int(active[0]) - padding, 0)
    end = min(int(active[-1]) + padding + 1, data.shape[0])
    return data[start:end]


def _pitch_shift(data: np.ndarray, semitones: float) -> np.ndarray:
    if abs(semitones) < 0.01 or data.shape[0] < 2:
        return data

    factor = 2 ** (semitones / 12)
    intermediate_len = max(1, int(data.shape[0] / factor))
    shifted = _resample(data, intermediate_len)
    return _resample(shifted, data.shape[0]).astype(np.float32)


def _resample(data: np.ndarray, frame_count: int) -> np.ndarray:
    if data.shape[0] == frame_count:
        return data
    old_positions = np.linspace(0.0, 1.0, num=data.shape[0])
    new_positions = np.linspace(0.0, 1.0, num=frame_count)
    channels = [
        np.interp(new_positions, old_positions, data[:, channel])
        for channel in range(data.shape[1])
    ]
    return np.stack(channels, axis=1)


def process_wav_audio(audio_bytes: bytes, controls: Any | None) -> bytes:
    if controls is None:
        return audio_bytes

    pitch = float(_get(controls, "pitch_semitones", 0.0) or 0.0)
    volume_db = float(_get(controls, "volume_db", 0.0) or 0.0)
    normalize = bool(_get(controls, "normalize", False))
    trim_silence = bool(_get(controls, "trim_silence", False))
    if abs(pitch) < 0.01 and abs(volume_db) < 0.01 and not normalize and not trim_silence:
        return audio_bytes

    data, sample_rate = _wav_to_float(audio_bytes)
    if trim_silence:
        data = _trim_silence(data, sample_rate)
    if abs(pitch) >= 0.01:
        data = _pitch_shift(data, pitch)
    if abs(volume_db) >= 0.01:
        data = data * float(10 ** (volume_db / 20))
    if normalize and data.size:
        peak = float(np.max(np.abs(data)))
        if peak > 0:
            data = data * min(0.98 / peak, 8.0)

    return _float_to_wav(data, sample_rate)


def wav_duration_ms(audio_bytes: bytes) -> int:
    with wave.open(io.BytesIO(audio_bytes), "rb") as reader:
        if reader.getframerate() <= 0:
            return 0
        return int(reader.getnframes() * 1000 / reader.getframerate())
