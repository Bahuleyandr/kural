# Kural Release Checklist

## TL;DR

```bash
git tag v0.2.0
git push origin v0.2.0
```

`.github/workflows/release.yml` builds Linux/Windows/macOS bundles, signs them
when the corresponding secrets are configured, runs the artifact smoke check,
and uploads everything to the GitHub release. Without signing secrets the
workflow still produces the bundles — they're just unsigned (and on macOS,
also un-notarized, which means Gatekeeper will block them).

## Unsigned Local Installers

For internal testing and demos, build straight from the repo:

```powershell
cd desktop
.\build-installer.ps1
```

```bash
cd desktop
./build-installer.sh
```

Both wrappers shell out to `desktop/scripts/build_desktop.py installer`. The
script provisions a bundled Python backend runtime with Kokoro and Chatterbox,
downloads the Kokoro ONNX weights into `desktop/runtime/models/kokoro`, renders
the installer config, builds the static frontend, builds the Tauri installer,
and runs `smoke-release-artifacts.py` against the output.

Optional flags forwarded straight through to `build_desktop.py`:

- `--without-clone` — skip Chatterbox for a smaller Kokoro-only build
- `--with-local-models` — bundle Faster-Whisper + Argos packs from
  `KURAL_LOCAL_MODELS_ROOT` (or provision new ones)
- `--skip-runtime-provision` — reuse `desktop/runtime/python`
- `--skip-model-provision` — reuse the bundled Kokoro weights

Unsigned Windows installers will trigger SmartScreen warnings; macOS
unsigned bundles will be Gatekeeper-blocked. Sign them.

## Public Beta RC1 Local Gate

Before tagging a public beta candidate, run the local release gate. The fast
gate is suitable before each RC commit:

```powershell
.\scripts\rc1-release-gate.ps1
```

Run the full gate before an installer handoff:

```powershell
.\scripts\rc1-release-gate.ps1 -IncludePlaywright -IncludeDocker
```

Cross-platform equivalent:

```bash
python scripts/rc1_release_gate.py --include-playwright --include-docker
```

See `docs/BETA_RC1.md` for the dogfood checklist and pass/fail criteria.

## Updater Signing

Tauri's auto-updater uses a separate Ed25519 keypair from OS code-signing.

1. `cargo install tauri-cli` once, then `cargo tauri signer generate -w
   ~/.kural/tauri.key`. Save the private key somewhere safe and the
   `pubkey:...` line as `KURAL_UPDATER_PUBLIC_KEY`.
2. Set GitHub secrets:
   - `KURAL_UPDATER_PUBLIC_KEY` — the public half (pasted into the config)
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of the private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — optional, only if the key is
     password-encrypted

The release workflow refuses to run without these.

## Windows Authenticode Signing

Windows blocks unsigned installers behind SmartScreen. Two paths:

**Standard certificate (Sectigo / DigiCert / GlobalSign):** ~$100/yr,
hosted on a smartcard or CSP. Less effective against SmartScreen.

**EV certificate:** ~$300/yr, instantly trusted by SmartScreen, hardware token
required.

Either way, configure these GitHub secrets:

- `KURAL_WIN_CERT_FILE` — base64-encoded `.pfx` (`base64 -w0 cert.pfx`).
  Used to import the cert into the runner's Cert store at job start.
- `KURAL_WIN_CERT_PASSWORD` — `.pfx` password.
- `KURAL_WIN_CERT_THUMBPRINT` — thumbprint that `signtool` and Tauri pick up
  from the imported cert.

The release workflow imports the cert into `Cert:\CurrentUser\My`, hands the
thumbprint to `render-release-config.py`, and Tauri invokes signtool with the
configured timestamp URL.

## macOS Developer ID Signing + Notarization

Required so Gatekeeper does not block the app on first launch.

1. Apple Developer Program membership ($99/yr).
2. Generate a "Developer ID Application" certificate from Xcode → Preferences
   → Accounts → Manage Certificates. Export as `.p12` with a password.
3. Generate an app-specific password at appleid.apple.com → Sign-In and
   Security → App-Specific Passwords (for `notarytool` submission).

GitHub secrets:

- `KURAL_MAC_SIGNING_IDENTITY` — exact identity string, e.g.
  `Developer ID Application: Bahuleyan S (TEAMID)`
- `KURAL_MAC_CERT_BASE64` — base64-encoded `.p12`
- `KURAL_MAC_CERT_PASSWORD` — `.p12` password
- `KURAL_MAC_KEYCHAIN_PASSWORD` — any string; used as the password for the
  ephemeral keychain the workflow creates
- `KURAL_APPLE_ID` — Apple ID email
- `KURAL_APPLE_TEAM_ID` — Team ID (10-char string from Apple Developer)
- `KURAL_APPLE_APP_PASSWORD` — app-specific password from the previous step

The workflow imports the cert into a temporary keychain, signs via Tauri's
`signingIdentity` config, then runs `xcrun notarytool submit … --wait` and
staples the resulting ticket.

## Artifact Smoke

Always runs as the last step of any release build:

```bash
cd desktop
python scripts/smoke-release-artifacts.py --require-signatures
```

Verifies bundle existence, non-empty size, presence of updater `.sig` files,
and parses any `latest.json` to ensure it has a version field.

## Release Tagging

```bash
# Bump app version everywhere it appears:
#   backend/app/version.py, backend/pyproject.toml, frontend/package.json,
#   cli/pyproject.toml, desktop/src-tauri/Cargo.toml
git commit -am "chore: bump to v0.2.1"
git tag v0.2.1
git push origin main v0.2.1
```

The release workflow triggers on `v*.*.*` tags. Track its run via
`gh run watch`.

## Known Gaps Until First Real Release

- Updater key not yet generated (no `KURAL_UPDATER_PUBLIC_KEY` saved).
- Windows EV cert not yet purchased.
- Apple Developer Program not yet enrolled.
- GitHub Actions billing on this account is currently blocked, so the
  workflow above will not actually execute until that is resolved. Local
  release builds (`build-release.{sh,ps1}`) work today; they just produce
  unsigned bundles.
