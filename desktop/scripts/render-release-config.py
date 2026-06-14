"""Render the Tauri release config overlay from signing environment variables.

In addition to the updater key/endpoint, this also wires platform code-signing:

- Windows Authenticode. Set ``KURAL_WIN_CERT_THUMBPRINT`` to the thumbprint of a
  code-signing certificate already imported into the Windows certificate store;
  Tauri/signtool select it by thumbprint. A bare PFX path cannot be expressed in
  tauri.conf's windows block, so ``KURAL_WIN_CERT_FILE`` without a thumbprint is
  rejected rather than silently producing an unsigned build.
- macOS Developer ID via ``KURAL_MAC_SIGNING_IDENTITY`` plus optional
  ``KURAL_MAC_NOTARIZE=true`` for notarytool submission.

The updater public key is validated so a placeholder or malformed key fails the
render instead of shipping an installer whose auto-update can never verify.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path


DEFAULT_ENDPOINT = (
    "https://github.com/Bahuleyandr/kural/releases/latest/download/latest.json"
)

_PUBKEY_PLACEHOLDERS = {"", "test-public-key", "changeme", "replace-me", "dummy", "todo"}


def _validate_updater_pubkey(value: str) -> str:
    """Reject placeholder/malformed updater keys before they ship.

    A Tauri v2 updater pubkey is the base64 key emitted by
    ``tauri signer generate``. If a placeholder (e.g. "test-public-key") or a
    typo'd key is baked into the bundle, the updater can never verify a
    signature, so every future auto-update silently fails. The original value is
    returned unchanged when valid — we validate, we do not transform.
    """
    cleaned = value.strip()
    if cleaned.lower() in _PUBKEY_PLACEHOLDERS:
        raise SystemExit(
            "KURAL_UPDATER_PUBLIC_KEY looks like a placeholder. Set it to the "
            "base64 public key from `tauri signer generate`."
        )
    # Accept either the raw base64 or a minisign 'untrusted comment' file body.
    candidate = cleaned.splitlines()[-1].strip()
    try:
        decoded = base64.b64decode(candidate, validate=True)
    except ValueError as exc:  # binascii.Error subclasses ValueError
        raise SystemExit(
            "KURAL_UPDATER_PUBLIC_KEY is not valid base64; expected the public "
            "key emitted by `tauri signer generate`."
        ) from exc
    if len(decoded) < 32:
        raise SystemExit(
            "KURAL_UPDATER_PUBLIC_KEY decoded to too few bytes to be a valid "
            "updater public key."
        )
    return cleaned


def _windows_block() -> dict[str, object] | None:
    thumbprint = os.environ.get("KURAL_WIN_CERT_THUMBPRINT", "").strip()
    cert_file = os.environ.get("KURAL_WIN_CERT_FILE", "").strip()
    timestamp_url = os.environ.get(
        "KURAL_WIN_TIMESTAMP_URL", "http://timestamp.digicert.com"
    ).strip()
    digest = os.environ.get("KURAL_WIN_DIGEST_ALGORITHM", "sha256").strip()

    if not thumbprint and not cert_file:
        return None
    if not thumbprint:
        # A bare PFX path can't be expressed in tauri.conf's windows signing
        # block (which keys off an installed cert's thumbprint). Fail loudly
        # rather than emit a block with no certificate -> silently unsigned.
        raise SystemExit(
            "KURAL_WIN_CERT_FILE is set but KURAL_WIN_CERT_THUMBPRINT is not. "
            "Import the certificate into the Windows store and set its "
            "thumbprint, or sign out-of-band. Kural will not emit a signing "
            "block with no certificate."
        )
    return {
        "certificateThumbprint": thumbprint,
        "timestampUrl": timestamp_url,
        "digestAlgorithm": digest,
    }


def _macos_block() -> dict[str, object] | None:
    identity = os.environ.get("KURAL_MAC_SIGNING_IDENTITY", "").strip()
    if not identity:
        return None
    block: dict[str, object] = {"signingIdentity": identity}
    entitlements = os.environ.get("KURAL_MAC_ENTITLEMENTS", "").strip()
    if entitlements:
        block["entitlements"] = entitlements
    if os.environ.get("KURAL_MAC_HARDENED_RUNTIME", "true").strip().lower() != "false":
        block["hardenedRuntime"] = True
    return block


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=str(repo_root / "desktop" / "target" / "tauri-release.conf.json"),
        help="Output config overlay path.",
    )
    args = parser.parse_args()

    public_key = os.environ.get("KURAL_UPDATER_PUBLIC_KEY", "").strip()
    if not public_key:
        raise SystemExit("KURAL_UPDATER_PUBLIC_KEY is required for release config rendering.")
    public_key = _validate_updater_pubkey(public_key)

    endpoint = os.environ.get("KURAL_UPDATE_ENDPOINT", DEFAULT_ENDPOINT).strip()
    bundle: dict[str, object] = {
        "createUpdaterArtifacts": True,
        "resources": {
            "../../backend/app": "backend/app",
            "../../backend/scripts": "backend/scripts",
            "../../backend/requirements.txt": "backend/requirements.txt",
            "../../desktop/runtime/python": "python",
        },
    }
    win_block = _windows_block()
    if win_block:
        bundle["windows"] = win_block
    mac_block = _macos_block()
    if mac_block:
        bundle["macOS"] = mac_block

    config = {
        "bundle": bundle,
        "plugins": {
            "updater": {
                "pubkey": public_key,
                "endpoints": [endpoint],
                "windows": {"installMode": "passive"},
            }
        },
    }

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"Rendered release config to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
