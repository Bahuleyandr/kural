# ── builder stage ──────────────────────────────────────────────────────────────
# Installs all Python dependencies into an isolated venv so the runtime stage
# can copy only the finished venv without pip, build tools, or wheel caches.
FROM python:3.11-slim@sha256:6d85378d88a19cd4d76079817532d62232be95757cb45945a99fec8e8084b9c2 AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
# CPU-only torch keeps the venv footprint manageable; must precede -r install.
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# ── runtime stage ──────────────────────────────────────────────────────────────
FROM python:3.11-slim@sha256:6d85378d88a19cd4d76079817532d62232be95757cb45945a99fec8e8084b9c2 AS runtime

# Runtime system libs only — no compiler toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    curl \
    espeak-ng \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Non-root service account.
RUN useradd --create-home --uid 1001 kural

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY --chown=kural:kural . .

RUN chmod +x /app/entrypoint.sh

USER kural

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/healthz || exit 1

# entrypoint.sh downloads Kokoro model files on first start (idempotent),
# then execs uvicorn. Models are persisted via the kural_model_cache volume.
ENTRYPOINT ["/app/entrypoint.sh"]
