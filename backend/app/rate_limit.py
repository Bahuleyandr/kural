"""Per-IP rate limiting via slowapi.

Limits live in settings (RATE_LIMIT_SYNTHESIZE, RATE_LIMIT_CLONE). Tests can
loosen them through monkeypatch on `settings`.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=[])


async def rate_limit_exceeded_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RateLimitExceeded)
    return JSONResponse(
        status_code=429,
        content={
            "detail": {
                "code": "rate_limited",
                "message": f"Rate limit exceeded: {exc.detail}",
            }
        },
    )
