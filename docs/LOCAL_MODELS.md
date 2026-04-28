# Local Multilingual Model Packs

Kural keeps ASR and translation packs optional. The default app still runs with
Kokoro and cloned voices only; local dubbing helpers become active when these
packages are installed and configured.

## Python Runtime

Use Python 3.11 for the optional model stack. On Windows, a self-contained setup
can live under `D:\Dev\Tools`:

```powershell
$env:UV_PYTHON_INSTALL_DIR = 'D:\Dev\Tools\uv\python'
uv python install 3.11
uv venv 'D:\Dev\Tools\kural-local-models\.venv' --python 3.11
uv pip install --python 'D:\Dev\Tools\kural-local-models\.venv\Scripts\python.exe' `
  -r backend\requirements.txt `
  -r backend\requirements-dev.txt `
  -r backend\requirements-local-models.txt
```

## Provision Starter Packs

```powershell
$env:KURAL_LOCAL_MODELS_ROOT = 'D:\Dev\Tools\kural-models'
& 'D:\Dev\Tools\kural-local-models\.venv\Scripts\python.exe' `
  backend\scripts\provision_local_models.py `
  --root $env:KURAL_LOCAL_MODELS_ROOT
```

The default starter set downloads `Systran/faster-whisper-tiny` and installs
Argos packages for English with Hindi, Bengali, and Spanish in both directions.

## Run Backend With Packs

The easiest path is the local runtime launcher.

Windows:

```powershell
.\scripts\start-local.ps1
```

Linux/macOS:

```bash
./scripts/start-local.sh
```

First-time setup can be done through the launcher:

```powershell
.\scripts\start-local.ps1 -Setup -ProvisionModels
```

```bash
./scripts/start-local.sh --setup --provision-models
```

Use `-InstallCloneRuntime` or `--install-clone-runtime` with setup when you
want the local Python venv to include the optional Chatterbox cloning runtime.
Docker images already include that runtime.

You can also run the backend manually:

```powershell
$env:FASTER_WHISPER_MODEL_DIR = 'D:\Dev\Tools\kural-models\asr\faster-whisper-tiny'
$env:ARGOS_PACKAGES_DIR = 'D:\Dev\Tools\kural-models\translation\argos\packages'
$env:MODEL_CACHE_DIR = 'D:\Dev\Tools\kural-models\tts\kokoro'
$env:CLONE_CACHE_DIR = 'D:\Dev\Tools\kural-models\clones'
& 'D:\Dev\Tools\kural-local-models\.venv\Scripts\python.exe' `
  -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check readiness:

```bash
curl http://localhost:8000/api/local-models
```

`faster-whisper` and `argos` should report `ready`. Kural does not download
large models on app startup.

## Platform Compatibility

- Windows: use `scripts/start-local.ps1`. The default tools root is
  `D:\Dev\Tools` when that folder exists, otherwise `%USERPROFILE%\.kural\tools`.
- Linux/macOS: use `scripts/start-local.sh`. The default tools root is
  `$HOME/.local/share/kural-tools`.
- Docker: `docker compose up` remains the most reproducible path and includes
  the Chatterbox clone runtime.
- Desktop: the Tauri app is cross-platform, but signed installers and bundled
  local model packs still need platform-specific release work.
