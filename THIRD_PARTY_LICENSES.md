# Third-Party Licenses & Notices

Kural's own source code is licensed under the **MIT License** (see `LICENSE`).
A built/bundled Kural distribution (desktop installer or Docker image) also
includes third-party software and, optionally, machine-learning model weights
that carry their **own** licenses. This file accounts for the notable ones so a
redistributed binary is license-compliant.

> If you distribute a Kural binary, ship this notice and honor the obligations
> below (notably the GPL/LGPL source-offer for espeak-ng / ffmpeg and the
> non-commercial restriction on NLLB weights).

## Always bundled (default "lite" runtime)

| Component | License | Notes |
|-----------|---------|-------|
| FastAPI, Starlette, Uvicorn | MIT / BSD-3 | Backend web stack |
| Pydantic, pydantic-settings | MIT | |
| NumPy, SciPy, soundfile (libsndfile) | BSD-3 (libsndfile: LGPL-2.1) | libsndfile is LGPL — dynamically linked |
| kokoro-onnx, onnxruntime | MIT | TTS inference |
| slowapi | MIT | |
| defusedxml | PSF | SSML hardening |
| Next.js, React, JSZip | MIT | Frontend |
| Tauri, wry, tao | MIT / Apache-2.0 | Desktop shell |
| **espeak-ng** | **GPL-3.0** | Kokoro phonemizer. **Copyleft** — see below. |
| **ffmpeg** | **GPL-2.0+ / LGPL** (build-dependent) | mp3 encode, mux, ASR decode. See below. |

### Copyleft obligations (espeak-ng, ffmpeg)

`espeak-ng` (GPL-3.0) is bundled in the backend Docker image and the desktop
runtime, and `ffmpeg` (typically a GPL build) is used for audio encode/decode.
Distributing a binary bundle that includes these triggers their copyleft terms:
you must make the corresponding source available (an offer of source) to
recipients of the bundle. Kural links/invokes them as separate system
components; this does **not** relicense Kural's MIT source, but the **bundle as a
whole** carries the GPL/LGPL source-availability obligation for those components.
Upstream sources: <https://github.com/espeak-ng/espeak-ng>,
<https://ffmpeg.org/download.html>.

## Optional — voice cloning extra (`--with-clone`)

| Component | License |
|-----------|---------|
| chatterbox-tts | MIT |
| PyTorch, torchaudio | BSD-3 |
| transformers, diffusers, safetensors | Apache-2.0 |
| librosa, pyloudnorm, omegaconf | ISC / MIT / BSD |

## Optional — local models extra (`--with-local-models`)

| Component | License |
|-----------|---------|
| vosk | Apache-2.0 |
| argostranslate / CTranslate2 | MIT |
| faster-whisper | MIT |
| pykakasi | GPL-3.0 (verify before bundling) |

## Model weights (downloaded/provisioned, not in the source tree)

| Model | Weights license | Bundling note |
|-------|-----------------|----------------|
| Kokoro v1.0 | Apache-2.0 | Default TTS — OK to bundle |
| Supertonic | MIT | OK to bundle |
| IndicTrans2 | MIT | OK to bundle |
| **NLLB** | **CC-BY-NC-4.0 (non-commercial)** | Disabled by default (`ENABLE_NLLB`). **Do NOT bundle in a commercial/redistributed build.** |
| Vosk models | Apache-2.0 (per-model — verify) | User-provisioned |

NLLB is gated off by default specifically because its weights are
non-commercial; keep it opt-in and never ship it in a redistributed bundle
without confirming eligibility.

---

This notice is best-effort and not legal advice. Verify the exact license of
each component's pinned version (and any transitive dependency) before
distributing a binary. Generate a full SBOM (e.g. `pip-audit`, `cargo license`,
`pnpm licenses list`) for a complete accounting.
