import logging
import traceback
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import telemetry as telemetry_module
from .auth import require_api_key
from .config import settings
from .rate_limit import limiter, rate_limit_exceeded_handler
from .routers import (
    agent,
    clones,
    health,
    local_models,
    model_packs,
    runtime,
    setup,
    synthesize,
    telemetry,
    voices,
)
from slowapi.errors import RateLimitExceeded

app = FastAPI(
    title="Kural TTS API",
    description=(
        "Privacy-first, offline text-to-speech powered by Kokoro TTS (Apache 2.0), "
        "Chatterbox TTS (MIT, voice cloning), and Supertonic TTS (MIT, native multilingual)."
    ),
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

_log = logging.getLogger("kural.exception")


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    _log.exception("Unhandled error in %s %s", request.method, request.url.path)
    if telemetry_module.is_enabled():
        telemetry_module.record_event(
            {
                "kind": "backend_unhandled",
                "message": str(exc),
                "extra": {
                    "method": request.method,
                    "path": request.url.path,
                    "traceback": traceback.format_exc(limit=20),
                },
                "received_at": datetime.now(timezone.utc).isoformat(),
                "source": "backend",
            }
        )
    return JSONResponse(
        status_code=500,
        content={
            "detail": {
                "code": "internal_error",
                "message": "Internal server error.",
            }
        },
    )

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
app.include_router(model_packs.router, prefix="/api", dependencies=_protected)
app.include_router(agent.router, prefix="/api", dependencies=_protected)
app.include_router(runtime.router, prefix="/api", dependencies=_protected)
# WebSocket streaming router self-authenticates (see local_models.py) —
# the require_api_key dependency is HTTP-only and can't gate a WS route.
app.include_router(local_models.stream_router, prefix="/api")
app.include_router(setup.router, prefix="/api", dependencies=_protected)
app.include_router(telemetry.router, prefix="/api", dependencies=_protected)
