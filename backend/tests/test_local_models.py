import sys
import types
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.local_models import asr
from app.local_models.translation import LocalModelUnavailable
from app.main import app
from app.routers import local_models as local_models_router


def test_local_models_inventory_lists_optional_adapters():
    res = TestClient(app).get("/api/local-models")

    assert res.status_code == 200
    payload = res.json()
    providers = {model["provider"] for model in payload["models"]}
    assert {"kokoro", "faster-whisper", "vosk", "argos"}.issubset(providers)


def test_local_models_inventory_includes_all_three_tts_engines():
    """The settings panel reads this endpoint to show engine status, so
    all three TTS engines must appear as category=tts entries."""
    res = TestClient(app).get("/api/local-models")

    assert res.status_code == 200
    tts = {m["provider"]: m for m in res.json()["models"] if m["category"] == "tts"}
    assert {"kokoro", "chatterbox", "supertonic"} == set(tts)
    # Supertonic must report an actionable status, never a bare "ready"
    # unless the cache is genuinely provisioned.
    assert tts["supertonic"]["status"] in {
        "ready",
        "not_configured",
        "not_installed",
    }
    assert tts["supertonic"]["license"] == "MIT"


def test_translate_returns_structured_unavailable_error(monkeypatch):
    def fail(_req):
        raise LocalModelUnavailable("No Argos packages")

    monkeypatch.setattr(local_models_router, "translate_text", fail)

    res = TestClient(app).post(
        "/api/translate",
        json={
            "text": "Hello",
            "source_language": "en-US",
            "target_language": "hi-IN",
        },
    )

    assert res.status_code == 503
    assert res.json()["detail"] == {
        "code": "local_translation_unavailable",
        "message": "No Argos packages",
    }


def test_translate_returns_local_provider(monkeypatch):
    def translate(req):
        return f"{req.text} translated", "argos"

    monkeypatch.setattr(local_models_router, "translate_text", translate)

    res = TestClient(app).post(
        "/api/translate",
        json={
            "text": "Hello",
            "source_language": "en-US",
            "target_language": "es-ES",
        },
    )

    assert res.status_code == 200
    assert res.json() == {
        "text": "Hello translated",
        "source_language": "en-US",
        "target_language": "es-ES",
        "provider": "argos",
    }


def test_transcribe_rejects_empty_upload():
    res = TestClient(app).post(
        "/api/transcribe",
        files={"file": ("empty.wav", b"", "audio/wav")},
    )

    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "empty_upload"


def test_transcribe_returns_segments(monkeypatch):
    def transcribe(*_args, **_kwargs):
        return SimpleNamespace(
            text="hello world",
            provider="faster-whisper",
            language="en",
            segments=[SimpleNamespace(start_ms=100, end_ms=900, text="hello world")],
        )

    monkeypatch.setattr(local_models_router, "transcribe_audio", transcribe)

    res = TestClient(app).post(
        "/api/transcribe",
        files={"file": ("clip.wav", b"RIFFdata", "audio/wav")},
        data={"language": "en-US"},
    )

    assert res.status_code == 200
    assert res.json() == {
        "text": "hello world",
        "language": "en",
        "provider": "faster-whisper",
        "segments": [{"start_ms": 100, "end_ms": 900, "text": "hello world"}],
    }


# ── Streaming transcription (WebSocket) ────────────────────────────────────


class _FakeStreamingTranscriber:
    """Stand-in for the Vosk-backed StreamingTranscriber.

    `accept` returns a final when fed the sentinel chunk b"BOUNDARY",
    otherwise a partial — deterministic enough to assert the route's
    frame handling without a real Vosk model.
    """

    def __init__(self, language=None, sample_rate=16000):
        self.language = language
        self.sample_rate = sample_rate
        self.chunks: list[bytes] = []

    def accept(self, pcm_chunk: bytes) -> dict:
        self.chunks.append(pcm_chunk)
        if pcm_chunk == b"BOUNDARY":
            return {"type": "final", "text": "hello world"}
        return {"type": "partial", "text": "hello"}

    def finalize(self) -> dict:
        return {"type": "final", "text": "trailing words", "complete": True}


def test_transcribe_stream_emits_partial_then_final(monkeypatch):
    monkeypatch.setattr(local_models_router, "StreamingTranscriber", _FakeStreamingTranscriber)

    client = TestClient(app)
    with client.websocket_connect("/api/transcribe/stream") as ws:
        ws.send_bytes(b"\x00\x00\x00\x00")
        assert ws.receive_json() == {"type": "partial", "text": "hello"}

        ws.send_bytes(b"BOUNDARY")
        assert ws.receive_json() == {"type": "final", "text": "hello world"}

        # {"type": "done"} must flush the trailing utterance and end the stream.
        ws.send_text('{"type": "done"}')
        assert ws.receive_json() == {
            "type": "final",
            "text": "trailing words",
            "complete": True,
        }


def test_transcribe_stream_passes_query_params(monkeypatch):
    captured: dict = {}

    class _Recorder(_FakeStreamingTranscriber):
        def __init__(self, language=None, sample_rate=16000):
            super().__init__(language, sample_rate)
            captured["language"] = language
            captured["sample_rate"] = sample_rate

    monkeypatch.setattr(local_models_router, "StreamingTranscriber", _Recorder)

    client = TestClient(app)
    with client.websocket_connect(
        "/api/transcribe/stream?language=hi&sample_rate=8000"
    ) as ws:
        ws.send_text('{"type": "done"}')
        ws.receive_json()

    assert captured == {"language": "hi", "sample_rate": 8000}


def test_transcribe_stream_reports_vosk_unavailable(monkeypatch):
    def _unavailable(*_args, **_kwargs):
        raise LocalModelUnavailable("vosk is not installed.")

    monkeypatch.setattr(local_models_router, "StreamingTranscriber", _unavailable)

    client = TestClient(app)
    with client.websocket_connect("/api/transcribe/stream") as ws:
        # The widget needs a structured error frame so it can fall back to
        # the batch /api/transcribe endpoint.
        msg = ws.receive_json()
        assert msg["type"] == "error"
        assert msg["code"] == "local_asr_unavailable"
        assert "vosk" in msg["message"]


def test_streaming_transcriber_accept_and_finalize(monkeypatch):
    """Unit-test the real StreamingTranscriber against a fake KaldiRecognizer."""
    fake_vosk = types.ModuleType("vosk")

    class _FakeRecognizer:
        def __init__(self, model, rate):
            self.rate = rate

        def SetWords(self, _value):
            pass

        def AcceptWaveform(self, chunk):
            # Only the sentinel chunk crosses an utterance boundary.
            return chunk == b"BOUNDARY"

        def Result(self):
            return '{"text": "an utterance"}'

        def PartialResult(self):
            return '{"partial": "an utter"}'

        def FinalResult(self):
            return '{"text": "the tail"}'

    fake_vosk.KaldiRecognizer = _FakeRecognizer
    fake_vosk.Model = object
    monkeypatch.setitem(sys.modules, "vosk", fake_vosk)
    monkeypatch.setattr(asr, "_load_vosk_model", lambda: object())

    transcriber = asr.StreamingTranscriber(language="en-US", sample_rate=16000)
    assert transcriber.sample_rate == 16000
    assert transcriber.accept(b"\x00\x00") == {"type": "partial", "text": "an utter"}
    assert transcriber.accept(b"BOUNDARY") == {"type": "final", "text": "an utterance"}
    assert transcriber.finalize() == {
        "type": "final",
        "text": "the tail",
        "complete": True,
    }
