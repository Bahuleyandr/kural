from fastapi import APIRouter
from ..models import HealthResponse
from ..config import settings

router = APIRouter()


@router.get("/healthz", response_model=HealthResponse, tags=["system"])
async def healthz() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version="0.1.0",
        engine=settings.tts_engine,
    )
