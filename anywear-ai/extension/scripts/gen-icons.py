"""Generate Anywear AI extension icons with Pillow (no external assets)."""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG = (17, 17, 20)      # ink
FG = (255, 255, 255)
ACC = (232, 230, 225)  # soft neutral accent


def round_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def make_icon(size, maskable=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    margin = 0 if maskable else int(size * 0.08)
    box = [margin, margin, size - margin, size - margin]
    radius = int(size * (0.22 if maskable else 0.26))
    round_rect(d, box, radius, BG)

    # "A" monogram: two strokes forming an A with a crossbar, plus a
    # subtle garment "hanger" curve for the fashion angle.
    s = size
    cx = s / 2
    stroke = max(2, int(s * 0.075))
    h = s * 0.52
    top = s * (0.24 if maskable else 0.27)
    # legs
    d.line([(cx, top), (cx - s * 0.20, s * 0.72)], fill=FG, width=stroke)
    d.line([(cx, top), (cx + s * 0.20, s * 0.72)], fill=FG, width=stroke)
    # crossbar
    d.line([(cx - s * 0.115, s * 0.55), (cx + s * 0.115, s * 0.55)], fill=ACC, width=stroke)
    # dot
    r = stroke * 0.75
    d.ellipse([cx - r, s * 0.76 - r, cx + r, s * 0.76 + r], fill=FG)
    # hanger hook hint
    d.arc([cx - s * 0.09, top - s * 0.14, cx + s * 0.09, top + s * 0.09],
          start=180, end=360, fill=ACC, width=max(2, stroke // 2))
    return img


for s in (16, 32, 48, 128):
    make_icon(s).convert("RGBA").save(OUT / f"icon-{s}.png")

# maskable 512 for store listing
make_icon(512, maskable=True).convert("RGBA").save(OUT / "icon-maskable-512.png")
# store listing 512
make_icon(512).convert("RGBA").save(OUT / "icon-512.png")
print("icons written:", sorted(p.name for p in OUT.iterdir()))
