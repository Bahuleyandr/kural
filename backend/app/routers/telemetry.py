"""POST /api/telemetry — frontend errors flow through here.

The route is a thin pass-through to the vendor-neutral `telemetry.record_event`
plumbing. With `KURAL_TELEMETRY_OPT_IN=false` (the default) the call is a
no-op and the endpoint just returns 202 — the frontend doesn't have to know
whether telemetry is configured.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .. import telemetry

router = APIRouter(tags=["telemetry"])


class TelemetryEvent(BaseModel):
    kind: str = Field(..., min_length=1, max_length=64)
    message: str | None = Field(default=None, max_length=2000)
    digest: str | None = Field(default=None, max_length=128)
    extra: dict[str, Any] = Field(default_factory=dict)


class TelemetryAck(BaseModel):
    accepted: bool
    forwarded: bool


@router.post("/telemetry", response_model=TelemetryAck, status_code=202)
async def submit_event(event: TelemetryEvent, request: Request) -> TelemetryAck:
    payload = {
        "kind": event.kind,
        "message": event.message,
        "digest": event.digest,
        "extra": event.extra,
        "client_host": request.client.host if request.client else None,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "source": "frontend",
    }
    forwarded = telemetry.is_enabled()
    if forwarded:
        telemetry.record_event(payload)
    return TelemetryAck(accepted=True, forwarded=forwarded)
