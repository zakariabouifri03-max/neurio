"""Provider factory. Selection via env vars:

    AI_PROVIDER=dev-composite  (default)  — local CPU composite, dev mode
    AI_PROVIDER=idmvton                  — self-hosted GPU inference server
    AI_ENGINE_URL=http://host:8001        — inference server base URL
    AI_ENGINE_API_KEY=...                 — optional bearer key
"""

from __future__ import annotations

import os
from typing import Optional

from ..base import TryOnProvider
from .dev_composite import DevCompositeProvider


def get_provider(
    name: Optional[str] = None,
    engine_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> TryOnProvider:
    name = (name or os.getenv("AI_PROVIDER") or "dev-composite").strip().lower()
    engine_url = engine_url or os.getenv("AI_ENGINE_URL", "")
    api_key = api_key or os.getenv("AI_ENGINE_API_KEY", "")

    if name in ("dev", "dev-composite", "composite", "local"):
        return DevCompositeProvider()
    if name in ("idmvton", "idm-vton", "vton", "http"):
        from .idmvton_http import IDMVTONHTTPProvider

        return IDMVTONHTTPProvider(engine_url, api_key=api_key or None)
    raise ValueError(f"unknown AI provider: {name!r} (known: dev-composite, idmvton)")


def list_providers() -> list[str]:
    return ["dev-composite", "idmvton"]
