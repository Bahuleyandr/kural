#!/bin/sh
# Prepare persisted cache volumes, then run the app as the non-root user.
set -e

MODEL_CACHE_DIR="${MODEL_CACHE_DIR:-/home/kural/.cache/kural/kokoro}"
CLONE_CACHE_DIR="${CLONE_CACHE_DIR:-/home/kural/.cache/kural/clones}"

mkdir -p "$MODEL_CACHE_DIR" "$CLONE_CACHE_DIR"
chown -R kural:kural "$MODEL_CACHE_DIR" "$CLONE_CACHE_DIR"

exec gosu kural sh -c 'python /app/scripts/download_models.py && exec uvicorn app.main:app --host 0.0.0.0 --port 8000'
