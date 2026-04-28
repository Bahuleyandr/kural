from fastapi import APIRouter
from ..models import HealthResponse
from ..config import settings

router = APIRouter()

_HEALTH = HealthResponse(status="ok", version=settings.app_version, engine=settings.tts_engine)


@router.get("/healthz", response_model=HealthResponse, tags=["system"])
async def healthz() -> HealthResponse:
    return _HEALTH


@router.get("/api/health", response_model=HealthResponse, tags=["system"])
async def api_health() -> HealthResponse:
    return _HEALTH
