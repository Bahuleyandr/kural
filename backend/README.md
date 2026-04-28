# Kural Backend

FastAPI service wrapping Kokoro TTS and Chatterbox TTS.

## Endpoints

- `GET /api/health` — health check
- `GET /api/voices` — list available voices
- `POST /api/synthesize` — synthesize text to audio

## Development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
