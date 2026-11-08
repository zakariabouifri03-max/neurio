"""GET /api/health."""

from __future__ import annotations

from fastapi import APIRouter

from ..ai_client import provider_health
from ..schemas import HealthResponse
from ..services.jobs import queue_depth

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health():
    p = provider_health()
    return HealthResponse(
        status="ok",
        version="1.0.0",
        provider=p["provider"],
        provider_mode=p["mode"],
        provider_available=p["available"],
        gpu=p["gpu"],
        dev_mode=p["mode"] == "dev-composite",
        queue=queue_depth(),
    )
