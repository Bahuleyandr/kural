from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_api_key
from .config import settings
from .rate_limit import limiter, rate_limit_exceeded_handler
from .routers import clones, health, local_models, synthesize, voices
from slowapi.errors import RateLimitExceeded

app = FastAPI(
    title="Kural TTS API",
    description="Privacy-first, offline text-to-speech powered by Kokoro TTS (Apache 2.0) and Chatterbox TTS (MIT).",
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
)

_protected = [Depends(require_api_key)]

app.include_router(health.router)
app.include_router(voices.router, prefix="/api", dependencies=_protected)
app.include_router(clones.router, prefix="/api", dependencies=_protected)
app.include_router(synthesize.router, prefix="/api", dependencies=_protected)
app.include_router(local_models.router, prefix="/api", dependencies=_protected)
