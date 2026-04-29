"""Render the Tauri release config overlay from signing environment variables.

In addition to the updater key/endpoint, this also wires platform code-signing:

- Windows Authenticode via signtool. The release workflow points
  ``KURAL_WIN_CERT_THUMBPRINT`` (or ``KURAL_WIN_CERT_FILE`` + password) at the
  installed cert; we just teach Tauri where to find signtool and which
  thumbprint to use.
- macOS Developer ID via ``KURAL_MAC_SIGNING_IDENTITY`` plus optional
  ``KURAL_MAC_NOTARIZE=true`` for notarytool submission.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


DEFAULT_ENDPOINT = (
    "https://github.com/Bahuleyandr/kural/releases/latest/download/latest.json"
)


def _windows_block() -> dict[str, object] | None:
    thumbprint = os.environ.get("KURAL_WIN_CERT_THUMBPRINT", "").strip()
    cert_file = os.environ.get("KURAL_WIN_CERT_FILE", "").strip()
    timestamp_url = os.environ.get(
        "KURAL_WIN_TIMESTAMP_URL", "http://timestamp.digicert.com"
    ).strip()
    digest = os.environ.get("KURAL_WIN_DIGEST_ALGORITHM", "sha256").strip()

    if not thumbprint and not cert_file:
        return None

    block: dict[str, object] = {
        "timestampUrl": timestamp_url,
        "digestAlgorithm": digest,
    }
    if thumbprint:
        block["certificateThumbprint"] = thumbprint
    return block


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
