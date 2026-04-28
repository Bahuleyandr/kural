# Kural Desktop

Tauri cross-platform desktop app wrapping the Kural web UI.

**Status: implemented preview.** The desktop app serves the static frontend, starts the local FastAPI backend, injects the backend URL into the webview, and hides to tray on close.

The bundled app includes the `backend/` directory as a Tauri resource. Preview builds can use `KURAL_PYTHON` or `KURAL_BACKEND_DIR`; release builds can provision and bundle `desktop/runtime/python` so the app does not depend on a system Python install.

## Development

```bash
cd desktop/src-tauri
cargo tauri dev
```

## Production build

```bash
cd desktop
./build.sh
```

Release signing and updater keys are intentionally disabled until the first signed distribution channel is chosen.

## Runtime Provisioning

```bash
python scripts/provision-backend-runtime.py --target runtime/python
```

Add `--with-clone` to include Chatterbox dependencies in the bundled runtime. The desktop app discovers the bundled runtime at `resources/python/bin/python` on Linux/macOS or `resources/python/Scripts/python.exe` on Windows.

## Signed Release Build

Tauri v2 updater artifacts require a public key in config and the private key in the build environment. Generate keys with the Tauri signer, set `KURAL_UPDATER_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, and optionally `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, then run:

```powershell
.\build-release.ps1
```

```bash
./build-release.sh
```

The release build renders a temporary Tauri config with `createUpdaterArtifacts`, bundles `desktop/runtime/python`, builds the installers, and runs `scripts/smoke-release-artifacts.py --require-signatures`.
