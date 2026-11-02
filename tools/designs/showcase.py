#!/usr/bin/env python3
"""Builds etsy-designs/index.html — a shop-style page for the collection."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "etsy-designs"))
data = json.load(open(os.path.join(OUT, "listings.json")))

cards = []
for i, d in enumerate(data["designs"], 1):
    tags = "".join('<span class="tag">%s</span>' % t for t in d["tags"][:6])
    cards.append(f'''
    <article class="card" data-id="{d['id']}">
      <a class="thumb" href="preview/{d['file']}-mockup.jpg" target="_blank">
        <img loading="lazy" src="preview/{d['file']}-mockup.jpg" alt="{d['title']}">
        <span class="badge">Digital Download</span>
      </a>
      <div class="meta">
        <div class="prices"><s>$2.23</s> <b>$1.67</b> <em>25% off</em></div>
        <h3>{d['title']}</h3>
        <div class="tags">{tags}</div>
        <div class="files">
          <a href="png/{d['file']}.png" download>PNG 4500×5400</a>
          <a href="svg/{d['file']}.svg" download>SVG</a>
          <a href="preview/{d['file']}-mockup.jpg" download>Mockup</a>
        </div>
      </div>
    </article>''')

html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{data['collection']['name']} — sublimation PNG collection</title>
<style>
  :root {{
    --ink:#2a211c; --cream:#f7f0df; --gold:#d9a93c; --gold2:#f3d177;
    --terra:#c0562f; --pine:#2e6b4f; --sand:#f1d2a6; --paper:#fbf7ef;
  }}
  * {{ box-sizing:border-box }}
  body {{
    margin:0; color:var(--ink); background:var(--paper);
    font-family:"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  }}
  header {{
    padding:34px 26px 26px; text-align:center;
    background:
      radial-gradient(1200px 300px at 50% -80px, #f6e7c8 0%, transparent 70%),
      repeating-linear-gradient(45deg, #fbf7ef 0 12px, #f8f1e3 12px 24px);
    border-bottom:2px dashed #e6d9bf;
  }}
  .kicker {{ letter-spacing:.32em; font-size:11px; text-transform:uppercase; color:#8b7658 }}
  h1 {{ margin:10px 0 6px; font-size:clamp(26px,4vw,44px); letter-spacing:.02em }}
  h1 span {{ color:var(--terra) }}
  .tagline {{ margin:0; color:#6d6154; font-size:14px }}
  .chips {{ display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:16px }}
  .chips span {{
    font-size:12px; padding:6px 12px; border:1.5px solid var(--ink); border-radius:999px;
    background:#fff; box-shadow:3px 3px 0 #e3d6bd;
  }}
  .wrap {{ max-width:1240px; margin:0 auto; padding:26px 18px 60px }}
  .note {{
    background:#fff; border:2px dashed #e0d2b6; border-radius:16px; padding:16px 18px;
    font-size:13.5px; line-height:1.6; color:#5d5347; margin-bottom:26px;
  }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:22px }}
  .card {{
    background:#fff; border:2px solid #efe4cd; border-radius:18px; overflow:hidden;
    box-shadow:0 10px 24px -18px #5b4a33; display:flex; flex-direction:column;
    transition:transform .18s ease, box-shadow .18s ease;
  }}
  .card:hover {{ transform:translateY(-3px); box-shadow:0 16px 30px -18px #5b4a33 }}
  .thumb {{ position:relative; display:block; aspect-ratio:1/1; background:#eee7d9; overflow:hidden }}
  .thumb img {{ width:100%; height:100%; object-fit:cover; display:block }}
  .badge {{
    position:absolute; left:10px; top:10px; background:rgba(42,33,28,.85); color:#fff;
    font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; padding:5px 9px; border-radius:999px;
  }}
  .meta {{ padding:14px 15px 16px; display:flex; flex-direction:column; gap:9px }}
  .prices {{ font-size:14px; color:#8a7c68 }}
  .prices b {{ color:var(--terra); font-size:17px }}
  .prices em {{ font-style:normal; font-size:11px; background:#f7e6cd; color:#8a5b25;
                padding:2px 7px; border-radius:999px }}
  h3 {{ font-size:13.5px; line-height:1.45; font-weight:600; margin:0 }}
  .tags {{ display:flex; flex-wrap:wrap; gap:5px }}
  .tag {{ font-size:10.5px; color:#7a6b57; background:#f6efdf; border-radius:6px; padding:3px 7px }}
  .files {{ display:flex; gap:8px; flex-wrap:wrap; margin-top:auto; padding-top:6px }}
  .files a {{
    font-size:11.5px; text-decoration:none; color:var(--ink); border:1.5px solid var(--ink);
    border-radius:8px; padding:6px 9px; background:#fff; box-shadow:2px 2px 0 #e7dac1;
  }}
  .files a:hover {{ background:var(--gold2) }}
  footer {{ text-align:center; font-size:12px; color:#8b7c67; padding:0 20px 40px }}
  footer code {{ background:#f0e7d4; padding:2px 5px; border-radius:5px }}
</style>
</head>
<body>
<header>
  <div class="kicker">Sublimation PNG · Vol. 1</div>
  <h1>K-STUDIO <span>STYLE</span></h1>
  <p class="tagline">{data['collection']['tagline']}</p>
  <div class="chips">
    <span>10 designs</span><span>4500×5400 px</span><span>300 dpi</span>
    <span>transparent PNG + SVG</span><span>mockups included</span>
  </div>
</header>
<div class="wrap">
  <p class="note"><b>How this follows the reference shop:</b> faux-applique letters with real stitch
  lines, leopard / gingham / plaid patchwork, cream coquette bows, gold doodles, a 2–3 colour palette
  per design, and titles built as <i>Hooks + Design + Style + Format + Digital Download</i>.
  Everything here is generated from code — no stock art, OFL fonts only.</p>
  <div class="grid">{''.join(cards)}</div>
</div>
<footer>Rebuild with <code>python3 tools/designs/designs.py</code> · mockups with <code>python3 tools/designs/mockup.py</code></footer>
</body>
</html>'''
open(os.path.join(OUT, "index.html"), "w").write(html)
print("wrote", os.path.join(OUT, "index.html"))
