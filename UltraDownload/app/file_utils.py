from pathlib import Path
import os
import re
import shutil
import json
import uuid


def safe_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "_", name).strip(" .")[:180].rstrip(" .")
    if not name or name in (".", ".."):
        name = "download.bin"
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", name, re.I):
        name = "_" + name
    return name


def temp_directory(download):
    # No arbitrary persisted path is accepted for deletion.
    if str(uuid.UUID(download.id)) != download.id:
        raise ValueError("Invalid download identifier")
    parent = Path(download.destination).parent / ".ultradownload"
    root = parent / download.id
    if parent.is_symlink() or root.is_symlink():
        raise OSError("Temporary directory must not be a symbolic link")
    return root


def prepare_directory(download):
    root = temp_directory(download)
    root.mkdir(parents=True, exist_ok=True)
    chunks = root / "chunks"
    if chunks.is_symlink():
        raise OSError("Chunk directory must not be a symbolic link")
    chunks.mkdir(exist_ok=True)
    manifest = root / "manifest.json"
    value = {"version": 1, "id": download.id, "size": download.size,
             "chunk_size": 1048576, "ranges": download.ranges,
             "destination": download.destination}
    if manifest.exists():
        if manifest.is_symlink() or json.loads(manifest.read_text()) != value:
            raise ValueError("Saved manifest does not match the download")
    else:
        with manifest.open("x", encoding="utf-8") as f:
            json.dump(value, f)
            f.flush()
            os.fsync(f.fileno())
    return root


def cleanup(download):
    root = temp_directory(download)
    if root.exists():
        manifest = root / "manifest.json"
        if manifest.is_symlink() or json.loads(manifest.read_text())["id"] != download.id:
            raise OSError("Refusing to delete an unowned directory")
        shutil.rmtree(root)


def check_space(directory: Path, required: int):
    if shutil.disk_usage(directory).free < required + 8 * 1024 * 1024:
        raise OSError("Insufficient disk space: chunks plus assembled output need additional space")


def publish_no_replace(source: Path, destination: Path):
    if os.name == "nt":
        os.rename(source, destination)  # Windows rename refuses an existing target.
    else:
        os.link(source, destination)  # Atomic, fails if a target exists.
        source.unlink()
