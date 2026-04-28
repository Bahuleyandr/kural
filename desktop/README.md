# Kural Desktop

Tauri cross-platform desktop app wrapping the Kural web UI.

**Status: implemented preview.** The desktop app serves the static frontend, starts the local FastAPI backend, injects the backend URL into the webview, and hides to tray on close.

The bundled app includes the `backend/` directory as a Tauri resource. A Python runtime and backend dependencies must still be available on the host for this preview build. Set `KURAL_PYTHON` or `KURAL_BACKEND_DIR` to override discovery.

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
