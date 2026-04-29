# Kural Release Checklist

## Unsigned Local Installers

Use this path for internal testing and demos before code-signing accounts are
ready.

Windows:

```powershell
cd desktop
.\build-installer.ps1
```

Linux/macOS:

```bash
cd desktop
./build-installer.sh
```

The installer scripts provision a bundled Python backend runtime, download the
Kokoro ONNX model files into `desktop/runtime/models/kokoro`, render
`desktop/target/tauri-installer.conf.json`, build the static frontend, build the
Tauri installer, and smoke-check the generated artifacts.

Optional switches:

- `-WithClone` / `--with-clone`: include Chatterbox voice-clone runtime.
- `-WithLocalModels` / `--with-local-models`: include Faster-Whisper and Argos
  packs from `KURAL_LOCAL_MODELS_ROOT`.
- `-SkipRuntimeProvision` / `--skip-runtime-provision`: reuse an existing
  `desktop/runtime/python`.
- `-SkipModelProvision` / `--skip-model-provision`: reuse existing bundled
  Kokoro model files.

Unsigned Windows installers may still show SmartScreen warnings until we add
Authenticode signing.

## Desktop Runtime

Provision a bundled backend runtime before signed desktop builds:

```bash
cd desktop
python scripts/provision-backend-runtime.py --target runtime/python
```

Use `--with-clone` when release artifacts should include Chatterbox voice-clone dependencies. The Tauri app discovers this runtime from the bundled `python/` resource, with `KURAL_PYTHON` still available as an override for diagnostics.

## Signing And Updater

Tauri v2 updater artifacts require:

- `KURAL_UPDATER_PUBLIC_KEY`: public key written into the temporary Tauri config.
- `TAURI_SIGNING_PRIVATE_KEY`: private signing key path or contents used only during build.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional private-key password.
- `KURAL_UPDATE_ENDPOINT`: optional updater JSON endpoint. Defaults to the GitHub latest release `latest.json`.

The release scripts render `desktop/target/tauri-release.conf.json` with `bundle.createUpdaterArtifacts=true`, bundle `desktop/runtime/python`, build installers, and verify artifacts:

```powershell
cd desktop
.\build-release.ps1
```

```bash
cd desktop
./build-release.sh
```

## Artifact Smoke

After a build, run:

```bash
cd desktop
python scripts/smoke-release-artifacts.py --require-signatures
```

This checks that bundle artifacts exist, are non-empty, updater signatures are present, and any generated `latest.json` files are valid JSON with a version.

## External Signing Accounts

Updater signatures are not the same as platform store or OS trust signing. Windows Authenticode, Apple Developer ID signing, notarization, and store submission still need the relevant private certificates/accounts outside this repository.
