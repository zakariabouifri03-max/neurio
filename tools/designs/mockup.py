#!/usr/bin/env python3
"""
mockup.py — puts each design on a shirt mockup (the way K-Studio shoots every listing:
one big chest mockup, light studio background, colourways side by side).

  python3 tools/designs/mockup.py

Outputs etsy-designs/preview/<id>-mockup.jpg  (2000x2000)
"""
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "etsy-designs"))
INK = "#20201E"


def shirt_svg(color="#1F1F1F", shade="#00000022", w=1200, h=1400):
    """A front-view crewneck tee, drawn flat with soft folds."""
    body = ("M600 120 C520 120 470 150 400 172 L250 230 L150 470 L290 520 L300 700 "
            "L300 1290 C300 1320 330 1330 380 1330 H820 C870 1330 900 1320 900 1290 "
            "L900 700 L910 520 L1050 470 L950 230 L800 172 C730 150 680 120 600 120 Z")
    collar = "M470 150 C510 230 690 230 730 150 C680 128 520 128 470 150 Z"
    folds = [
        "M330 690 C360 830 350 1010 320 1180",
        "M870 690 C840 840 850 1020 880 1180",
        "M420 1180 C500 1210 700 1210 780 1180",
        "M600 240 C590 420 610 520 600 640",
        "M330 760 C400 800 470 810 560 800",
    ]
    fold_paths = "".join('<path d="%s" fill="none" stroke="rgba(255,255,255,.06)" '
                         'stroke-width="10" stroke-linecap="round"/>' % f for f in folds)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 1200 1400">
  <defs>
    <radialGradient id="body" cx="42%" cy="30%" r="90%">
      <stop offset="0" stop-color="rgb(255,255,255)" stop-opacity=".16"/>
      <stop offset=".55" stop-color="rgb(0,0,0)" stop-opacity="0"/>
      <stop offset="1" stop-color="rgb(0,0,0)" stop-opacity=".38"/>
    </radialGradient>
    <linearGradient id="sleeve" x1="0" x2="1">
      <stop offset="0" stop-color="rgb(0,0,0)" stop-opacity=".22"/>
      <stop offset=".5" stop-color="rgb(255,255,255)" stop-opacity=".06"/>
      <stop offset="1" stop-color="rgb(0,0,0)" stop-opacity=".22"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="12"/></filter>
  </defs>
  <g>
    <path d="{body}" fill="{color}"/>
    <path d="{body}" fill="url(#body)"/>
    {fold_paths}
    <path d="{collar}" fill="rgb(0,0,0)" opacity=".35"/>
    <path d="{collar}" fill="none" stroke="rgb(255,255,255)" stroke-opacity=".10" stroke-width="8"/>
    <path d="M250 230 L150 470 L290 520 L300 700" fill="url(#sleeve)"/>
    <path d="M950 230 L1050 470 L910 520 L900 700" fill="url(#sleeve)"/>
    <path d="M300 1240 H900" stroke="rgb(0,0,0)" stroke-opacity=".25" stroke-width="6" stroke-dasharray="26 18"/>
  </g>
</svg>'''


def render_shirt(path, color):
    svg = shirt_svg(color=color)
    tmp = path.replace(".png", ".svg")
    with open(tmp, "w") as f:
        f.write(svg)
    node = ("const {Resvg}=require('@resvg/resvg-js');const fs=require('fs');"
            "const a=process.argv.slice(-2);"
            "const r=new Resvg(fs.readFileSync(a[0],'utf8'),{fitTo:{mode:'width',value:1200}});"
            "fs.writeFileSync(a[1],r.render().asPng());")
    subprocess.run(["node", "-e", node, tmp, path], check=True, cwd=os.path.join(HERE, "..", ".."))
    os.unlink(tmp)
    return Image.open(path).convert("RGBA")


def composite(design_path, color, bg="#EDE9E2", out=None, chest=0.50, shirt_w=1200):
    shirt = render_shirt(os.path.join("/tmp", "shirt_%s.png" % color.strip("#")), color)
    design = Image.open(design_path).convert("RGBA")
    dw = int(shirt.width * chest)
    dh = int(dw * design.height / design.width)
    if dh > shirt.height * 0.62:
        dh = int(shirt.height * 0.62)
        dw = int(dh * design.width / design.height)
    design = design.resize((dw, dh), Image.LANCZOS)
    canvas_w, canvas_h = 2000, 2000
    canvas = Image.new("RGBA", (canvas_w, canvas_h), bg)
    sc = 1.45
    sw, sh = int(shirt.width * sc), int(shirt.height * sc)
    canvas.alpha_composite(shirt.resize((sw, sh), Image.LANCZOS), ((canvas_w - sw) // 2, 260))
    dx = (canvas_w - dw) // 2
    dy = 260 + int(sh * 0.235)
    canvas.alpha_composite(design, (dx, dy))
    if out:
        canvas.convert("RGB").save(out, quality=92)
    return canvas


if __name__ == "__main__":
    import glob
    import json
    meta_path = os.path.join(OUT, "designs.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    os.makedirs(os.path.join(OUT, "preview"), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(OUT, "png", "d*-*.png"))):
        if "preview" in f:
            continue
        base = os.path.basename(f).replace(".png", "")
        pid = base.split("-")[0]
        color = meta.get(pid, {}).get("shirt", "#1F1F1F")
        composite(f, color, out=os.path.join(OUT, "preview", base + "-mockup.jpg"))
        print("mockup", base)
