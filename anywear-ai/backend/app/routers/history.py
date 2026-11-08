"""GET /api/history, DELETE /api/history/{id}."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_db
from ..schemas import HistoryItem
from ..services import storage
from .upload import require_api_key

router = APIRouter()


@router.get("/history", response_model=list[HistoryItem])
def list_history(_=Depends(require_api_key)):
    rows = get_db().query("SELECT * FROM history ORDER BY created_at DESC LIMIT 100")
    return [
        HistoryItem(
            id=r["id"],
            created_at=r["created_at"],
            status=r["status"],
            category=r["category"],
            person_url=storage.file_url(r["person_file_id"]) if r["person_file_id"] else None,
            garment_url=storage.file_url(r["garment_file_id"]) if r["garment_file_id"] else None,
            garment_source_url=r["garment_url"],
            result_url=storage.file_url(r["result_file_id"]) if r["result_file_id"] else None,
            provider=r["provider"],
            mode=r["mode"],
        )
        for r in rows
    ]


@router.delete("/history/{item_id}")
def delete_history(item_id: str, _=Depends(require_api_key)):
    row = get_db().query_one("SELECT * FROM history WHERE id = ?", (item_id,))
    if not row:
        raise HTTPException(status_code=404, detail="history item not found")
    # Remove stored files first, then the record (best-effort cleanup).
    for fid in (row["person_file_id"], row["garment_file_id"], row["result_file_id"]):
        if fid:
            storage.delete_file(fid)
    get_db().execute("DELETE FROM history WHERE id = ?", (item_id,))
    return {"deleted": item_id}
