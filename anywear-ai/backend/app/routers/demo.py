"""Demo store + garment catalog — served by the backend so it renders as
real HTML and garment images are fetchable server-side (same origin).

Endpoints:
  GET /demo             — demo store page (product grid)
  GET /demo/garments    — garment catalog JSON (for the Live Studio)
  GET /demo/images/{name} — garment image files
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

router = APIRouter()

DEMO_DIR = Path(__file__).resolve().parents[1] / "demo_images"


def _load_catalog() -> list[dict]:
    catalog_path = DEMO_DIR / "catalog.json"
    if catalog_path.exists():
        return json.loads(catalog_path.read_text())
    return []


@router.get("/demo", response_class=HTMLResponse)
def demo_page():
    catalog = _load_catalog()
    if not catalog:
        return HTMLResponse("<h1>No demo garments available</h1>")

    cards = []
    for item in catalog:
        cards.append(
            f'''<div class="card" data-category="{item["category"]}" data-name="{item["name"]}">
  <img src="{item["image"]}" alt="{item["name"]}" />
  <div class="info"><h3>{item["name"]}</h3><span class="tag">{item["category"]}</span></div>
</div>'''
        )

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo Store — Anywear AI</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: Inter, system-ui, sans-serif; background: #f6f6f7; color: #111; }}
    .nav {{ padding: 16px 32px; border-bottom: 1px solid #e8e8ec; display: flex; gap: 24px; align-items: center; }}
    .nav b {{ font-size: 18px; }}
    .nav span {{ font-size: 13px; color: #8a8a92; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; padding: 32px; max-width: 1400px; margin: 0 auto; }}
    .card {{ background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.06); cursor: pointer; transition: box-shadow .2s; }}
    .card:hover {{ box-shadow: 0 8px 24px rgba(0,0,0,.1); }}
    .card img {{ width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }}
    .card .info {{ padding: 12px; }}
    .card .info h3 {{ font-size: 13px; font-weight: 600; }}
    .card .info .tag {{ display: inline-block; font-size: 10px; background: #111; color: #fff; padding: 2px 8px; border-radius: 999px; margin-top: 6px; }}
    .hint {{ text-align: center; padding: 24px; color: #8a8a92; font-size: 13px; max-width: 600px; margin: 0 auto; }}
  </style>
</head>
<body>
  <nav class="nav"><b>Demo Store</b><span>Anywear AI — open the extension and click Scan page</span></nav>
  <div class="hint">Click the Anywear AI icon, then Scan page. {len(catalog)} garments available.</div>
  <div class="grid">
    {''.join(cards)}
  </div>
</body>
</html>"""
    return HTMLResponse(html)


@router.get("/demo/garments")
def garment_catalog():
    """Return the full garment catalog for the Live Studio."""
    return _load_catalog()


@router.get("/demo/images/{name}")
def demo_image(name: str):
    """Serve any demo image file (validated against catalog)."""
    catalog = _load_catalog()
    allowed = {item["image"].split("/")[-1] for item in catalog}
    if name not in allowed:
        raise HTTPException(status_code=404, detail="image not found")
    path = DEMO_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(path)
