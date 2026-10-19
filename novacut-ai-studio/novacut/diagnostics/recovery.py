"""Autosave, session lock and crash recovery."""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..core import paths
from ..core.logging_setup import get_logger
from ..models.project import Project
from ..models.serialize import save_project, load_project, ProjectLoadError

log = get_logger("recovery")
SESSION_FILE = "session.json"


@dataclass
class RecoverableSession:
    project_path: str
    autosave_path: str
    timestamp: float
    name: str


class SessionRecovery:
    """Tracks the open document and rotates timestamped autosave archives."""

    def __init__(self) -> None:
        paths.ensure_dirs()
        self.session_path = paths.AUTOSAVE_DIR / SESSION_FILE
        self._pid = os.getpid()

    # ------------------------------------------------------------- session
    def begin(self, project: Project) -> None:
        self.session_path.write_text(json.dumps({
            "pid": self._pid,
            "project_path": project.path or "",
            "name": project.settings.name,
            "started": time.time(),
            "last_autosave": "",
        }, indent=2), encoding="utf-8")

    def end(self) -> None:
        self.session_path.unlink(missing_ok=True)

    def update(self, project: Project, autosave_path: str = "") -> None:
        data = self._read()
        data.update({"pid": self._pid,
                     "project_path": project.path or data.get("project_path", ""),
                     "name": project.settings.name,
                     "last_autosave": autosave_path or data.get("last_autosave", ""),
                     "updated": time.time()})
        self.session_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def _read(self) -> dict:
        try:
            return json.loads(self.session_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    # ------------------------------------------------------------ autosave
    def autosave(self, project: Project) -> Optional[Path]:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        safe = "".join(c if c.isalnum() or c in "-_" else "_"
                       for c in project.settings.name)[:40] or "project"
        target = paths.AUTOSAVE_DIR / f"{safe}-{stamp}.novacut"
        save_project(project, target, bundle_media=False)
        self._rotate()
        self.update(project, str(target))
        log.info("Autosaved %s", target)
        return target

    def _rotate(self, keep: int = 5) -> None:
        archives = sorted(paths.AUTOSAVE_DIR.glob("*.novacut"),
                          key=lambda p: p.stat().st_mtime, reverse=True)
        for old in archives[keep:]:
            old.unlink(missing_ok=True)

    # ------------------------------------------------------------ recovery
    def find_recoverable(self) -> list[RecoverableSession]:
        sessions: list[RecoverableSession] = []
        data = self._read()
        auto = data.get("last_autosave", "")
        if auto and Path(auto).exists():
            sessions.append(RecoverableSession(
                data.get("project_path", ""), auto,
                Path(auto).stat().st_mtime, data.get("name", "Project")))
        # Also surface orphaned autosaves from previous crashes.
        known = {s.autosave_path for s in sessions}
        for p in sorted(paths.AUTOSAVE_DIR.glob("*.novacut"),
                        key=lambda x: x.stat().st_mtime, reverse=True)[:5]:
            if str(p) not in known:
                sessions.append(RecoverableSession(
                    "", str(p), p.stat().st_mtime, p.stem))
        return sessions

    def load_autosave(self, path: str) -> Project:
        project = load_project(path)
        project.path = None  # require explicit Save As for recovered docs
        project.dirty = True
        return project
