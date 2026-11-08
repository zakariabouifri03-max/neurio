"""Generation job manager: state machine + worker execution."""

from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime, timezone

from ..ai_client import get_provider
from ..config import settings
from ..db import get_db
from ..image_utils_local import validate_image_bytes
from . import storage

QUEUE_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_job(
    person_file_id: str,
    garment_file_id: str | None,
    garment_url: str | None,
    category: str,
) -> str:
    job_id = uuid.uuid4().hex
    db = get_db()
    db.execute(
        "INSERT INTO jobs (id, created_at, status, category, person_file_id, garment_file_id, garment_url)"
        " VALUES (?, ?, 'queued', ?, ?, ?, ?)",
        (job_id, _now(), category, person_file_id, garment_file_id, garment_url),
    )
    return job_id


def get_job(job_id: str) -> dict:
    row = get_db().query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if not row:
        return {}
    d = dict(row)
    d["result_url"] = storage.file_url(d["result_file_id"]) if d.get("result_file_id") else None
    d.pop("result_file_id", None)
    return d


def queue_depth() -> int:
    with QUEUE_LOCK:
        return get_db().query_one("SELECT COUNT(*) c FROM jobs WHERE status IN ('queued','running')")["c"]


def run_job(job_id: str) -> None:
    """Execute a queued job in a worker thread."""
    db = get_db()
    row = db.query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if not row or row["status"] != "queued":
        return

    db.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (job_id,))

    try:
        person_bytes = storage.resolve_file(row["person_file_id"]).read_bytes()
        garment_bytes = storage.resolve_file(row["garment_file_id"]).read_bytes() if row["garment_file_id"] else fetch_garment(row["garment_url"])
        if not garment_bytes:
            raise ValueError("garment image unavailable")

        validate_image_bytes(person_bytes)
        validate_image_bytes(garment_bytes)

        from ..ai_client import get_provider

        provider = get_provider()  # ensures anywear_ai is importable
        from anywear_ai import TryOnOptions

        options = TryOnOptions(category=row["category"] or "other", max_size=1024)
        result = provider.generate(person_bytes, garment_bytes, options)

        result_id, _ = storage.save_result(result.output_bytes, result.mimetype)
        meta = dict(result.meta)
        meta["elapsed_ms"] = result.elapsed_ms

        db.execute(
            "UPDATE jobs SET status = 'succeeded', result_file_id = ?, provider = ?, mode = ?, meta = ? WHERE id = ?",
            (result_id, result.provider, result.mode, str(meta), job_id),
        )
        db.execute(
            "INSERT INTO history (id, created_at, status, category, person_file_id, garment_file_id, garment_url, result_file_id, provider, mode, meta)"
            " VALUES (?, ?, 'succeeded', ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                uuid.uuid4().hex,
                _now(),
                row["category"],
                row["person_file_id"],
                row["garment_file_id"],
                row["garment_url"],
                result_id,
                result.provider,
                result.mode,
                str(meta),
            ),
        )
    except Exception as exc:  # noqa: BLE001
        db.execute("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?", (str(exc)[:500], job_id))


def start_worker(job_id: str) -> threading.Thread:
    t = threading.Thread(target=run_job, args=(job_id,), daemon=True)
    t.start()
    return t


def fetch_garment(url: str | None) -> bytes | None:
    """Server-side garment fetch (no CORS restrictions server-side)."""
    if not url:
        return None
    try:
        import requests

        r = requests.get(url, timeout=15, headers={"User-Agent": "AnywearBot/1.0"})
        r.raise_for_status()
        return r.content
    except Exception:  # noqa: BLE001
        return None
