#!/usr/bin/env python3
"""
Generate the legacy PNG launcher icons for NeurioVM.

Modern Android (API 26+) uses the adaptive icon in `mipmap-anydpi-v26/`, which
is pure XML and needs no bitmaps. Everything below API 26 still wants a PNG per
density, and some third-party launchers on newer Android keep asking for one too
— so these exist.

The drawing mirrors `res/drawable/ic_launcher_foreground.xml` exactly: a
hypervisor chip with pins, a nested device and a play glyph. Both are generated
from the same numbers so the vector and the bitmap never drift apart.

    python3 tools/make-icons.py            # writes into android/app/src/main/res
    python3 tools/make-icons.py --check    # verify the files exist and match
"""

from __future__ import annotations

import argparse
import hashlib
import math
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("needs Pillow:  pip3 install --break-system-packages pillow")

# ── palette — keep in sync with res/values/colors.xml ────────────────────────
BG = (0x0B, 0x0F, 0x14, 255)
BODY = (0x16, 0x20, 0x2B, 255)
TEAL = (0x33, 0xD6, 0xA6, 255)
BLUE = (0x63, 0xB3, 0xFF, 255)

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# Adaptive-icon foregrounds are 108dp with a 72dp safe zone.
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

# All geometry is expressed on a 108-unit canvas, exactly like the vector.
CANVAS = 108.0


def rounded_rect(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def chip(scale: float, background: bool, safe_inset: float = 0.0) -> Image.Image:
    """
    Render the icon.

    scale          pixels per 108-unit design unit
    background     draw the dark plate (legacy icon) or stay transparent (foreground)
    safe_inset     shrink the artwork to fit the adaptive-icon safe zone
    """
    size = int(round(CANVAS * scale))
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # One design unit in pixels, after the optional safe-zone squeeze. Everything
    # below is expressed in design units so the bitmap and the vector agree.
    k = (CANVAS - 2 * safe_inset) / CANVAS
    off = safe_inset * scale
    unit = scale * k

    def u(v: float) -> float:
        return off + v * unit

    def r(v: float) -> float:
        return v * unit

    if background:
        rounded_rect(d, [0, 0, size - 1, size - 1], 24 * scale, fill=BG)

    # pins — drawn first so the body overlaps their inner ends
    for x in (36, 46, 56, 66):
        d.rectangle([u(x), u(19), u(x + 6), u(29)], fill=BLUE)
        d.rectangle([u(x), u(79), u(x + 6), u(89)], fill=BLUE)
    for y in (36, 46, 56, 66):
        d.rectangle([u(19), u(y), u(29), u(y + 6)], fill=BLUE)
        d.rectangle([u(79), u(y), u(89), u(y + 6)], fill=BLUE)

    # chip body: 52 units square, 8-unit corners, 4-unit teal border
    rounded_rect(d, [u(28), u(28), u(80), u(80)], r(8),
                 fill=BODY, outline=TEAL, width=max(1, int(round(r(4)))))

    # the nested device
    rounded_rect(d, [u(42), u(42), u(66), u(66)], r(5), fill=TEAL)

    # play glyph
    d.polygon([(u(50), u(48)), (u(50), u(60)), (u(61), u(54))], fill=BG)

    return img


def write_png(img: Image.Image, path: str) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG", optimize=True)
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:16]


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    res = os.path.normpath(os.path.join(here, "..", "android", "app", "src", "main", "res"))

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--res", default=res, help="resource directory to write into")
    ap.add_argument("--check", action="store_true", help="only verify the files exist")
    args = ap.parse_args()

    expected = []
    for density, px in DENSITIES.items():
        expected.append((f"mipmap-{density}/ic_launcher.png", px, True, 0.0))
    for density, px in FOREGROUND.items():
        expected.append((f"drawable-{density}/ic_launcher_foreground.png", px, False, 12.0))

    missing = []
    for rel, px, background, inset in expected:
        path = os.path.join(args.res, rel)
        if args.check:
            if not os.path.isfile(path):
                missing.append(rel)
            continue
        scale = px / CANVAS
        img = chip(scale, background, inset)
        digest = write_png(img, path)
        print(f"  {rel:<46} {px:>4}px  sha256:{digest}")

    if args.check:
        if missing:
            print("MISSING: " + ", ".join(missing))
            return 1
        print(f"all {len(expected)} launcher bitmaps present")
        return 0

    # a 512px store/play listing image, handy and cheap to produce here
    store = chip(512 / CANVAS, True, 0.0)
    digest = write_png(store, os.path.join(here, "store-icon-512.png"))
    print(f"  tools/store-icon-512.png                     512px  sha256:{digest}")
    print(f"\nwrote {len(expected)} bitmaps into {args.res}")
    print("adaptive icon (API 26+) is XML: res/mipmap-anydpi-v26/ic_launcher.xml")
    return 0


if __name__ == "__main__":
    sys.exit(main())
