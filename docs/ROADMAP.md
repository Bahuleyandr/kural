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
- Model Pack Manager v2 with local readiness by workflow, recommended-pack filtering, trust labels, manifest digests, benchmark estimates, runnable local benchmark ranking, marketplace manifest validation, compatibility metadata, local best-model routing, and safe backend job APIs for install/update/remove where Kural owns the model folder.
- Voice Quality Studio for side-by-side style renders, waveform/loudness inspection, naturalness coaching, blind A/B/C comparison, winner picking, notes, favourites, and applying the best control preset.
- First-run Public Beta setup wizard covering local engine, Kokoro, clone runtime, offline dubbing packs, microphone permission, sample project creation, restart-engine repair, and setup reset.
- Dubbing Timeline view with source media preview, waveform-style overview, speaker lanes, transcript speaker inference, speaker-level voice/speed assignment, ready/overrun signalling, media transcription imports, word-level transcript editing from alignment data, subtitle retiming to rendered audio, optional lip-sync runtime status, glossary-aware translation, split/merge editing, suggested-speed application, per-segment render, alignment checks, retry/render-all actions, render-plan/MP4 mux-script export, direct local ffmpeg MP4 export, transcript export, and WAV timeline export.
- Dictation settings for language hints, push-to-talk, auto-paste, echo cancellation, noise suppression, and trailing-space insertion.
- Desktop diagnostics panel exposing local engine URL, runtime status, app data path, audio folder, startup errors, restart action, logs-folder action, model/cache health checks, ffmpeg status, and optional lip-sync readiness.
- Project Vault panel for local project search/tag/archive/duplicate posture, storage usage, and desktop vault snapshots.
- Privacy and safety panel showing local API posture, provenance sidecars, generated asset footprint, voice-use audit log, exportable clone consent ledger, and ready local ASR/translation packs.
- Pronunciation Studio JSON profile import/export and one-click preview rendering into the audio library.
- Clone Studio guided recording scripts by language/accent, quick/professional tier labels, Pro Clone Pack guided-line workflow, room-tone/consent fields, allowed-use metadata, identity cards, expanded readiness diagnostics, and downloadable readiness reports.
- Script Studio delivery diagnostics, filler-word detection, read-time statistics, persistent restore points, split/merge editing, selected-line generation, caption export, and punctuation cleanup.
- Kural Agents local assistant view with mic STT loop, deterministic local workflow planning, optional loopback Ollama adapter, speak-response TTS, auto-speak, and interruptible playback.
- CLI/MCP read-only model-pack inventory, local agent capability profile, and `.kuralproj` archive inspection.
- Single Python entrypoint (`desktop/scripts/build_desktop.py`) shared by all four installer/release shell wrappers.
- Frontend split into `app/components/`, `app/hooks/`, `app/lib/` modules with a Next.js error boundary; `apiFetch` wraps `X-API-Key` injection; `useApi` hook offers abort + 5s cache.
- A11y pass: skip link, `aria-live` regions for status and errors, `aria-pressed`/`aria-current` on toggle buttons, focus rings on every interactive element.

## Next

- User-selected desktop vault folder and recent-project tracking beyond the default app-data vault.
- Hardware compatibility scan beyond manifest-declared CPU/GPU/RAM checks.
- Tauri updater signature validation in the release pipeline and OS signing once certificates are available.
- Multilingual TTS adapter slots beyond Kokoro/Chatterbox/Supertonic (user-provided voice folders).
- Full IndicTrans2 inference adapter once a local model-pack layout is finalised.
- Real audio-render benchmark probes per engine once all TTS adapters expose a uniform safe sample-render interface.
- Optional local lip-sync renderer integration once a vetted model pack/binary format is selected.
- Published signed desktop installers — pending Windows/macOS signing certificates and a chosen distribution channel.
- Upstream the manual rate-limit overrides in tests with a slowapi-aware fixture in `slowapi` itself.
