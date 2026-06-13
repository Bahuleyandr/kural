# Kural CLI

Python Click CLI for Kural TTS.

## Commands

```bash
kural speak "Hello, world!"          # synthesize and play
kural speak "Hello" --voice af_sky   # choose voice
kural speak "Hello" --output out.wav # save to file
echo "Hello" | kural speak -         # stdin input
kural voices                         # list available voices
kural voices --clones                # list Kokoro and cloned voices
kural voices clone sample.wav --name "My Voice" --consent
kural voices export voices.zip
kural voices import voices.zip
kural models                         # list local model packs and jobs
kural models --category asr          # filter by tts/asr/translation
kural agent profile                  # local agent capability profile
kural agent profile --json
kural projects inspect demo.kuralproj
kural projects inspect demo.kuralproj --json
kural speak "Hello" --voice-id <clone-id>
```

`projects inspect` reads only `manifest.json` and validates archive member
paths before reporting document, audio asset, pronunciation profile, voice
preset, and dubbing segment counts. It does not extract project files.

`agent profile` is read-only and consent-safe. It reports available voices,
cloned voices, ready local model categories, and recommended agent tools
without creating clones or installing model packs.

## Installation

```bash
pip install -e .
```
