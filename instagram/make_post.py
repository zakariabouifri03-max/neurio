#!/usr/bin/env python3
"""
Adzak shop — Instagram promo graphics ($3 -> $1, 24 hours only).

Everything is drawn from code (no Canva, no template):
    python3 instagram/make_post.py          # all three sizes
    python3 instagram/make_post.py story    # just one

Outputs (instagram/out/):
    post_1080x1350.png      feed post A — 4:5 (biggest reach in feed)
    post_1080x1350_v2.png   feed post B — same template, other photo (carousel)
    post_1080x1080.png      feed post — square
    story_1080x1920.png     story / reel cover

Fonts: Anton + Inter (SIL Open Font License, see assets/fonts/OFL-*.txt)
"""

import os
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(BASE, "assets", "fonts")
ASSETS = os.path.join(BASE, "assets")
OUT = os.path.join(BASE, "out")

S = 2  # supersampling -> crisp edges after the final downscale

# ------------------------------------------------------------------ palette
CREAM = (252, 247, 237)
CREAM_D = (242, 232, 214)
INK = (26, 20, 17)
INK_SOFT = (112, 100, 89)
RED = (191, 46, 39)
RED_D = (150, 30, 26)

BRAND = "ADZAK"
KICKER = "DIGITAL DOWNLOADS"
URL = "adzak-shop.fourthwall.com"
CTA = "SHOP NOW  ·  LINK IN BIO"


def F(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), int(round(size * S)))


def ANTON(s):
    return F("Anton-Regular.ttf", s)


def INTER(s, w=500):
    return F(f"Inter-{w}.ttf", s)


def cap_height(f):
    b = f.getbbox("H")
    return (b[3] - b[1]) / S


def tw(s, f, tracking=0.0):
    if not s:
        return 0.0
    return (sum(f.getlength(c) for c in s) + tracking * S * (len(s) - 1)) / S


def fit_size(make_font, s, max_w, start, tracking=0.0, floor=12):
    """largest size in px so that the string fits max_w"""
    size = start
    while size > floor and tw(s, make_font(size), tracking) > max_w:
        size -= 1
    return size


class Art:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = self._bg()
        self.d = ImageDraw.Draw(self.img, "RGBA")

    # ------------------------------------------------------------ texture
    def _bg(self):
        w, h = self.w * S, self.h * S
        ys = np.linspace(0, 1, h)[:, None, None]
        top = np.array(CREAM, float)[None, None, :]
        bot = np.array(CREAM_D, float)[None, None, :]
        arr = top + (bot - top) * (ys ** 1.15)
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.sqrt(((xx - w * 0.22) / (w * 0.9)) ** 2 + ((yy - h * 0.04) / (h * 0.8)) ** 2)
        arr = arr + (np.clip(1 - d, 0, 1)[..., None] ** 2) * 7.0
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    # -------------------------------------------------------------- type
    def text(self, x, base, s, f, fill, tracking=0.0, anchor="l"):
        tr = tracking * S
        widths = [f.getlength(c) for c in s]
        total = sum(widths) + tr * max(len(s) - 1, 0)
        cx = {"c": x * S - total / 2, "r": x * S - total}.get(anchor, x * S)
        for c, w in zip(s, widths):
            self.d.text((cx, base * S), c, font=f, fill=fill, anchor="ls")
            cx += w + tr
        return total / S

    def big(self, cx, base, s, max_w, start, fill, tracking=1.0):
        size = fit_size(ANTON, s, max_w, start, tracking)
        self.text(cx, base, s, ANTON(size), fill, tracking, anchor="c")
        return size

    def rule(self, x0, y, x1, color=(*INK, 30), w=1.5):
        self.d.line([(x0 * S, y * S), (x1 * S, y * S)], fill=color, width=max(1, int(w * S)))

    def pill(self, cx, y0, h, s, f, fg, bg, track=0.0, padx=None, radius=None):
        padx = padx if padx is not None else h * 0.55
        w = tw(s, f, track) + padx * 2
        radius = radius if radius is not None else h / 2
        self.d.rounded_rectangle(
            [(cx - w / 2) * S, y0 * S, (cx + w / 2) * S, (y0 + h) * S],
            radius=radius * S, fill=bg,
        )
        self.text(cx, y0 + h / 2 + cap_height(f) / 2, s, f, fg, track, anchor="c")
        return y0 + h

    def was_price(self, cx, base, size=30, prices="was $3", rest="SAVE 67%  ·  ENDS TONIGHT"):
        """small em-dash price row with the old price struck through"""
        f = INTER(size, 800)
        fs = INTER(size * 0.95, 500)
        gap = size * 0.62
        w1 = tw(prices, fs, 1.0)
        w2 = tw("·", fs, 1.0)
        w3 = tw(rest, f, 1.6)
        total = w1 + w2 + w3 + gap * 2
        x = cx - total / 2
        self.text(x, base, prices, fs, INK_SOFT, 1.0)
        self.d.line([(x - 2) * S, (base - size * 0.30) * S, (x + w1 + 2) * S, (base - size * 0.30) * S],
                    fill=RED, width=max(2, int(size * 0.085 * S)))
        x += w1 + gap
        self.text(x, base, "·", fs, INK_SOFT, 1.0)
        x += w2 + gap
        self.text(x, base, rest, f, RED, 1.6)

    # ------------------------------------------------------------- photo
    def photo(self, box, path, radius=26, shadow=True, focus=0.5):
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        im = Image.open(path).convert("RGB")
        sw, sh = im.size
        scale = max(w / sw, h / sh)
        im = im.resize((int(sw * scale * S + 0.5), int(sh * scale * S + 0.5)), Image.LANCZOS)
        left = (im.size[0] - int(w * S)) // 2
        top = int((im.size[1] - h * S) * focus)
        im = im.crop((left, top, left + int(w * S), top + int(h * S)))

        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, im.size[0] - 1, im.size[1] - 1], radius=radius * S, fill=255)

        if shadow:
            sh_layer = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
            ImageDraw.Draw(sh_layer).rounded_rectangle(
                [x0 * S, (y0 + 15) * S, x1 * S, (y1 + 20) * S],
                radius=radius * S, fill=(62, 42, 26, 60))
            self.img.paste(sh_layer.filter(ImageFilter.GaussianBlur(11 * S)), (0, 0), sh_layer)

        self.img.paste(im, (int(x0 * S), int(y0 * S)), mask)
        self.d.rounded_rectangle([v * S for v in box], radius=radius * S,
                                 outline=(255, 255, 255, 110), width=int(1.6 * S))
        return box

    def bleed_photo(self, path, box_h, fade=210, focus=0.5):
        """full-width photo at the top, fading out into the cream page"""
        sw, fh = self.w * S, box_h * S
        im = Image.open(path).convert("RGB")
        sc = sw / im.size[0]
        im = im.resize((sw, max(int(im.size[1] * sc), fh)), Image.LANCZOS)
        top = int((im.size[1] - fh) * focus)
        im = im.crop((0, top, sw, top + fh))

        mask = Image.new("L", (sw, fh), 255)
        md = ImageDraw.Draw(mask)
        n = fade * S
        for i in range(n):
            y = fh - n + i
            md.line([(0, y), (sw, y)], fill=int(255 * (1 - i / n) ** 1.5))
        self.img.paste(im, (0, 0), mask)

    # ----------------------------------------------------------- sticker
    def sticker(self, cx, cy, r, angle=-11):
        size = int(r * 2 * S * 1.3)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        c, R = size / 2, r * S
        d.ellipse([c - R, c - R, c + R, c + R], fill=RED + (255,))
        d.ellipse([c - R * 0.89, c - R * 0.89, c + R * 0.89, c + R * 0.89],
                  outline=(255, 248, 236, 115), width=max(1, int(1.6 * S)))
        f1 = ImageFont.truetype(os.path.join(FONTS, "Anton-Regular.ttf"), int(R * 0.95))
        f2 = ImageFont.truetype(os.path.join(FONTS, "Inter-800.ttf"), int(R * 0.235))

        def centred(s, f, baseline, tracking):
            tr = tracking * R
            widths = [f.getlength(ch) for ch in s]
            x = c - (sum(widths) + tr * (len(s) - 1)) / 2
            for ch, w in zip(s, widths):
                d.text((x, baseline), ch, font=f, fill=CREAM + (255,), anchor="ls")
                x += w + tr

        b = f1.getbbox("24H")
        base1 = c + (b[3] - b[1]) * 0.30
        centred("24H", f1, base1, 0)
        centred("ONLY", f2, base1 + R * 0.33, 0.06)

        layer = layer.rotate(angle, resample=Image.BICUBIC, expand=False)
        self.img.paste(layer, (int(cx * S - size / 2), int(cy * S - size / 2)), layer)

    # -------------------------------------------------------------- misc
    def grain(self, amount=2.6):
        arr = np.asarray(self.img).astype(np.float32)
        noise = np.random.normal(0, amount, arr.shape[:2])[..., None]
        self.img = Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8), "RGB")

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        self.img.resize((self.w, self.h), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("wrote out/" + name, f"{self.w}x{self.h}")


def header(a, y=88, x0=80, x1=1000):
    a.text(x0, y, BRAND, ANTON(32), INK, 3.5)
    wb = tw(BRAND, ANTON(32), 3.5)
    a.d.ellipse([(x0 + wb + 9) * S, (y - 9) * S, (x0 + wb + 19) * S, (y + 1) * S], fill=RED)
    a.text(x1, y, KICKER, INTER(19, 700), INK_SOFT, 3.2, anchor="r")
    a.rule(x0, y + 34, x1)


# ------------------------------------------------------------------ feed 4:5
def post_4x5(photo="flatlay_01.jpg", out="post_1080x1350.png",
             head1="EVERY DESIGN", head2="JUST $1",
             sub="Christmas PNG bundles  ·  instant download"):
    a = Art(1080, 1350)
    header(a)

    y = a.pill(540, 158, 54, "TODAY ONLY  ·  24 HOURS", INTER(22, 800), CREAM, RED, 3.0)

    # headline block, flow-computed from real cap heights
    s1 = fit_size(ANTON, head1, 940, 150, 2.0)
    s2 = fit_size(ANTON, head2, 960, 252, 1.0)
    cap1, cap2 = cap_height(ANTON(s1)), cap_height(ANTON(s2))

    base1 = y + 40 + cap1
    a.text(540, base1, head1, ANTON(s1), INK, 2.0, anchor="c")
    base2 = base1 + 0.10 * s1 + cap2
    a.text(540, base2, head2, ANTON(s2), RED, 1.0, anchor="c")

    y = base2 + 58
    a.was_price(540, y, 30)
    y += 46
    a.text(540, y, sub, INTER(29, 500), INK_SOFT, 0.4, anchor="c")
    y = a.pill(540, y + 22, 62, CTA, INTER(24, 800), CREAM, INK, 3.0, padx=44)

    a.photo([80, y + 46, 1000, 1264], os.path.join(ASSETS, photo), radius=24, focus=0.46)
    a.text(540, 1316, URL, INTER(24, 600), INK_SOFT, 2.2, anchor="c")
    a.sticker(944, y + 92, 74)
    a.grain()
    a.save(out)


# --------------------------------------------------------------- feed 1:1
def post_1x1():
    a = Art(1080, 1080)
    a.photo([60, 40, 1020, 466], os.path.join(ASSETS, "flatlay_01.jpg"), radius=22, focus=0.42)
    a.sticker(962, 424, 56)

    y = a.pill(540, 498, 50, "TODAY ONLY  ·  24 HOURS", INTER(20, 800), CREAM, RED, 2.6)

    s1 = fit_size(ANTON, "EVERY DESIGN", 950, 120, 1.6)
    s2 = fit_size(ANTON, "JUST $1", 950, 196, 1.0)
    base1 = y + 34 + cap_height(ANTON(s1))
    a.text(540, base1, "EVERY DESIGN", ANTON(s1), INK, 1.6, anchor="c")
    base2 = base1 + 0.08 * s1 + cap_height(ANTON(s2))
    a.text(540, base2, "JUST $1", ANTON(s2), RED, 1.0, anchor="c")

    a.was_price(540, base2 + 44, 25, "was $3", "SAVE 67%")
    y = a.pill(540, base2 + 68, 56, CTA, INTER(22, 800), CREAM, INK, 2.8, padx=40)
    a.text(540, y + 42, "SHOP:  " + URL, INTER(22, 600), INK_SOFT, 1.6, anchor="c")
    a.grain()
    a.save("post_1080x1080.png")


# ------------------------------------------------------------- story 9:16
def story():
    a = Art(1080, 1920)
    a.bleed_photo(os.path.join(ASSETS, "flatlay_portrait.jpg"), 1080, fade=230, focus=0.06)
    a.pill(540, 96, 52, "TODAY ONLY  ·  24 HOURS", INTER(21, 800), CREAM, RED, 3.0)

    s1 = fit_size(ANTON, "EVERY DESIGN", 900, 132, 2.4)
    base1 = 1232
    a.text(540, base1, "EVERY DESIGN", ANTON(s1), INK, 2.4, anchor="c")

    s2 = fit_size(ANTON, "JUST $1", 960, 300, 0.5)
    base2 = base1 + 26 + cap_height(ANTON(s2))
    a.text(540, base2, "JUST $1", ANTON(s2), RED, 0.5, anchor="c")

    a.was_price(540, base2 + 62, 30, "was $3", "SAVE 67%  ·  TODAY ONLY")
    y = a.pill(540, base2 + 104, 76, CTA, INTER(27, 800), CREAM, INK, 3.2, padx=54)
    a.text(540, 1856, URL, INTER(26, 600), INK_SOFT, 2.6, anchor="c")
    a.sticker(946, 962, 74)
    a.grain()
    a.save("story_1080x1920.png")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    np.random.seed(7)
    if which in ("all", "feed"):
        post_4x5()
        post_4x5(photo="flatlay_02.jpg", out="post_1080x1350_v2.png",
                 head1="CHRISTMAS PNG", head2="ONLY $1",
                 sub="Print-ready files  ·  instant download")
    if which in ("all", "square"):
        post_1x1()
    if which in ("all", "story"):
        story()
