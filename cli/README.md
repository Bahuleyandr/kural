# Kural CLI

Python Click CLI for Kural TTS.

## Commands

```bash
kural speak "Hello, world!"          # synthesize and play
kural speak "Hello" --voice af_sky   # choose voice
kural speak "Hello" --output out.wav # save to file
echo "Hello" | kural speak -         # stdin input
kural voices                         # list available voices
```

## Installation

```bash
pip install -e .
```
