#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
runtime_dir="$script_dir/runtime"
runtime_python="$runtime_dir/python"
runtime_models="$runtime_dir/models"
config_path="$script_dir/target/tauri-installer.conf.json"
python_bin="${KURAL_DESKTOP_BUILD_PYTHON:-python3}"
local_models_root="${KURAL_LOCAL_MODELS_ROOT:-}"
with_clone="0"
with_local_models="0"
skip_runtime="0"
skip_models="0"
skip_smoke="0"
tauri_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-clone)
      with_clone="1"
      shift
      ;;
    --with-local-models)
      with_local_models="1"
      shift
      ;;
    --skip-runtime-provision)
      skip_runtime="1"
      shift
      ;;
    --skip-model-provision)
      skip_models="1"
      shift
      ;;
    --skip-smoke)
      skip_smoke="1"
      shift
      ;;
    --python)
      python_bin="$2"
      shift 2
      ;;
    --local-models-root)
      local_models_root="$2"
      shift 2
      ;;
    --)
      shift
      tauri_args+=("$@")
      break
      ;;
    *)
      tauri_args+=("$1")
      shift
      ;;
  esac
done

mkdir -p "$runtime_models"

if [[ "$skip_runtime" != "1" ]]; then
  runtime_args=(
    "$script_dir/scripts/provision-backend-runtime.py"
    --target "$runtime_python"
    --python "$python_bin"
  )
  if [[ "$with_clone" == "1" ]]; then
    runtime_args+=(--with-clone)
  fi
  if [[ "$with_local_models" == "1" ]]; then
    runtime_args+=(--with-local-models)
  fi
  "$python_bin" "${runtime_args[@]}"
fi

if [[ -x "$runtime_python/bin/python" ]]; then
  runtime_python_exe="$runtime_python/bin/python"
elif [[ -x "$runtime_python/Scripts/python.exe" ]]; then
  runtime_python_exe="$runtime_python/Scripts/python.exe"
else
  echo "Bundled runtime Python was not found in $runtime_python" >&2
  exit 1
fi

kokoro_runtime_dir="$runtime_models/kokoro"
if [[ "$skip_models" != "1" ]]; then
  MODEL_CACHE_DIR="$kokoro_runtime_dir" "$runtime_python_exe" "$repo_root/backend/scripts/download_models.py"
fi

if [[ "$with_local_models" == "1" ]]; then
  if [[ -z "$local_models_root" ]]; then
    local_models_root="$runtime_models/local-source"
    "$runtime_python_exe" "$repo_root/backend/scripts/provision_local_models.py" --root "$local_models_root"
  fi

  asr_source="$local_models_root/asr/faster-whisper-tiny"
  argos_source="$local_models_root/translation/argos/packages"
  asr_dest="$runtime_models/asr/faster-whisper-tiny"
  argos_dest="$runtime_models/translation/argos/packages"

  if [[ -d "$asr_source" ]]; then
    mkdir -p "$(dirname "$asr_dest")"
    rm -rf "$asr_dest"
    cp -R "$asr_source" "$asr_dest"
  else
    echo "Warning: Faster-Whisper model source not found: $asr_source" >&2
  fi

  if [[ -d "$argos_source" ]]; then
    mkdir -p "$(dirname "$argos_dest")"
    rm -rf "$argos_dest"
    cp -R "$argos_source" "$argos_dest"
  else
    echo "Warning: Argos package source not found: $argos_source" >&2
  fi
fi

config_args=(
  "$script_dir/scripts/render-installer-config.py"
  --output "$config_path"
)
if [[ "$with_local_models" == "1" ]]; then
  config_args+=(--with-local-models)
fi
"$runtime_python_exe" "${config_args[@]}"

(cd "$repo_root/frontend" && corepack pnpm run build:desktop)
(cd "$script_dir" && npx @tauri-apps/cli@^2 build --config "$config_path" "${tauri_args[@]}")

if [[ "$skip_smoke" != "1" ]]; then
  "$runtime_python_exe" "$script_dir/scripts/smoke-release-artifacts.py"
fi
