"""POST /api/tryon — enqueue a generation job. GET /api/jobs/{id} — status."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from ..config import settings
from ..image_utils_local import ImageValidationError, validate_image_bytes
from ..rate_limit import check_rate_limit
from ..schemas import JobStatus, TryOnRequestOk
from ..services import storage
from ..services.jobs import create_job, get_job, start_worker
from .upload import require_api_key

router = APIRouter()

CATEGORY_OPTIONS = {
    "shirt", "tshirt", "dress", "jacket", "coat", "trousers", "pants",
    "skirt", "sweater", "hoodie", "other",
}


@router.post("/tryon", response_model=TryOnRequestOk, dependencies=[Depends(check_rate_limit)])
async def try_on(
    request: Request,
    person: UploadFile = File(..., description="person photograph"),
    garment: Optional[UploadFile] = File(None, description="garment image (upload)"),
    garment_url: Optional[str] = Form(None, description="garment image URL (server-side fetch)"),
    category: str = Form("other"),
    _=Depends(require_api_key),
):
    if not garment and not garment_url:
        raise HTTPException(status_code=400, detail="provide either garment file or garment_url")

    cat = (category or "other").strip().lower()
    if cat not in CATEGORY_OPTIONS:
        # lenient: normalize unknown categories instead of rejecting
        from anywear_ai.categories import normalize_category

        cat = normalize_category(cat)

    # --- validate person photo ---
    person_bytes = await person.read()
    if len(person_bytes) > settings.max_person_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="person image too large")
    try:
        validate_image_bytes(person_bytes, max_bytes=settings.max_person_mb * 1024 * 1024)
    except ImageValidationError as exc:
        raise HTTPException(status_code=422, detail=f"person image invalid: {exc}") from exc

    person_file_id, _ = storage.save_upload(person_bytes, person.content_type or "image/jpeg")

    # --- validate garment (upload or URL fetch) ---
    garment_file_id = None
    if garment is not None:
        garment_bytes = await garment.read()
        if len(garment_bytes) > settings.max_garment_mb * 1024 * 1024:
            raise HTTPException(status_code=413, detail="garment image too large")
        try:
            validate_image_bytes(garment_bytes, max_bytes=settings.max_garment_mb * 1024 * 1024)
        except ImageValidationError as exc:
            raise HTTPException(status_code=422, detail=f"garment image invalid: {exc}") from exc
        garment_file_id, _ = storage.save_upload(garment_bytes, garment.content_type or "image/png")
    elif garment_url:
        import asyncio

        from ..services.jobs import fetch_garment

        # Run the synchronous fetch in a thread — otherwise the async event
        # loop is blocked and the backend can't respond to its own request.
        garment_bytes = await asyncio.to_thread(fetch_garment, garment_url)
        if not garment_bytes:
            raise HTTPException(status_code=422, detail="could not fetch garment image from URL")
        try:
            validate_image_bytes(garment_bytes, max_bytes=settings.max_garment_mb * 1024 * 1024)
        except ImageValidationError as exc:
            raise HTTPException(status_code=422, detail=f"garment image invalid: {exc}") from exc
        garment_file_id, _ = storage.save_upload(garment_bytes, "image/png")

    job_id = create_job(person_file_id, garment_file_id, garment_url, cat)
    start_worker(job_id)

    return TryOnRequestOk(job_id=job_id, status="queued", poll_url=f"/api/jobs/{job_id}")


@router.get("/jobs/{job_id}", response_model=JobStatus)
async def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    meta = {}
    if job.get("meta"):
        try:
            meta = json.loads(job["meta"])
        except (TypeError, ValueError):
            meta = {"raw": job["meta"]}
    return JobStatus(
        job_id=job["id"],
        status=job["status"],
        category=job.get("category"),
        provider=job.get("provider"),
        mode=job.get("mode"),
        result_url=job.get("result_url"),
        error=job.get("error"),
        meta=meta,
    )
