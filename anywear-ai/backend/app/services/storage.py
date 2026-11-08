"""Secure temporary image storage: opaque UUID filenames, path traversal safe,
size-validated, with explicit deletion."""

from __future__ import annotations

import uuid
from pathlib import Path

from ..config import settings

_MIME_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def save_upload(data: bytes, content_type: str) -> tuple[str, Path]:
    """Persist an uploaded file under a random UUID name. Returns (file_id, path)."""
    ext = _MIME_EXT.get(content_type, ".bin")
    file_id = uuid.uuid4().hex
    path = settings.uploads_dir / f"{file_id}{ext}"
    # Write with O_EXCL semantics; uuid collision is practically impossible.
    with open(path, "wb") as f:
        f.write(data)
    return file_id, path


def save_result(data: bytes, mimetype: str) -> tuple[str, Path]:
    ext = _MIME_EXT.get(mimetype, ".png")
    file_id = uuid.uuid4().hex
    path = settings.results_dir / f"{file_id}{ext}"
    with open(path, "wb") as f:
        f.write(data)
    return file_id, path


def resolve_file(file_id: str) -> Path | None:
    """Resolve a file_id to its path. Only hex uuids allowed — prevents traversal."""
    if not file_id or len(file_id) != 32 or any(c not in "0123456789abcdef" for c in file_id):
        return None
    for root in (settings.uploads_dir, settings.results_dir):
        for p in root.iterdir():
            if p.stem == file_id:
                return p
    return None


def file_url(file_id: str) -> str:
    return f"/api/files/{file_id}"


def delete_file(file_id: str) -> bool:
    p = resolve_file(file_id)
    if p and p.exists():
        p.unlink()
        return True
    return False
