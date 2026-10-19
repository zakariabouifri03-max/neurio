"""Common contracts for local AI tools: availability checks and status."""
from __future__ import annotations

import importlib.util
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..core.ffmpeg import find_ffmpeg
from ..core import paths


@dataclass
class ToolStatus:
    id: str
    name: str
    available: bool
    reason: str = ""
    needs_model: bool = False
    model_installed: bool = False
    model_path: str = ""
    requirements: str = ""
    resource_note: str = ""

    def as_dict(self) -> dict:
        return dict(self.__dict__)


class AITool:
    id: str = "base"
    name: str = "Base tool"
    description: str = ""
    needs_model: bool = False
    model_kind: str = ""

    def __init__(self) -> None:
        self._status: Optional[ToolStatus] = None

    # ------------------------------------------------------------- checks
    @staticmethod
    def module_available(module: str) -> bool:
        return importlib.util.find_spec(module) is not None

    @staticmethod
    def ffmpeg_available() -> bool:
        return find_ffmpeg() is not None

    def model_dir(self) -> Path:
        d = paths.MODELS_DIR / self.model_kind
        d.mkdir(parents=True, exist_ok=True)
        return d

    def check(self) -> ToolStatus:  # pragma: no cover - overridden
        raise NotImplementedError

    def unavailable(self, reason: str, **kw) -> ToolStatus:
        return ToolStatus(self.id, self.name, False, reason=reason,
                          needs_model=self.needs_model, **kw)

    def available(self, **kw) -> ToolStatus:
        return ToolStatus(self.id, self.name, True,
                          needs_model=self.needs_model, **kw)

    def ensure_ready(self) -> None:
        status = self.check()
        if not status.available:
            raise RuntimeError(status.reason or f"{self.name} is not available.")
