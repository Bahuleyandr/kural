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
