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
kural speak "Hello" --voice-id <clone-id>
```

## Installation

```bash
pip install -e .
```
