#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools_root="${KURAL_TOOLS_ROOT:-"$HOME/.local/share/kural-tools"}"
backend_host="127.0.0.1"
backend_port="8000"
frontend_host="127.0.0.1"
frontend_port="3000"
setup="0"
provision_models="0"
install_clone_runtime="0"
no_frontend="0"

usage() {
  cat <<'USAGE'
Usage: scripts/start-local.sh [options]

Options:
  --tools-root PATH          Root for venvs and model packs.
  --backend-python PATH      Python executable for the backend.
  --backend-host HOST        Backend bind host. Default: 127.0.0.1
  --backend-port PORT        Backend port. Default: 8000
  --frontend-host HOST       Frontend bind host. Default: 127.0.0.1
  --frontend-port PORT       Frontend port. Default: 3000
  --setup                    Create Python 3.11 venv and install dependencies.
  --provision-models         Download Kokoro, faster-whisper tiny, and starter Argos packs.
  --install-clone-runtime    Include optional Chatterbox clone runtime during --setup.
  --no-frontend              Start only the backend.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tools-root)
      tools_root="$2"
      shift 2
      ;;
    --backend-python)
      KURAL_BACKEND_PYTHON="$2"
      shift 2
      ;;
    --backend-host)
      backend_host="$2"
      shift 2
      ;;
    --backend-port)
      backend_port="$2"
      shift 2
      ;;
    --frontend-host)
      frontend_host="$2"
      shift 2
      ;;
    --frontend-port)
      frontend_port="$2"
      shift 2
      ;;
    --setup)
      setup="1"
      shift
      ;;
    --provision-models)
      provision_models="1"
      shift
      ;;
    --install-clone-runtime)
      install_clone_runtime="1"
      shift
      ;;
    --no-frontend)
      no_frontend="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

venv_dir="$tools_root/kural-local-models/.venv"
default_python="$venv_dir/bin/python"
backend_python="${KURAL_BACKEND_PYTHON:-"$default_python"}"
models_root="$tools_root/kural-models"
backend_dir="$repo_root/backend"
frontend_dir="$repo_root/frontend"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required. $2" >&2
    exit 1
  fi
}

wait_for_backend() {
  url="$1"
  for _ in $(seq 1 60); do
    if "$backend_python" - "$url" <<'PY' >/dev/null 2>&1
import sys
import urllib.request

urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
    then
      return 0
    fi
    sleep 1
  done
  echo "Backend did not become healthy at $url" >&2
  exit 1
}

cleanup() {
  if [[ -n "${frontend_pid:-}" ]] && kill -0 "$frontend_pid" >/dev/null 2>&1; then
    kill "$frontend_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "${backend_pid:-}" ]] && kill -0 "$backend_pid" >/dev/null 2>&1; then
    kill "$backend_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$tools_root" "$models_root"

if [[ "$setup" == "1" ]]; then
  require_command uv "Install uv first, or create the venv manually and pass --backend-python."
  export UV_PYTHON_INSTALL_DIR="$tools_root/uv/python"
  uv python install 3.11
  uv venv "$venv_dir" --python 3.11
  uv pip install --python "$default_python" \
    -r "$backend_dir/requirements.txt" \
    -r "$backend_dir/requirements-dev.txt" \
    -r "$backend_dir/requirements-local-models.txt"

  if [[ "$install_clone_runtime" == "1" ]]; then
    uv pip install --python "$default_python" -r "$backend_dir/requirements-clone.txt"
    uv pip install --python "$default_python" --no-deps chatterbox-tts==0.1.7
  fi
fi

if [[ ! -x "$backend_python" ]]; then
  echo "Backend Python not found at $backend_python. Run scripts/start-local.sh --setup first." >&2
  exit 1
fi

export MODEL_CACHE_DIR="${MODEL_CACHE_DIR:-"$models_root/tts/kokoro"}"
export CLONE_CACHE_DIR="${CLONE_CACHE_DIR:-"$models_root/clones"}"
export FASTER_WHISPER_MODEL_DIR="${FASTER_WHISPER_MODEL_DIR:-"$models_root/asr/faster-whisper-tiny"}"
export ARGOS_PACKAGES_DIR="${ARGOS_PACKAGES_DIR:-"$models_root/translation/argos/packages"}"
export ARGOS_PACKAGE_DIR="$ARGOS_PACKAGES_DIR"
export HF_HOME="${HF_HOME:-"$tools_root/huggingface-cache"}"
export NEXT_PUBLIC_API_URL="http://$backend_host:$backend_port"

mkdir -p "$MODEL_CACHE_DIR" "$CLONE_CACHE_DIR" "$FASTER_WHISPER_MODEL_DIR" "$ARGOS_PACKAGES_DIR" "$HF_HOME"

if [[ "$provision_models" == "1" || ! -f "$MODEL_CACHE_DIR/kokoro-v1.0.int8.onnx" || ! -f "$MODEL_CACHE_DIR/voices-v1.0.bin" ]]; then
  "$backend_python" "$backend_dir/scripts/download_models.py"
fi

if [[ "$provision_models" == "1" ]]; then
  "$backend_python" "$backend_dir/scripts/provision_local_models.py" --root "$models_root"
fi

backend_url="http://$backend_host:$backend_port"
frontend_url="http://$frontend_host:$frontend_port"

echo "Starting Kural backend at $backend_url"
(cd "$backend_dir" && "$backend_python" -m uvicorn app.main:app --host "$backend_host" --port "$backend_port") &
backend_pid="$!"

wait_for_backend "$backend_url/api/health"
echo "Backend ready."
echo "Model cache: $MODEL_CACHE_DIR"
echo "ASR model: $FASTER_WHISPER_MODEL_DIR"
echo "Argos packages: $ARGOS_PACKAGES_DIR"

if [[ "$no_frontend" != "1" ]]; then
  require_command corepack "Install Node.js 22+ with Corepack enabled."
  echo "Starting Kural frontend at $frontend_url"
  (cd "$frontend_dir" && corepack pnpm dev -- --hostname "$frontend_host" --port "$frontend_port") &
  frontend_pid="$!"
fi

echo ""
echo "Kural is running."
echo "API: $backend_url"
if [[ "$no_frontend" != "1" ]]; then
  echo "UI:  $frontend_url"
fi
echo "Press Ctrl+C to stop."

while true; do
  if ! kill -0 "$backend_pid" >/dev/null 2>&1; then
    wait "$backend_pid"
    exit $?
  fi
  if [[ -n "${frontend_pid:-}" ]] && ! kill -0 "$frontend_pid" >/dev/null 2>&1; then
    wait "$frontend_pid"
    exit $?
  fi
  sleep 2
done
