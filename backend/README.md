# Kural Backend

FastAPI service wrapping Kokoro TTS and Chatterbox TTS.

## Endpoints

- `GET /api/health`: health check
- `GET /api/voices`: list available voices
- `POST /api/synthesize`: synthesize text to WAV or MP3
- `GET /api/synthesize/stream`: stream Kokoro WAV chunks
- `POST /api/voices/clone`: clone a voice from a consent-confirmed sample
- `GET /api/voices/clones`: list saved cloned voices
- `GET /api/voices/clones/export`: export saved cloned voices
- `POST /api/voices/clones/import`: import saved cloned voices
- `DELETE /api/voices/clones/{id}`: delete a saved cloned voice

## Development

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The Docker image installs the optional Chatterbox cloning runtime. For local
non-Docker development, use Docker for voice cloning unless your Python/Torch
environment matches Chatterbox's pinned runtime dependencies.

## Tests

```bash
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

MP3 export requires `ffmpeg` to be available on the backend host. The Docker image includes it.
