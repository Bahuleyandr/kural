# syntax=docker/dockerfile:1.7
# ── builder ─────────────────────────────────────────────────────────────────
# Two flavours share one builder, gated by a build arg:
#   --build-arg KURAL_FLAVOUR=lite   (default) — Kokoro only, ~600 MB image
#   --build-arg KURAL_FLAVOUR=clone           — Kokoro + Chatterbox, ~2 GB
# The `lite` image keeps PyTorch/Chatterbox out entirely; the `clone` image
# layers them on top of the same base venv.
FROM python:3.11-slim@sha256:6d85378d88a19cd4d76079817532d62232be95757cb45945a99fec8e8084b9c2 AS builder

ARG KURAL_FLAVOUR=lite
ENV KURAL_FLAVOUR=${KURAL_FLAVOUR}

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt requirements.lock requirements-clone.txt .
# Base runtime installs from a fully hash-pinned lock (--require-hashes) for
# reproducible builds + supply-chain integrity. Regenerate with `make lock`.
RUN pip install --no-cache-dir --require-hashes -r requirements.lock
RUN if [ "$KURAL_FLAVOUR" = "clone" ]; then \
        pip install --no-cache-dir torch==2.6.0+cpu torchaudio==2.6.0+cpu --index-url https://download.pytorch.org/whl/cpu \
        && pip install --no-cache-dir -r requirements-clone.txt \
        && pip install --no-cache-dir --no-deps chatterbox-tts==0.1.7; \
    fi

# ── runtime ────────────────────────────────────────────────────────────────
FROM python:3.11-slim@sha256:6d85378d88a19cd4d76079817532d62232be95757cb45945a99fec8e8084b9c2 AS runtime

ARG KURAL_FLAVOUR=lite
ENV KURAL_FLAVOUR=${KURAL_FLAVOUR}

# Runtime system libs only — no compiler toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    curl \
    gosu \
    espeak-ng \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1001 kural

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY --chown=kural:kural . .

RUN chmod +x /app/entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/healthz || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]

LABEL org.opencontainers.image.title="kural-backend" \
      org.opencontainers.image.description="Kural FastAPI backend (flavour=${KURAL_FLAVOUR})" \
      org.opencontainers.image.licenses="MIT"
