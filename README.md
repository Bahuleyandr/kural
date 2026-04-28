# Kural

Privacy-first, cross-platform AI text-to-speech platform. Runs entirely offline. No cloud, no tracking, no subscription required.

## TTS Engines

- **Kokoro TTS** (Apache 2.0) — high-quality neural TTS with multiple voices
- **Chatterbox TTS** (MIT) — expressive synthesis with voice cloning support

## Project Structure

```
kural/
  backend/      # Python FastAPI service wrapping Kokoro and Chatterbox
  frontend/     # Next.js web UI — text → audio in one page
  cli/          # Python Click CLI: kural speak, kural voices
  desktop/      # Tauri cross-platform desktop app (Phase 2)
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
npm install
npm run dev
```

**CLI:**

```bash
cd cli
pip install -e .
kural speak "Hello, world!"
kural voices
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/voices` | List available voices |
| POST | `/api/synthesize` | Synthesize text to audio |
| GET | `/api/health` | Health check |

## License

- Kural: MIT
- Kokoro TTS: Apache 2.0
- Chatterbox TTS: MIT
