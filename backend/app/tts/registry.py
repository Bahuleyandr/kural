"""Thread-safe engine registry.

Both Kokoro (ONNX) and Chatterbox (PyTorch) engines are expensive to load and
hold large in-memory state. The registry guarantees one-shot, double-checked
locking so concurrent first-time requests do not race to load duplicate copies.

Kural is **single-tenant by design** — every running process serves one user.
Engines are shared across all requests in this process, including the cloned
voice cache. For multi-tenant or LAN deployments, run one process per tenant
(see README: "Hardening for networked deployments").
"""
from __future__ import annotations

import threading
from typing import Any, Callable


class EngineRegistry:
    def __init__(self) -> None:
        self._kokoro: Any = None
        self._chatterbox: Any = None
        self._kokoro_lock = threading.Lock()
        self._chatterbox_lock = threading.Lock()

    def kokoro(self, factory: Callable[[], Any]) -> Any:
        if self._kokoro is not None:
            return self._kokoro
        with self._kokoro_lock:
            if self._kokoro is None:
                self._kokoro = factory()
            return self._kokoro

    def chatterbox(self, factory: Callable[[], Any]) -> Any:
        if self._chatterbox is not None:
            return self._chatterbox
        with self._chatterbox_lock:
            if self._chatterbox is None:
                self._chatterbox = factory()
            return self._chatterbox

    def reset(self) -> None:
        """Drop loaded engines. Tests use this; production never should."""
        with self._kokoro_lock, self._chatterbox_lock:
            self._kokoro = None
            self._chatterbox = None


registry = EngineRegistry()
