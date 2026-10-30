#!/usr/bin/env python3
"""dev helper: score the scale search and dump an aligned contact sheet"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
import build as B

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
F = os.path.join(root, "media/monkey-cuddle/frames")
paths = [os.path.join(F, n) for n in ("kf0.png", "kf2.png", "kf3.png", "kf4b.png", "kf5.png")]

ref = Image.open(paths[0]).convert("RGB")
rw, rh = ref.size
AW = 320
ref_g = B.highpass(B.gray(np.asarray(ref.resize((AW, int(round(AW*rh/rw))), Image.BILINEAR), np.float32)))

grid = list(np.linspace(0.60, 1.40, 41))
for p in paths[1:]:
    im = Image.open(p).convert("RGB")
    g = B.highpass(B.gray(np.asarray(im.resize((AW, int(round(AW*im.size[1]/im.size[0]))), Image.BILINEAR), np.float32)))
    rows = []
    for s in grid:
        nw, nh = max(16, int(round(rw*s))), max(16, int(round(rh*s)))
        b = np.array(Image.fromarray(g).resize((nw, nh), Image.BILINEAR), np.float32)
        b -= b.mean(); a = np.array(ref_g, np.float32) - ref_g.mean()
        dy, dx, peak = B.fft_peakshift(a/(np.linalg.norm(a)+1e-9), b/(np.linalg.norm(b)+1e-9))
        rows.append((peak, s, dx, dy))
    rows.sort(reverse=True)
    k = im.size[0]/AW
    print(os.path.basename(p), " ".join(f"s={s:.2f}:{pk:.3f}" for pk, s, dx, dy in rows[:3]))
    print("   best shift(fullres)", f"({rows[0][2]*k:+.0f},{rows[0][3]*k:+.0f})")

canvases, (cw, ch) = B.build_canvases(paths)
tiles = [c.resize((360, int(360*ch/cw)), Image.LANCZOS) for c in canvases]
sheet = Image.new("RGB", (360*len(tiles), tiles[0].size[1]))
for i, t in enumerate(tiles):
    sheet.paste(t, (360*i, 0))
out = os.path.join(root, "media/monkey-cuddle/diag-alignment.jpg")
sheet.save(out, quality=88)
print("wrote", out, sheet.size)
