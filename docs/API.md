# Kural API

Backend base URL defaults to `http://localhost:8000`.

## Health

```bash
curl http://localhost:8000/api/health
```

`/api/health` and `/healthz` are unauthenticated so a container or orchestrator can probe liveness regardless of API-key configuration.

## Authentication

The API is unauthenticated by default for the single-user offline workflow. Set a shared secret to require an `X-API-Key` header on every other `/api/*` request:

```bash
# Either name binds; the KURAL_-prefixed form is preferred, the bare API_KEY is a legacy alias.
export KURAL_API_KEY=$(openssl rand -hex 32)
curl http://localhost:8000/api/voices -H "X-API-Key: $KURAL_API_KEY"
```

The desktop app provisions a per-install key automatically. The WebSocket streaming route accepts the key as either the `X-API-Key` header or an `?api_key=` query parameter (browser sockets cannot set headers).

## First-Run Setup

```bash
curl http://localhost:8000/api/setup/status
curl -X POST http://localhost:8000/api/setup/provision-models
```

`/api/setup/status` reports whether the Kokoro weights are present, the resolved model directory, and `provision_status` (`idle`, `running`, `complete`, `error`). `POST /api/setup/provision-models` starts a background download (returns `202`; a second concurrent call returns `409`). The first-run wizard and Settings → Desktop Release Diagnostics poll these.

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
curl http://localhost:8000/api/model-packs/benchmarks
curl -X POST http://localhost:8000/api/model-packs/benchmarks/run \
  -H "Content-Type: application/json" \
  -d '{"language":"en-US","capability":"tts","use_case":"dubbing"}'
curl "http://localhost:8000/api/model-packs/recommend?language=en-US&capability=tts"
curl -X POST http://localhost:8000/api/marketplace/validate \
  -H "Content-Type: application/json" \
  -d @community-pack-manifest.json
curl -X POST http://localhost:8000/api/model-packs/kokoro-v1-onnx/install
curl -X POST http://localhost:8000/api/model-packs/faster-whisper/update
curl -X DELETE http://localhost:8000/api/model-packs/jobs/<job-id>
```

The model-pack API is the only path the UI uses for installs/removals. Each action is a backend-defined safe operation; the browser never runs arbitrary shell commands. Pack records include `id`, `version`, `source_url`, `checksum`, `license`, `disk_size_mb`, `installed_path`, `languages`, `capabilities`, `requires_confirmation`, `non_commercial`, compatibility metadata, provenance requirements, and supported `actions`.

`/api/model-packs/benchmarks` returns local benchmark estimates for quality, naturalness, language quality, latency, memory, and best-fit routing hints. `/api/model-packs/benchmarks/run` ranks installed and configured candidates for a requested language/use case with timed local probes and sample-script complexity. `/api/model-packs/recommend` returns the best current pack for a requested language and capability using readiness, quality, latency, and routing hints.

`/api/marketplace/validate` validates community voice/model manifests before install. Voice packs must include consent proof, sample hash, allowed uses, payload checksum, license, compatibility metadata, and provenance/watermark posture; unsigned packs can be reviewed but are not installable.

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

For low-latency playback, `GET /api/synthesize/stream` streams WAV audio as it is generated. Parameters are passed as the query string:

```bash
curl "http://localhost:8000/api/synthesize/stream?text=Hello%20from%20Kural&voice=af_bella&speed=1.0" --output speech.wav
```

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
  -F "allowed_uses=personal" \
  -F "clone_tier=quick" \
  -F "quality_score=86" \
  -F "consent_confirmed=true" \
  -F "file=@sample.wav"
```

Clone and built-in voice metadata include `language`, optional `locale`, `engine`, and `capabilities` so the UI can filter voices and prepare for future local multilingual model packs. Clone metadata also includes `sample_sha256`, `allowed_uses`, `clone_tier`, and optional `quality_score` for the local identity card and consent ledger.

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

For live dictation, `WS /api/transcribe/stream` accepts streamed little-endian PCM16 mono audio (optional `?language=` / `?sample_rate=` query params, default 16000 Hz) and returns incremental `{"type":"partial"|"final","text":...}` JSON frames. Streaming is Vosk-backed; if Vosk isn't configured the socket emits one `{"type":"error"}` frame and closes so the client can fall back to batch `/api/transcribe`. Authenticate with the `X-API-Key` header or an `?api_key=` query parameter.

Rendered dubbing segments can be aligned against expected text and slot duration:

```bash
curl -X POST http://localhost:8000/api/align \
  -F "expected_text=Hello world" \
  -F "expected_duration_ms=1800" \
  -F "language=en-US" \
  -F "file=@rendered-segment.wav"
```

The response includes `duration_ms`, optional `overrun_ms`, and word-level timestamps when the local aligner can provide them. If ASR alignment is unavailable, Kural returns `503` with `detail.code="alignment_unavailable"`.

Direct MP4 dubbing export is available when `ffmpeg` is installed on the backend host:

```bash
curl -X POST http://localhost:8000/api/mux \
  -F "original=@original.mp4" \
  -F "dubbed_audio=@kural-dubbing.wav" \
  -F "output_name=dubbed.mp4" \
  --output dubbed.mp4
```

The mux command is fixed server-side (`-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest`). If ffmpeg is missing, Kural returns `503` with `detail.code="ffmpeg_unavailable"`.

Optional lip-sync is surfaced as a safe runtime probe only:

```bash
curl http://localhost:8000/api/lip-sync/status
```

Kural does not launch arbitrary lip-sync commands from the UI. Configure `KURAL_LIP_SYNC_BINARY` to point at a vetted local binary before enabling lip-sync render actions.

## Local Agent

Kural Agents v1 is local and deterministic by default. The frontend can also opt into a loopback Ollama call (`KURAL_OLLAMA_URL`, `KURAL_OLLAMA_MODEL`) and still falls back to deterministic workflow planning when Ollama is unavailable. Responses can be spoken through the existing local TTS pipeline:

```bash
curl -X POST http://localhost:8000/api/agent/respond \
  -H "Content-Type: application/json" \
  -d '{"message":"Help me clone a voice","project_language":"en-US"}'
```

## Runtime And Provenance

```bash
curl http://localhost:8000/api/runtime/health-checks
curl -X POST http://localhost:8000/api/runtime/repair \
  -H "Content-Type: application/json" \
  -d '{"action":"create_clone_folder"}'
curl -X POST http://localhost:8000/api/provenance/sidecar \
  -H "Content-Type: application/json" \
  -d '{"project_id":"p1","asset_name":"clip.wav","voice_label":"Bella"}'
```

`/api/runtime/health-checks` reports Kokoro model files, clone storage, ffmpeg, lip-sync configuration, and sampled model-cache storage. `/api/runtime/repair` accepts only backend-defined safe actions: `create_clone_folder` and `provision_kokoro` can run locally; `install_ffmpeg` and `configure_lip_sync_binary` return structured manual-setup errors. `/api/provenance/sidecar` creates the synthetic-audio sidecar shape used by exports.

## Local Project Archives

Project workspaces are frontend-local IndexedDB data. In desktop mode, the UI can also save `.kuralproj` snapshots into the local Project Vault folder. Exported `.kuralproj` files are zip archives with `manifest.json`, project metadata, pronunciation profiles, voice presets, dubbing segments, and referenced audio files. There is no backend project database in this phase.

The CLI and MCP server can inspect portable project archives without extracting them:

```bash
kural projects inspect demo.kuralproj --json
```

The inspector validates archive member paths before reading `manifest.json`, then reports schema version, project name, language settings, tags, and counts for documents, audio assets, pronunciation profiles, voice presets, and dubbing segments.

## Model Pack Metadata

`GET /api/model-packs` returns safe backend-supported actions plus provenance fields:

- `recommended`: whether the pack is part of the suggested Public Beta local setup.
- `trust_level`: one of `built_in`, `verified_manifest`, `user_supplied`, or `external_runtime`.
- `manifest_digest`: a stable `sha256:` digest over the local manifest identity, version, source, checksum, license, and capabilities.
- `quality_score`: local routing score from 0-100 for the pack's intended workflow.
- `latency_tier`: one of `realtime`, `interactive`, `batch`, or `manual`.
- `routing_hints`: short tags such as `default-tts`, `media-transcription`, or `offline-translation`.

The UI uses these fields to filter recommended packs, show whether a pack comes from a bundled manifest, and build a local quality router for creator workflows.

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

## Telemetry

Telemetry is opt-in and ships nothing by default. Both `KURAL_TELEMETRY_OPT_IN=true` and `KURAL_TELEMETRY_ENDPOINT=<url>` must be set before any event leaves the machine.

```bash
curl -X POST http://localhost:8000/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{"kind":"ui_error","message":"example","extra":{}}'
```

The endpoint always returns `202` with `{"accepted":true,"forwarded":<bool>}`. When telemetry is disabled (the default) `forwarded` is `false` and the event is dropped locally.

## Errors

Error responses use FastAPI's standard JSON shape with a structured `detail` object:

```json
{
  "detail": {
    "code": "voice_consent_required",
    "message": "Confirm you have consent to clone this voice before uploading."
  }
}
```
