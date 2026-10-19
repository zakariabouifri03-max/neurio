"""Atomic project serialization, portable media references, and recovery snapshots."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile
from typing import Any

from .models import Project, SCHEMA_VERSION

PROJECT_SUFFIX = ".novacut"


class ProjectFormatError(ValueError):
    pass


def app_data_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif os.environ.get("XDG_DATA_HOME"):
        base = Path(os.environ["XDG_DATA_HOME"])
    else:
        base = Path.home() / ".local" / "share"
    return base / "NovaCut AI Studio"


def cache_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    elif os.environ.get("XDG_CACHE_HOME"):
        base = Path(os.environ["XDG_CACHE_HOME"])
    else:
        base = Path.home() / ".cache"
    return base / "NovaCut AI Studio"


def _project_document(project: Project, project_file: Path, autosave: bool = False) -> dict[str, Any]:
    project.validate()
    payload = project.to_dict()
    folder = Path(project.path).parent.resolve() if autosave and project.path else project_file.parent.resolve()
    for asset in payload["media"].values():
        absolute = Path(asset["path"]).expanduser()
        try:
            resolved = absolute.resolve()
            asset["path"] = str(resolved)
            asset["relative_path"] = os.path.relpath(resolved, folder)
        except (OSError, ValueError):
            asset["relative_path"] = ""
    return {
        "format": "novacut-project",
        "schema_version": SCHEMA_VERSION,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "autosave": bool(autosave),
        "source_project_path": project.path,
        "project": payload,
    }


def save_project(project: Project, file_path: str | Path, *, autosave: bool = False) -> Path:
    path = Path(file_path).expanduser().resolve()
    if path.suffix.lower() not in {PROJECT_SUFFIX, ".json"}:
        path = path.with_suffix(PROJECT_SUFFIX)
    path.parent.mkdir(parents=True, exist_ok=True)
    document = _project_document(project, path, autosave=autosave)
    encoded = json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8")
    temp_name = ""
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as stream:
            temp_name = stream.name
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    except OSError as exc:
        if temp_name:
            try:
                os.unlink(temp_name)
            except OSError:
                pass
        raise OSError(f"Could not save project to {path}: {exc}") from exc
    if not autosave:
        project.path = str(path)
        project.dirty = False
    return path


def _load_document(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as stream:
            document = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise ProjectFormatError(f"Could not read project file: {exc}") from exc
    if not isinstance(document, dict):
        raise ProjectFormatError("Project file must contain a JSON object")
    version = int(document.get("schema_version", 0))
    if document.get("format") != "novacut-project":
        raise ProjectFormatError("This is not a NovaCut project file")
    if version > SCHEMA_VERSION:
        raise ProjectFormatError(
            f"Project version {version} is newer than this application (supports {SCHEMA_VERSION})."
        )
    if version < 1:
        raise ProjectFormatError("Project file is missing a supported schema version")
    payload = document.get("project")
    if not isinstance(payload, dict):
        raise ProjectFormatError("Project data is missing")
    return document, payload


def load_project(file_path: str | Path) -> tuple[Project, list[str]]:
    path = Path(file_path).expanduser().resolve()
    document, payload = _load_document(path)
    project = Project.from_dict(payload)
    source_project = document.get("source_project_path") if document.get("autosave") else ""
    project.path = str(Path(source_project).expanduser().resolve()) if source_project else str(path)
    project.dirty = bool(document.get("autosave"))
    warnings: list[str] = []
    media_records = document["project"].get("media", {})
    relative_base = Path(document.get("source_project_path") or path).expanduser().resolve().parent
    for media_id, asset in project.media.items():
        raw = media_records.get(media_id, {})
        relative = raw.get("relative_path")
        candidates = []
        if relative:
            candidates.append((relative_base / relative).resolve())
        candidates.append(Path(asset.path).expanduser())
        found = next((candidate for candidate in candidates if candidate.exists()), None)
        if found:
            asset.path = str(found.resolve())
        else:
            warnings.append(f"Missing media: {asset.name} ({asset.path})")
    return project, warnings


def autosave_path(project: Project) -> Path:
    folder = app_data_dir() / "Recovery"
    folder.mkdir(parents=True, exist_ok=True)
    base = Path(project.path).stem if project.path else "Untitled"
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in base)[:80] or "Untitled"
    return folder / f"{safe}.autosave{PROJECT_SUFFIX}"


def save_autosave(project: Project) -> Path:
    return save_project(project, autosave_path(project), autosave=True)


def recovery_available(project_path: str = "") -> tuple[Path | None, str]:
    base = Path(project_path).stem if project_path else "Untitled"
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in base)[:80] or "Untitled"
    candidate = app_data_dir() / "Recovery" / f"{safe}.autosave{PROJECT_SUFFIX}"
    if not candidate.exists():
        return None, ""
    try:
        recover_doc, _ = _load_document(candidate)
        recovered_at = datetime.fromisoformat(recover_doc["saved_at"])
    except (ProjectFormatError, KeyError, ValueError, TypeError):
        return None, ""
    if project_path:
        original = Path(project_path)
        if original.exists() and candidate.stat().st_mtime <= original.stat().st_mtime:
            return None, ""
    return candidate, recovered_at.astimezone().strftime("%Y-%m-%d %H:%M")


def remove_autosave(project: Project) -> None:
    try:
        autosave_path(project).unlink(missing_ok=True)
    except OSError:
        pass


def save_recovery_copy(project: Project, folder: str | Path) -> Path:
    """Write an ordinary project copy with resolved paths for manual recovery."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    name = Path(project.path).name if project.path else "Recovered.novacut"
    return save_project(project, folder / name, autosave=False)
