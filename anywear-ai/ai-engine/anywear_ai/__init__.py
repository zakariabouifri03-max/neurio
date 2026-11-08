"""Anywear AI — modular virtual try-on engine.

Providers
---------
- ``dev_composite``: local, CPU-only, real image processing (Pillow alpha composite).
  Clearly labeled development mode — no neural net involved. Used for development,
  CI and environments without a GPU.
- ``idmvton_http``: production provider. Talks to a self-hosted IDM-VTON inference
  server (see docs/AI_ENGINE.md). Requires a GPU server.
"""

from anywear_ai.base import (
    ProviderError,
    ProviderNotAvailableError,
    TryOnOptions,
    TryOnProvider,
    TryOnResult,
)
from anywear_ai.providers import get_provider, list_providers

__all__ = [
    "ProviderError",
    "ProviderNotAvailableError",
    "TryOnOptions",
    "TryOnProvider",
    "TryOnResult",
    "get_provider",
    "list_providers",
]

__version__ = "0.1.0"
