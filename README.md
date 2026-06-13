# Kural

Privacy-first, cross-platform AI text-to-speech and dictation workstation. Runs entirely offline. No cloud, no tracking, no subscription required.

## TTS Engines

- **Kokoro TTS** (Apache 2.0): high-quality neural TTS with multiple voices
- **Chatterbox TTS** (MIT): expressive synthesis with voice cloning support
- **Supertonic TTS** (MIT): compact ONNX model with native multilingual synthesis (Supertone Inc. open weights, English/Hindi/Japanese/German/French/Spanish exposed initially)

## Optional Local Multilingual Packs

- **ASR:** faster-whisper, Vosk, or whisper.cpp for offline audio/video transcription
- **Translation:** Argos Translate for offline translation packages
- **Model-pack slots:** IndicTrans2 for Indian-language translation and NLLB for non-commercial experiments remain explicit opt-ins

## Project Structure

```
kural/
  backend/      # Python FastAPI service wrapping Kokoro, Chatterbox, and Supertonic
  frontend/     # Next.js creator workspace with projects, quality studio, dubbing, SSML, model packs, and audio library
  cli/          # Python Click CLI: kural speak, kural voices, kural models
  mcp/          # Model Context Protocol server: inspect voices/models and synthesize/transcribe
  desktop/      # Tauri cross-platform desktop app
  docker-compose.yml
```

## Quick Start

### Docker (recommended)

```bash
docker compose up
```

Opens the web UI at http://localhost:3000. The backend API runs at http://localhost:8000.

### Desktop installer

Internal unsigned installers can be built from the repo:

```powershell
cd desktop
.\build-installer.ps1
```

On Linux/macOS:

```bash
cd desktop
./build-installer.sh
```

Signed public installers are a release step once Windows/macOS signing
certificates are available.

Desktop installer builds include the Kokoro and Chatterbox runtimes by default,
so saved cloned voices can synthesize offline once the required model cache is
present. Pass `--without-clone` only when building a smaller Kokoro-only test
installer.

### Dictation widget

The desktop app ships a frameless dictation widget. Press
`Ctrl+Shift+Space` (`Cmd+Shift+Space` on macOS) — or use the tray menu —
to summon it, speak, and stop; the transcript is copied to the clipboard
ready to paste. It streams to the Vosk-backed `/api/transcribe/stream`
WebSocket, so a local Vosk model must be configured (see
`docs/LOCAL_MODELS.md`).

Supertonic voices (IDs prefixed `st_`) require the `supertonic` pip
package and a populated model cache. The upstream wheel pins `numpy<2`,
which conflicts with `kokoro-onnx`, so install in this order:

```bash
cd backend
pip install -r requirements.txt
pip install -r requirements-supertonic.txt
pip install --no-deps supertonic>=1.2.0
python scripts/download_models.py --supertonic
```

The cache defaults to `~/.cache/kural/supertonic` (override with
`SUPERTONIC_MODEL_DIR`). Both engines coexist fine with numpy 2.x at
runtime — the upstream `<2` pin is overly conservative.

### Local development

**One-command local runtime:**

Windows:

```powershell
.\scripts\start-local.ps1
```

Linux/macOS:

```bash
./scripts/start-local.sh
```

Add `-Setup -ProvisionModels` on Windows, or `--setup --provision-models` on Linux/macOS, to create the optional Python 3.11 local-model runtime and download starter Kokoro, Faster-Whisper, and Argos packs.

**Backend:**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**

```bash
cd frontend
corepack enable
pnpm install
pnpm dev
```

**CLI:**

```bash
cd cli
pip install -e .
kural speak "Hello, world!"
kural voices --clones
kural models
kural agent profile --json
kural projects inspect ./demo.kuralproj
```

**MCP server:**

Drive Kural from Claude Code, Cursor, or any MCP client. The server wraps
a running backend over HTTP — see `mcp/README.md` for client wiring.

```bash
cd mcp
pip install -e .
kural-mcp   # runs over stdio; expects the backend on KURAL_HOST
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/voices` | List available voices |
| POST | `/api/synthesize` | Synthesize text or supported SSML to audio |
| GET | `/api/synthesize/stream` | Stream Kokoro WAV chunks |
| POST | `/api/voices/clone` | Create a consent-gated cloned voice |
| GET | `/api/voices/clones` | List cloned voices |
| GET | `/api/voices/clones/export` | Export cloned voices as a zip archive |
| POST | `/api/voices/clones/import` | Import cloned voices from a zip archive |
| DELETE | `/api/voices/clones/{id}` | Delete a cloned voice |
| GET | `/api/local-models` | Inspect optional local ASR/translation adapters |
| GET | `/api/model-packs` | Inspect installable/removable local model packs and recent jobs |
| POST | `/api/model-packs/benchmarks/run` | Rank local model candidates for a language/use case |
| POST | `/api/marketplace/validate` | Validate a consent-first community voice/model manifest |
| POST | `/api/model-packs/{id}/install` | Queue a safe backend-defined model-pack install |
| POST | `/api/model-packs/{id}/update` | Queue a safe backend-defined model-pack update |
| DELETE | `/api/model-packs/{id}` | Queue removal of a Kural-managed model-pack folder |
| GET | `/api/model-packs/jobs/{job_id}` | Inspect a model-pack background job |
| DELETE | `/api/model-packs/jobs/{job_id}` | Cancel a queued/running model-pack job |
| POST | `/api/transcribe` | Transcribe local audio/video into dubbing segments |
| POST | `/api/align` | Align rendered segment audio for overrun checks and subtitle timing |
| WS | `/api/transcribe/stream` | Incremental speech-to-text over WebSocket (Vosk-backed; powers the dictation widget) |
| POST | `/api/translate` | Translate local script text with installed packages |
| GET | `/api/runtime/health-checks` | Inspect local model, clone, ffmpeg, and lip-sync readiness |
| GET | `/api/lip-sync/status` | Check optional local lip-sync runtime configuration |
| POST | `/api/provenance/sidecar` | Build synthetic-audio provenance sidecar JSON |
| GET | `/api/health` | Health check (also exposed at `/healthz` for Docker) |

Voice clone samples must be WAV/MP3 audio, 5-30 seconds long, no larger than 25 MB, and submitted with explicit consent confirmation. Each accepted upload appends a JSON record to `CONSENT_LOG_PATH` (`~/.cache/kural/consent.log` by default) capturing the voice ID, sample SHA-256, requesting IP, and the consent statement that was in effect.

### Hardening for networked deployments

The API is unauthenticated by default to keep the single-user offline workflow friction-free. Set `KURAL_API_KEY` to require a shared `X-API-Key` header on every `/api/*` request. The Docker compose stack binds to `127.0.0.1` by default — set `KURAL_BIND=0.0.0.0` (and `KURAL_API_KEY`) to expose on a LAN. `RATE_LIMIT_SYNTHESIZE` and `RATE_LIMIT_CLONE` accept any [slowapi syntax](https://slowapi.readthedocs.io/) (e.g. `30/minute`, `5/second`).

### Single-tenant by design

Kural assumes one user per backend process. The Kokoro and Chatterbox engines are shared across requests via a thread-safe registry, and the cloned-voice cache lives at one location per process (`CLONE_CACHE_DIR`). For multi-tenant or LAN deployments, run one container per tenant — there is no built-in per-user isolation.

The creator UI stores projects locally in IndexedDB and, in desktop mode, can save portable vault snapshots to the local Project Vault folder. A project can contain script documents, generated audio assets, voice presets, pronunciation profiles, and transcript-file dubbing segments. Use `.kuralproj` export/import when you want a portable offline archive; use `kural projects inspect` or the MCP `inspect_project_archive` tool to audit an archive without extracting it.

Optional ASR/translation runtimes are adapter-driven. Install `backend/requirements-local-models.txt`, provision model packs under the configured cache folders, then check `/api/local-models` or `/api/model-packs` before using audio/video import or local translation in the dubbing workspace. See `docs/LOCAL_MODELS.md` for a repeatable local setup.

The workstation tabs are organised around day-to-day creator workflows:

- **Write:** single, batch, SSML, performance style, and advanced audio controls.
- **Quality:** A/B render the same line across styles, inspect waveform/loudness cues, get naturalness coaching, and reuse the best settings.
- **Voices:** engine inventory, Clone Studio readiness scoring, Pro Clone Pack guided lines, room-tone/consent fields, cloned voices, readiness-report export, and voice import/export.
- **Models:** local pack readiness, recommended-pack filtering, runnable benchmark ranking, community manifest validation, manifest trust metadata, quality/routing hints, and safe backend install/update/remove jobs for Kokoro, Supertonic, Chatterbox, Faster-Whisper, Vosk, Argos, IndicTrans2, and NLLB slots.
- **Dubbing:** subtitle/audio/video imports, source media preview, waveform-style timeline, word-level transcript editing, speaker-track voice assignment, local translation, split/merge segment editing, per-segment render, retiming, lip-sync readiness, alignment checks, render-plan/MP4 mux-script export, transcript export, overrun warnings, and stitched WAV export.
- **Pronunciation:** ordered language-aware pronunciation rules with preview render plus JSON profile import/export.
- **Script:** SSML chips, find/replace, filler-word detection, version history, selected-line generation, caption export, script diagnostics, and punctuation cleanup.
- **Agent:** mic STT loop, deterministic local planning, optional Ollama, auto-speak TTS, and interruption.
- **Library:** local generated clips.
- **Settings:** project vault snapshots, dictation controls, desktop diagnostics with runtime health checks, privacy/safety posture, voice-use audit, and exportable consent ledger.

## Developer commands

```bash
make backend-test
make frontend-lint
make frontend-unit
make frontend-build
make docker-build
```

See `docs/API.md` for API examples, `docs/ROADMAP.md` for the staged product plan, and `docs/RELEASE.md` for desktop release steps.

## License

- Kural: MIT
- Kokoro TTS: Apache 2.0
- Chatterbox TTS: MIT
- Supertonic TTS: MIT
