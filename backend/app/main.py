from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import health, voices, synthesize

app = FastAPI(
    title="Kural TTS API",
    description="Privacy-first, offline text-to-speech powered by Kokoro TTS (Apache 2.0).",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(voices.router, prefix="/api")
app.include_router(synthesize.router, prefix="/api")
