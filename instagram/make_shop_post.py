#!/usr/bin/env python3
"""
Adzak shop — "$3 -> $1 for 24 hours" on the real shirt designs.

    python3 instagram/make_shop_post.py

Outputs (instagram/out/):
    post_shop_1080x1350.png      main feed post — all 4 designs in a 2x2 grid
    carousel_1..4_1080x1350.png  one design per slide (post them as a carousel)
    post_shop_1080x1080.png      square version of the main post
    story_shop_1080x1920.png     story / reel cover

Product images live in assets/products/ (see _manifest.json for the order + names).
"""

import json
import os
import numpy as np
from PIL import Image, ImageDraw

from studio import (Art, S, INTER, ANTON, cap_height, tw, fit_size, header,
                    CREAM, CREAM_D, INK, INK_SOFT, RED, WHITE,
                    BRAND, URL, CTA, ASSETS)

PRODUCTS_DIR = os.path.join(ASSETS, "products")
WAS, NOW = "3", "1"
SAVE = "67%"


# ------------------------------------------------------------------ pieces
def arrow(d, x, base, w, color, lw):
    """small right arrow drawn by hand (no font glyph needed)"""
    y = base - lw * 0.9
    d.line([(x, y), (x + w, y)], fill=color, width=int(lw))
    d.line([(x + w - lw * 3.2, y - lw * 2.3), (x + w, y)], fill=color, width=int(lw))
    d.line([(x + w - lw * 3.2, y + lw * 2.3), (x + w, y)], fill=color, width=int(lw))


def chip(a, cx, base, size=34, fg=CREAM, bg=RED, pad=None):
    """red pill:  $3  ->  $1   (old price struck through)"""
    fw = INTER(size * 0.72, 700)
    fn = ANTON(size)
    w_was = tw("$" + WAS, fw, 0.8)
    w_now = tw("$" + NOW, fn, 0.5)
    aw = size * 0.62
    gap = size * 0.30
    pad = pad if pad is not None else size * 0.62
    h = size * 1.85
    total = w_was + gap + aw + gap + w_now + pad * 2

    a.d.rounded_rectangle([(cx - total / 2) * S, (base - h) * S, (cx + total / 2) * S, base * S],
                          radius=h / 2 * S, fill=bg)
    x = cx - total / 2 + pad
    mid = base - h / 2 + cap_height(fw) / 2
    a.text(x, mid, "$" + WAS, fw, fg, 0.8)
    a.d.line([(x - 2) * S, (mid - size * 0.30) * S, (x + w_was + 2) * S, (mid - size * 0.30) * S],
             fill=fg, width=max(2, int(size * 0.075 * S)))
    x += w_was + gap
    arrow(a.d, x * S, (mid) * S, aw * S, fg + (255,), size * 0.075 * S)
    x += aw + gap
    a.text(x, base - h / 2 + cap_height(fn) / 2, "$" + NOW, fn, fg, 0.5)


def product_card(a, box, path, pad=18, radius=18):
    a.design(box, path, radius=radius, pad=pad)
    return box


def load():
    meta = json.load(open(os.path.join(PRODUCTS_DIR, "_manifest.json")))
    out = []
    for m in meta:
        p = os.path.join(PRODUCTS_DIR, m["file"])
        if os.path.exists(p):
            out.append({**m, "path": p})
    return out


# --------------------------------------------------------------- main post
def post(square=False):
    if square:
        a = Art(1080, 1080)
        x0, x1 = 60, 1020
        header(a, y=48, x0=x0, x1=x1)
        y = a.pill(540, 96, 46, "TODAY ONLY  ·  24 HOURS", INTER(19, 800), CREAM, RED, 2.8)
        s1 = fit_size(ANTON, "ALL DESIGNS", x1 - x0, 92, 2.0)
        s2 = fit_size(ANTON, "JUST $1", 900, 140, 1.0)
        base1 = y + 34 + cap_height(ANTON(s1))
        a.text(540, base1, "ALL DESIGNS", ANTON(s1), INK, 2.0, anchor="c")
        base2 = base1 + 0.10 * s1 + cap_height(ANTON(s2))
        a.text(540, base2, "JUST $1", ANTON(s2), RED, 1.0, anchor="c")

        top = base2 + 40
        w = (x1 - x0 - 3 * 16) / 4
        h = 356
        for i, p in enumerate(prods):
            bx = x0 + i * (w + 16)
            a.design([bx, top, bx + w, top + h], p["path"], radius=14, pad=10)
            chip(a, bx + w / 2, top + h + 40, size=26)
        y = a.pill(540, top + h + 92, 60, CTA, INTER(22, 800), CREAM, INK, 2.8, padx=42)
        a.text(540, y + 52, URL, INTER(22, 600), INK_SOFT, 2.0, anchor="c")
        a.grain()
        a.save("post_shop_1080x1080.png")
        return

    a = Art(1080, 1350)
    x0, x1 = 64, 1016
    header(a, y=52, x0=x0, x1=x1)
    y = a.pill(540, 100, 48, "TODAY ONLY  ·  24 HOURS", INTER(20, 800), CREAM, RED, 2.8)

    s1 = fit_size(ANTON, "ALL DESIGNS", x1 - x0, 100, 2.2)
    s2 = fit_size(ANTON, "JUST $1", 920, 160, 1.0)
    base1 = y + 36 + cap_height(ANTON(s1))
    a.text(540, base1, "ALL DESIGNS", ANTON(s1), INK, 2.2, anchor="c")
    base2 = base1 + 0.10 * s1 + cap_height(ANTON(s2))
    a.text(540, base2, "JUST $1", ANTON(s2), RED, 1.0, anchor="c")
    a.was_price(540, base2 + 46, 27, "was $3", f"SAVE {SAVE}  ·  ENDS TONIGHT")

    top = base2 + 78
    gap = 22
    card_w = (x1 - x0 - gap) / 2
    card_h = (1200 - top - 34) / 2
    for i, p in enumerate(prods):
        r, c = divmod(i, 2)
        bx = x0 + c * (card_w + gap)
        by = top + r * (card_h + 34)
        a.design([bx, by, bx + card_w, by + card_h], p["path"], radius=20, pad=16)
        a.d.rounded_rectangle([(bx + 14) * S, (by + card_h - 58) * S, (bx + card_w - 14) * S,
                               (by + card_h - 6) * S], radius=22 * S, fill=CREAM + (242,))
        chip(a, bx + card_w / 2, by + card_h - 18, size=25)

    y = a.pill(540, 1218, 60, CTA, INTER(23, 800), CREAM, INK, 3.0, padx=44)
    a.text(540, 1322, URL, INTER(23, 600), INK_SOFT, 2.2, anchor="c")
    a.sticker(x1 - 34, top - 8, 68)
    a.grain()
    a.save("post_shop_1080x1350.png")


# --------------------------------------------------------------- carousel
def slide(i, p, total):
    a = Art(1080, 1350)
    x0, x1 = 64, 1016
    header(a, y=52, x0=x0, x1=x1, right=f"{i + 1} / {total}")

    card = [x0, 112, x1, 966]
    a.design(card, p["path"], radius=24, pad=26)
    chip(a, 540, card[3] + 34, size=38)

    s = fit_size(ANTON, p["label"], x1 - x0, 106, 2.6)
    base = card[3] + 92 + cap_height(ANTON(s))
    a.text(540, base, p["label"], ANTON(s), INK, 2.6, anchor="c")
    a.text(540, base + 40, p["sub"] + "  ·  instant download", INTER(25, 500), INK_SOFT, 0.4, anchor="c")
    y = a.pill(540, base + 68, 58, CTA, INTER(22, 800), CREAM, INK, 2.8, padx=40)
    a.text(540, y + 48, URL, INTER(22, 600), INK_SOFT, 2.0, anchor="c")
    a.sticker(x1 - 30, 158, 62)
    a.grain()
    a.save(f"carousel_{i + 1}_1080x1350.png")


# ------------------------------------------------------------------ story
def story():
    a = Art(1080, 1920)
    x0, x1 = 64, 1016
    header(a, y=92, x0=x0, x1=x1)
    y = a.pill(540, 148, 50, "TODAY ONLY  ·  24 HOURS", INTER(21, 800), CREAM, RED, 3.0)

    s1 = fit_size(ANTON, "ALL DESIGNS", x1 - x0, 118, 2.4)
    s2 = fit_size(ANTON, "JUST $1", 920, 200, 0.6)
    base1 = y + 38 + cap_height(ANTON(s1))
    a.text(540, base1, "ALL DESIGNS", ANTON(s1), INK, 2.4, anchor="c")
    base2 = base1 + 0.10 * s1 + cap_height(ANTON(s2))
    a.text(540, base2, "JUST $1", ANTON(s2), RED, 0.6, anchor="c")

    top = base2 + 62
    gap = 22
    card_w = (x1 - x0 - gap) / 2
    card_h = (1540 - top - 30) / 2 - 14
    for i, p in enumerate(prods):
        r, c = divmod(i, 2)
        bx = x0 + c * (card_w + gap)
        by = top + r * (card_h + 30)
        a.design([bx, by, bx + card_w, by + card_h], p["path"], radius=20, pad=16)
    grid_bottom = top + card_h * 2 + 30

    a.was_price(540, grid_bottom + 56, 32, "was $3", f"SAVE {SAVE}  ·  ENDS TONIGHT")
    y = a.pill(540, grid_bottom + 96, 86, CTA, INTER(29, 800), CREAM, INK, 3.4, padx=58)
    a.text(540, y + 62, URL, INTER(27, 600), INK_SOFT, 2.6, anchor="c")
    a.sticker(944, top + 6, 70)
    a.grain()
    a.save("story_shop_1080x1920.png")


if __name__ == "__main__":
    prods = load()
    print(f"{len(prods)} designs")
    np.random.seed(5)
    post()
    post(square=True)
    for i, p in enumerate(prods):
        slide(i, p, len(prods))
    story()
