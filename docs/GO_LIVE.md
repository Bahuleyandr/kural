# Kural Public Beta — Go-Live Operational Runbook

The code-side RC1 blockers are fixed and merged. The remaining steps are
**operational** — they need hardware, money, account access, or your Forgejo
server, so they can't live in the codebase. This is the checklist, in priority
order, with copy-paste commands.

---

## 1. Validate the Windows installer on a clean machine  (highest priority)

**Already validated on Windows (dev box, 2026-06-14):**
- python-build-standalone provisions end-to-end — downloads the pinned
  `cpython-3.12.8+20241219`, extracts it, and pip-installs the whole backend
  (numpy/scipy/onnxruntime/soundfile/kokoro-onnx/…) into `desktop/runtime/python`.
- the **bundled `python.exe` boots the FastAPI backend and serves**: `/healthz`
  200, `/api/health` → `ok v0.2.0`, `/api/runtime/health-checks` → 200.
- the desktop static export (`build:desktop`) emits Tauri-ready relative-URL
  `index.html` **and** `dictation.html` (no absolute `/_next`).

So the relocatable-runtime risk (the big one) is largely retired.

**Still needs a clean VM** (this box has system Python and no display for the
GUI). On a fresh Windows VM with **no Python on PATH**, confirm:

```powershell
# On a dev box with the toolchains (Python 3.12, Node 22, Rust, pnpm):
cd desktop
.\build-installer.ps1                 # full build (Kokoro + Chatterbox), or
.\build-installer.ps1 --without-clone # smaller Kokoro-only build to validate the pipeline first
# Output: desktop\src-tauri\target\release\bundle\{nsis,msi}\Kural_*.exe / *.msi
```

Copy the produced installer to the **clean VM** and confirm (mirrors
`docs/BETA_RC1.md` "First 15 Minutes"):

- [ ] Installer runs; app window opens to the creator workspace (not blank).
- [ ] The bundled Python launches the backend with **no system Python present**
      (this is the relocatable-runtime test that the dev box can't prove).
- [ ] Settings → Desktop Release Diagnostics: API URL is `127.0.0.1`, API key
      "Configured".
- [ ] First run reaches a working engine **without** re-downloading models if
      they were bundled (installer mode bundles them); offline after that.
- [ ] **IPC still works with `withGlobalTauri:false`:** save a clip (Save to
      folder), Reveal it, Open Logs, Restart Local Engine — all from the main
      window. (The dictation widget must NOT be able to do these.)
- [ ] Kokoro synth offline; clone capture+synth; `.kuralproj` export/import
      round-trip.

> If anything fails, capture `%APPDATA%\ai.kural.tts\logs` and the console — the
> startup paths are now non-fatal and surface errors via the diagnostics banner.

---

## 2. Register a Forgejo Actions runner  (so CI actually runs)

`.forgejo/workflows/ci.yml` runs the full gate, but a runner must be registered
or it never executes (GitHub Actions stays billing-blocked).

```bash
# On the Forgejo server: mint a registration token
#   Site admin → Actions → Runners → Create new runner   (or:)
forgejo forgejo-cli actions register   # prints a token

# On the runner host (needs Docker, or a host with python3.12+node+rust):
forgejo-runner register \
  --instance https://forgejo.hippocampus-monitor.ts.net \
  --token   <token> \
  --name    kural-ci \
  --labels  ubuntu-latest:docker://node:22-bookworm
forgejo-runner daemon        # (or run as a systemd service)
```

Then push any commit and confirm the `gate` job runs green in the Forgejo
Actions tab.

---

## 3. Auto-update  (NOT a beta blocker — for signed releases later)

The public beta uses `build-installer` (NSIS/MSI), which **ships no updater** —
so there is no day-one 404. The updater only matters once you cut signed
`build-release` builds. Two prerequisites then:

1. **A public update endpoint.** The default points at
   `github.com/Bahuleyandr/kural/releases/.../latest.json`, but that repo is
   **private** — end users can't reach private releases. Either:
   - make the GitHub repo (or at least its Releases) public, **or**
   - host `latest.json` + artifacts on a public host you control (Cloudflare
     Pages/R2) and set `KURAL_UPDATE_ENDPOINT` to it.
2. **An updater keypair** (separate from code-signing):
   ```bash
   cargo tauri signer generate -w ~/.kural/tauri.key
   # save the private key safely; the printed pubkey -> KURAL_UPDATER_PUBLIC_KEY
   ```
   `render-release-config.py` now validates this key, so a placeholder is
   rejected before it can ship a dead updater.

---

## 4. Windows Authenticode cert  (kills SmartScreen)

The signing plumbing is wired and verified; it just needs a certificate. Until
then the beta is unsigned and SmartScreen warns on first run (acceptable for a
documented beta).

- Standard cert (~$100/yr) or EV (~$300/yr, instantly SmartScreen-trusted).
- Import it, then set `KURAL_WIN_CERT_THUMBPRINT` and build with
  `build-release` — `render-release-config.py` emits the signing block and the
  build now **warns loudly** if no cert is configured.
- Verify the result: `python desktop/scripts/smoke-release-artifacts.py --require-signatures --verify-authenticode`.

See `docs/RELEASE.md` for the full secrets list (incl. macOS Developer ID +
notarization) when you get there.
