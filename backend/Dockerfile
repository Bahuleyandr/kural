FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    curl \
    espeak-ng \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Install CPU-only torch first to keep image size manageable
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# Download Kokoro model files at build time so the image is self-contained
COPY scripts/download_models.py /tmp/download_models.py
RUN python /tmp/download_models.py

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
