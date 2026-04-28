#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

WITH_CLONE=0
TAURI_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --with-clone)
      WITH_CLONE=1
      shift
      ;;
    --)
      shift
      TAURI_ARGS+=("$@")
      break
      ;;
    *)
      TAURI_ARGS+=("$1")
      shift
      ;;
  esac
done

if [ -z "${KURAL_UPDATER_PUBLIC_KEY:-}" ]; then
  echo "KURAL_UPDATER_PUBLIC_KEY is required." >&2
  exit 1
fi
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "TAURI_SIGNING_PRIVATE_KEY is required for updater artifact signatures." >&2
  exit 1
fi

RUNTIME_ARGS=(scripts/provision-backend-runtime.py --target runtime/python)
if [ "$WITH_CLONE" -eq 1 ]; then
  RUNTIME_ARGS+=(--with-clone)
fi
python "${RUNTIME_ARGS[@]}"

CONFIG_PATH="target/tauri-release.conf.json"
python scripts/render-release-config.py --output "$CONFIG_PATH"

(cd ../frontend && npx pnpm@9.15.9 build:desktop)
npx @tauri-apps/cli@^2 build --config "$CONFIG_PATH" "${TAURI_ARGS[@]}"
python scripts/smoke-release-artifacts.py --require-signatures
