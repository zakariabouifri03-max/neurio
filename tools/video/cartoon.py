#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bash Baqi Racing — cartoon beach-buggy short film.
Vertical 1080x1920, 24 fps, 60 s (1440 frames), rendered with Pillow.

  python3 tools/video/cartoon.py --preview 3,10,22,35,47,55
  python3 tools/video/cartoon.py --start 0 --end 1440 --outdir /tmp/frames --workers 2
"""
import argparse
import math
import os
import random
import subprocess
import time as _time
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageChops, ImageFilter, ImageFont
from arabic_reshaper import reshape as ar_reshape
from bidi.algorithm import get_display

# ----------------------------------------------------------------------------
# constants
# ----------------------------------------------------------------------------
FPS = 24
DUR = 60.0
NFRAMES = int(FPS * DUR)          # 1440
W, H = 1080, 1920                 # final delivery size
SS = 1.5                          # supersample factor (render 1620x2880)

HORIZON = 760.0                   # sky / sea line
SEA_TOP = 760.0
SEA_BOT = 1140.0                  # sea / sand line

INK = (38, 27, 48)
WHITE = (255, 255, 255)
CREAM = (255, 248, 232)

SAND = (247, 214, 152)
SAND_D = (231, 186, 116)
SAND_L = (255, 236, 190)

PALM_LEAF = (74, 176, 96)
PALM_LEAF_D = (46, 138, 74)
PALM_TRUNK = (150, 100, 62)
PALM_TRUNK_D = (120, 76, 46)

HERO_BODY = (255, 96, 64)
HERO_BODY_D = (214, 62, 40)
RIVAL_BODY = (72, 138, 236)
RIVAL_BODY_D = (44, 96, 186)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

_FONTS = {}


def font(size, bold=True):
    k = (int(size * SS), bold)
    if k not in _FONTS:
        _FONTS[k] = ImageFont.truetype(FONT_BOLD if bold else FONT_REG, k[0])
    return _FONTS[k]


def ar(text):
    """Shape + bidi-reorder an Arabic string for Pillow."""
    return get_display(ar_reshape(text))


# ----------------------------------------------------------------------------
# easy maths
# ----------------------------------------------------------------------------
def clamp(v, a=0.0, b=1.0):
    return a if v < a else (b if v > b else v)


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_c(c1, c2, t):
    return tuple(int(lerp(c1[i], c2[i], t)) for i in range(3))


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def ease_out(t, p=3.0):
    return 1 - (1 - clamp(t)) ** p


def ease_in(t, p=3.0):
    return clamp(t) ** p


def ease_out_back(t, s=1.9):
    t = clamp(t) - 1.0
    return t * t * ((s + 1) * t + s) + 1.0


def ease_in_out(t):
    t = clamp(t)
    return 3 * t * t - 2 * t * t * t


def seq(t0, t1, t):
    """normalised progress between two times"""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))


def bob(t, amp=1.0, freq=1.0, phase=0.0):
    return amp * math.sin(t * freq * math.tau + phase)


# ----------------------------------------------------------------------------
# pen: draws in 1080x1920 space onto a supersampled canvas
# ----------------------------------------------------------------------------
class Pen:
    def __init__(self, draw, s=SS):
        self.d = draw
        self.s = s

    # -- coordinate helpers
    def _b(self, box):
        s = self.s
        return (box[0] * s, box[1] * s, box[2] * s, box[3] * s)

    def _p(self, pts):
        s = self.s
        return [(p[0] * s, p[1] * s) for p in pts]

    def _w(self, w):
        return max(1, int(round(w * self.s)))

    # -- primitives
    def rect(self, box, fill=None, outline=None, width=1):
        self.d.rectangle(self._b(box), fill=fill, outline=outline, width=self._w(width))

    def rrect(self, box, r, fill=None, outline=None, width=1):
        self.d.rounded_rectangle(self._b(box), r * self.s, fill=fill,
                                 outline=outline, width=self._w(width))

    def ellipse(self, box, fill=None, outline=None, width=1):
        self.d.ellipse(self._b(box), fill=fill, outline=outline, width=self._w(width))

    def circle(self, x, y, r, fill=None, outline=None, width=1):
        self.ellipse((x - r, y - r, x + r, y + r), fill=fill, outline=outline, width=width)

    def poly(self, pts, fill=None):
        self.d.polygon(self._p(pts), fill=fill)

    def poly_out(self, pts, fill, ol=INK, w=6.0):
        """filled polygon with a cartoon ink outline of width w"""
        p = self._p(pts)
        self.d.polygon(p, fill=fill)
        if ol is not None:
            self.d.line(p + [p[0]], fill=ol, width=self._w(w), joint="curve")

    def line(self, pts, w=6.0, fill=INK, joint="curve"):
        self.d.line(self._p(pts), fill=fill, width=self._w(w), joint=joint)

    def arc(self, box, a0, a1, w=6.0, fill=INK):
        self.d.arc(self._b(box), a0, a1, fill=fill, width=self._w(w))

    def pieslice(self, box, a0, a1, fill=None, outline=None, w=1):
        self.d.pieslice(self._b(box), a0, a1, fill=fill, outline=outline, width=self._w(w))

    def comp(self, layer, xy=(0, 0)):
        """alpha-composite an RGBA sub-layer onto the main canvas"""
        base = self.d._image
        base.alpha_composite(layer, (int(xy[0]), int(xy[1])))
        self.d = ImageDraw.Draw(base)

    def text(self, xy, s, size, fill=WHITE, anchor="mm", ink=INK, sw=0.0, bold=True):
        self.d.text((xy[0] * self.s, xy[1] * self.s), s, font=font(size, bold),
                    fill=fill, anchor=anchor, stroke_width=self._w(sw) if sw else 0,
                    stroke_fill=ink)

    def text_size(self, s, size, bold=True):
        return font(size, bold).getbbox(s)[2:]


# ----------------------------------------------------------------------------
# layers / compositing helpers
# ----------------------------------------------------------------------------
def new_layer():
    img = Image.new("RGBA", (int(W * SS), int(H * SS)), (0, 0, 0, 0))
    return img, Pen(ImageDraw.Draw(img))


def paste_layer(base, layer):
    return Image.alpha_composite(base, layer)


def silhouette(bbox, draw_fn, fill, ink=INK, w=7.0):
    """Render a silhouette with an ink outline.

    The drawing happens in global (1080x1920) coordinates; the shape is baked into a
    padded RGBA tile.  Returns (image, paste_offset) — pass both to Pen.comp().
    """
    pad = int(max(2.0, w * SS * 2.4))          # room for the outline
    x0, y0, x1, y1 = [int(v * SS) for v in bbox]
    w_ = max(1, x1 - x0) + pad * 2
    h_ = max(1, y1 - y0) + pad * 2
    mask = Image.new("L", (w_, h_), 0)
    ox, oy = x0 - pad, y0 - pad

    class LocalPen(Pen):
        def _b(self, box):
            return ((box[0] * self.s - ox), (box[1] * self.s - oy),
                    (box[2] * self.s - ox), (box[3] * self.s - oy))

        def _p(self, pts):
            return [(p[0] * self.s - ox, p[1] * self.s - oy) for p in pts]

        def circle(self, x, y, r, fill=None, outline=None, width=1):
            self.ellipse((x - r, y - r, x + r, y + r), fill=255)

        def ellipse(self, box, fill=None, outline=None, width=1):
            self.d.ellipse(self._b(box), fill=255)

        def rect(self, box, fill=None, outline=None, width=1):
            self.d.rectangle(self._b(box), fill=255)

        def rrect(self, box, r, fill=None, outline=None, width=1):
            self.d.rounded_rectangle(self._b(box), r * self.s, fill=255)

        def poly(self, pts, fill=None):
            self.d.polygon(self._p(pts), fill=255)

    lp = LocalPen(ImageDraw.Draw(mask), s=SS)
    draw_fn(lp, 255)
    if not np.array(mask).any():
        raise RuntimeError("silhouette(): nothing was drawn")

    k = max(1, int(round(w * SS)))
    eroded = mask.filter(ImageFilter.MinFilter(k * 2 + 1))
    ring = ImageChops.subtract(mask, eroded)
    m = np.array(mask)
    r = np.array(ring)
    out = np.zeros((h_, w_, 4), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = fill
    out[m > 0] = (*fill, 255)
    out[r > 0] = (*ink, 255)
    out[..., 3] = np.maximum(m, r)
    return Image.fromarray(out, "RGBA"), (ox, oy)


def grad_v(size, c_top, c_mid, c_bot, stops=(0.0, 0.55, 1.0)):
    """vertical 3-stop gradient numpy -> Image of exactly `size`"""
    w, h = size
    ys = np.linspace(0, 1, h, dtype=np.float32)
    s0, s1, s2 = stops
    top = np.array(c_top, dtype=np.float32)[None, :]
    mid = np.array(c_mid, dtype=np.float32)[None, :]
    bot = np.array(c_bot, dtype=np.float32)[None, :]
    t1 = np.clip((ys - s0) / max(1e-6, s1 - s0), 0, 1)[:, None]
    t2 = np.clip((ys - s1) / max(1e-6, s2 - s1), 0, 1)[:, None]
    low = top + (mid - top) * t1
    high = mid + (bot - mid) * t2
    col = np.where((ys < s1)[:, None], low, high)          # (h, 3)
    arr = np.repeat(col[:, None, :], w, axis=1)            # (h, w, 3)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


_GRAD_CACHE = {}


def grad_cached(key, c_top, c_mid, c_bot):
    if key not in _GRAD_CACHE:
        _GRAD_CACHE[key] = grad_v((int(W * SS), int(H * SS)), c_top, c_mid, c_bot)
    return _GRAD_CACHE[key]


MOODS = {
    #           sky top            sky mid             sky bottom (horizon glow)
    "dawn":   ((72, 78, 148),      (162, 122, 178),   (255, 176, 132)),
    "day":    ((54, 152, 224),     (128, 206, 240),   (208, 240, 250)),
    "golden": ((52, 96, 190),      (222, 146, 120),   (255, 208, 138)),
    "dusk":   ((44, 34, 92),       (146, 62, 122),    (255, 140, 96)),
    "blaze":  ((70, 46, 140),      (228, 96, 96),     (255, 186, 96)),
}


def sea_color(mood):
    return {
        "dawn": ((58, 96, 156), (96, 150, 196)),
        "day": ((48, 158, 190), (110, 206, 220)),
        "golden": ((56, 108, 168), (128, 168, 200)),
        "dusk": ((44, 54, 118), (110, 92, 150)),
        "blaze": ((58, 62, 140), (140, 118, 170)),
    }[mood]


def sand_color(mood):
    return {
        "dawn": ((238, 198, 158), (216, 168, 124)),
        "day": (SAND, SAND_D),
        "golden": ((250, 200, 132), (226, 168, 104)),
        "dusk": ((196, 150, 128), (166, 118, 108)),
        "blaze": ((244, 186, 128), (214, 146, 100)),
    }[mood]


# ----------------------------------------------------------------------------
# background pieces
# ----------------------------------------------------------------------------
def sun(p, x, y, r, t, mood, glow=1.0, rays=True):
    img = p.d._image if hasattr(p.d, "_image") else None
    # glow
    if glow > 0:
        g, gp = new_layer()
        gp.circle(x, y, r * 2.5, fill=(255, 240, 190, int(90 * glow)))
        g = g.filter(ImageFilter.GaussianBlur(int(60 * SS)))
        p_img = p.d._image
        p_img.alpha_composite(g)
        p.d = ImageDraw.Draw(p_img)
    p.circle(x, y, r * (1.03 + 0.012 * math.sin(t * 2.0)), fill=(255, 226, 118))
    p.circle(x, y, r * 0.86, fill=(255, 246, 180))
    p.circle(x - r * 0.28, y - r * 0.25, r * 0.42, fill=(255, 255, 214))
    if rays:
        for i in range(10):
            a = t * 0.25 + i * math.tau / 10
            r0, r1 = r * 1.28, r * (1.5 + 0.06 * math.sin(t * 3 + i))
            p.line([(x + math.cos(a) * r0, y + math.sin(a) * r0),
                    (x + math.cos(a) * r1, y + math.sin(a) * r1)],
                   w=7, fill=(255, 236, 150))


def cloud(p, x, y, s, t, alpha=255, ink=INK):
    def shape(lp, col):
        lp.rrect((x - 0.92 * s, y - 0.04 * s, x + 0.92 * s, y + 0.30 * s), 0.17 * s)
        lp.circle(x - 0.56 * s, y + 0.02 * s, 0.26 * s)
        lp.circle(x + 0.58 * s, y + 0.04 * s, 0.24 * s)
        lp.circle(x - 0.14 * s, y - 0.16 * s, 0.30 * s)
        lp.circle(x + 0.24 * s, y - 0.10 * s, 0.26 * s)
        lp.circle(x - 0.02 * s, y - 0.34 * s, 0.22 * s)

    bbox = (x - 1.0 * s, y - 0.72 * s, x + 1.0 * s, y + 0.44 * s)
    lay, xy = silhouette(bbox, shape, fill=(255, 255, 255), ink=ink, w=4.6)
    if alpha < 255:
        lay.putalpha(lay.getchannel("A").point(lambda v: int(v * alpha / 255)))
    p.comp(lay, xy)


def seagull(p, x, y, s, t, phase=0.0):
    flap = math.sin(t * 6.0 + phase)
    wing = 0.55 * s * flap
    pts_l = [(x - s, y - wing * 0.6), (x - s * 0.45, y + s * 0.05), (x, y)]
    pts_r = [(x + s, y - wing * 0.6), (x + s * 0.45, y + s * 0.05), (x, y)]
    p.line(pts_l, w=max(2.0, s * 0.13), fill=(255, 255, 255))
    p.line(pts_r, w=max(2.0, s * 0.13), fill=(255, 255, 255))
    p.line([(x - s * 0.98, y - wing * 0.58), (x - s * 0.55, y - 0.1 * s)], w=max(1.6, s * 0.10), fill=INK)
    p.line([(x + s * 0.98, y - wing * 0.58), (x + s * 0.55, y - 0.1 * s)], w=max(1.6, s * 0.10), fill=INK)


def sky(img, p, mood, t, scroll=0.0, stars=0.0):
    key = mood
    base = grad_cached(key, *MOODS[mood])
    img.paste(base, (0, 0))
    if stars > 0:
        rnd = random.Random(7)
        sl, sp = new_layer()
        for _ in range(90):
            sx = rnd.uniform(0, W)
            sy = rnd.uniform(0, HORIZON * 0.75)
            rr = rnd.uniform(1.4, 3.4)
            tw = 0.55 + 0.45 * math.sin(t * 2.2 + sx)
            a = int(255 * clamp(stars) * tw)
            sp.circle(sx, sy, rr, fill=(255, 255, 240, a))
        p.comp(sl)
    # sun
    sx = 700 - 0.0
    if mood == "dawn":
        sun(p, 470, lerp(1180, 830, smooth(seq(0, 5.0, t))), 130, t, mood, glow=0.9)
    elif mood == "day":
        sun(p, 840, 210 + bob(t, 12, 0.12), 120, t, mood, glow=0.75, rays=True)
    elif mood == "golden":
        sun(p, 760, 640 + bob(t, 8, 0.2), 150, t, mood, glow=1.0)
    elif mood == "dusk":
        sun(p, 640, lerp(700, 980, smooth(seq(1.0, 7.0, t))), 140, t, mood, glow=1.0)
    else:
        sun(p, 760, 300, 130, t, mood, glow=0.8)
    # clouds
    clouds = [
        (180, 250, 110, 14.0, 0.10),
        (820, 170, 84, 19.0, 0.22),
        (520, 420, 130, 12.0, 0.0),
        (1010, 520, 96, 16.0, 0.34),
        (-60, 560, 120, 11.0, 0.5),
        (300, 640, 74, 21.0, 0.66),
    ]
    for cx, cy, cs, csp, ph in clouds:
        cxx = ((cx - scroll * 0.12 * csp + t * 6.0) % (W + 700)) - 350
        yoff = bob(t, 8, 0.25, ph * 6.28)
        cloud(p, cxx, cy + yoff, cs, t, ink=INK)


def sea(img, p, mood, t, scroll, waves=1.0, sun_x=760.0, glitter=1.0):
    c1, c2 = sea_color(mood)
    p.rect((0, SEA_TOP, W, SEA_BOT), fill=c1)
    # horizon shimmer
    p.rect((0, SEA_TOP, W, SEA_TOP + 70), fill=lerp_c(c1, (255, 255, 255), 0.30))
    # depth bands (far -> near)
    for i in range(6):
        k = (i + 1) / 6.0
        yy = lerp(SEA_TOP + 40, SEA_BOT - 30, k * k * 0.9 + 0.05)
        col = lerp_c(c1, c2, k * 0.7)
        pts = [(xx, yy + 8 * math.sin(xx * 0.011 + i * 1.9 + t * 0.5)) for xx in range(-60, W + 120, 60)]
        pts += [(W + 120, SEA_BOT + 20), (-60, SEA_BOT + 20)]
        p.poly(pts, fill=col)
    # wave crests: irregular
    rnd = random.Random(17)
    rows = 7
    for row in range(rows):
        depth = (row + 1) / rows
        yy = lerp(SEA_TOP + 90, SEA_BOT - 60, depth ** 0.85)
        amp = lerp(2.5, 13, depth) * waves
        seg = lerp(90, 230, depth)
        off = (t * lerp(16, 70, depth) + scroll * lerp(0.05, 0.22, depth)) % seg
        n = int(W / seg) + 4
        col = lerp_c(lerp_c(c1, (255, 255, 255), 0.42), c2, depth * 0.45)
        for i in range(n):
            x = i * seg - off + rnd.uniform(-18, 18)
            ln = seg * rnd.uniform(0.42, 0.85)
            p.arc((x, yy - amp * 2.4, x + ln, yy + amp * 2.4), 195, 345,
                  w=max(2.0, lerp(3.5, 8.5, depth)), fill=col)
    # sun glitter path on the water
    if glitter > 0:
        gl, gp = new_layer()
        rr = random.Random(5)
        for row in range(13):
            k = row / 12.0
            yy = lerp(SEA_TOP + 55, SEA_BOT - 45, k ** 0.75)
            spread = lerp(26, 300, k)
            n = int(lerp(2, 9, k))
            for i in range(n):
                gx = sun_x + rr.uniform(-spread, spread) * 0.75
                gw = lerp(12, 80, k) * rr.uniform(0.45, 1.25)
                a = int(170 * (0.30 + 0.70 * k) * (0.45 + 0.55 * math.sin(t * 3.4 + i * 1.7 + row * 0.9)))
                gp.ellipse((gx - gw, yy - 3 - 4 * k, gx + gw, yy + 3 + 4 * k),
                           fill=(255, 255, 255, max(0, a)))
        p.comp(gl)
    # foam at the shore
    p.rect((0, SEA_BOT - 14, W, SEA_BOT + 6), fill=(252, 252, 246))
    foam, fp = new_layer()
    rr2 = random.Random(23)
    for i in range(16):
        fx = (i * 173 + 60 * math.sin(t * 1.6 + i) - scroll * 0.3) % (W + 200) - 100
        fp.circle(fx, SEA_BOT + 2 + rr2.uniform(-4, 6), rr2.uniform(10, 26), fill=(255, 255, 255, 210))
    p.comp(foam)


def sand(img, p, mood, t, scroll, wet=1.0):
    c1, c2 = sand_color(mood)
    p.rect((0, SEA_BOT, W, H), fill=c1)
    # wet strip near water
    if wet > 0:
        p.rect((0, SEA_BOT, W, SEA_BOT + 70), fill=lerp_c(c1, c2, 0.55))
    # dune shadow line
    pts = []
    for i in range(0, W + 40, 40):
        xx = i - (scroll * 0.25) % 40
        pts.append((xx, lerp(SEA_BOT + 210, SEA_BOT + 250, 0.5 + 0.5 * math.sin(xx * 0.004 + 1.2))))
    pts += [(W + 40, H), (-40, H)]
    p.poly(pts, fill=c2)
    # pebbles / shells
    rnd = random.Random(11)
    for i in range(120):
        bx = rnd.uniform(0, W)
        by = rnd.uniform(SEA_BOT + 120, H)
        depth = (by - SEA_BOT) / (H - SEA_BOT)
        xx = (bx - scroll * lerp(0.35, 1.15, depth)) % W
        s = lerp(3.0, 9.0, depth)
        kind = i % 4
        col = lerp_c(c2, (255, 255, 255), 0.55) if kind else lerp_c(c2, INK, 0.35)
        if kind == 0:
            p.circle(xx, by, s * 0.75, fill=col)
        elif kind == 1:
            p.line([(xx - s, by), (xx + s, by)], w=2.6, fill=col)
        elif kind == 2:
            p.circle(xx, by, s * 0.5, fill=(255, 190, 160))       # tiny shell
        else:
            p.line([(xx, by - s * 0.5), (xx, by + s * 0.5)], w=2.2, fill=col)


def _qbez(p0, p1, p2, u):
    ax, ay = lerp(p0[0], p1[0], u), lerp(p0[1], p1[1], u)
    bx, by = lerp(p1[0], p2[0], u), lerp(p1[1], p2[1], u)
    return (lerp(ax, bx, u), lerp(ay, by, u))


def frond(p, cx, cy, ang, length, droop, w_max, col, col_d, outline=INK, ow=3.4):
    """tapered drooping palm leaf, ribbed"""
    p0 = (cx, cy)
    p1 = (cx + math.cos(ang) * length * 0.55, cy + math.sin(ang) * length * 0.42)
    p2 = (cx + math.cos(ang) * length, cy + math.sin(ang) * length * 0.30 + droop)
    left, right, spine = [], [], []
    N = 8
    for i in range(N + 1):
        u = i / N
        x, y = _qbez(p0, p1, p2, u)
        nx, ny = -(p2[1] - p0[1]), (p2[0] - p0[0])
        nl = math.hypot(nx, ny) or 1.0
        nx, ny = nx / nl, ny / nl
        w = w_max * math.sin(math.pi * min(1.0, 0.10 + u * 0.9)) ** 0.60
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
        spine.append((x, y))
    p.poly_out(left + right[::-1], fill=col, ol=outline, w=ow)
    p.line(spine, w=max(1.5, w_max * 0.16), fill=col_d)


def palm(p, x, y, s, t, dark=False, sway=1.0):
    leaf = (30, 84, 62) if dark else PALM_LEAF
    leafb = (20, 62, 50) if dark else PALM_LEAF_D
    trunk = (62, 46, 54) if dark else PALM_TRUNK
    trunkd = (38, 28, 36) if dark else PALM_TRUNK_D
    rnd = random.Random(int(x * 7 + y * 3))

    lean = 52 * s * sway
    topx = x + lean + 12 * s * sway * math.sin(t * 0.75 + x * 0.01)
    topy = y - 330 * s
    ctrl = (x + lean * 0.35, y - 190 * s)

    # ---- back fronds
    for i in range(4):
        a = math.radians(-176 + i * 46 + 6 * math.sin(t * 0.9 + i))
        ln = lerp(120, 190, rnd.random()) * s
        frond(p, topx, topy, a, ln, ln * 0.62, 26 * s, leafb, lerp_c(leafb, INK, 0.35))

    # ---- trunk (tapered, leaning)
    left, right, spine = [], [], []
    N = 12
    for i in range(N + 1):
        u = i / N
        px, py = _qbez((x, y), ctrl, (topx, topy), u)
        w = 25 * s * (1 - 0.42 * u)
        left.append((px - w, py))
        right.append((px + w, py))
        spine.append((px, py))
    p.poly_out(left + right[::-1], fill=trunk, ol=INK, w=6 * s)
    for i in range(2, N, 2):                      # trunk rings
        u = i / N
        px, py = _qbez((x, y), ctrl, (topx, topy), u)
        w = 25 * s * (1 - 0.42 * u)
        p.line([(px - w * 0.95, py), (px + w * 0.9, py - 4 * s)], w=max(1.5, 2.3 * s), fill=trunkd)

    # ---- coconuts
    for dx, dy in ((-17, 4), (15, 2), (-2, 17)):
        p.circle(topx + dx * s, topy + dy * s, 13 * s, fill=(126, 84, 52), outline=INK, width=3.0 * s)

    # ---- front fronds
    for i in range(5):
        a = math.radians(-168 + 12 + i * 36 + 7 * math.sin(t * 1.1 + i * 1.7))
        ln = lerp(150, 235, rnd.random()) * s
        frond(p, topx, topy, a, ln, ln * 0.58, 30 * s,
              leaf if i % 2 else lerp_c(leaf, (255, 255, 255), 0.10), leafb)
    # crown
    p.circle(topx, topy + 6 * s, 17 * s, fill=leafb, outline=INK, width=3.4 * s)


def island(p, x, y, s, t, mood):
    """little distant island with palms"""
    def shape(lp, col):
        lp.ellipse((x - 200 * s, y - 60 * s, x + 200 * s, y + 45 * s))

    lay, xy = silhouette((x - 230 * s, y - 95 * s, x + 230 * s, y + 70 * s),
                         shape, fill=(226, 200, 150), ink=INK, w=5.0)
    p.comp(lay, xy)
    palm(p, x - 40 * s, y - 22 * s, 0.30 * s, t, dark=False, sway=0.5)
    palm(p, x + 60 * s, y - 14 * s, 0.36 * s, t, dark=False, sway=0.35)


# ----------------------------------------------------------------------------
# the buggy
# ----------------------------------------------------------------------------
def wheel(p, x, y, r, spin, t, dark=False):
    tire = (44, 40, 52)
    rim = (232, 200, 96) if not dark else (150, 130, 90)
    hub = (250, 240, 220) if not dark else (180, 176, 170)
    p.circle(x, y, r + 7, fill=INK)
    p.circle(x, y, r, fill=tire)
    p.circle(x, y, r * 0.92, fill=(62, 56, 70))
    # treads
    for i in range(10):
        a = spin + i * math.tau / 10
        p.line([(x + math.cos(a) * r * 0.86, y + math.sin(a) * r * 0.86),
                (x + math.cos(a) * r * 0.99, y + math.sin(a) * r * 0.99)],
               w=max(2.0, r * 0.10), fill=(30, 26, 38))
    p.circle(x, y, r * 0.55, fill=rim, outline=INK, width=max(2.0, r * 0.075))
    # spokes
    for i in range(5):
        a = spin + i * math.tau / 5
        p.line([(x + math.cos(a) * r * 0.12, y + math.sin(a) * r * 0.12),
                (x + math.cos(a) * r * 0.46, y + math.sin(a) * r * 0.46)],
               w=max(2.2, r * 0.10), fill=INK)
    p.circle(x, y, r * 0.18, fill=hub, outline=INK, width=max(1.8, r * 0.06))


def draw_buggy(p, x, y, s, t, angle=0.0, spin=0.0, body=HERO_BODY, body_d=HERO_BODY_D,
               driver=True, exhaust=True, arm_up=False, dark=False, shadow=1.0):
    """Side-view cartoon beach buggy. (x, y) = contact point of wheels. angle in degrees
    (positive = nose up / counter-clockwise). s = scale (1.0 -> ~330 px long)."""
    ang = math.radians(angle)
    ca, sa = math.cos(ang), math.sin(ang)

    def P(px, py):
        """local (front+, up-) -> canvas"""
        px, py = px * s, py * s
        return (x + px * ca - py * sa, y + px * sa + py * ca)

    rw_r, fw_r = 72 * s, 54 * s
    rear = P(-96, -rw_r)
    front = P(104, -fw_r)

    # soft contact shadow (scales with the height above the ground, given by `shadow`)
    if shadow > 0.01:
        sh, shp = new_layer()
        shp.ellipse((x - 210 * s * shadow, y - 26 * s * shadow, x + 190 * s * shadow,
                     y + 30 * s * shadow), fill=(120, 88, 60, int(120 * shadow)))
        sh = sh.filter(ImageFilter.GaussianBlur(int(9 * s * SS)))
        p.comp(sh)

    wheel(p, rear[0], rear[1], rw_r, spin, t, dark)
    if not dark:
        pass
    wheel(p, front[0], front[1], fw_r, spin * 1.25, t, dark)

    # suspension arms
    p.line([P(-96, -rw_r - 6), P(-40, -120)], w=11 * s, fill=INK)
    p.line([P(104, -fw_r - 6), P(58, -104)], w=10 * s, fill=INK)

    # chassis
    chassis = [P(-150, -86), P(-120, -150), P(-40, -168), P(30, -160),
               P(96, -128), P(150, -120), P(150, -74), P(60, -62), P(-90, -60)]
    p.poly_out(chassis, fill=body, ol=INK, w=7 * s)
    # lower shading
    p.poly_out([P(-140, -78), P(140, -74), P(150, -60), P(-80, -58)], fill=body_d, ol=None)

    # side stripe / number plate
    p.poly_out([P(-70, -132), P(20, -136), P(26, -108), P(-64, -104)], fill=CREAM, ol=INK, w=5 * s)
    p.circle(*(P(-22, -120)), 0 + 24 * s, fill=(255, 255, 255), outline=INK, width=4 * s)
    p.text(P(-22, -121), "7", 40 * s, fill=INK)

    # engine block + exhaust
    if exhaust:
        p.poly_out([P(-150, -140), P(-100, -150), P(-96, -92), P(-146, -86)], fill=(196, 200, 210), ol=INK, w=6 * s)
        for i in range(3):
            p.line([P(-146 + i * 14, -140), P(-146 + i * 14, -96)], w=4 * s, fill=(150, 154, 166))
        p.line([P(-152, -70), P(-196, -58), P(-214, -74)], w=13 * s, fill=(170, 174, 186))
        p.line([P(-152, -70), P(-196, -58), P(-214, -74)], w=4.0, fill=INK)

    # cockpit + driver
    if driver:
        p.poly_out([P(-70, -160), P(-10, -168), P(20, -160), P(16, -120), P(-66, -118)],
                   fill=body_d, ol=INK, w=6 * s)
        # body
        p.poly_out([P(-56, -150), P(-4, -152), P(-2, -122), P(-58, -120)], fill=(252, 214, 166), ol=INK, w=5 * s)
        # helmet
        hx, hy = P(-30, -186)
        p.circle(hx, hy, 34 * s, fill=(250, 250, 250), outline=INK, width=6 * s)
        p.pieslice((hx - 34 * s, hy - 34 * s, hx + 34 * s, hy + 34 * s), 300, 60,
                   fill=(255, 96, 64))
        p.pieslice((hx - 34 * s, hy - 34 * s, hx + 34 * s, hy + 34 * s), 300, 60, outline=INK, w=5 * s)
        p.circle(*(P(-22, -184)), 0 + 9 * s, fill=(60, 90, 220), outline=INK, width=3 * s)
        # goggles visor
        p.poly_out([P(-14, -196), P(6, -198), P(8, -178), P(-12, -176)], fill=(60, 210, 240), ol=INK, w=4 * s)
        # arms
        if arm_up:
            p.line([P(-24, -150), P(-6, -196), P(16, -224)], w=13 * s, fill=(252, 214, 166))
            p.line([P(-24, -150), P(-6, -196), P(16, -224)], w=3.5, fill=INK)
            p.circle(*(P(18, -230)), 0 + 11 * s, fill=(252, 214, 166), outline=INK, width=4 * s)
        else:
            p.line([P(-20, -148), P(16, -150)], w=13 * s, fill=(252, 214, 166))
            p.line([P(-20, -148), P(16, -150)], w=3.5, fill=INK)
            p.circle(*(P(20, -150)), 0 + 11 * s, fill=(252, 214, 166), outline=INK, width=4 * s)
        # steering wheel
        swx, swy = P(28, -164)
        p.line([(swx + 0, swy + 10 * s), (swx, swy + 40 * s)], w=7 * s, fill=(60, 56, 70))
        p.arc((swx - 26 * s, swy - 26 * s, swx + 26 * s, swy + 26 * s), 200, 340, w=10 * s, fill=INK)

    # roll cage
    p.line([P(-76, -168), P(-30, -232), P(30, -230), P(70, -172)], w=15 * s, fill=(238, 238, 244))
    p.line([P(-76, -168), P(-30, -232), P(30, -230), P(70, -172)], w=4.5, fill=INK)
    p.line([P(-52, -196), P(24, -196)], w=11 * s, fill=(238, 238, 244))
    p.line([P(-52, -196), P(24, -196)], w=3.5, fill=INK)

    # headlight + bumper
    hx2, hy2 = P(150, -100)
    p.circle(hx2, hy2, 15 * s, fill=(255, 246, 190), outline=INK, width=5 * s)
    p.circle(hx2 - 4 * s, hy2 - 3 * s, 6 * s, fill=(255, 255, 240))

    # front flag / antenna
    ax, ay = P(-150, -150)
    p.line([(ax, ay), (ax - 2 * s, ay - 130 * s)], w=6 * s, fill=INK)
    fl = 46 * s
    wave = 8 * s * math.sin(t * 5.0)
    flag = [(ax - 2 * s, ay - 130 * s), (ax + fl, ay - 122 * s + wave),
            (ax + fl, ay - 86 * s + wave), (ax - 2 * s, ay - 96 * s)]
    p.poly_out(flag, fill=(255, 210, 80), ol=INK, w=5 * s)


# ----------------------------------------------------------------------------
# fx
# ----------------------------------------------------------------------------
def dust_puff(p, x, y, r, alpha):
    """NB: draw onto a dedicated transparent layer, then p.comp() it."""
    if alpha <= 0.02 or r <= 1:
        return
    col = (246, 228, 196, int(clamp(alpha) * 205))
    p.circle(x, y, r, fill=col)
    p.circle(x - r * 0.7, y + r * 0.3, r * 0.62, fill=col)
    p.circle(x + r * 0.75, y + r * 0.25, r * 0.55, fill=col)
    p.circle(x, y - r * 0.6, r * 0.5, fill=col)


def dust_trail(p, t, x, y, s, rate=11.0, life=0.85, spread=1.0):
    dl, dp = new_layer()
    n = int(life / (1.0 / rate)) + 2
    base = int(t * rate)
    for i in range(n):
        idx = base - i
        if idx < 0:
            continue
        age = t - idx / rate
        if age < 0 or age > life:
            continue
        u = age / life
        rnd = random.Random(idx * 977)
        jitter = rnd.uniform(-1, 1)
        px = x - (60 + 210 * ease_out(u, 2.0)) * s * spread
        py = y - (10 + 90 * ease_out(u, 1.6)) * s - jitter * 26 * s * u
        r = (14 + 52 * ease_out(u, 1.4)) * s * spread
        dust_puff(dp, px, py, r * (0.85 + 0.3 * jitter), (1 - u) ** 1.5 * 0.85)
    p.comp(dl)


def speed_lines(p, x, y, s, t, n=9, length=420, spread=260, alpha=0.75):
    sl, sp = new_layer()
    rnd = random.Random(int(t * 12) * 31 + 5)
    for i in range(n):
        yy = y + rnd.uniform(-spread / 2, spread / 2) * s
        xx = x - rnd.uniform(0, length) * s
        ln = rnd.uniform(90, length) * s
        sp.line([(xx, yy), (xx - ln, yy + rnd.uniform(-14, 14) * s)],
                w=max(2.0, rnd.uniform(3, 9) * s), fill=(255, 255, 255, int(255 * alpha)))
    p.comp(sl)


def confetti(p, t, x0, y0, spread=1.0, count=90, t0=0.0, life=3.2):
    rnd = random.Random(99)
    for i in range(count):
        sx = x0 + rnd.uniform(-1, 1) * 260 * spread
        sy = y0 + rnd.uniform(-0.35, 0.25) * 220 * spread
        vx = rnd.uniform(-260, 260) * spread
        vy = rnd.uniform(-620, -180) * spread
        ag = t - t0
        if ag < 0 or ag > life:
            continue
        px = sx + vx * ag
        py = sy + vy * ag + 720 * ag * ag
        rot = rnd.uniform(0, 6.28) + ag * rnd.uniform(4, 12)
        col = [(255, 96, 64), (255, 210, 80), (72, 210, 240), (150, 120, 240), (255, 255, 255)][i % 5]
        wdt = rnd.uniform(12, 26)
        hgt = rnd.uniform(6, 14)
        pts = [(px + math.cos(rot) * wdt / 2, py + math.sin(rot) * wdt / 2),
               (px - math.cos(rot) * wdt / 2, py - math.sin(rot) * wdt / 2),
               (px - math.cos(rot) * wdt / 2 + math.cos(rot + 1.57) * hgt,
                py - math.sin(rot) * wdt / 2 + math.sin(rot + 1.57) * hgt),
               (px + math.cos(rot) * wdt / 2 + math.cos(rot + 1.57) * hgt,
                py + math.sin(rot) * wdt / 2 + math.sin(rot + 1.57) * hgt)]
        if py < H + 40:
            p.poly(pts, fill=col)


def sparkles(p, t, x, y, r, n=7, t0=0.0):
    for i in range(n):
        a = i * math.tau / n + t * 1.4
        rr = r * (0.7 + 0.3 * math.sin(t * 4 + i))
        sx = x + math.cos(a) * rr
        sy = y + math.sin(a) * rr * 0.85
        sz = 14 + 10 * abs(math.sin(t * 3 + i * 1.3))
        p.line([(sx - sz, sy), (sx + sz, sy)], w=5, fill=(255, 250, 210))
        p.line([(sx, sy - sz), (sx, sy + sz)], w=5, fill=(255, 250, 210))


def comic_word(p, x, y, text, size, rot, fill=(255, 236, 90), t=0.0, pop=1.0, italic=0):
    lay, lp = new_layer()
    lp.text((x, y), text, size * pop, fill=fill, ink=INK, sw=size * 0.13 * pop)
    bbox = lay.getbbox()
    if bbox is None:
        return
    lay = lay.crop(bbox)
    lay = lay.rotate(rot, resample=Image.BICUBIC, expand=True)
    base = p.d._image
    base.alpha_composite(lay, (int(bbox[0] - (lay.width - (bbox[2] - bbox[0])) / 2),
                               int(bbox[1] - (lay.height - (bbox[3] - bbox[1])) / 2)))
    p.d = ImageDraw.Draw(base)


def checkered_flag(p, x, y, s, t, wave=0.0):
    p.line([(x, y), (x, y - 210 * s)], w=9 * s, fill=INK)
    n, m = 4, 4
    cw, ch = 40 * s, 32 * s
    for i in range(n):
        for j in range(m):
            col = INK if (i + j) % 2 == 0 else WHITE
            yy = y - 200 * s + j * ch + math.sin(t * 4 + i) * wave
            pts = [(x + i * cw, yy), (x + (i + 1) * cw, yy + math.sin(t * 4 + i + 1) * wave * 0.6),
                   (x + (i + 1) * cw, yy + ch + math.sin(t * 4 + i + 1) * wave * 0.6),
                   (x + i * cw, yy + ch)]
            p.poly(pts, fill=col)
    for j in range(m):
        yy = y - 200 * s + j * ch + math.sin(t * 4) * wave
        p.line([(x, yy), (x + n * cw, yy + math.sin(t * 4 + n) * wave * 0.6)], w=3 * s, fill=INK)


def banner(p, t, y, x0, x1, s=1.0, text="FINISH", ground=None):
    """checkered gantry across the track: posts + fabric band"""
    ground = H if ground is None else ground
    band_h = 120 * s
    wave = 6 * s
    # posts
    for xx in (x0, x1):
        p.rect((xx - 16 * s, y - 40 * s, xx + 16 * s, ground), fill=(206, 210, 222))
        p.rect((xx - 16 * s, y - 40 * s, xx + 16 * s, ground), outline=INK, width=6)
        p.rrect((xx - 40 * s, ground - 26 * s, xx + 40 * s, ground + 8), 10 * s,
                fill=(186, 190, 202), outline=INK, width=6)
    # fabric: 3 rows of checkers with a gentle sine wave
    cols = max(4, int((x1 - x0) / (46 * s)))
    cw = (x1 - x0) / cols
    rows = 3
    for i in range(cols):
        for j in range(rows):
            col = INK if (i + j) % 2 == 0 else (250, 250, 250)
            xx = x0 + i * cw
            yy = y + j * band_h / rows + math.sin(t * 2.4 + i * 0.45) * wave
            yy2 = y + (j + 1) * band_h / rows + math.sin(t * 2.4 + (i + 1) * 0.45) * wave
            p.poly([(xx, yy), (xx + cw, yy), (xx + cw, yy2), (xx, yy2)], fill=col)
    # top & bottom rails
    for j in (0, rows):
        yy = y + j * band_h / rows
        for k in range(cols + 1):
            xx = x0 + k * cw
            p.circle(xx, yy + math.sin(t * 2.4 + k * 0.45) * wave, 4.5 * s,
                     fill=INK)
    comic_word(p, (x0 + x1) / 2, y + band_h / 2, text, 68 * s, 0, fill=(255, 236, 90), t=t)


def trophy(p, t, x, y, s, rise=1.0):
    y = y - (1 - rise) * 300
    # cup
    p.poly_out([(x - 74 * s, y - 150 * s), (x + 74 * s, y - 150 * s), (x + 40 * s, y - 10 * s),
                (x - 40 * s, y - 10 * s)], fill=(255, 206, 70), ol=INK, w=7 * s)
    p.ellipse((x - 74 * s, y - 190 * s, x + 74 * s, y - 118 * s), fill=(255, 226, 120), outline=INK, width=7 * s)
    for sx in (-1, 1):
        bx0 = x + sx * 62 * s - 40 * s
        bx1 = x + sx * 62 * s + 40 * s
        p.arc((bx0, y - 172 * s, bx1, y - 92 * s), -95 if sx > 0 else 95, 95 if sx > 0 else 265,
              w=13 * s, fill=(255, 214, 92))
        p.arc((bx0, y - 172 * s, bx1, y - 92 * s), -95 if sx > 0 else 95, 95 if sx > 0 else 265,
              w=4.5 * s, fill=INK)
    p.poly_out([(x - 26 * s, y - 10 * s), (x + 26 * s, y - 10 * s), (x + 32 * s, y + 40 * s),
                (x - 32 * s, y + 40 * s)], fill=(232, 176, 60), ol=INK, w=6 * s)
    p.rrect((x - 62 * s, y + 36 * s, x + 62 * s, y + 74 * s), 12 * s, fill=(232, 176, 60), outline=INK, width=6 * s)
    p.rrect((x - 82 * s, y + 70 * s, x + 82 * s, y + 104 * s), 12 * s, fill=(255, 206, 70), outline=INK, width=6 * s)
    p.circle(x, y - 128 * s, 26 * s, fill=(255, 255, 220), outline=INK, width=5 * s)
    p.text((x, y - 132 * s), "1", 34 * s, fill=INK)
    sparkles(p, t, x, y - 60 * s, 150 * s)


# ----------------------------------------------------------------------------
# scenes
# ----------------------------------------------------------------------------
def scene_intro(t):
    """0 - 6 s : sunrise, title card"""
    img, p = new_layer()
    sky(img, p, "dawn", t + 2.0)
    sea(img, p, "dawn", t, 0.0, sun_x=470, glitter=0.85)
    sand(img, p, "dawn", t, 0.0)
    for i in range(3):
        seagull(p, 250 + i * 190 + 30 * math.sin(t + i), 300 + i * 54 + 16 * math.sin(t * 2 + i),
                22, t + i * 0.7, phase=i)
    # title
    u = seq(0.9, 1.8, t)
    if u > 0:
        pop = ease_out_back(u, 1.7)
        comic_word(p, 540, 520 - 40 * (1 - u), "BASH BAQI", int(120 * pop), rot=-2.5 * (1 - u),
                   fill=(255, 236, 90), t=t)
        comic_word(p, 540, 672 - 40 * (1 - u), "RACING", int(134 * pop), rot=2.0 * (1 - u),
                   fill=(255, 96, 64), t=t)
    if t > 1.6:
        a = clamp(seq(1.6, 2.6, t))
        lay, lp = new_layer()
        lp.text((540, 830), ar("سباق الباغي على الشاطئ"), 64 * a, fill=WHITE, ink=INK, sw=9 * a)
        p.comp(lay)
    if t > 2.1:
        a = clamp(seq(2.1, 3.0, t)) * clamp(seq(5.6, 4.9, t))
        if a > 0.02:
            fl, fp = new_layer()
            fl2 = new_layer()
            checkered_flag(fp, 330, 1105, 0.62, t, wave=7)
            checkered_flag(fp, 750, 1105, 0.62, t + 0.6, wave=-7)
            if a < 1:
                fp.d = ImageDraw.Draw(fp.d._image)
            fl.putalpha(fl.getchannel("A").point(lambda v: int(v * a)))
            p.comp(fl)
    # foreground silhouettes framing the shot
    palm(p, 96, 1640, 1.5, t, dark=True, sway=1.5)
    palm(p, 1010, 1560, 1.15, t, dark=True, sway=1.1)
    return img


def scene_drive(t):
    """6 - 18 s : cruising along the beach"""
    img, p = new_layer()
    scroll = (t - 6.0) * 760.0
    sky(img, p, "day", t, scroll)
    sea(img, p, "day", t, scroll, sun_x=840)
    island(p, 300 - (scroll * 0.10) % 2400 + 800, SEA_TOP + 44, 0.55, t, "day")
    sand(img, p, "day", t, scroll)
    rnd = random.Random(21)
    for i in range(6):
        wx = i * 620 + rnd.uniform(-90, 90)
        px = (wx - scroll * 0.55) % 2600 - 260
        if -330 < px < W + 330:
            palm(p, px, SEA_BOT + 130 + rnd.uniform(-20, 40), lerp(0.66, 0.9, rnd.random()),
                 t + i, sway=1.0)
    bx, by = 400, 1660 + bob(t, 10, 0.9)
    pitch = 2.4 * math.sin(t * 7.0)
    spin = -(t - 6.0) * 22.0
    dust_trail(p, t, bx - 120, by - 10, 1.0, rate=13, life=0.8)
    draw_buggy(p, bx, by, 1.06, t, angle=pitch, spin=spin)
    # fast parallax foreground: dim dune band + tufts (never covers the buggy)
    fg, fp = new_layer()
    ridge = [(xx - 200, 1815 + 60 * math.sin((xx + scroll * 1.55) * 0.0034)
              + 30 * math.sin((xx + scroll * 1.55) * 0.0091)) for xx in range(-200, int(W) + 260, 60)]
    fp.poly(ridge + [(W + 260, H + 80), (-200, H + 80)], fill=(226, 178, 112))
    rr = random.Random(31)
    for i in range(7):
        gx = (i * 210 + 90 - scroll * 1.55) % (W + 420) - 210
        gy = 1860 + rr.uniform(-14, 26)
        sc = rr.uniform(0.8, 1.25)
        for k in range(5):
            a = math.radians(-150 + k * 24)
            fp.line([(gx, gy), (gx + math.cos(a) * 54 * sc, gy + math.sin(a) * 54 * sc)],
                    w=7 * sc, fill=(96, 138, 72))
    p.comp(fg)
    for i in range(3):
        seagull(p, (200 + i * 420 - scroll * 0.2) % 1400 - 160, 320 + i * 90, 20, t + i, phase=i * 2)
    a = clamp(seq(2.0, 3.0, t - 6.0)) * clamp(seq(11.2, 10.2, t - 6.0))
    if a > 0.02:
        comic_word(p, 540, 150, "BASH BAQI RACING", int(52 * (0.9 + 0.1 * a)), 0,
                   fill=(255, 255, 255), t=t)
    return img


def scene_jump(t):
    """18 - 30 s : run up a dune ramp, backflip, land"""
    L = t - 18.0
    img, p = new_layer()
    scroll = L * 880.0
    sky(img, p, "day", t, scroll)
    sea(img, p, "day", t, scroll, sun_x=840, glitter=0.6)
    sand(img, p, "day", t, scroll)
    ground = 1700.0
    air_t0, air_t1 = 3.6, 7.6
    ramp_top_x = 680.0
    ramp_top_y = ground - 230.0
    ramp_base_x = 380.0
    if L > air_t1:                      # let the ramp leave the frame behind us
        sx = (L - air_t1) * 760.0
        ramp_top_x -= sx
        ramp_base_x -= sx
    if L < air_t0:
        k = seq(0.0, air_t0, L)
        bx = lerp(60, ramp_top_x - 40, k ** 0.92)
        # ride up the ramp
        rk = clamp((bx - ramp_base_x) / (ramp_top_x - 40 - ramp_base_x))
        by = ground - rk * (ground - ramp_top_y)
        pitch = -18 * rk
        rot = 0.0
    elif L < air_t1:
        u = seq(air_t0, air_t1, L)
        ue = ease_in_out(u)
        height = 980.0 * math.sin(math.pi * ue) ** 0.9
        by = ground - 230.0 - height
        bx = lerp(ramp_top_x - 40, 660, smooth(u))
        pitch = lerp(-22, 30, ue)
        rot = 0.0
    else:
        k = seq(air_t1, air_t1 + 0.7, L)
        by = ground - 90 * (1 - ease_out(k, 2.0))
        bx = lerp(660, 800, ease_out(k, 2.0))
        pitch = lerp(10, 0, ease_out(k, 2.0))
        rot = 0.0

    # soft dune band (no ink outline – it is scenery, not a prop)
    ridge = [(xx - 120, ground + 150 + 46 * math.sin(xx * 0.0032 + 0.7)
              + 26 * math.sin(xx * 0.0081 + 2.1)) for xx in range(-120, int(W) + 180, 60)]
    p.poly(ridge + [(W + 180, H + 80), (-120, H + 80)], fill=SAND_D)
    # the ramp itself
    p.poly_out([(ramp_base_x - 40, ground + 12), (ramp_top_x + 30, ground + 12),
                (ramp_top_x + 30, ramp_top_y), (ramp_base_x + 90, ramp_top_y + 104)],
               fill=(202, 146, 96), ol=INK, w=9)
    for i in range(4):
        xk = ramp_base_x + 60 + i * 62
        p.line([(xk, ground + 6), (xk + 40, ground + 6 - (196 - i * 44))], w=7, fill=(160, 110, 72))
    # checkered edge along the lip
    for i in range(5):
        p.rect((ramp_base_x + 100 + i * 46, ramp_top_y + 96 - i * 24,
                ramp_base_x + 132 + i * 46, ramp_top_y + 118 - i * 24), fill=INK if i % 2 else WHITE)
    p.line([(ramp_top_x + 30, ramp_top_y), (ramp_top_x + 30, ramp_top_y - 120)], w=7, fill=INK)
    p.poly_out([(ramp_top_x + 30, ramp_top_y - 118), (ramp_top_x + 120, ramp_top_y - 100 + 8 * math.sin(t * 5)),
                (ramp_top_x + 120, ramp_top_y - 60 + 8 * math.sin(t * 5)), (ramp_top_x + 30, ramp_top_y - 74)],
               fill=(255, 210, 80), ol=INK, w=5)
    # scenery (hidden while the buggy flies past them)
    if not (air_t0 - 0.8 < L < air_t1 + 0.2):
        for i in range(4):
            px = (300 + i * 980 - scroll * 0.5) % 3600 - 320
            if -340 < px < W + 340:
                palm(p, px, SEA_BOT + 150, 0.82, t + i, sway=1.0)
    for i in range(3):
        seagull(p, (150 + i * 380 - scroll * 0.15) % 1300 - 150, 260 + i * 70, 19, t + i, phase=i)

    spin = -(L * 26.0) if L < air_t1 else -(L * 8.0)
    scale = 1.06
    if air_t0 < L < air_t1:
        scale = 1.06 + 0.12 * math.sin(math.pi * seq(air_t0, air_t1, L))
    # take-off dust
    if air_t0 - 0.5 < L < air_t0 + 0.45:
        tl, tp = new_layer()
        k = clamp((L - (air_t0 - 0.5)) / 0.9)
        for i in range(12):
            r = (50 + 170 * ease_out(k, 1.5)) * (0.55 + 0.45 * math.sin(i * 2.1))
            dust_puff(tp, ramp_top_x - 60 - 70 * i * k, ramp_top_y + 60 - 26 * math.sin(i),
                      r * (1 - k * 0.45), (1 - k) * 0.8)
        p.comp(tl)
    if air_t0 < L < air_t1:
        al, ap = new_layer()
        u = seq(air_t0, air_t1, L)
        for i in range(7):
            dust_puff(ap, bx - 200 - i * 58, by + 60 + 30 * math.sin(i), 38 - i * 3.5, 0.32 * (1 - u * 0.7))
        p.comp(al)
        if 0.22 < u < 0.85:
            comic_word(p, bx - 250, by - 210, "WHOOSH!", 76, -8, fill=(200, 240, 255), t=t,
                       pop=0.85 + 0.3 * abs(math.sin(t * 7)))
        # spin motion arc
        ar, arp = new_layer()
        for i in range(5):
            k = i / 4.0
            a0 = 150 + k * 60
            arp.arc((bx - 210, by - 210, bx + 230, by + 240), a0, a0 + 12,
                    w=8 * (1 - k * 0.5), fill=(255, 255, 255, int(150 * (1 - k))))
        p.comp(ar)
    # landing burst
    if air_t1 - 0.05 < L < air_t1 + 0.9:
        ll, lp2 = new_layer()
        k = clamp((L - air_t1) / 0.95)
        for i in range(16):
            rnd = random.Random(i * 31)
            ang = -3.0 + i * 0.40
            rr = (40 + 300 * ease_out(k, 1.5)) * (0.55 + 0.55 * rnd.random())
            dust_puff(lp2, bx + math.cos(ang) * rr * 0.7, ground + 20 + math.sin(ang) * rr * 0.3,
                      (36 + 30 * k) * (1 - k * 0.35), (1 - k) * 0.9)
        p.comp(ll)
        if k < 0.45:
            comic_word(p, bx + 30, ground - 330, "BAM!", 100, -6, fill=(255, 120, 70), t=t,
                       pop=1.15 - 0.4 * k)

    draw_buggy(p, bx, by, scale, t, angle=pitch, spin=spin, arm_up=(air_t0 - 0.7 < L < air_t1))
    if L > air_t1 + 0.9:
        k = seq(air_t1 + 0.9, air_t1 + 1.8, L)
        if k < 1:
            comic_word(p, 540, 400, "PERFECT LANDING", 52, -2,
                       fill=(160, 255, 190), t=t, pop=0.6 + 0.5 * k)
    return img


def scene_race(t):
    """30 - 42 s : duel with the rival, item box, turbo overtake"""
    L = t - 30.0
    img, p = new_layer()
    shake = 0.0
    if 3.2 < L < 6.2:
        shake = 9.0 * (1 - abs((L - 4.7) / 1.5))
    scroll = L * 1250.0 + max(0.0, L - 4.0) * 900.0
    sky(img, p, "golden", t, scroll)
    sea(img, p, "golden", t, scroll, sun_x=760, glitter=0.9)
    sand(img, p, "golden", t, scroll)
    for i in range(5):
        px = (300 + i * 780 - scroll * 0.55) % 3900 - 300
        if -340 < px < W + 340:
            palm(p, px, SEA_BOT + 140, 0.78, t + i, sway=1.0)

    gy = 1660 + shake * 0.2
    hero_x = 470
    spin = -t * 30.0
    rv = seq(0.0, 4.0, L)
    rival_x = lerp(hero_x + 430, hero_x + 215, smooth(rv))
    if L > 6.0:
        rival_x = min(hero_x + 215 + (L - 6.0) * 250, W + 280)
    rival_s = 1.02 if L < 6.0 else lerp(1.02, 0.9, clamp((L - 6) / 4))
    draw_buggy(p, rival_x, gy - 34, rival_s, t + 1.7, angle=2.0 * math.sin(t * 6 + 1),
               spin=spin * 0.95, body=RIVAL_BODY, body_d=RIVAL_BODY_D)
    if 2.4 < L < 3.6:
        k = seq(2.4, 3.6, L)
        ix = lerp(W + 200, hero_x + 165, k)
        iy = 1420 + bob(t, 26, 3.0)
        size = 74
        p.poly_out([(ix - size, iy - size), (ix + size, iy - size), (ix + size, iy + size),
                    (ix - size, iy + size)], fill=(255, 120, 170), ol=INK, w=7)
        p.text((ix, iy + 4), "?", 92, fill=(255, 255, 255), ink=INK, sw=7)
    if 3.4 < L < 3.9:
        fk = seq(3.4, 3.9, L)
        for i in range(8):
            a = i * math.tau / 8
            p.line([(hero_x + math.cos(a) * (70 + 420 * fk), 1560 + math.sin(a) * (70 + 420 * fk)),
                    (hero_x + math.cos(a) * (140 + 520 * fk), 1560 + math.sin(a) * (140 + 520 * fk))],
                   w=14 * (1 - fk), fill=(255, 240, 160))
    turbo = 3.9 <= L <= 7.4
    if turbo:
        k = clamp((L - 3.9) / 0.35) * clamp((7.4 - L) / 0.4)
        for i in range(9):
            fl = (70 + 150 * (0.5 + 0.5 * math.sin(t * 22 + i * 1.7))) * k
            yo = math.sin(t * 18 + i) * 24
            p.poly_out([(hero_x - 196, 1586 + yo), (hero_x - 196 - fl, 1568 + yo - 18),
                        (hero_x - 196 - fl, 1604 + yo + 18)], fill=(255, 190 + i * 6, 60), ol=INK, w=5)
        speed_lines(p, hero_x + 120, 1560, 1.25, t, n=11, length=560, spread=330, alpha=0.8)
        comic_word(p, hero_x - 60, 1290 + bob(t, 18, 8.0), "TURBO!", 84, -5, fill=(255, 210, 60), t=t,
                   pop=1.0 + 0.12 * math.sin(t * 12))
    else:
        speed_lines(p, hero_x + 100, 1560, 1.1, t, n=5, length=340, spread=250, alpha=0.35)
    dust_trail(p, t, hero_x - 130, gy - 16, 1.0, rate=16, life=0.7, spread=1.15)
    draw_buggy(p, hero_x, gy, 1.08, t, angle=2.4 * math.sin(t * 7), spin=spin)

    pos = 2 if L < 4.0 else 1
    p.circle(W - 116, 172 + shake, 74, fill=(255, 255, 255), outline=INK, width=9)
    p.text((W - 116, 178 + shake), str(pos), 104, fill=INK)
    comic_word(p, 300, 148, "LAP 3/3", 42, -3, fill=(255, 255, 255), t=t)
    if 4.0 < L < 6.0:
        comic_word(p, 540, 300 + bob(t, 10, 9), "1st PLACE!", 78, 3, fill=(255, 236, 90), t=t)
    return img


def scene_finish(t):
    """42 - 52 s : finish line, confetti, trophy"""
    L = t - 42.0
    img, p = new_layer()
    scroll = L * 900.0 + max(0.0, L - 2.6) * 260
    sky(img, p, "blaze", t, scroll)
    sea(img, p, "blaze", t, scroll, sun_x=700, glitter=1.0)
    sand(img, p, "blaze", t, scroll)
    gy = 1660
    for side_x, sgn in ((0, 1), (W, -1)):
        for i in range(6):
            rnd = random.Random(i * 13 + (0 if sgn > 0 else 7))
            cx = side_x + sgn * (34 + i * 54)
            cy = 1420 + rnd.uniform(-24, 34)
            jump = 16 * abs(math.sin(t * 5 + i * 1.4)) if L > 2.4 else 4 * math.sin(t * 3 + i)
            sc = 0.8 + rnd.random() * 0.3
            p.circle(cx, cy - 74 * sc - jump, 22 * sc, fill=(60, 44, 60))
            p.rrect((cx - 20 * sc, cy - 52 * sc - jump, cx + 20 * sc, cy + 6 * sc), 10 * sc,
                    fill=(70, 52, 66))
            if L > 2.4:
                a = math.radians(230 + 40 * math.sin(t * 6 + i))
                p.line([(cx, cy - 46 * sc - jump),
                        (cx + math.cos(a) * 46 * sc, cy - 46 * sc - jump + math.sin(a) * 46 * sc)],
                       w=11 * sc, fill=(70, 52, 66))

    finished = L > 3.15
    bx = lerp(140, 520, ease_out(seq(0.0, 3.15, L), 1.6))
    if finished:
        bx = lerp(520, 700, ease_out(seq(3.15, 4.8, L), 2.0))
    angle = -14 * math.sin(seq(3.15, 4.8, L) * math.pi) if finished else 0.0
    spin = -t * 28 if not finished else -t * 6
    if not finished:
        dust_trail(p, t, bx - 120, gy - 12, 1.0, rate=14, life=0.7)
    banner(p, t, 1215, 60, W - 60, s=1.0, text="FINISH", ground=1740)
    draw_buggy(p, bx, gy, 1.1, t, angle=angle, spin=spin, arm_up=finished)

    if finished:
        k = seq(3.15, 4.2, L)
        confetti(p, t, 540, 1080, spread=1.6, count=110, t0=42 + 3.2, life=6.0)
        if k < 0.45:
            comic_word(p, 540, 760, "FINISH!", 108, -3, fill=(255, 236, 90), t=t,
                       pop=0.7 + 1.0 * ease_out(k / 0.45, 2.0))
        if L > 3.9:
            comic_word(p, 540, 620, "1st PLACE!", 96, 2, fill=(255, 255, 255), t=t)
            lay, lp = new_layer()
            lp.text((540, 715), ar("المركز الأول!"), 64, fill=(120, 255, 180), ink=INK, sw=9)
            p.comp(lay)
        if L > 4.8:
            trophy(p, t, 540, 1020, 1.0, rise=ease_out(seq(4.8, 5.6, L), 2.0))
            if L > 5.6:
                comic_word(p, 540, 1400, "+ 1000  COINS", 58, -2, fill=(255, 214, 90), t=t)
    return img


def scene_outro(t):
    """52 - 60 s : sunset logo card"""
    L = t - 52.0
    img, p = new_layer()
    stars = clamp(seq(2.0, 7.0, L))
    sky(img, p, "dusk", t, 0.0, stars=stars)
    sea(img, p, "dusk", t, L * 60.0, sun_x=640, glitter=1.0)
    sand(img, p, "dusk", t, L * 40.0)
    palm(p, 150, 1600, 1.25, t, dark=True, sway=1.2)
    palm(p, 400, 1500, 0.85, t + 1.0, dark=True, sway=0.9)
    palm(p, 960, 1580, 1.4, t + 0.5, dark=True, sway=1.3)
    draw_buggy(p, 540, 1700, 1.0, t, angle=0.0, spin=0.0, arm_up=(L > 1.0))
    u = seq(0.6, 1.8, L)
    if u > 0:
        pop = ease_out_back(u, 1.8)
        comic_word(p, 540, 520, "BASH BAQI", int(112 * pop), -2, fill=(255, 236, 90), t=t)
        comic_word(p, 540, 660, "RACING", int(126 * pop), 2, fill=(255, 96, 64), t=t)
        sweep = seq(1.8, 3.2, L)
        if 0 < sweep < 1:
            lay, lp = new_layer()
            for yy, sz in ((520, 112), (660, 126)):
                x0 = lerp(-400, 1480, ease_in_out(sweep))
                lp.poly([(x0, yy - sz), (x0 + 70, yy - sz), (x0 + 10, yy + sz), (x0 - 60, yy + sz)],
                        fill=(255, 255, 255, 150))
            p.comp(lay)
    if L > 2.2:
        a = clamp(seq(2.2, 3.4, L))
        lay, lp = new_layer()
        lp.text((540, 830), ar("سباق الباغي على الشاطئ"), 60 * (0.9 + 0.1 * a), fill=WHITE, ink=INK, sw=9 * a)
        p.comp(lay)
        checkered_flag(p, 200, 1500, 0.62, t, wave=7)
        checkered_flag(p, 900, 1470, 0.62, t + 0.8, wave=-7)
    if L > 3.4:
        a = clamp(seq(3.4, 4.4, L))
        cl, cp = new_layer()
        for i, txt in enumerate(("50 CARS", "10 WORLDS", "PLAY FREE")):
            cp.rrect((140 + i * 280, 1180, 380 + i * 280, 1262), 41,
                     fill=(255, 255, 255, int(238 * a)), outline=INK, width=6)
            cp.text((260 + i * 280, 1224), txt, max(1.0, 36 * a), fill=INK, ink=None, sw=0)
        p.comp(cl)
    fade = clamp(seq(6.6, 7.9, L))
    if fade > 0:
        fl, fp = new_layer()
        fp.rect((0, 0, W, H), fill=(6, 4, 14, int(255 * fade)))
        p.comp(fl)
    return img


SCENES = [
    (0.0, 6.0, scene_intro),
    (6.0, 18.0, scene_drive),
    (18.0, 30.0, scene_jump),
    (30.0, 42.0, scene_race),
    (42.0, 52.0, scene_finish),
    (52.0, 60.0, scene_outro),
]


def vignette(img, strength=0.22):
    if "vig" not in _GRAD_CACHE:
        w_, h_ = img.size
        yy, xx = np.mgrid[0:h_, 0:w_]
        nx = (xx / w_ - 0.5) * 2
        ny = (yy / h_ - 0.5) * 2
        r = np.sqrt(nx * nx * 0.85 + ny * ny)
        v = np.clip(1.0 - strength * np.clip(r - 0.55, 0, 3) ** 1.7, 0.0, 1.0)
        _GRAD_CACHE["vig"] = Image.fromarray((v * 255).astype(np.uint8), "L")
    return Image.composite(img, Image.new("RGB", img.size, (12, 8, 22)), _GRAD_CACHE["vig"])


def render_frame(i):
    t = i / FPS
    for t0, t1, fn in SCENES:
        if t0 <= t < t1 or (fn is SCENES[-1][2] and t >= t0):
            layer = fn(t)
            break
    else:
        layer = scene_outro(t)
    # transitions: quick white flash across scene cuts
    for cut in (6.0, 18.0, 30.0, 42.0, 52.0):
        d = t - cut
        if -0.16 < d < 0.16:
            k = 1 - abs(d) / 0.16
            flash, fp = new_layer()
            fp.rect((0, 0, W, H), fill=(255, 255, 255, int(210 * k ** 0.8)))
            layer = Image.alpha_composite(layer, flash)
    img = layer.convert("RGB").resize((W, H), Image.LANCZOS)
    img = vignette(img)
    return img


# ----------------------------------------------------------------------------
# cli
# ----------------------------------------------------------------------------
def _worker(args):
    i, outdir = args
    img = render_frame(i)
    if outdir is None:                      # streaming mode: hand back raw RGB bytes
        return i, img.tobytes()
    path = os.path.join(outdir, "f_%05d.png" % i)
    img.save(path, optimize=False, compress_level=1)
    return i, b""


def encode(out_path, audio_path, start, end):
    """render straight into libx264 through a pipe (no intermediate files)"""
    exe = os.environ.get("FFMPEG")
    if not exe:
        try:
            import imageio_ffmpeg
            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            exe = "ffmpeg"
    cmd = [exe, "-hide_banner", "-loglevel", "warning", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (W, H), "-r", str(FPS),
           "-i", "pipe:0"]
    if audio_path and os.path.exists(audio_path):
        cmd += ["-i", audio_path]
    cmd += ["-map", "0:v"]
    if audio_path and os.path.exists(audio_path):
        cmd += ["-map", "1:a", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-level", "4.1", "-threads", "2",
            "-movflags", "+faststart", "-shortest", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    jobs = [(i, None) for i in range(start, end)]
    t0 = _time.time()
    with Pool(args_workers) as pool:
        for n, (i, raw) in enumerate(pool.imap(_worker, jobs, chunksize=2), 1):
            proc.stdin.write(raw)
            if n % 48 == 0 or n == len(jobs):
                el = _time.time() - t0
                print("frame %d/%d  %.0fs elapsed, eta %.0fs" % (n, len(jobs), el,
                      el / n * (len(jobs) - n)), flush=True)
    proc.stdin.close()
    rc = proc.wait()
    print("ffmpeg exit", rc, "in %.1fs" % (_time.time() - t0))
    return rc


args_workers = 2


def main():
    global args_workers
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=str, default=None, help="comma separated second marks")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=NFRAMES)
    ap.add_argument("--outdir", type=str, default="/tmp/frames")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--encode", type=str, default=None, help="write an mp4 instead of PNGs")
    ap.add_argument("--audio", type=str, default=None)
    a = ap.parse_args()
    args_workers = a.workers

    if a.preview:
        os.makedirs("/tmp/preview", exist_ok=True)
        for s in a.preview.split(","):
            t0 = _time.time()
            img = render_frame(int(float(s) * FPS))
            path = "/tmp/preview/t%05.2f.png" % float(s)
            img.save(path)
            print("wrote", path, "%.2fs" % (_time.time() - t0))
        return

    if a.encode:
        os.makedirs(os.path.dirname(os.path.abspath(a.encode)), exist_ok=True)
        encode(a.encode, a.audio, a.start, a.end)
        return

    os.makedirs(a.outdir, exist_ok=True)
    jobs = [(i, a.outdir) for i in range(a.start, a.end)]
    t0 = _time.time()
    with Pool(a.workers) as pool:
        for n, i in enumerate(pool.imap_unordered(_worker, jobs, chunksize=4), 1):
            if n % 24 == 0 or n == len(jobs):
                el = _time.time() - t0
                print("frame %d/%d  %.1fs elapsed, eta %.1fs" % (n, len(jobs), el,
                      el / n * (len(jobs) - n)), flush=True)
    print("done in %.1fs" % (_time.time() - t0))


if __name__ == "__main__":
    main()
