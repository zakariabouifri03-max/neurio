"""Demo store page — served by the backend so it renders as real HTML
and the garment images are fetchable server-side (same origin, no CORS/network issues).

Open http://localhost:8000/demo in Chrome, then click the Anywear AI extension icon.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

DEMO_DIR = Path(__file__).resolve().parents[1] / "demo_images"

PRODUCTS = [
    {"name": "Linen Summer Dress", "category": "dress", "price": "$89", "color": "#78a0c8"},
    {"name": "Cotton T-Shirt", "category": "shirt", "price": "$25", "color": "#f0f0f5"},
    {"name": "Denim Jacket", "category": "jacket", "price": "$120", "color": "#465064"},
    {"name": "Slim Trousers", "category": "trousers", "price": "$75", "color": "#323c50"},
    {"name": "Knit Sweater", "category": "sweater", "price": "$65", "color": "#b4645a"},
    {"name": "Floral Skirt", "category": "skirt", "price": "$55", "color": "#c896b4"},
]


@router.get("/demo", response_class=HTMLResponse)
def demo_page():
    cards = []
    ld_items = []
    for p in PRODUCTS:
        img = f"/demo/images/{p['category']}.png"
        cards.append(
            f'''<div class="card" data-category="{p["category"]}">
  <img src="{img}" alt="{p["name"]}" />
  <div class="info"><h3>{p["name"]}</h3><div class="price">{p["price"]}</div><span class="tag">{p["category"]}</span></div>
</div>'''
        )
        ld_items.append(
            f'''{{"@type":"Product","name":"{p["name"]}","image":"{img}","offers":{{"@type":"Offer","price":"{p["price"].replace('$','')}"}}}}'''
        )

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Demo Store — Anywear AI</title>
  <meta property="og:image" content="/demo/images/dress.png" />
  <script type="application/ld+json">
    {{"@context":"https://schema.org","@type":"ItemList","itemListElement":[
      {",".join(ld_items)}
    ]}}
  </script>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: Inter, system-ui, sans-serif; background: #f6f6f7; color: #111; }}
    .nav {{ padding: 16px 32px; border-bottom: 1px solid #e8e8ec; display: flex; gap: 24px; align-items: center; }}
    .nav b {{ font-size: 18px; }}
    .nav span {{ font-size: 13px; color: #8a8a92; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; padding: 32px; max-width: 1200px; margin: 0 auto; }}
    .card {{ background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.06); cursor: pointer; transition: box-shadow .2s; }}
    .card:hover {{ box-shadow: 0 8px 24px rgba(0,0,0,.1); }}
    .card img {{ width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; }}
    .card .info {{ padding: 16px; }}
    .card .info h3 {{ font-size: 14px; font-weight: 600; }}
    .card .info .price {{ font-size: 16px; font-weight: 700; margin-top: 4px; }}
    .card .info .tag {{ display: inline-block; font-size: 11px; background: #111; color: #fff; padding: 2px 8px; border-radius: 999px; margin-top: 8px; }}
    .hint {{ text-align: center; padding: 24px; color: #8a8a92; font-size: 13px; max-width: 600px; margin: 0 auto; }}
  </style>
</head>
<body>
  <nav class="nav"><b>Demo Store</b><span>Anywear AI — open the extension and click Scan page</span></nav>
  <div class="hint">This is a fake store for testing Anywear AI. Click the Anywear AI icon, then Scan page — product images are detected automatically. Garment images are served from this server, so try-on works without network issues.</div>
  <div class="grid">
    {''.join(cards)}
  </div>
</body>
</html>"""
    return HTMLResponse(html)


@router.get("/demo/images/{name}")
def demo_image(name: str):
    from fastapi.responses import FileResponse

    # Only allow known demo images
    allowed = {p["category"] + ".png" for p in PRODUCTS}
    if name not in allowed:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(DEMO_DIR / name)
