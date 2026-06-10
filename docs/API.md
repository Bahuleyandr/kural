# Kural API

Backend base URL defaults to `http://localhost:8000`.

## Health

```bash
curl http://localhost:8000/api/health
```

## Voices

```bash
curl http://localhost:8000/api/voices
curl http://localhost:8000/api/voices/clones
```

## Local Models

```bash
curl http://localhost:8000/api/local-models
```

Kural reports optional local ASR and translation adapters without downloading model packs. `ready` means the Python package or external binary is installed and the configured local model folder has files. `not_installed` or `not_configured` means the UI can show the workflow but the backend will return a structured `503` until the pack is provisioned.

## Model Packs And Jobs

```bash
curl http://localhost:8000/api/model-packs
curl -X POST http://localhost:8000/api/model-packs/kokoro-v1-onnx/install
curl -X POST http://localhost:8000/api/model-packs/faster-whisper/update
curl -X DELETE http://localhost:8000/api/model-packs/jobs/<job-id>
```

The model-pack API is the only path the UI uses for installs/removals. Each action is a backend-defined safe operation; the browser never runs arbitrary shell commands. Pack records include `id`, `version`, `source_url`, `checksum`, `license`, `disk_size_mb`, `installed_path`, `languages`, `capabilities`, `requires_confirmation`, `non_commercial`, and supported `actions`.

Background jobs use one shared shape:

```json
{
  "id": "ecf1...",
  "kind": "model-pack:install:kokoro-v1-onnx",
  "status": "running",
  "progress": 20,
  "message": "Launching safe provisioner",
  "started_at": "2026-06-11T10:00:00Z",
  "completed_at": null,
  "error": null
}
```

Manual runtime packs such as Chatterbox, Vosk, IndicTrans2, and NLLB expose inventory and instructions but may reject install/remove actions unless Kural owns a configured model folder.

## Synthesis

```bash
curl -X POST http://localhost:8000/api/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from Kural","voice":"af_bella","speed":1,"format":"wav"}' \
  --output speech.wav
```

Use `"format":"mp3"` for Kokoro MP3 export when `ffmpeg` is installed. Cloned voices always return WAV.

Advanced audio controls are optional. Top-level `speed` remains supported for older clients; when `controls.speed` is present it is used for synthesis speed.

```json
{
  "text": "Hello from Kural",
  "voice": "af_bella",
  "format": "wav",
  "language": "en-US",
  "controls": {
    "speed": 1.05,
    "pitch_semitones": 1.0,
    "volume_db": -1.5,
    "normalize": true,
    "trim_silence": true,
    "pause_scale": 1.2
  },
  "pronunciation_rules": [
    {
      "id": "kural",
      "pattern": "Kural",
      "replacement": "koo-ral",
      "mode": "word",
      "case_sensitive": false,
      "language": "en-US",
      "enabled": true,
      "priority": 10
    }
  ]
}
```

Enable Kural's supported SSML subset with `"ssml":true`:

```bash
curl -X POST http://localhost:8000/api/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello <break time=\"300ms\"/> <sub alias=\"Kural\">குரல்</sub>","voice":"af_bella","format":"wav","ssml":true}' \
  --output speech.wav
```

Supported tags are `<speak>`, `<break time="250ms"/>`, `<break strength="medium"/>`, `<sub alias="...">`, `<say-as interpret-as="characters|spell-out|digits|telephone|number|cardinal|ordinal|date|time|currency|unit">`, `<emphasis level="reduced|moderate|strong">`, `<prosody rate="..." pitch="..." volume="...">`, `<phoneme alphabet="ipa|x-sampa" ph="...">`, `<p>`, and `<s>`. Prosody and phoneme are safe fallbacks for now; unsupported attributes are rejected instead of silently ignored.

## Voice Cloning

Voice cloning is consent-gated and local-only. Samples must be WAV/MP3, 5-30 seconds, and at most 25 MB.

```bash
curl -X POST http://localhost:8000/api/voices/clone \
  -F "name=My Voice" \
  -F "language=en-US" \
  -F "consent_confirmed=true" \
  -F "file=@sample.wav"
```

Clone and built-in voice metadata include `language`, optional `locale`, `engine`, and `capabilities` so the UI can filter voices and prepare for future local multilingual model packs.

## Local Translation And Transcription

Translation is offline-only and uses installed local packages. Argos Translate is the first implemented provider; IndicTrans2 and NLLB are registered as model-pack targets but are not enabled by default.

```bash
curl -X POST http://localhost:8000/api/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello","source_language":"en-US","target_language":"es-ES"}'
```

Transcription accepts local audio/video uploads and uses the first configured ASR provider in this order: faster-whisper, Vosk, then whisper.cpp.

```bash
curl -X POST http://localhost:8000/api/transcribe \
  -F "language=en-US" \
  -F "file=@scene.wav"
```

Optional adapter dependencies live in `backend/requirements-local-models.txt`. Kural does not include or download ASR/translation model weights in the default package.

Rendered dubbing segments can be aligned against expected text and slot duration:

```bash
curl -X POST http://localhost:8000/api/align \
  -F "expected_text=Hello world" \
  -F "expected_duration_ms=1800" \
  -F "language=en-US" \
  -F "file=@rendered-segment.wav"
```

The response includes `duration_ms`, optional `overrun_ms`, and word-level timestamps when the local aligner can provide them. If ASR alignment is unavailable, Kural returns `503` with `detail.code="alignment_unavailable"`.

## Local Project Archives

Project workspaces are frontend-local IndexedDB data. Exported `.kuralproj` files are zip archives with `manifest.json`, project metadata, pronunciation profiles, voice presets, dubbing segments, and referenced audio files. There is no backend project database in this phase.

Delete a clone:

```bash
curl -X DELETE http://localhost:8000/api/voices/clones/<clone-id>
```

Export all cloned voices as a portable zip archive:

```bash
curl http://localhost:8000/api/voices/clones/export --output kural-voices.zip
```

Import a Kural voice archive:

```bash
curl -X POST http://localhost:8000/api/voices/clones/import \
  -F "file=@kural-voices.zip"
```

Error responses use FastAPI's standard JSON shape with a structured `detail` object:

```json
{
  "detail": {
    "code": "voice_consent_required",
    "message": "Confirm you have consent to clone this voice before uploading."
  }
}
```
