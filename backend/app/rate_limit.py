"""Per-IP rate limiting via slowapi.

Limits live in settings (RATE_LIMIT_SYNTHESIZE, RATE_LIMIT_CLONE). Tests can
loosen them through monkeypatch on `settings`.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from .config import settings


def _client_key(request: Request) -> str:
    """Rate-limit bucket key.

    By default this is the socket peer (``get_remote_address``). Behind a
    reverse proxy that peer is the proxy itself, so every client collapses into
    one bucket. When ``rate_limit_trust_forwarded`` is set (operator asserts a
    trusted proxy always sets the header) key on the leftmost X-Forwarded-For
    hop instead. Off by default because X-Forwarded-For is client-spoofable
    when the app is directly reachable.
    """
    if settings.rate_limit_trust_forwarded:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            client = forwarded.split(",")[0].strip()
            if client:
                return client
    return get_remote_address(request)


limiter = Limiter(key_func=_client_key, default_limits=[])


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
