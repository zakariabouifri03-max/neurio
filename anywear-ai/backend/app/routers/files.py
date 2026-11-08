"""GET /api/files/{file_id} — serve stored images by opaque UUID.

Files are only reachable via unguessable UUID names, never by path.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..services import storage

router = APIRouter()


@router.get("/files/{file_id}")
def get_file(file_id: str):
    path = storage.resolve_file(file_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(path)
