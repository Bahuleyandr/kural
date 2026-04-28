#!/bin/sh
# Download Kokoro model files on first start (idempotent — skips if already cached).
set -e
python /app/scripts/download_models.py
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
