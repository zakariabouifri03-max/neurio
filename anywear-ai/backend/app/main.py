"""Anywear AI backend — FastAPI application entry point.

Run:  uvicorn app.main:app --reload --port 8000   (from backend/)
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import init_db
from .routers import demo, files, health, history, tryon, upload

settings.ensure_dirs()
init_db(settings.db_path)

app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Chrome extensions originate from chrome-extension://<id>, which can't
    # be listed explicitly (the id is random per install). Allow them via regex.
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):  # noqa: BLE001
    return JSONResponse(status_code=500, content={"detail": "internal server error"})


app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(tryon.router, prefix="/api", tags=["tryon"])
app.include_router(history.router, prefix="/api", tags=["history"])
app.include_router(files.router, prefix="/api", tags=["files"])
app.include_router(demo.router, tags=["demo"])


@app.get("/")
def root():
    return {"name": settings.app_name, "docs": "/docs", "health": "/api/health"}
