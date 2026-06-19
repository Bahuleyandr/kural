"""The rate-limit bucket key must default to the socket peer and only honor
X-Forwarded-For when the operator explicitly trusts a reverse proxy."""
from types import SimpleNamespace

from app import rate_limit
from app.config import settings


def _req(peer: str, xff: str | None = None):
    headers = {"x-forwarded-for": xff} if xff is not None else {}
    return SimpleNamespace(client=SimpleNamespace(host=peer), headers=headers)


def test_keys_on_socket_peer_by_default(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_trust_forwarded", False)
    # XFF is ignored when not trusted — otherwise a client could spoof buckets.
    assert rate_limit._client_key(_req("1.2.3.4", xff="9.9.9.9")) == "1.2.3.4"


def test_keys_on_forwarded_when_trusted(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_trust_forwarded", True)
    assert rate_limit._client_key(_req("10.0.0.1", xff="9.9.9.9, 10.0.0.1")) == "9.9.9.9"


def test_trusted_but_no_forwarded_falls_back_to_peer(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_trust_forwarded", True)
    assert rate_limit._client_key(_req("10.0.0.1")) == "10.0.0.1"
