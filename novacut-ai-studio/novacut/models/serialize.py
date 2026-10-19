"""Versioned project file format.

A ``.novacut`` file is a ZIP archive containing::

    manifest.json   - format/app version, creation info, bundled file list
    project.json    - the full serialisable Project document
    media/...       - optional consolidated media (when the user chooses it)

Media is referenced, never copied destructively. References store both an
absolute path and, when possible, a path relative to the project file, so
projects stay portable across machines and drive-letter changes on Windows.
"""
from __future__ import annotations

import json
import os
import time
import zipfile
from pathlib import Path
from typing import Optional

from .. import __version__, PROJECT_FORMAT_VERSION
from ..core.logging_setup import get_logger
from .project import Project, portable_path

log = get_logger("serialize")
MANIFEST_NAME = "manifest.json"
DOCUMENT_NAME = "project.json"


class ProjectLoadError(RuntimeError):
    pass


def save_project(project: Project, path: str | Path,
                 bundle_media: bool = False) -> Path:
    """Save *project* to a .novacut ZIP archive (atomic write)."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = project.to_dict()
    bundled: list[str] = []

    # Annotate media with portable references before serialising.
    for mid, item in list(project.media.items()):
        entry = doc["media"][mid]
        entry["rel_path"] = portable_path(out, item.path) if item.path else ""
        entry["abs_path"] = item.path

    tmp = out.with_suffix(out.suffix + ".tmp")
    try:
        with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED,
                             compresslevel=6) as zf:
            manifest = {
                "app": "NovaCut AI Studio",
                "app_version": __version__,
                "format_version": PROJECT_FORMAT_VERSION,
                "created_at": time.time(),
                "bundle_media": bundle_media,
                "bundled_files": bundled,
            }
            zf.writestr(MANIFEST_NAME, json.dumps(manifest, indent=2))
            zf.writestr(DOCUMENT_NAME, json.dumps(doc, indent=2))
            if bundle_media:
                _bundle_media(zf, project, bundled)
        os.replace(tmp, out)
    except Exception:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        raise
    project.path = str(out.resolve())
    project.dirty = False
    log.info("Saved project %s (bundle=%s)", out, bundle_media)
    return out


def _bundle_media(zf: zipfile.ZipFile, project: Project, bundled: list[str]) -> None:
    seen: set[str] = set()
    for item in project.media.values():
        p = Path(item.path)
        if not p.exists() or p in seen:
            continue
        seen.add(str(p))
        arc = f"media/{item.id}{p.suffix.lower()}"
        zf.write(p, arc)
        bundled.append(arc)


def load_project(path: str | Path) -> Project:
    """Load a .novacut archive and resolve all media references."""
    src = Path(path)
    if not src.exists():
        raise ProjectLoadError(f"Project file not found: {src}")
    try:
        with zipfile.ZipFile(src, "r") as zf:
            try:
                manifest = json.loads(zf.read(MANIFEST_NAME))
            except KeyError:
                manifest = {}
            try:
                doc = json.loads(zf.read(DOCUMENT_NAME))
            except KeyError as exc:
                raise ProjectLoadError("Archive is missing project.json") from exc
            project = Project.from_dict(doc)
            _resolve_media(project, src, zf, manifest)
    except zipfile.BadZipFile as exc:
        raise ProjectLoadError(f"Not a valid .novacut archive: {src}") from exc
    project.path = str(src.resolve())
    project.dirty = False
    log.info("Loaded project %s (format v%s)", src,
             manifest.get("format_version", "?"))
    return project


def _resolve_media(project: Project, src: Path,
                   zf: zipfile.ZipFile, manifest: dict) -> None:
    base = src.parent
    archive_names = set(zf.namelist())
    for item in project.media.values():
        d = item  # MediaItem; doc fields were consumed by from_dict already
        # Recover the stored path hints from the raw document via re-read.
    # Re-read raw entries to obtain rel_path/abs_path hints.
    raw = json.loads(zf.read(DOCUMENT_NAME))
    for mid, entry in raw.get("media", {}).items():
        item = project.media.get(mid)
        if item is None:
            continue
        candidates: list[Path] = []
        rel = entry.get("rel_path")
        if rel and not Path(rel).is_absolute():
            candidates.append(base / rel)
        abs_path = entry.get("abs_path") or entry.get("path")
        if abs_path:
            candidates.append(Path(abs_path))
        candidates.append(base / Path(item.path).name)
        bundled = f"media/{mid}{Path(item.path).suffix.lower()}"
        if bundled in archive_names:
            extracted = base / bundled
            extracted.parent.mkdir(parents=True, exist_ok=True)
            if not extracted.exists():
                with zf.open(bundled) as src_f, open(extracted, "wb") as dst:
                    dst.write(src_f.read())
            candidates.insert(0, extracted)
        resolved = next((c for c in candidates if c.exists()), None)
        if resolved is not None:
            item.path = str(resolved)
            item.missing = False
        else:
            item.missing = True
            log.warning("Missing media: %s", item.path)


def save_autosave_snapshot(project: Project, target: str | Path) -> Path:
    """Lightweight autosave: same archive format, never touches the user file."""
    return save_project(project, target, bundle_media=False)


def export_json(project: Project, path: str | Path) -> Path:
    """Plain JSON export (handy for debugging and version control)."""
    out = Path(path)
    out.write_text(json.dumps(project.to_dict(), indent=2), encoding="utf-8")
    return out
