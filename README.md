# Kural

Privacy-first, cross-platform AI text-to-speech platform. Runs entirely offline. No cloud, no tracking, no subscription required.

## TTS Engines

- **Kokoro TTS** (Apache 2.0): high-quality neural TTS with multiple voices
- **Chatterbox TTS** (MIT): expressive synthesis with voice cloning support

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

### Local development

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
| GET | `/api/health` | Health check |

Voice clone samples must be WAV/MP3 audio, 5-30 seconds long, no larger than 25 MB, and submitted with explicit consent confirmation.

The creator UI stores projects locally in IndexedDB. A project can contain script documents, generated audio assets, voice presets, pronunciation profiles, and transcript-file dubbing segments. Use `.kuralproj` export/import when you want a portable offline archive.

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
