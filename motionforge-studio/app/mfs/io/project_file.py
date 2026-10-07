"""The ``.mfs`` project format.

An ``.mfs`` file is a ZIP container:

    manifest.json      the whole document (scenes, layers, cels metadata, rigs, AI data)
    assets/<id>.<ext>  imported bitmaps / audio / video / brushes / poses
    cels/<id>.png      raster cels (only the ones that are not empty)
    thumbnail.png      project preview used by the start screen
    VERSION            format version

Everything a user can create is stored, so a project reopens exactly as it was
saved.  The format is forward compatible: unknown keys are ignored on load and
kept untouched in the manifest when the file is re-saved by a newer build.
"""
from __future__ import annotations

import json
import os
import shutil
import time
import zipfile
from dataclasses import dataclass

from .. import APP_NAME, PROJECT_FORMAT_VERSION, PROJECT_MAGIC, __version__
from ..model import Project

MANIFEST = "manifest.json"
THUMB = "thumbnail.png"
VERSION_FILE = "VERSION"
STORE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".mp4", ".ogg", ".m4a",
             ".zip", ".webm", ".wav"}


class ProjectError(Exception):
    pass


# --------------------------------------------------------------------------
# saving
# --------------------------------------------------------------------------
def save_project(project: Project, path: str, thumbnail: bytes | None = None,
                 compresslevel: int = 6) -> str:
    if not path.lower().endswith(".mfs"):
        path += ".mfs"
    project.meta["modified"] = time.time()
    project.meta["app_version"] = __version__
    payload: dict[str, bytes] = {}

    # 1. gather binary payloads from cels + assets (mutating asset source paths
    #    is avoided: the archive name is deterministic from the asset uid)
    for scene in project.scenes:
        for layer in scene.layers:
            for ref in layer.cels.values():
                extra = ref.cel.payload()
                if extra:
                    payload.update(extra)

    data = project.to_dict()
    for asset in project.assets.values():
        if asset.data:
            payload[asset.archive_name] = asset.data

    tmp = path + ".part"
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=compresslevel) as zf:
        zf.writestr(VERSION_FILE, str(PROJECT_FORMAT_VERSION), zipfile.ZIP_STORED)
        zf.writestr(MANIFEST, json.dumps(data, ensure_ascii=False), zipfile.ZIP_DEFLATED)
        if thumbnail:
            zf.writestr(THUMB, thumbnail, zipfile.ZIP_STORED)
        for name, blob in payload.items():
            if not blob:
                continue
            ext = os.path.splitext(name)[1].lower()
            comp = zipfile.ZIP_STORED if ext in STORE_EXT else zipfile.ZIP_DEFLATED
            zf.writestr(name, blob, comp)
    os.replace(tmp, path)
    project.path = path
    project.dirty = False
    return path


def save_project_bytes(project: Project, thumbnail: bytes | None = None) -> bytes:
    """Serialise to memory (used by autosave/recovery and by tests)."""
    import io as _io
    buffer = _io.BytesIO()
    payload: dict[str, bytes] = {}
    for scene in project.scenes:
        for layer in scene.layers:
            for ref in layer.cels.values():
                extra = ref.cel.payload()
                if extra:
                    payload.update(extra)
    data = project.to_dict()
    for asset in project.assets.values():
        if asset.data:
            payload[asset.archive_name] = asset.data
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.writestr(VERSION_FILE, str(PROJECT_FORMAT_VERSION), zipfile.ZIP_STORED)
        zf.writestr(MANIFEST, json.dumps(data, ensure_ascii=False), zipfile.ZIP_DEFLATED)
        if thumbnail:
            zf.writestr(THUMB, thumbnail, zipfile.ZIP_STORED)
        for name, blob in payload.items():
            ext = os.path.splitext(name)[1].lower()
            comp = zipfile.ZIP_STORED if ext in STORE_EXT else zipfile.ZIP_DEFLATED
            zf.writestr(name, blob, comp)
    return buffer.getvalue()


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------
def load_project(path: str) -> Project:
    if not os.path.isfile(path):
        raise ProjectError(f"File not found: {path}")
    try:
        with zipfile.ZipFile(path, "r") as zf:
            names = set(zf.namelist())
            if MANIFEST not in names:
                raise ProjectError("This file is not a MotionForge Studio project "
                                   "(manifest.json is missing).")
            raw = zf.read(MANIFEST).decode("utf8")
            data = json.loads(raw)
            if data.get("magic") not in (None, PROJECT_MAGIC):
                raise ProjectError("Unsupported project flavour.")

            def reader(name: str) -> bytes | None:
                if name and name in names:
                    return zf.read(name)
                return None

            project = Project.from_dict(data, reader)
            if THUMB in names:
                try:
                    project.meta["thumbnail"] = zf.read(THUMB)
                except Exception:
                    pass
    except zipfile.BadZipFile as exc:
        raise ProjectError(f"Damaged project file: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise ProjectError(f"Project manifest is corrupted: {exc}") from exc
    project.path = path
    project.dirty = False
    _relink_assets(project, os.path.dirname(os.path.abspath(path)))
    return project


def load_project_bytes(blob: bytes) -> Project:
    import io as _io
    with zipfile.ZipFile(_io.BytesIO(blob), "r") as zf:
        data = json.loads(zf.read(MANIFEST).decode("utf8"))

        def reader(name: str) -> bytes | None:
            try:
                return zf.read(name)
            except KeyError:
                return None
        project = Project.from_dict(data, reader)
        try:
            project.meta["thumbnail"] = zf.read(THUMB)
        except Exception:
            pass
    return project


def _relink_assets(project: Project, folder: str) -> None:
    """If an asset has no data but its source still exists, keep the path."""
    for asset in project.assets.values():
        if asset.data is None and asset.source_path:
            if not os.path.isabs(asset.source_path):
                candidate = os.path.join(folder, asset.source_path)
                if os.path.exists(candidate):
                    asset.source_path = candidate


# --------------------------------------------------------------------------
# thumbnails
# --------------------------------------------------------------------------
def project_thumbnail(project: Project, size: tuple[int, int] = (320, 180)) -> bytes:
    from ..engine.render import RenderOptions, render_scene
    scene = project.active_scene
    frame = scene.frame_start
    img = render_scene(scene, project, RenderOptions(frame=frame, size=size, quality="normal"))
    from PySide6.QtCore import QBuffer
    buf = QBuffer()
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    return bytes(buf.data())


def project_summary(path: str) -> dict:
    """Read just the manifest - used by the start screen / recent files."""
    info = {"path": path, "name": os.path.basename(path), "valid": False}
    try:
        with zipfile.ZipFile(path, "r") as zf:
            data = json.loads(zf.read(MANIFEST).decode("utf8"))
        info.update({
            "valid": True,
            "name": data.get("name", info["name"]),
            "scenes": len(data.get("scenes", [])),
            "fps": data.get("fps", 24),
            "width": data.get("width", 1920),
            "height": data.get("height", 1080),
            "assets": len(data.get("assets", [])),
            "modified": (data.get("meta") or {}).get("modified", 0),
            "app_version": (data.get("meta") or {}).get("app_version", ""),
        })
    except Exception as exc:
        info["error"] = str(exc)
    return info


# --------------------------------------------------------------------------
# autosave / crash recovery
# --------------------------------------------------------------------------
@dataclass
class AutosaveEntry:
    path: str
    project_path: str
    time: float
    size: int

    def age_minutes(self) -> float:
        return (time.time() - self.time) / 60.0

    def label(self) -> str:
        stamp = time.strftime("%H:%M:%S", time.localtime(self.time))
        return f"{stamp}  ·  {os.path.basename(self.project_path or 'Untitled')}  ·  {self.size // 1024} KB"


def autosave_dir(base: str | None = None) -> str:
    base = base or default_app_dir()
    path = os.path.join(base, "autosave")
    os.makedirs(path, exist_ok=True)
    return path


def default_app_dir() -> str:
    """Per-user writable location for settings, autosaves and recovery."""
    if os.name == "nt":
        root = os.environ.get("APPDATA") or os.path.expanduser("~")
    else:
        root = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    path = os.path.join(root, "MotionForgeStudio")
    os.makedirs(path, exist_ok=True)
    return path


def write_autosave(project: Project, thumbnail: bytes | None = None) -> str:
    folder = autosave_dir()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = os.path.splitext(os.path.basename(project.path or "Untitled"))[0]
    target = os.path.join(folder, f"{name}--{stamp}.mfs")
    blob = save_project_bytes(project, thumbnail)
    with open(target, "wb") as fh:
        fh.write(blob)
    with open(target + ".info", "w", encoding="utf8") as fh:
        json.dump({"project_path": project.path or "", "time": time.time()}, fh)
    _trim_autosaves(folder, keep=int(project.settings.get("autosave", {}).get("keep_backups", 8)))
    return target


def _trim_autosaves(folder: str, keep: int) -> None:
    entries = list_autosaves(folder)
    for entry in entries[keep:]:
        try:
            os.remove(entry.path)
            if os.path.exists(entry.path + ".info"):
                os.remove(entry.path + ".info")
        except OSError:
            pass


def list_autosaves(folder: str | None = None) -> list[AutosaveEntry]:
    folder = folder or autosave_dir()
    out: list[AutosaveEntry] = []
    if not os.path.isdir(folder):
        return out
    for name in os.listdir(folder):
        if not name.endswith(".mfs"):
            continue
        path = os.path.join(folder, name)
        info_path = path + ".info"
        project_path = ""
        stamp = os.path.getmtime(path)
        if os.path.exists(info_path):
            try:
                with open(info_path, "r", encoding="utf8") as fh:
                    info = json.load(fh)
                project_path = info.get("project_path", "")
                stamp = float(info.get("time", stamp))
            except Exception:
                pass
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        out.append(AutosaveEntry(path, project_path, stamp, size))
    return sorted(out, key=lambda e: e.time, reverse=True)


def clear_autosaves(project_path: str | None = None) -> int:
    removed = 0
    for entry in list_autosaves():
        if project_path and os.path.abspath(entry.project_path) != os.path.abspath(project_path):
            continue
        try:
            os.remove(entry.path)
            if os.path.exists(entry.path + ".info"):
                os.remove(entry.path + ".info")
            removed += 1
        except OSError:
            continue
    return removed


def backup_existing(path: str, keep: int = 8) -> str | None:
    """Versioned backup before overwriting a project (File ▸ Backup)."""
    if not os.path.isfile(path):
        return None
    folder = os.path.join(os.path.dirname(os.path.abspath(path)), "MotionForge Backups")
    os.makedirs(folder, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    base = os.path.splitext(os.path.basename(path))[0]
    target = os.path.join(folder, f"{base}--{stamp}.mfs")
    try:
        shutil.copy2(path, target)
    except OSError:
        return None
    backups = sorted((os.path.join(folder, f) for f in os.listdir(folder)
                      if f.endswith(".mfs")), key=os.path.getmtime, reverse=True)
    for old in backups[keep:]:
        try:
            os.remove(old)
        except OSError:
            pass
    return target


def recent_files_store() -> str:
    return os.path.join(default_app_dir(), "recent.json")


def load_recent_files(limit: int = 12) -> list[str]:
    path = recent_files_store()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf8") as fh:
            data = json.load(fh)
        files = [f for f in data.get("files", []) if isinstance(f, str)]
    except Exception:
        return []
    return [f for f in files if os.path.exists(f)][:limit]


def push_recent_file(path: str) -> None:
    files = load_recent_files(limit=50)
    path = os.path.abspath(path)
    files = [f for f in files if os.path.abspath(f) != path]
    files.insert(0, path)
    try:
        with open(recent_files_store(), "w", encoding="utf8") as fh:
            json.dump({"files": files[:50]}, fh, indent=1)
    except OSError:
        pass


_ = APP_NAME
