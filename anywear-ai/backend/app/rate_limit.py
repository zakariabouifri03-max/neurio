"""Simple per-IP sliding-window rate limiter (no external deps)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from .config import settings

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)


def check_rate_limit(request: Request) -> None:
    window = 60.0
    rpm = settings.rate_limit_rpm
    now = time.monotonic()
    key = request.client.host if request.client else "unknown"
    with _lock:
        dq = _hits[key]
        while dq and now - dq[0] > window:
            dq.popleft()
        if len(dq) >= rpm:
            raise HTTPException(status_code=429, detail="rate limit exceeded (requests per minute)")
        dq.append(now)
