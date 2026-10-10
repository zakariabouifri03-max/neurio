#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Design system for the explainer short.

Editorial/documentary motion-graphics toolkit built on Pillow:
  - palette, type scale, layout grid
  - tracked (letter-spaced) text, auto-fitting, wrapping
  - panels, hairlines, gradients, grain
  - easing curves
  - Albers equal-area conic projection + US state basemap (real GeoJSON)
  - reusable chart primitives (bars, line chart, clock)

Nothing here is scene-specific; scenes live in render.py.
"""
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTDIR = os.path.join(HERE, "fonts")
DATADIR = os.path.join(HERE, "data")

# ---------------------------------------------------------------------------
# palette — deep navy / white / red accent / neutral gray
# ---------------------------------------------------------------------------
NAVY = (10, 20, 35)          # page background
NAVY_2 = (16, 30, 51)        # raised panel
NAVY_3 = (24, 42, 68)        # brightest panel
LINE = (38, 58, 88)          # hairlines / rules
LINE_SOFT = (26, 41, 63)

INK = (242, 245, 250)        # primary text (near-white, not pure)
INK_DIM = (176, 189, 208)    # secondary text
MUTE = (122, 140, 165)       # tertiary / labels
FAINT = (72, 92, 121)

RED = (226, 59, 59)          # accent
RED_D = (168, 34, 34)
RED_L = (255, 112, 100)

SUN = (245, 181, 68)         # sunrise / daylight data
SUN_D = (196, 132, 34)
TEAL = (86, 190, 180)        # contrast data series

BLACK = (0, 0, 0)

# ---------------------------------------------------------------------------
# typography
# ---------------------------------------------------------------------------
BC = "BarlowCondensed"       # display / headlines (condensed, tall)
INTER = "Inter"              # data, labels, body

_FONTS = {}


def _path(family, weight):
    if family == BC:
        return os.path.join(FONTDIR, f"BarlowCondensed-{weight}.ttf")
    return os.path.join(FONTDIR, f"Inter-{weight}.ttf")


def font(size, family=INTER, weight=700):
    """Cached TrueType face. `weight` is an int (400..900) or a Barlow style
    name string ('Regular','Medium','SemiBold','Bold','Black')."""
    size = int(round(size))
    if isinstance(weight, str):
        wname = weight
        wkey = weight
    elif family == BC:
        wname = {400: "Regular", 500: "Medium", 600: "SemiBold",
                 700: "Bold", 800: "Black", 900: "Black"}[weight]
        wkey = wname
    else:
        wname = str(weight)
        wkey = weight
    k = (size, family, wkey)
    if k not in _FONTS:
        _FONTS[k] = ImageFont.truetype(_path(family, wname), size)
    return _FONTS[k]


def tlen(txt, f, spacing=0.0):
    """Width of `txt` in px, including manual letter-spacing."""
    if not txt:
        return 0.0
    w = f.getlength(txt)
    if spacing:
        w += spacing * (len(txt) - 1)
    return w


def text(d, xy, txt, f, fill=INK, spacing=0.0, anchor="la", stroke=0,
         stroke_fill=None, alpha=1.0):
    """Draw text with letter-spacing. anchor follows PIL semantics (l/c/r + a/m/s/d)."""
    if not spacing:
        if alpha < 1.0:
            fill = tuple(int(c * alpha) + 0 for c in fill) if False else fill
        d.text(xy, txt, font=f, fill=fill, anchor=anchor,
               stroke_width=stroke, stroke_fill=stroke_fill)
        return
    # manual tracking: place glyph by glyph
    ha, va = anchor[0], anchor[1]
    total = tlen(txt, f, spacing)
    x, y = float(xy[0]), float(xy[1])
    if ha in ("c", "m"):
        x -= total / 2.0
    elif ha == "r":
        x -= total
    cur = x
    for ch in txt:
        d.text((cur, y), ch, font=f, fill=fill, anchor="l" + va,
               stroke_width=stroke, stroke_fill=stroke_fill)
        cur += f.getlength(ch) + spacing
    return total


def tsize(d, txt, f, spacing=0.0, anchor="la"):
    """Ink bbox (x0,y0,x1,y1) of tracked text drawn at xy=anchor origin."""
    asc, desc = f.getmetrics()
    w = tlen(txt, f, spacing)
    return (0, 0, w, asc + desc)


def fit_size(txt, max_w, family=INTER, weight=700, hi=400, lo=8, spacing=0.0):
    """Largest point size at which txt fits in max_w."""
    a, b = lo, hi
    for _ in range(34):
        m = (a + b) / 2
        if tlen(txt, font(m, family, weight), spacing) <= max_w:
            a = m
        else:
            b = m
    return a


def wrap(txt, f, max_w, spacing=0.0):
    """Greedy word wrap on a font + tracking."""
    out, line = [], ""
    for word in txt.split():
        trial = word if not line else line + " " + word
        if tlen(trial, f, spacing) <= max_w or not line:
            line = trial
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out


# ---------------------------------------------------------------------------
# easing
# ---------------------------------------------------------------------------
def clamp(v, a=0.0, b=1.0):
    return a if v < a else (b if v > b else v)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    t = clamp(t)
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def seq(t0, t1, t):
    """Normalised progress of t between t0 and t1."""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))


def ease_out(t, p=3.0):
    return 1 - (1 - clamp(t)) ** p


def ease_in(t, p=3.0):
    return clamp(t) ** p


def ease_in_out(t):
    t = clamp(t)
    return 3 * t * t - 2 * t * t * t


def ease_out_expo(t):
    t = clamp(t)
    return 1.0 if t >= 1 else 1 - 2 ** (-10 * t)


def ease_out_back(t, s=1.55):
    t = clamp(t) - 1.0
    return t * t * ((s + 1) * t + s) + 1.0


def ease_out_elastic(t, amp=0.6):
    t = clamp(t)
    if t in (0.0, 1.0):
        return t
    return 2 ** (-10 * t) * math.sin((t - 0.075) * math.tau / 0.3) * amp + 1


# ---------------------------------------------------------------------------
# surfaces
# ---------------------------------------------------------------------------
def rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def hairline(d, x0, y0, x1, y1, fill=LINE, width=1):
    d.line([(x0, y0), (x1, y1)], fill=fill, width=max(1, int(width)))


def vgrad(size, top, bot, mode="RGB"):
    """Vertical gradient as a cached PIL image."""
    w, h = size
    a = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    t = np.array(top, dtype=np.float32)[None, None, :]
    b = np.array(bot, dtype=np.float32)[None, None, :]
    arr = (t + (b - t) * a).repeat(w, axis=1).astype(np.uint8)
    return Image.fromarray(arr, "RGB").convert(mode)


def radial_glow(size, cx, cy, radius, color, power=1.0, strength=1.0):
    """Additive radial glow on a transparent layer."""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dd = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / max(1.0, radius)
    a = np.clip(1.0 - dd, 0, 1) ** power * strength
    arr = np.zeros((h, w, 4), dtype=np.float32)
    arr[..., 0] = color[0] * a
    arr[..., 1] = color[1] * a
    arr[..., 2] = color[2] * a
    arr[..., 3] = 255.0 * np.clip(a, 0, 1)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def grain(img, amount=5.0, seed=7):
    """Subtle film grain — kills the flat 'rendered' look."""
    arr = np.asarray(img).astype(np.int16)
    rng = np.random.default_rng(seed)
    n = rng.normal(0, amount, arr.shape[:2])[..., None]
    return Image.fromarray(np.clip(arr + n, 0, 255).astype(np.uint8), img.mode)


# ---------------------------------------------------------------------------
# Albers equal-area conic — the standard projection for US choropleths
# ---------------------------------------------------------------------------
class Albers:
    def __init__(self, p1=29.5, p2=45.5, lat0=37.5, lon0=-96.0):
        d2r = math.pi / 180
        s1, s2 = math.sin(p1 * d2r), math.sin(p2 * d2r)
        self.n = (s1 + s2) / 2
        self.C = math.cos(p1 * d2r) ** 2 + 2 * self.n * s1
        self.rho0 = math.sqrt(self.C - 2 * self.n * math.sin(lat0 * d2r)) / self.n
        self.lon0 = lon0

    def raw(self, lon, lat):
        d2r = math.pi / 180
        rho = math.sqrt(max(0.0, self.C - 2 * self.n * math.sin(lat * d2r))) / self.n
        th = self.n * (lon - self.lon0) * d2r
        # negate so north (math-up) maps to screen-up (image y grows downward)
        return rho * math.sin(th), -(self.rho0 - rho * math.cos(th))


_PROJ = Albers()
_STATES = None
_STATE_BOX = None


def states():
    """Contiguous-US state polygons in projected space, plus the fit box."""
    global _STATES, _STATE_BOX
    if _STATES is not None:
        return _STATES, _STATE_BOX
    gj = json.load(open(os.path.join(DATADIR, "us-states.json")))
    skip = {"Alaska", "Hawaii", "Puerto Rico"}
    polys, xs, ys = [], [], []
    for f in gj["features"]:
        name = f["properties"].get("name", "")
        if name in skip:
            continue
        g = f["geometry"]
        rings = []
        if g["type"] == "Polygon":
            rings = g["coordinates"]
        else:
            for poly in g["coordinates"]:
                rings.extend(poly)
        for ring in rings:
            pts = [_PROJ.raw(lo, la) for lo, la in ring]
            rings_x = [p[0] for p in pts]
            rings_y = [p[1] for p in pts]
            xs += rings_x
            ys += rings_y
            polys.append((name, pts))
    _STATES = polys
    _STATE_BOX = (min(xs), min(ys), max(xs), max(ys))
    return _STATES, _STATE_BOX


class MapFit:
    """Fit the projected basemap into a pixel box, preserving aspect."""

    def __init__(self, box, pad=0.0):
        polys, (x0, y0, x1, y1) = states()
        bw, bh = box[2] - box[0], box[3] - box[1]
        bw -= pad * 2
        bh -= pad * 2
        sx = bw / (x1 - x0)
        sy = bh / (y1 - y0)
        self.s = min(sx, sy)
        # centre inside the box
        cx = box[0] + bw / 2 + pad
        cy = box[1] + bh / 2 + pad
        mx = (x0 + x1) / 2
        my = (y0 + y1) / 2
        self.ox = cx - mx * self.s
        self.oy = cy - my * self.s

    def xy(self, lon, lat):
        x, y = _PROJ.raw(lon, lat)
        return self.ox + x * self.s, self.oy + y * self.s

    def draw(self, d, fill=NAVY_3, outline=LINE, width=2, reveal=1.0,
             alpha=1.0):
        """Draw state outlines. `reveal` sweeps a left-to-right wipe (0..1)."""
        polys, (x0, y0, x1, y1) = states()
        lim = self.ox + (x0 + (x1 - x0) * clamp(reveal)) * self.s if reveal < 1 else None
        for name, pts in polys:
            scr = [(self.ox + px * self.s, self.oy + py * self.s) for px, py in pts]
            if lim is not None and min(p[0] for p in scr) > lim:
                continue
            if len(scr) < 3:
                continue
            d.polygon(scr, fill=fill, outline=outline, width=max(1, int(width)))


# ---------------------------------------------------------------------------
# chart primitives
# ---------------------------------------------------------------------------
def count_fmt(v, dec=0):
    return f"{v:,.{dec}f}"


def bars(d, box, values, labels, colors, prog=1.0, vmax=None,
         label_f=None, value_f=None, value_fmt=lambda v: f"{v:,.0f}",
         gap_ratio=0.42, baseline=True):
    """Horizontal bar chart that grows with `prog` (0..1)."""
    x0, y0, x1, y1 = box
    n = len(values)
    vmax = vmax or max(values)
    slot = (y1 - y0) / n
    bh = slot * (1 - gap_ratio)
    lx = x0
    bw_max = x1 - x0
    for i, (v, lab, col) in enumerate(zip(values, labels, colors)):
        cy = y0 + slot * i + slot / 2
        w = bw_max * (v / vmax) * ease_out_expo(prog)
        if baseline:
            hairline(d, x0, y0 + slot * i + slot, x1, y0 + slot * i + slot,
                     LINE_SOFT, 1)
        d.rounded_rectangle([lx, cy - bh / 2, lx + max(2, w), cy + bh / 2],
                            radius=bh / 2, fill=col)
        if label_f:
            text(d, (lx + 8, cy), lab, label_f, fill=INK, anchor="lm")
        if value_f and prog > 0.02:
            text(d, (lx + max(2, w) - 16, cy), value_fmt(v), value_f,
                 fill=NAVY, anchor="rm")


def line_chart(d, box, xs, ys, color, prog=1.0, width=8, dots=None,
               dot_labels=None, label_f=None, grid=True, vmax=None,
               vmin=0.0, area=None):
    """Animated line chart. `prog` sweeps the trace left→right."""
    x0, y0, x1, y1 = box
    vmax = vmax if vmax is not None else max(ys)
    vmin = vmin if vmin is not None else min(min(ys), 0)

    def px(i):
        return x0 + (x1 - x0) * (i / max(1, len(xs) - 1))

    def py(v):
        return y1 - (y1 - y0) * ((v - vmin) / max(1e-9, vmax - vmin))

    if grid:
        for k in range(5):
            gy = y0 + (y1 - y0) * k / 4
            hairline(d, x0, gy, x1, gy, LINE_SOFT, 1)

    p = ease_out_expo(prog)
    last = (len(xs) - 1) * p
    pts = []
    for i in range(len(xs)):
        if i > last:
            break
        pts.append((px(i), py(ys[i])))
    if pts and last > int(last):
        i = int(last)
        if i + 1 < len(xs):
            f = last - i
            pts.append((lerp(px(i), px(i + 1), f), lerp(py(ys[i]), py(ys[i + 1]), f)))

    if area and len(pts) > 1:
        poly = list(pts) + [(pts[-1][0], y1), (pts[0][0], y1)]
        d.polygon(poly, fill=area)
    if len(pts) > 1:
        d.line(pts, fill=color, width=width, joint="curve")

    if dots:
        for i in dots:
            if i <= last:
                r = 14
                d.ellipse([px(i) - r, py(ys[i]) - r, px(i) + r, py(ys[i]) + r],
                          fill=color, outline=NAVY, width=4)
                if dot_labels and label_f and i in dot_labels:
                    dl, pos = dot_labels[i]
                    text(d, pos(px(i), py(ys[i])), dl, label_f, fill=INK,
                         anchor="mm")


def clock(d, cx, cy, r, hour, minute, face=NAVY_2, rim=INK, hands=RED,
          ticks=12, prog=1.0, tick_col=None):
    """Analogue clock face. hour/minute are real values (may be fractional)."""
    tick_col = tick_col or LINE
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=face, outline=rim,
              width=max(2, int(r * 0.022)))
    for i in range(ticks):
        a = i / ticks * math.tau - math.pi / 2
        r0 = r * (0.84 if i % 3 else 0.88)
        w = max(2, int(r * (0.035 if i % 3 else 0.018)))
        d.line([(cx + math.cos(a) * r0, cy + math.sin(a) * r0),
                (cx + math.cos(a) * r * 0.95, cy + math.sin(a) * r * 0.95)],
               fill=rim if i % 3 else tick_col, width=w)
    ha = ((hour % 12) + minute / 60) / 12 * math.tau - math.pi / 2
    ma = minute / 60 * math.tau - math.pi / 2
    d.line([(cx, cy), (cx + math.cos(ha) * r * 0.5, cy + math.sin(ha) * r * 0.5)],
           fill=rim, width=max(4, int(r * 0.075)))
    d.line([(cx, cy), (cx + math.cos(ma) * r * 0.72, cy + math.sin(ma) * r * 0.72)],
           fill=hands, width=max(3, int(r * 0.05)))
    rr0 = r * 0.055
    d.ellipse([cx - rr0, cy - rr0, cx + rr0, cy + rr0], fill=hands)


def sky_strip(d, box, hour_of_sunrise, now_hour=7.5):
    """A vertical band showing darkness at `now_hour` given a sunrise time."""
    x0, y0, x1, y1 = box
    for i in range(int(y1 - y0)):
        t = i / max(1, (y1 - y0) - 1)
        h = now_hour + t * 4
        k = clamp((h - hour_of_sunrise) / 1.4)
        d.line([(x0, y0 + i), (x1, y0 + i)], fill=mix((8, 14, 28), (120, 175, 235), k))
