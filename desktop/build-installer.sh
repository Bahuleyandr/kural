#!/usr/bin/env bash
# Thin wrapper — orchestration lives in scripts/build_desktop.py.
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${KURAL_DESKTOP_BUILD_PYTHON:-python3}" "$script_dir/scripts/build_desktop.py" installer "$@"
