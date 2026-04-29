# Kural

Privacy-first, cross-platform AI text-to-speech platform. Runs entirely offline. No cloud, no tracking, no subscription required.

## TTS Engines

- **Kokoro TTS** (Apache 2.0): high-quality neural TTS with multiple voices
- **Chatterbox TTS** (MIT): expressive synthesis with voice cloning support

## Optional Local Multilingual Packs

- **ASR:** faster-whisper, Vosk, or whisper.cpp for offline audio/video transcription
- **Translation:** Argos Translate for offline translation packages
- **Model-pack slots:** IndicTrans2 for Indian-language translation and NLLB for non-commercial experiments remain explicit opt-ins

## Project Structure

```
kural/
  backend/      # Python FastAPI service wrapping Kokoro and Chatterbox
  frontend/     # Next.js creator workspace with projects, dubbing, SSML, and audio library
  cli/          # Python Click CLI: kural speak, kural voices
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
| POST | `/api/transcribe` | Transcribe local audio/video into dubbing segments |
| POST | `/api/translate` | Translate local script text with installed packages |
| GET | `/api/health` | Health check (also exposed at `/healthz` for Docker) |

Voice clone samples must be WAV/MP3 audio, 5-30 seconds long, no larger than 25 MB, and submitted with explicit consent confirmation. Each accepted upload appends a JSON record to `CONSENT_LOG_PATH` (`~/.cache/kural/consent.log` by default) capturing the voice ID, sample SHA-256, requesting IP, and the consent statement that was in effect.

### Hardening for networked deployments

The API is unauthenticated by default to keep the single-user offline workflow friction-free. Set `KURAL_API_KEY` to require a shared `X-API-Key` header on every `/api/*` request. The Docker compose stack binds to `127.0.0.1` by default — set `KURAL_BIND=0.0.0.0` (and `KURAL_API_KEY`) to expose on a LAN. `RATE_LIMIT_SYNTHESIZE` and `RATE_LIMIT_CLONE` accept any [slowapi syntax](https://slowapi.readthedocs.io/) (e.g. `30/minute`, `5/second`).

### Single-tenant by design

Kural assumes one user per backend process. The Kokoro and Chatterbox engines are shared across requests via a thread-safe registry, and the cloned-voice cache lives at one location per process (`CLONE_CACHE_DIR`). For multi-tenant or LAN deployments, run one container per tenant — there is no built-in per-user isolation.

The creator UI stores projects locally in IndexedDB. A project can contain script documents, generated audio assets, voice presets, pronunciation profiles, and transcript-file dubbing segments. Use `.kuralproj` export/import when you want a portable offline archive.

Optional ASR/translation runtimes are adapter-driven. Install `backend/requirements-local-models.txt`, provision model packs under the configured cache folders, then check `/api/local-models` before using audio/video import or local translation in the dubbing workspace. See `docs/LOCAL_MODELS.md` for a repeatable local setup.

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
