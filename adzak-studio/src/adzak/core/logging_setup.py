"""Structured logging for ADZAK Creative Studio.

Rules enforced here:
- Logs go to a rotating file plus (optionally) stderr.
- Values that look like secrets are redacted before they are written, so API
  keys can never leak into log files by accident.
"""

from __future__ import annotations

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path

from . import paths

LOG_NAME = "adzak"

_SECRET_PATTERNS = [
    re.compile(r"(?i)\b(sk|pk|key|token|secret|api[-_]?key|authorization|bearer)[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9_\-]{8,}[\"']?"),
    re.compile(r"\b(sk-[A-Za-z0-9]{16,})\b"),
    re.compile(r"(?i)\b(x-api-key|api-key)\b\s*[:=]\s*\S+"),
]


class RedactingFilter(logging.Filter):
    """Redacts anything that resembles a credential."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        for pat in _SECRET_PATTERNS:
            msg = pat.sub("[REDACTED]", msg)
        record.msg = msg
        record.args = ()
        return True


def setup_logging(level: int = logging.INFO, logfile: Path | None = None) -> logging.Logger:
    logger = logging.getLogger(LOG_NAME)
    if logger.handlers:
        return logger
    logger.setLevel(level)
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)s %(module)s:%(lineno)d %(message)s"
    )

    fh = RotatingFileHandler(
        logfile or (paths.logs_dir() / "adzak.log"),
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    fh.setFormatter(fmt)
    fh.addFilter(RedactingFilter())
    logger.addHandler(fh)

    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    sh.addFilter(RedactingFilter())
    logger.addHandler(sh)
    logger.propagate = False
    return logger


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"{LOG_NAME}.{name}")
