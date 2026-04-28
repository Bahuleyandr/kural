# Kural Roadmap

## Stabilization

- UUID-only cloned voice IDs with path containment before read/delete.
- Consent-gated clone uploads with sample size and duration limits.
- Reproducible pnpm Docker frontend builds.
- Persistent Docker volumes for Kokoro models and cloned voices.
- Centralized application version and MIT license alignment.
- Backend tests, frontend smoke tests, and CI checks.

## Desktop

- Bundle the backend directory as a Tauri resource.
- Keep Python runtime discovery explicit with `KURAL_PYTHON` and `KURAL_BACKEND_DIR`.
- Show backend startup failures in the web UI.
- Keep updater inactive until signing keys and distribution channel are selected.

## Creator Product

- Batch generation from blank-line separated text.
- Project workspaces with local documents, audio assets, pronunciation profiles, and voice presets.
- Named pronunciation profiles with ordered literal and whole-word rules.
- Persistent project audio library via IndexedDB with migration from the original audio history.
- True long-document chunk stitching.
- Expanded SSML subset for pauses, emphasis, prosody fallback, phoneme fallback, and pronunciation.
- Advanced controls for speed, pitch, volume, normalization, silence trimming, pause scaling, and format.
- Transcript-file dubbing workflow for SRT, VTT, CSV, and plain text.
- Optional local ASR adapters for faster-whisper, Vosk, and whisper.cpp.
- Optional Argos Translate adapter for target-language drafts.
- `.kuralproj` import/export archives for local project portability.
- Multilingual-ready voice and clone metadata with language, locale, engine, and capabilities.
- Voice-clone import/export archives for local portability.
- WAV/MP3 export for Kokoro and WAV export for cloned voices.
- Voice sample preview and clone consent guardrails.

## Release

- Explicit desktop backend runtime provisioning.
- Release scripts for updater signing configuration.
- Artifact smoke checks for desktop bundles and updater signatures.

## Next Candidates

- Full IndicTrans2 inference adapter after a local model-pack layout is selected.
- Optional local forced alignment for subtitle timing repair.
- User-provided multilingual TTS voice folders.
- User-defined voice folders.
- Published signed desktop installers after signing keys and distribution accounts are available.
