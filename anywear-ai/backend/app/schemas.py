"""Pydantic response schemas."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    file_id: str
    url: str
    size: int
    content_type: str


class TryOnRequestOk(BaseModel):
    job_id: str
    status: str = Field(pattern="^(queued|running)$")
    poll_url: str


class TryOnError(BaseModel):
    detail: str


class JobStatus(BaseModel):
    job_id: str
    status: str  # queued | running | succeeded | failed
    category: Optional[str] = None
    provider: Optional[str] = None
    mode: Optional[str] = None
    result_url: Optional[str] = None
    error: Optional[str] = None
    meta: dict = {}


class HistoryItem(BaseModel):
    id: str
    created_at: str
    status: str
    category: Optional[str] = None
    person_url: Optional[str] = None
    garment_url: Optional[str] = None
    garment_source_url: Optional[str] = None
    result_url: Optional[str] = None
    provider: Optional[str] = None
    mode: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    provider: str
    provider_mode: str
    provider_available: bool
    gpu: bool
    dev_mode: bool
    queue: int
