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

## Synthesis

```bash
curl -X POST http://localhost:8000/api/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from Kural","voice":"af_bella","speed":1,"format":"wav"}' \
  --output speech.wav
```

Use `"format":"mp3"` for Kokoro MP3 export when `ffmpeg` is installed. Cloned voices always return WAV.

## Voice Cloning

Voice cloning is consent-gated and local-only. Samples must be WAV/MP3, 5-30 seconds, and at most 25 MB.

```bash
curl -X POST http://localhost:8000/api/voices/clone \
  -F "name=My Voice" \
  -F "consent_confirmed=true" \
  -F "file=@sample.wav"
```

Delete a clone:

```bash
curl -X DELETE http://localhost:8000/api/voices/clones/<clone-id>
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
