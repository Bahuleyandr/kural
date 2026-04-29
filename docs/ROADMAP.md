# Kural Roadmap

## Shipped

- Core TTS surface: Kokoro and Chatterbox engines wrapped behind a single FastAPI service, CLI, web UI, and Tauri desktop shell.
- Reproducible Docker frontend builds; persistent volumes for Kokoro model cache and cloned voices.
- Voice cloning with consent gating, append-only consent audit log, UUID-only IDs, path containment, sample size and duration limits.
- Append-only consent audit trail (`CONSENT_LOG_PATH`) covering every accepted clone upload (timestamp, voice ID, sample SHA-256, requesting IP, consent statement version).
- Optional `KURAL_API_KEY` shared-secret middleware on every `/api/*` route; default Docker compose binds to `127.0.0.1`.
- Per-IP rate limits via slowapi (`RATE_LIMIT_SYNTHESIZE`, `RATE_LIMIT_CLONE`); FFmpeg subprocess timeout enforcement.
- Hardened SSML parser (defusedxml) and tightened CORS configuration.
- Thread-safe `EngineRegistry` for single-tenant lazy loading of Kokoro and Chatterbox engines.
- Centralized application version, MIT license alignment, gitleaks + `pnpm audit --audit-level high`.
- Backend tests (mocked), real Kokoro integration smoke test gated by `KURAL_RUN_INTEGRATION=1`, frontend unit tests for libraries and hooks, Playwright e2e smoke.
- Creator workspace: projects, batch generation, long-document chunking, named pronunciation profiles, voice presets, transcript-file dubbing for SRT/VTT/CSV/TXT.
- IndexedDB-backed audio library and `.kuralproj` import/export archives.
- Voice clone import/export archives.
- Optional ASR (faster-whisper, Vosk, whisper.cpp) and translation (Argos, IndicTrans2 pack, NLLB) adapters with `/api/local-models`, `/api/transcribe`, `/api/translate`.
- Expanded SSML subset (pauses, emphasis, prosody fallback, phoneme fallback, pronunciation rules).
- Advanced audio controls (speed, pitch, volume, normalization, silence trim, pause scaling, format).
- Single Python entrypoint (`desktop/scripts/build_desktop.py`) shared by all four installer/release shell wrappers.
- Frontend split into `app/components/`, `app/hooks/`, `app/lib/` modules with a Next.js error boundary; `apiFetch` wraps `X-API-Key` injection; `useApi` hook offers abort + 5s cache.
- A11y pass: skip link, `aria-live` regions for status and errors, `aria-pressed`/`aria-current` on toggle buttons, focus rings on every interactive element.

## Next

- Multilingual TTS adapter slots beyond Kokoro/Chatterbox (user-provided voice folders).
- Full IndicTrans2 inference adapter once a local model-pack layout is finalised.
- Optional local forced alignment for subtitle timing repair.
- Published signed desktop installers — pending Windows/macOS signing certificates and a chosen distribution channel.
- Upstream the manual rate-limit overrides in tests with a slowapi-aware fixture in `slowapi` itself.
