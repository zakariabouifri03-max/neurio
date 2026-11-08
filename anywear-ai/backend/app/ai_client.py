"""Bridge to the ai-engine package.

Imports the monorepo `anywear_ai` package. Works out of the box in the monorepo
(sibling `ai-engine/` directory) and also when installed via
`pip install -e ../ai-engine`.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from .config import settings

_ENGINE_DIR = Path(__file__).resolve().parents[2] / "ai-engine"


def _ensure_engine_importable() -> None:
    try:
        import anywear_ai  # noqa: F401
        return
    except ImportError:
        if _ENGINE_DIR.is_dir():
            sys.path.insert(0, str(_ENGINE_DIR))
        else:
            raise


def build_provider():
    _ensure_engine_importable()
    from anywear_ai import get_provider

    return get_provider(
        name=settings.ai_provider,
        engine_url=settings.ai_engine_url,
        api_key=settings.ai_engine_api_key,
    )


_provider = None


def get_provider():
    global _provider
    if _provider is None:
        _provider = build_provider()
    return _provider


def provider_health() -> dict:
    p = get_provider()
    try:
        h = p.health()
        return {
            "provider": h.get("provider", p.name),
            "mode": h.get("mode", p.mode),
            "available": h.get("available", False),
            "gpu": h.get("gpu", False),
        }
    except Exception as exc:  # noqa: BLE001
        return {"provider": p.name, "mode": p.mode, "available": False, "gpu": False, "reason": str(exc)}
