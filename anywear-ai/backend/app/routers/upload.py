"""POST /api/upload — validate + store an uploaded image."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from ..config import settings
from ..image_utils_local import ImageValidationError, validate_image_bytes
from ..rate_limit import check_rate_limit
from ..schemas import UploadResponse
from ..services import storage

router = APIRouter()


def require_api_key(request: Request) -> None:
    if settings.api_key:
        auth = request.headers.get("authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if token != settings.api_key:
            raise HTTPException(status_code=401, detail="invalid or missing API key")


@router.post("/upload", response_model=UploadResponse, dependencies=[Depends(check_rate_limit)])
async def upload_image(request: Request, file: UploadFile = File(...), _=Depends(require_api_key)):
    content_type = (file.content_type or "").lower()
    if content_type not in settings.allowed_formats:
        raise HTTPException(status_code=415, detail=f"unsupported content type: {content_type}")

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail=f"file exceeds {settings.max_upload_mb}MB limit")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        validate_image_bytes(data)
    except ImageValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    file_id, path = storage.save_upload(data, content_type)
    return UploadResponse(
        file_id=file_id,
        url=storage.file_url(file_id),
        size=len(data),
        content_type=content_type,
    )
