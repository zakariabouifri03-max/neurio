"""Project management: folders on disk + SQLite catalogue + autosave.

A project is a folder containing ``project.adzak`` (a JSON document with the
full timeline/design state) plus ``media/`` for imported files and ``export/``
for render outputs.  The catalogue database keeps a searchable list of recent
projects without having to scan the disk.
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from . import paths
from .logging_setup import get_logger

log = get_logger("projects")

PROJECT_FILE_NAME = "project.adzak"
PROJECT_SCHEMA_VERSION = 1

_SAFE_NAME = re.compile(r"[^\w\- ]+")


def safe_name(name: str) -> str:
    cleaned = _SAFE_NAME.sub("", name).strip() or "Untitled"
    return cleaned[:80]


@dataclass
class ProjectMeta:
    id: str
    name: str
    path: str
    kind: str            # video | photo | design | audio | animation | mixed
    created: float
    modified: float
    extra: dict = field(default_factory=dict)


def default_project_state(kind: str = "video", width: int = 1920, height: int = 1080,
                          fps: float = 30.0) -> dict[str, Any]:
    """Initial document state for each studio kind."""
    base: dict[str, Any] = {
        "schema_version": PROJECT_SCHEMA_VERSION,
        "kind": kind,
        "created": time.time(),
        "modified": time.time(),
    }
    if kind == "video":
        base.update({
            "settings": {"width": width, "height": height, "fps": fps,
                         "aspect": None, "background": "#000000"},
            "timeline": {"tracks": []},
            "bin": [],
        })
    elif kind == "photo":
        base.update({
            "canvas": {"width": width, "height": height},
            "layers": [],
        })
    elif kind == "design":
        base.update({
            "canvas": {"width": width, "height": height, "background": "#ffffff"},
            "items": [],
            "brand_kit": {},
        })
    elif kind == "audio":
        base.update({"clips": [], "waveform_zoom": 1.0})
    elif kind == "animation":
        base.update({
            "settings": {"width": width, "height": height, "fps": fps, "duration": 5.0},
            "objects": [],
        })
    else:
        base.update({"payload": {}})
    return base


class ProjectStore:
    """SQLite catalogue of known projects."""

    def __init__(self, db_path: Path | None = None):
        self._path = db_path or (paths.app_data_dir() / "projects.sqlite3")
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, name TEXT, path TEXT, kind TEXT,
                created REAL, modified REAL, extra TEXT)"""
        )
        self._conn.commit()

    def upsert(self, meta: ProjectMeta) -> None:
        with self._lock:
            self._conn.execute(
                """INSERT INTO projects (id, name, path, kind, created, modified, extra)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name, path=excluded.path, kind=excluded.kind,
                     modified=excluded.modified, extra=excluded.extra""",
                (meta.id, meta.name, meta.path, meta.kind, meta.created,
                 meta.modified, json.dumps(meta.extra)),
            )
            self._conn.commit()

    def remove(self, project_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
            self._conn.commit()

    def list_recent(self, limit: int = 20) -> list[ProjectMeta]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id,name,path,kind,created,modified,extra FROM projects "
                "ORDER BY modified DESC LIMIT ?", (limit,)).fetchall()
        out = []
        for r in rows:
            if Path(r[2]).exists():
                out.append(ProjectMeta(r[0], r[1], r[2], r[3], r[4], r[5],
                                       json.loads(r[6] or "{}")))
        return out

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class Project:
    """One opened project: folder + document + autosave."""

    def __init__(self, root: Path, meta: ProjectMeta, state: dict[str, Any]):
        self.root = Path(root)
        self.meta = meta
        self.state = state
        self.dirty = False

    # ------------------------------------------------------------------
    @property
    def media_dir(self) -> Path:
        d = self.root / "media"
        d.mkdir(exist_ok=True)
        return d

    @property
    def export_dir(self) -> Path:
        d = self.root / "export"
        d.mkdir(exist_ok=True)
        return d

    @property
    def project_file(self) -> Path:
        return self.root / PROJECT_FILE_NAME

    def save(self) -> Path:
        self.state["modified"] = time.time()
        self.meta.modified = self.state["modified"]
        tmp = self.project_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, ensure_ascii=False, indent=1),
                       encoding="utf-8")
        tmp.replace(self.project_file)
        self.dirty = False
        return self.project_file

    def autosave(self) -> Path:
        """Write a crash-recovery snapshot into the app autosave dir."""
        stamp = time.strftime("%Y%m%d-%H%M%S")
        target = paths.autosave_dir() / f"{self.meta.id}-{stamp}.adzak"
        payload = {"meta": asdict(self.meta), "state": self.state}
        target.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        # Keep only the 5 newest snapshots per project.
        snaps = sorted(paths.autosave_dir().glob(f"{self.meta.id}-*.adzak"))
        for old in snaps[:-5]:
            try:
                old.unlink()
            except OSError:
                pass
        return target

    def import_media(self, source: str | Path, copy: bool = True) -> Path:
        src = Path(source)
        if not src.is_file():
            raise FileNotFoundError(src)
        dest = self.media_dir / src.name
        n = 1
        while dest.exists():
            dest = self.media_dir / f"{src.stem}_{n}{src.suffix}"
            n += 1
        if copy:
            shutil.copy2(src, dest)
        else:
            dest = src
        return dest


class ProjectManager:
    """Create / open / delete projects and recover autosaves."""

    def __init__(self, store: ProjectStore | None = None,
                 base_dir: Path | None = None):
        self.store = store or ProjectStore()
        self.base_dir = Path(base_dir) if base_dir else paths.projects_dir()

    def create(self, name: str, kind: str = "video",
               width: int = 1920, height: int = 1080, fps: float = 30.0,
               base_dir: Path | None = None) -> Project:
        name = safe_name(name)
        root = Path(base_dir) if base_dir else self.base_dir
        folder = root / name
        n = 1
        while folder.exists():
            folder = root / f"{name}_{n}"
            n += 1
        folder.mkdir(parents=True)
        meta = ProjectMeta(id=uuid.uuid4().hex, name=name, path=str(folder),
                           kind=kind, created=time.time(), modified=time.time())
        state = default_project_state(kind, width, height, fps)
        proj = Project(folder, meta, state)
        proj.save()
        self.store.upsert(meta)
        return proj

    def open(self, folder: str | Path) -> Project:
        folder = Path(folder)
        pfile = folder / PROJECT_FILE_NAME
        if not pfile.is_file():
            raise FileNotFoundError(f"Not an ADZAK project: {folder}")
        state = json.loads(pfile.read_text(encoding="utf-8"))
        # Migration hook for future schema versions.
        if state.get("schema_version", 1) > PROJECT_SCHEMA_VERSION:
            raise ValueError("Project was created with a newer version of ADZAK.")
        meta = ProjectMeta(
            id=state.get("project_id") or uuid.uuid4().hex,
            name=state.get("name") or folder.name,
            path=str(folder),
            kind=state.get("kind", "mixed"),
            created=state.get("created", 0.0),
            modified=state.get("modified", 0.0),
        )
        state.setdefault("name", meta.name)
        state.setdefault("project_id", meta.id)
        proj = Project(folder, meta, state)
        meta.modified = time.time()
        self.store.upsert(meta)
        return proj

    def delete(self, meta: ProjectMeta, delete_files: bool = False) -> None:
        self.store.remove(meta.id)
        if delete_files:
            shutil.rmtree(meta.path, ignore_errors=True)
        for snap in paths.autosave_dir().glob(f"{meta.id}-*.adzak"):
            snap.unlink(missing_ok=True)

    def list_autosaves(self) -> list[Path]:
        return sorted(paths.autosave_dir().glob("*.adzak"),
                      key=lambda p: p.stat().st_mtime, reverse=True)

    def recover(self, autosave_path: Path) -> Project:
        payload = json.loads(autosave_path.read_text(encoding="utf-8"))
        meta = ProjectMeta(**payload["meta"])
        if not Path(meta.path).exists():
            raise FileNotFoundError(
                f"Original project folder is gone: {meta.path}")
        proj = Project(Path(meta.path), meta, payload["state"])
        proj.save()
        self.store.upsert(meta)
        return proj
