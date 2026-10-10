"""Structured logging with redaction of API keys and bearer tokens."""
from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

_SECRET_RE = re.compile(
    r"(sk-[A-Za-z0-9_\-]{8,}"
    r"|(?i:api[_-]?key|authorization|bearer|token|secret|password)\s*[=:]\s*\S+)"
)
LOGGER_NAME = "adzak"


def redact(text: str) -> str:
    return _SECRET_RE.sub("[REDACTED]", text)


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        red = redact(msg)
        if red != msg:
            record.msg = red
            record.args = ()
        return True


def setup_logging(log_dir: Path, level: int = logging.INFO) -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(level)
    if getattr(logger, "_adzak_configured", False):
        return logger
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = RotatingFileHandler(log_dir / "adzak.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    fh.addFilter(RedactFilter())
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    sh.addFilter(RedactFilter())
    logger.addHandler(fh)
    logger.addHandler(sh)
    logger.propagate = False
    logger._adzak_configured = True  # type: ignore[attr-defined]
    return logger


def get_logger(name: str = "") -> logging.Logger:
    return logging.getLogger(f"{LOGGER_NAME}.{name}" if name else LOGGER_NAME)
