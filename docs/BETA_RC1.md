# Public Beta RC1 Dogfood Checklist

This checklist is for the first Windows-focused public beta candidate. Kural
must remain offline-first: no cloud TTS, ASR, translation, voice storage, or
project sync should be required for the pass.

## Local Release Gate

Fast gate:

```powershell
.\scripts\rc1-release-gate.ps1
```

Full local gate before tagging:

```powershell
.\scripts\rc1-release-gate.ps1 -IncludePlaywright -IncludeDocker
```

The same checks can be run cross-platform:

```bash
python scripts/rc1_release_gate.py
python scripts/rc1_release_gate.py --include-playwright --include-docker
```

The default gate runs backend pytest, frontend install/lint/unit/build, desktop
release config rendering, artifact smoke validation, and Tauri `cargo check`.
The full gate adds Playwright smoke tests and Docker compose build/up health
checks.

## First 15 Minutes

1. Install the unsigned Windows build on a clean local machine or fresh user
   profile.
2. Launch Kural and confirm the first-run wizard says the local speech engine is
   starting on this computer.
3. Open Settings -> Desktop Release Diagnostics.
4. Confirm the API URL is loopback (`127.0.0.1` or `localhost`) and no remote
   endpoint is required.
5. Run each available safe repair action:
   - Kokoro models: starts the model provisioner.
   - Voice clone storage: creates the local clone folder.
6. Confirm ffmpeg and lip-sync are presented as manual setup when missing.
7. Generate one Kokoro clip, save it to the Audio Library, restart the app, and
   confirm the clip still appears.
8. Record or upload a 5-30 second clone sample with consent checked, create the
   clone, and synthesize with it after Chatterbox is installed.
9. Import an SRT/VTT/CSV/TXT dubbing file, render one segment, align it, and
   export WAV plus captions.
10. Export a `.kuralproj`, import it into a second project, and verify assets and
    pronunciation profiles survive.

## Model Pack Reality Check

Before publishing the RC, open the Model Pack Manager and record:

- Kokoro status, installed path, and disk estimate.
- Chatterbox availability for cloned voices.
- Supertonic status for multilingual TTS.
- Faster-Whisper and Vosk status for local transcription.
- Argos and IndicTrans2 status for local translation.
- Any non-commercial license gates that need explicit user confirmation.

Large downloads must be explicit. The UI must not execute arbitrary shell
commands; only backend-exposed safe model-pack actions are allowed.

## Installer Pass Criteria

Pass:

- App opens to a non-blank creator workspace.
- Backend status wording uses local-runtime language, not cloud/API language.
- Diagnostics can restart the local backend, open logs, and run safe repairs.
- Kokoro synthesis works offline after model setup.
- Saved audio lands in the desktop audio library folder.
- Clone storage persists across restarts.
- Exported files include provenance sidecar support.
- The app launches with the network disabled after models are present.

Fail:

- Blank white page, framework overlay, or unrecoverable backend status.
- Any runtime repair launches arbitrary shell commands from the UI.
- Any generated voice/sample/project data is sent to a remote service.
- Installer requires GitHub Actions or cloud CI to validate.
- `.kuralproj` import/export loses local project data.

## RC1 Release Notes Template

```markdown
## Kural Public Beta RC1

Kural is an offline creator workstation for local TTS, voice cloning, dubbing,
project archives, pronunciation profiles, and synthetic-audio provenance.

### Known prerequisites
- Windows unsigned installer may show SmartScreen until Authenticode signing is configured.
- macOS builds require Developer ID signing and notarization for public distribution.
- Optional ffmpeg, lip-sync, ASR, and translation model packs are local dependencies.

### What to test first
- First-run setup wizard.
- Kokoro generation and audio library persistence.
- Voice clone capture/upload with consent.
- Dubbing transcript import, segment render, alignment, and export.
- Settings -> Desktop Release Diagnostics repair actions.
```
