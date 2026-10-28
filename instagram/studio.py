#!/usr/bin/env python3
"""
Small drawing kit shared by the Adzak Instagram posters.
Cream paper, Anton display type, Inter body type, supersampled 2x.
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(BASE, "assets", "fonts")
ASSETS = os.path.join(BASE, "assets")
OUT = os.path.join(BASE, "out")

S = 2  # supersampling

CREAM = (252, 247, 237)
CREAM_D = (242, 232, 214)
INK = (26, 20, 17)
INK_SOFT = (112, 100, 89)
RED = (191, 46, 39)
WHITE = (255, 255, 255)

BRAND = "ADZAK"
KICKER = "DIGITAL DOWNLOADS"
URL = "adzak-shop.fourthwall.com"
SHOP = "https://adzak-shop.fourthwall.com/"
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

    def rule(self, x0, y, x1, color=(*INK, 30), w=1.5):
        self.d.line([(x0 * S, y * S), (x1 * S, y * S)], fill=color, width=max(1, int(w * S)))

    def pill(self, cx, y0, h, s, f, fg, bg, track=0.0, padx=None):
        padx = padx if padx is not None else h * 0.55
        w = tw(s, f, track) + padx * 2
        self.d.rounded_rectangle([(cx - w / 2) * S, y0 * S, (cx + w / 2) * S, (y0 + h) * S],
                                 radius=h / 2 * S, fill=bg)
        self.text(cx, y0 + h / 2 + cap_height(f) / 2, s, f, fg, track, anchor="c")
        return y0 + h

    def headline(self, cx, base, s, max_w, start, fill, tracking=1.0):
        size = fit_size(ANTON, s, max_w, start, tracking)
        self.text(cx, base, s, ANTON(size), fill, tracking, anchor="c")
        return size

    def was_price(self, cx, base, size=30, prices="was $3", rest="SAVE 67%  ·  ENDS TONIGHT"):
        f = INTER(size, 800)
        fs = INTER(size * 0.95, 500)
        gap = size * 0.62
        w1, w2, w3 = tw(prices, fs, 1.0), tw("·", fs, 1.0), tw(rest, f, 1.6)
        x = cx - (w1 + w2 + w3 + gap * 2) / 2
        self.text(x, base, prices, fs, INK_SOFT, 1.0)
        self.d.line([(x - 2) * S, (base - size * 0.30) * S, (x + w1 + 2) * S, (base - size * 0.30) * S],
                    fill=RED, width=max(2, int(size * 0.085 * S)))
        self.text(x + w1 + gap, base, "·", fs, INK_SOFT, 1.0)
        self.text(x + w1 + gap + w2 + gap, base, rest, f, RED, 1.6)

    # ------------------------------------------------------------- images
    def _shadow(self, box, radius, dy=15, spread=20, alpha=58, blur=11):
        layer = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).rounded_rectangle(
            [box[0] * S, (box[1] + dy) * S, box[2] * S, (box[3] + spread) * S],
            radius=radius * S, fill=(62, 42, 26, alpha))
        self.img.paste(layer.filter(ImageFilter.GaussianBlur(blur * S)), (0, 0), layer)

    def photo(self, box, path, radius=24, shadow=True, focus=0.5, border=True):
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        im = Image.open(path).convert("RGB")
        scale = max(w / im.size[0], h / im.size[1])
        im = im.resize((int(im.size[0] * scale * S + 0.5), int(im.size[1] * scale * S + 0.5)), Image.LANCZOS)
        left = (im.size[0] - int(w * S)) // 2
        top = int((im.size[1] - h * S) * focus)
        im = im.crop((left, top, left + int(w * S), top + int(h * S)))
        mask = Image.new("L", im.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=radius * S, fill=255)
        if shadow:
            self._shadow(box, radius)
        self.img.paste(im, (int(x0 * S), int(y0 * S)), mask)
        if border:
            self.d.rounded_rectangle([v * S for v in box], radius=radius * S,
                                     outline=(255, 255, 255, 110), width=int(1.6 * S))

    def design(self, box, path, radius=20, pad=0, bg=WHITE):
        """product artwork, contained (never cropped) on a white card"""
        x0, y0, x1, y1 = box
        self._shadow(box, radius, dy=12, spread=16, alpha=52, blur=9)
        self.d.rounded_rectangle([v * S for v in box], radius=radius * S, fill=bg)
        try:
            im = Image.open(path).convert("RGBA")
        except Exception:
            return False
        inner_w, inner_h = (x1 - x0 - pad * 2) * S, (y1 - y0 - pad * 2) * S
        sc = min(inner_w / im.size[0], inner_h / im.size[1])
        im = im.resize((max(1, int(im.size[0] * sc)), max(1, int(im.size[1] * sc))), Image.LANCZOS)
        px = int(x0 * S + (inner_w - im.size[0]) / 2) + int(pad * S)
        py = int(y0 * S + (inner_h - im.size[1]) / 2) + int(pad * S)
        self.img.paste(im, (px, py), im)
        return True

    # ----------------------------------------------------------- details
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
        self.img.paste(layer.rotate(angle, resample=Image.BICUBIC, expand=False),
                       (int(cx * S - size / 2), int(cy * S - size / 2)), layer)

    def price_tag(self, cx, base, was="3", now="1", size=40):
        """small 'was $3  →  $1' unit used under each design"""
        fw = INTER(size * 0.62, 600)
        fn = ANTON(size)
        w_was = tw("$" + was, fw, 0.6)
        w_now = tw("$" + now, fn, 0.5)
        gap = size * 0.30
        x = cx - (w_was + gap + w_now) / 2
        self.text(x, base, "$" + was, fw, INK_SOFT, 0.6)
        self.d.line([(x - 2) * S, (base - size * 0.28) * S, (x + w_was + 2) * S, (base - size * 0.28) * S],
                    fill=RED, width=max(2, int(size * 0.075 * S)))
        self.text(x + w_was + gap, base, "$" + now, fn, RED, 0.5)

    def qr(self, box, url=SHOP, fill=INK, bg=CREAM):
        import qrcode
        q = qrcode.QRCode(border=1, box_size=10,
                          error_correction=qrcode.constants.ERROR_CORRECT_M)
        q.add_data(url)
        q.make(fit=True)
        im = q.make_image(fill_color=fill, back_color=bg).convert("RGB")
        w, h = int((box[2] - box[0]) * S), int((box[3] - box[1]) * S)
        im = im.resize((w, h), Image.NEAREST)
        self.img.paste(im, (int(box[0] * S), int(box[1] * S)))

    def grain(self, amount=2.6):
        arr = np.asarray(self.img).astype(np.float32)
        noise = np.random.normal(0, amount, arr.shape[:2])[..., None]
        self.img = Image.fromarray(np.clip(arr + noise, 0, 255).astype(np.uint8), "RGB")

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        self.img.resize((self.w, self.h), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("wrote out/" + name, f"{self.w}x{self.h}")


def header(a, y=84, x0=80, x1=1000, right=KICKER, rule=True):
    a.text(x0, y, BRAND, ANTON(30), INK, 3.4)
    wb = tw(BRAND, ANTON(30), 3.4)
    a.d.ellipse([(x0 + wb + 9) * S, (y - 8) * S, (x0 + wb + 18) * S, (y + 1) * S], fill=RED)
    a.text(x1, y, right, INTER(18, 700), INK_SOFT, 3.0, anchor="r")
    if rule:
        a.rule(x0, y + 32, x1)
    return y + 32


def load_products(folder=None):
    """[(path, title)] from the collected images, manifest order first"""
    import json
    folder = folder or os.path.join(ASSETS, "products")
    if not os.path.isdir(folder):
        return []
    manifest = os.path.join(folder, "_manifest.json")
    out, seen = [], set()
    if os.path.exists(manifest):
        try:
            for item in json.load(open(manifest)):
                if item.get("file"):
                    p = os.path.join(folder, item["file"])
                    if os.path.exists(p):
                        out.append((p, item.get("title", "")))
                        seen.add(os.path.basename(p))
        except Exception as e:
            print("manifest error:", e)
    for f in sorted(os.listdir(folder)):
        if f.startswith("_") or f.rsplit(".", 1)[-1].lower() not in ("webp", "png", "jpg", "jpeg"):
            continue
        if f not in seen:
            out.append((os.path.join(folder, f), ""))
    return out
