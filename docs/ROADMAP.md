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
- Pronunciation replacement dictionary.
- Local session audio library with replay and downloads.
- Persistent audio library via IndexedDB.
- True long-document chunk stitching.
- SSML subset for pauses, emphasis, and pronunciation.
- Voice-clone import/export archives for local portability.
- WAV/MP3 export for Kokoro and WAV export for cloned voices.
- Voice sample preview and clone consent guardrails.

## Release

- Explicit desktop backend runtime provisioning.
- Release scripts for updater signing configuration.
- Artifact smoke checks for desktop bundles and updater signatures.

## Next Candidates

- User-defined voice folders.
- Published signed desktop installers after signing keys and distribution accounts are available.
