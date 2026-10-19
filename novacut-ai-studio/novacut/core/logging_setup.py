"""Rotating application logs plus an in-memory ring buffer for diagnostics."""
from __future__ import annotations

import logging
from collections import deque
from logging.handlers import RotatingFileHandler

from . import paths


class RingHandler(logging.Handler):
    """Keeps the most recent log records in memory for the diagnostics dialog."""

    def __init__(self, capacity: int = 500):
        super().__init__()
        self.records: deque[str] = deque(maxlen=capacity)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.records.append(self.format(record))
        except Exception:  # pragma: no cover - logging must never raise
            self.handleError(record)

    def dump(self) -> str:
        return "\n".join(self.records)


_RING = RingHandler()
_CONFIGURED = False


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    global _CONFIGURED
    logger = logging.getLogger("novacut")
    if _CONFIGURED:
        return logger
    paths.ensure_dirs()
    logger.setLevel(logging.DEBUG)
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    fh = RotatingFileHandler(
        paths.LOG_DIR / "novacut.log", maxBytes=2_000_000, backupCount=5,
        encoding="utf-8",
    )
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(fmt)
    sh = logging.StreamHandler()
    sh.setLevel(level)
    sh.setFormatter(fmt)
    _RING.setLevel(logging.DEBUG)
    _RING.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(sh)
    logger.addHandler(_RING)
    logger.propagate = False
    _CONFIGURED = True
    return logger


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"novacut.{name}")


def ring_buffer() -> str:
    return _RING.dump()
