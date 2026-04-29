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


async def require_api_key(api_key: str | None = Security(_api_key_header)) -> None:
    expected = settings.api_key.strip()
    if not expected:
        return
    if not api_key or not hmac.compare_digest(api_key.encode(), expected.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "invalid_api_key",
                "message": "Missing or invalid X-API-Key header.",
            },
        )
