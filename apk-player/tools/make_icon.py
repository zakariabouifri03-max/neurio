#!/usr/bin/env python3
"""Draws the Neurio APK Player icon and writes src/app.ico (16..256 px).

Usage: python3 tools/make_icon.py   (needs Pillow)
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "app.ico")
PREVIEW = os.path.join(HERE, "..", "src", "app-icon.png")

S = 1024  # master size


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))


def master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # diagonal green -> sky-blue gradient
    grad = Image.new("RGBA", (S, S))
    gp = grad.load()
    c1, c2 = (34, 197, 94, 255), (14, 165, 233, 255)
    for y in range(S):
        for x in range(S):
            gp[x, y] = lerp(c1, c2, (x + y) / (2 * S - 2))

    # rounded-square mask with a soft drop shadow
    pad, radius = 56, 230
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((pad, pad, S - pad, S - pad), radius, fill=255)
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((pad, pad + 22, S - pad, S - pad + 22), radius, fill=(0, 0, 0, 110))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(18)))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # soft highlight on the top half
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse((-S * 0.25, -S * 0.75, S * 1.25, S * 0.42), fill=(255, 255, 255, 38))
    hl_mask = Image.new("L", (S, S), 0)
    hl_mask.paste(mask, (0, 0))
    img = Image.composite(Image.alpha_composite(img, hl), img, hl_mask)
    d = ImageDraw.Draw(img)

    # Android-style antennas (hint that it opens APKs)
    w = 34
    d.line((380, 250, 330, 160), fill=(255, 255, 255, 255), width=w)
    d.line((644, 250, 694, 160), fill=(255, 255, 255, 255), width=w)
    d.ellipse((330 - w / 2, 160 - w / 2, 330 + w / 2, 160 + w / 2), fill="white")
    d.ellipse((694 - w / 2, 160 - w / 2, 694 + w / 2, 160 + w / 2), fill="white")

    # white circle with a play triangle cut out
    cx, cy, r = S // 2, 575, 300
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))
    tri = [(cx - 95, cy - 155), (cx - 95, cy + 155), (cx + 165, cy)]
    tri_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(tri_mask).polygon(tri, fill=255)
    tri_fill = Image.new("RGBA", (S, S))
    tp = tri_fill.load()
    for y in range(S):
        for x in range(S):
            tp[x, y] = lerp((22, 163, 74, 255), (2, 132, 199, 255), (x + y) / (2 * S - 2))
    img.paste(tri_fill, (0, 0), tri_mask)
    return img


def main():
    m = master()
    sizes = [256, 128, 64, 48, 40, 32, 24, 20, 16]
    frames = [m.resize((s, s), Image.LANCZOS) for s in sizes]
    if frames[-1].size[0] <= 24:
        # sharpen the tiniest versions a little so the triangle stays visible
        for i, s in enumerate(sizes):
            if s <= 24:
                frames[i] = frames[i].filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=0))
    frames[0].save(OUT, format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[1:])
    m.resize((256, 256), Image.LANCZOS).save(PREVIEW)
    print("wrote", os.path.normpath(OUT), os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
