"""Optional API key authentication.

If KURAL_API_KEY is set, every /api/* request must include a matching
X-API-Key header. If unset, authentication is disabled — preserves the
single-user offline workflow the README promises while letting operators
gate networked deployments.
"""
import hmac

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

from .config import settings

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def check_api_key(provided: str | None) -> bool:
    """True when `provided` matches KURAL_API_KEY, or when auth is disabled.

    Transport-agnostic so both the HTTP dependency below and the
    WebSocket streaming route can share one constant-time comparison —
    APIKeyHeader (a Security scheme) only works for HTTP requests.
    """
    expected = settings.api_key.strip()
    if not expected:
        return True
    return bool(
        provided and hmac.compare_digest(provided.encode(), expected.encode())
    )


async def require_api_key(api_key: str | None = Security(_api_key_header)) -> None:
    if check_api_key(api_key):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={
            "code": "invalid_api_key",
            "message": "Missing or invalid X-API-Key header.",
        },
    )
