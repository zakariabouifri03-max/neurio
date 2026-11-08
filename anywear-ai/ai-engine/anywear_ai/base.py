"""Core abstractions for the try-on provider system."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


class ProviderError(Exception):
    """Raised when a try-on generation fails."""


class ProviderNotAvailableError(ProviderError):
    """Raised when a provider is selected but not usable (e.g. no GPU server)."""


@dataclass
class TryOnOptions:
    category: str = "shirt"          # shirt | trousers | dress | jacket | skirt | other
    strength: float = 1.0            # 0..1 blend strength hint for composite providers
    preserve_identity: bool = True
    max_size: int = 1024             # max output edge in pixels
    seed: Optional[int] = None
    extra: dict = field(default_factory=dict)


@dataclass
class TryOnResult:
    output_bytes: bytes
    mimetype: str
    provider: str
    mode: str                        # "dev-composite" | "idmvton" | ...
    elapsed_ms: int
    meta: dict = field(default_factory=dict)


class TryOnProvider(ABC):
    """Interface every try-on backend must implement.

    Implementations must be safe to call from a thread (the backend runs
    generations in worker threads).
    """

    name: str = "base"
    mode: str = "base"

    @abstractmethod
    def generate(self, person_image: bytes, garment_image: bytes, options: TryOnOptions) -> TryOnResult:
        """Run try-on. Returns TryOnResult with rendered PNG/JPEG bytes."""

    def health(self) -> dict:
        return {"provider": self.name, "mode": self.mode, "available": True}


def now_ms() -> int:
    return int(time.monotonic() * 1000)
