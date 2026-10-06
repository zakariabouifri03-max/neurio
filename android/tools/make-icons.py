#!/usr/bin/env python3
"""Draws the launcher icons (no image files in git, everything procedural).

    python3 android/tools/make-icons.py

Creates in app/res:
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png            48..192 px
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_round.png      circular
  mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png 108dp adaptive foreground
  mipmap-anydpi-v26/ic_launcher.xml + ic_launcher_round.xml
  mipmap-xxhdpi/ic_notif.png                             72 px white glyph
"""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(os.path.dirname(HERE), "app", "res")

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

# Instagram-ish gradient
C1 = (245, 133, 41)
C2 = (221, 42, 123)
C3 = (129, 52, 175)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def gradient(size):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * (size - 1)) if size > 1 else 0
            px[x, y] = lerp(C1, C2, t / 0.55) if t < 0.55 else lerp(C2, C3, (t - 0.55) / 0.45)
    return img


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def circle_mask(size):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
    return m


def draw_art(size, inset=0.0, bg=True, circular=False):
    """The icon itself: gradient tile + white reel frame + play + save arrow."""
    ss = size * 4                     # supersample for smooth edges
    base = gradient(ss) if bg else Image.new("RGB", (ss, ss), (0, 0, 0))
    art = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)

    pad = int(ss * (0.14 + inset))
    box = ss - 2 * pad
    r = int(box * 0.30)
    # white rounded "reel" frame
    d.rounded_rectangle([pad, pad, ss - pad, ss - pad], radius=r,
                        outline=(255, 255, 255, 255), width=max(2, int(box * 0.105)))

    # play triangle in the middle
    cx, cy = ss / 2.0, ss / 2.0
    t = box * 0.30
    tri = [(cx - t * 0.52, cy - t), (cx - t * 0.52, cy + t), (cx + t * 0.92, cy)]
    d.polygon(tri, fill=(255, 255, 255, 255))

    # small "save down arrow" badge bottom-right
    br = box * 0.30
    bx, by = ss - pad - br * 0.30, ss - pad - br * 0.30
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=(255, 255, 255, 255))
    aw = br * 0.30
    d.rectangle([bx - aw * 0.55, by - br * 0.62, bx + aw * 0.55, by + br * 0.10],
                fill=(221, 42, 123, 255))
    d.polygon([(bx - aw * 1.15, by - br * 0.02), (bx + aw * 1.15, by - br * 0.02),
               (bx, by + br * 0.62)], fill=(221, 42, 123, 255))

    if bg:
        tile = base.convert("RGBA")
        tile.alpha_composite(art)
        out = tile
    else:
        out = art

    mask = circle_mask(ss) if circular else rounded_mask(ss, int(ss * 0.22))
    if bg or circular:
        out.putalpha(mask)
    return out.resize((size, size), Image.LANCZOS)


def notif_glyph(size):
    """White monochrome download glyph for the notification bar."""
    ss = size * 8
    img = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = (255, 255, 255, 255)
    d.rectangle([ss * 0.16, ss * 0.80, ss * 0.84, ss * 0.90], fill=w)
    d.rectangle([ss * 0.43, ss * 0.12, ss * 0.57, ss * 0.55], fill=w)
    d.polygon([(ss * 0.26, ss * 0.48), (ss * 0.74, ss * 0.48), (ss * 0.5, ss * 0.76)], fill=w)
    return img.resize((size, size), Image.LANCZOS)


def main():
    for name, dpi in DENSITIES.items():
        folder = os.path.join(RES, "mipmap-" + name)
        os.makedirs(folder, exist_ok=True)
        px = int(48 * dpi)
        draw_art(px).save(os.path.join(folder, "ic_launcher.png"))
        draw_art(px, circular=True).save(os.path.join(folder, "ic_launcher_round.png"))
        fg = int(108 * dpi)
        draw_art(fg, inset=0.10, bg=False).save(os.path.join(folder, "ic_launcher_foreground.png"))
        print("mipmap-" + name, px, "px +", fg, "px foreground")

    os.makedirs(os.path.join(RES, "mipmap-xxhdpi"), exist_ok=True)
    notif_glyph(72).save(os.path.join(RES, "mipmap-xxhdpi", "ic_notif.png"))

    anydpi = os.path.join(RES, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    for round_ in (False, True):
        name = "ic_launcher_round.xml" if round_ else "ic_launcher.xml"
        with open(os.path.join(anydpi, name), "w") as f:
            f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                    '    <background android:drawable="@color/icon_bg" />\n'
                    '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                    '</adaptive-icon>\n')
    print("adaptive icons + notification glyph written")


if __name__ == "__main__":
    main()
