#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Alignment check: drop every keyframe into the shared camera space and write a
side-by-side strip so you can see whether the clock / room / subjects line up
before spending 4 minutes on a render.

    python3 tools/monkey-cuddle/diag.py            # -> media/monkey-cuddle/alignment-check.jpg
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image

import build as B

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FR = os.path.join(ROOT, "media/monkey-cuddle/frames")
NAMES = ("kf0.png", "kf2.png", "kf3.png", "kf4b.png", "kf5.png")


def main():
    paths = [os.path.join(FR, n) for n in NAMES]
    canvases, (cw, ch) = B.build_canvases(paths)
    tw = 340
    tiles = [c.resize((tw, int(round(tw * ch / cw))), Image.LANCZOS) for c in canvases]
    sheet = Image.new("RGB", (tw * len(tiles), tiles[0].size[1]))
    for i, t in enumerate(tiles):
        sheet.paste(t, (tw * i, 0))
    out = os.path.join(ROOT, "media/monkey-cuddle/alignment-check.jpg")
    sheet.save(out, quality=88)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
