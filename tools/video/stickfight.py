#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
STICK RIVALS — a 60 s cinematic stickman fight, generated entirely from code.

Landscape 1920x1080, 24 fps, 60 s (1440 frames), drawn with Pillow + numpy and
piped straight into libx264.  Two skeletal stickmen (Ronin vs Blaze) trade blows
through a scripted choreography with comic-book impacts, a moving camera,
health-bar HUD, letterbox + vignette + film grain for a filmic finish.

  # soundtrack first (impacts/whooshes are timed to the hits in HITS below)
  python3 tools/video/stickfight_audio.py --out /tmp/fight.wav

  # render + mux
  python3 tools/video/stickfight.py --encode video/stickman-fight-60s.mp4 \
          --audio /tmp/fight.wav --workers 2

  # peek at single frames while tweaking (seconds)
  python3 tools/video/stickfight.py --preview 2,8,18,28,40,48,57
"""
import argparse
import math
import os
import random
import subprocess
import time as _time
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from arabic_reshaper import reshape as ar_reshape
from bidi.algorithm import get_display

# ----------------------------------------------------------------------------
# constants
# ----------------------------------------------------------------------------
FPS = 24
DUR = 60.0
NFRAMES = int(FPS * DUR)          # 1440
W, H = 1920, 1080                 # delivery size (16:9 — a fight reads landscape)
SS = 1.5                          # supersample: render 2880x1620

GROUND = 880.0                    # world y of the floor line
BASE_ROOTY = 700.0                # standing hip height for both fighters

INK_DARK = (26, 24, 34)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_FONTS = {}


def font(px, bold=True):
    px = int(px)
    k = (px, bold)
    if k not in _FONTS:
        _FONTS[k] = ImageFont.truetype(FONT_BOLD if bold else FONT_REG, px)
    return _FONTS[k]


def ar(text):
    """Shape + bidi-reorder an Arabic string for Pillow."""
    return get_display(ar_reshape(text))


# ----------------------------------------------------------------------------
# small maths
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


def ease_in_out(t):
    t = clamp(t)
    return 3 * t * t - 2 * t * t * t


def ease_out_back(t, s=1.9):
    t = clamp(t) - 1.0
    return t * t * ((s + 1) * t + s) + 1.0


def seq(t0, t1, t):
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))


def ang(deg):
    return math.radians(deg)


def pol(a, length):
    return (math.cos(a) * length, math.sin(a) * length)


# ----------------------------------------------------------------------------
# pen — draws in 1920x1080 world space onto a supersampled RGBA canvas
# ----------------------------------------------------------------------------
class Pen:
    def __init__(self, draw, s=SS):
        self.d = draw
        self.s = s

    def _b(self, box):
        s = self.s
        return (box[0] * s, box[1] * s, box[2] * s, box[3] * s)

    def _p(self, pts):
        s = self.s
        return [(p[0] * s, p[1] * s) for p in pts]

    def _w(self, w):
        return max(1, int(round(w * self.s)))

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

    def poly_out(self, pts, fill, ol=INK_DARK, w=6.0):
        p = self._p(pts)
        self.d.polygon(p, fill=fill)
        if ol is not None:
            self.d.line(p + [p[0]], fill=ol, width=self._w(w), joint="curve")

    def line(self, pts, w=6.0, fill=INK_DARK, joint="curve"):
        self.d.line(self._p(pts), fill=fill, width=self._w(w), joint=joint)

    def arc(self, box, a0, a1, w=6.0, fill=INK_DARK):
        self.d.arc(self._b(box), a0, a1, fill=fill, width=self._w(w))

    def pieslice(self, box, a0, a1, fill=None, outline=None, w=1):
        self.d.pieslice(self._b(box), a0, a1, fill=fill, outline=outline, width=self._w(w))

    def comp(self, layer, xy=(0, 0)):
        base = self.d._image
        base.alpha_composite(layer, (int(xy[0] * self.s), int(xy[1] * self.s)))
        self.d = ImageDraw.Draw(base)

    def text(self, xy, s, size, fill=(255, 255, 255), anchor="mm", ink=INK_DARK,
             sw=0.0, bold=True):
        self.d.text((xy[0] * self.s, xy[1] * self.s), s,
                    font=font(int(size * self.s), bold),
                    fill=fill, anchor=anchor,
                    stroke_width=self._w(sw) if sw else 0, stroke_fill=ink)

    def text_size(self, s, size, bold=True):
        return font(int(size * self.s), bold).getbbox(s)[2:]


def new_layer(w=W, h=H):
    img = Image.new("RGBA", (int(w * SS), int(h * SS)), (0, 0, 0, 0))
    return img, Pen(ImageDraw.Draw(img))


def new_screen_layer():
    """overlay layer at final 1080p resolution (no supersampling)."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return img, Pen(ImageDraw.Draw(img), s=1.0)


def seg(p, a, b, w, col):
    """thick rounded segment (capsule) between two world points."""
    p.line([a, b], w=w, fill=col)
    r = w * 0.5
    p.circle(a[0], a[1], r, fill=col)
    p.circle(b[0], b[1], r, fill=col)


# ----------------------------------------------------------------------------
# vertical gradient (numpy -> Image)
# ----------------------------------------------------------------------------
_GRAD_CACHE = {}


def grad_v(size, c_top, c_mid, c_bot, stops=(0.0, 0.55, 1.0)):
    w, h = size
    ys = np.linspace(0, 1, h, dtype=np.float32)
    s0, s1, s2 = stops
    top = np.array(c_top, np.float32)[None, :]
    mid = np.array(c_mid, np.float32)[None, :]
    bot = np.array(c_bot, np.float32)[None, :]
    t1 = np.clip((ys - s0) / max(1e-6, s1 - s0), 0, 1)[:, None]
    t2 = np.clip((ys - s1) / max(1e-6, s2 - s1), 0, 1)[:, None]
    low = top + (mid - top) * t1
    high = mid + (bot - mid) * t2
    col = np.where((ys < s1)[:, None], low, high)
    arr = np.repeat(col[:, None, :], w, axis=1)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def grad_cached(key, c_top, c_mid, c_bot):
    if key not in _GRAD_CACHE:
        _GRAD_CACHE[key] = grad_v((int(W * SS), int(H * SS)), c_top, c_mid, c_bot)
    return _GRAD_CACHE[key]


# moody skies per act
MOODS = {
    "night":  ((18, 20, 44),   (44, 40, 84),    (92, 66, 120)),
    "dusk":   ((40, 34, 92),   (150, 66, 120),  (255, 150, 96)),
    "blaze":  ((60, 30, 90),   (206, 70, 84),   (255, 176, 92)),
    "golden": ((46, 84, 168),  (224, 150, 118), (255, 210, 140)),
}


# ----------------------------------------------------------------------------
# fighter definitions
# ----------------------------------------------------------------------------
FIGHTERS = {
    "ronin": dict(
        ink=(34, 42, 74), accent=(72, 150, 245), glow=(90, 170, 255),
        x0=760.0, facing=+1, hair="topknot", name="RONIN", name_ar="رونين",
    ),
    "blaze": dict(
        ink=(84, 30, 34), accent=(250, 112, 48), glow=(255, 130, 70),
        x0=1160.0, facing=-1, hair="spikes", name="BLAZE", name_ar="بلايز",
    ),
}

# skeleton lengths (local, facing +x)
TORSO = 128.0
HEAD_OFF = 36.0
HEAD_R = 27.0
UA = 84.0      # upper arm
FA = 80.0      # forearm
TH = 94.0      # thigh
SH = 90.0      # shin
FOOT = 28.0


def fk(pose):
    """forward kinematics -> local joint points (hip at origin, forward +x)."""
    ta = ang(pose["ta"])
    hip = (0.0, 0.0)
    neck = pol(ta, TORSO)
    head = (neck[0] + pol(ta, HEAD_OFF)[0], neck[1] + pol(ta, HEAD_OFF)[1])
    shoulder = (neck[0], neck[1] + 10.0)

    def arm(ua, fa):
        e = (shoulder[0] + pol(ang(ua), UA)[0], shoulder[1] + pol(ang(ua), UA)[1])
        f = (e[0] + pol(ang(fa), FA)[0], e[1] + pol(ang(fa), FA)[1])
        return e, f

    le, lf = arm(pose["lua"], pose["lfa"])   # lead arm
    re, rf = arm(pose["rua"], pose["rfa"])   # rear arm

    def leg(th, sh, ft):
        k = pol(ang(th), TH)
        a = (k[0] + pol(ang(sh), SH)[0], k[1] + pol(ang(sh), SH)[1])
        toe = (a[0] + pol(ang(ft), FOOT)[0], a[1] + pol(ang(ft), FOOT)[1])
        return k, a, toe

    lk, la, lt = leg(pose["lth"], pose["lsh"], pose["lft"])
    rk, ra, rt = leg(pose["rth"], pose["rsh"], pose["rft"])
    return dict(hip=hip, neck=neck, head=head, shoulder=shoulder,
                le=le, lf=lf, re=re, rf=rf, lk=lk, la=la, lt=lt, rk=rk, ra=ra, rt=rt)


def to_world(pt, rootx, rooty, facing):
    return (rootx + facing * pt[0], rooty + pt[1])


def draw_fighter(layer_pen, key, fd, pose, ghosts=()):
    """draw one stickman.  ghosts = list of (pose, alpha) motion-trail copies."""
    rootx, rooty, facing = pose["rootx"], pose["rooty"], fd["facing"]
    ink = fd["ink"]
    accent = fd["accent"]

    sh = layer_pen
    sh.ellipse((rootx - 74, GROUND - 16, rootx + 74, GROUND + 16),
               fill=(20, 16, 30, 90))

    def wp(pt):
        return to_world(pt, rootx, rooty, facing)

    for gpose, galpha in ghosts:
        g = fk(gpose)
        col = accent + (galpha,)
        seg(sh, wp(g["neck"]), wp(g["lf"]), 12, col)
        seg(sh, wp(g["le"]), wp(g["lf"]), 10, col)
        seg(sh, wp(g["hip"]), wp(g["lk"]), 12, col)
        seg(sh, wp(g["lk"]), wp(g["la"]), 11, col)

    j = fk(pose)
    neck, hip, head = wp(j["neck"]), wp(j["hip"]), wp(j["head"])
    le, lf = wp(j["le"]), wp(j["lf"])
    re, rf = wp(j["re"]), wp(j["rf"])
    lk, la, lt = wp(j["lk"]), wp(j["la"]), wp(j["lt"])
    rk, ra, rt = wp(j["rk"]), wp(j["ra"]), wp(j["rt"])

    rear = lerp_c(ink, (0, 0, 0), 0.28)
    seg(sh, hip, rk, 13, rear)
    seg(sh, rk, ra, 12, rear)
    seg(sh, ra, rt, 9, rear)
    seg(sh, neck, re, 11, rear)
    seg(sh, re, rf, 10, rear)

    seg(sh, hip, neck, 19, ink)
    seg(sh, hip, lk, 14, ink)
    seg(sh, lk, la, 13, ink)
    seg(sh, la, lt, 10, ink)
    seg(sh, neck, le, 12, ink)
    seg(sh, le, lf, 11, ink)

    sh.circle(lf[0], lf[1], 9, fill=ink)
    sh.circle(rf[0], rf[1], 9, fill=rear)
    sh.circle(lt[0], lt[1], 8, fill=ink)
    sh.circle(rt[0], rt[1], 8, fill=rear)

    seg(sh, (hip[0] + facing * -14, hip[1] - 4), (hip[0] + facing * 14, hip[1] - 4), 6, accent)

    draw_head(sh, head, fd, facing, ink, accent)
    draw_scarf(sh, neck, fd, facing, pose.get("t", 0.0))

    return dict(head=head, neck=neck, hip=hip,
                chest=(lerp(hip[0], neck[0], 0.6), lerp(hip[1], neck[1], 0.6)),
                lf=lf, rf=rf, lt=lt)


def draw_head(p, head, fd, facing, ink, accent):
    hx, hy = head
    r = HEAD_R
    p.circle(hx, hy, r, fill=ink)
    p.arc((hx - r, hy - r, hx + r, hy + r), 200, 340, w=6, fill=accent)
    fl = math.sin(fd.get("_tf", 0.0) * 9.0) * 6
    p.line([(hx - facing * r * 0.6, hy - r * 0.55),
            (hx - facing * (r + 26), hy - r * 0.55 + fl)], w=5, fill=accent)
    p.line([(hx - facing * r * 0.6, hy - r * 0.4),
            (hx - facing * (r + 20), hy - r * 0.4 - fl)], w=4, fill=accent)

    ex = hx + facing * r * 0.34
    ey = hy - r * 0.05
    p.circle(ex, ey, 3.4, fill=(255, 255, 255))
    p.circle(ex + facing * 1.2, ey, 1.7, fill=(20, 20, 28))
    p.line([(ex - facing * 6, ey - 8), (ex + facing * 5, ey - 5)], w=3, fill=accent)

    if fd["hair"] == "topknot":
        p.circle(hx, hy - r - 4, 6, fill=accent)
        p.line([(hx, hy - r), (hx, hy - r - 6)], w=5, fill=ink)
    else:
        for k in (-1, 0, 1):
            bx = hx + k * 10
            p.line([(bx, hy - r + 3), (bx + k * 4 - facing * 2, hy - r - 16)],
                   w=5, fill=accent)


def draw_scarf(p, neck, fd, facing, t):
    x, y = neck
    fl = math.sin(t * 11.0) * 8
    pts = [(x, y - 6), (x - facing * 54, y - 16 + fl),
           (x - facing * 46, y + 6 + fl), (x, y + 2)]
    p.poly_out(pts, fd["accent"], ol=lerp_c(fd["accent"], (0, 0, 0), 0.4), w=4)


# ----------------------------------------------------------------------------
# POSES — every action returns overrides on top of a fighting-guard base.
# angles are LOCAL (facing +x).  ta: torso (up = -90).  arms/legs absolute deg.
# ----------------------------------------------------------------------------
def base_guard(f, t, side_bob=0.0):
    b = math.sin(t * 3.1 + (0 if f == "ronin" else 1.6))
    return dict(
        ta=-88 + b * 1.6 + side_bob,
        lua=54, lfa=-30,
        rua=118, rfa=-6,
        lth=74, lsh=104,
        rth=112, rsh=84,
        lft=-6, rft=-6,
        rooty=BASE_ROOTY - b * 4,
    )


def merge(base, over):
    r = dict(base)
    r.update(over)
    return r


def strike_curve(p):
    """0..1 with a sharp peak around 0.34 (the moment of contact)."""
    if p < 0.34:
        return ease_out(p / 0.34, 2.2)
    return 1.0 - ease_in((p - 0.34) / 0.66, 2.0) * 0.92


def pose_action(f, kind, p, t, prm):
    g = base_guard(f, t)
    if kind in ("guard", "circle"):
        sway = math.sin(t * 2.2 + (0 if f == "ronin" else 3.0)) * 6
        return merge(g, dict(lth=74 + sway * 0.3, rth=112 - sway * 0.3,
                             ta=g["ta"] + sway * 0.2, lua=54 + sway, rua=118 - sway))

    if kind == "walk":
        s = math.sin(p * math.tau * 2)
        c = math.cos(p * math.tau * 2)
        return merge(g, dict(
            lth=74 + s * 26, lsh=104 + c * 18, rth=112 - s * 26, rsh=84 - c * 18,
            ta=-86 + s * 3, rooty=BASE_ROOTY - abs(s) * 6,
            lua=54 + s * 8, rua=118 - s * 8))

    if kind == "jab":
        k = strike_curve(p)
        return merge(g, dict(lua=lerp(54, -6, k), lfa=lerp(-30, 2, k),
                             rua=118 + k * 8, ta=-88 - k * 4,
                             lth=70, lsh=106, rooty=BASE_ROOTY - k * 4))

    if kind == "hook":
        k = strike_curve(p)
        return merge(g, dict(lua=lerp(70, 6, k), lfa=lerp(20, -18, k),
                             rua=118 + k * 14, ta=-88 - k * 6,
                             rooty=BASE_ROOTY - k * 6, lth=68, lsh=108))

    if kind == "cross":
        k = strike_curve(p)
        return merge(g, dict(rua=lerp(120, -4, k), rfa=lerp(-6, 6, k),
                             lua=54 + k * 20, ta=-86 - k * 6,
                             rooty=BASE_ROOTY - k * 6, lth=70, lsh=106, rth=110, rsh=86))

    if kind == "upper":
        k = strike_curve(p)
        return merge(g, dict(lua=lerp(70, -40, k), lfa=lerp(30, -70, k),
                             ta=-88 - k * 8, rooty=BASE_ROOTY - k * 10,
                             lth=72, lsh=104))

    if kind == "kick":
        k = strike_curve(p)
        return merge(g, dict(lth=lerp(74, 8, k), lsh=lerp(104, 20, k), lft=lerp(-6, 4, k),
                             rth=108, rsh=92, ta=-84 - k * 8,
                             rooty=BASE_ROOTY + k * 4, lua=40, rua=120))

    if kind == "sweep":
        k = strike_curve(p)
        return merge(g, dict(lth=lerp(80, 4, k), lsh=lerp(96, 16, k),
                             rth=110, rsh=80, ta=-84 - k * 10,
                             rooty=BASE_ROOTY + k * 12, lua=60, rua=130))

    if kind == "windup":
        k = smooth(p)
        return merge(g, dict(rua=lerp(120, 250, k), rfa=lerp(-6, 40, k),
                             lua=lerp(54, 300, k), ta=-88 - k * 6,
                             rooty=BASE_ROOTY - k * 6, lth=70, lsh=104, rth=112, rsh=84))

    if kind == "spinkick":
        k = strike_curve(p)
        return merge(g, dict(lth=lerp(60, -6, k), lsh=lerp(90, 6, k),
                             ta=-84 - k * 10, rooty=BASE_ROOTY + k * 6,
                             rth=104, rsh=88, rua=250, rfa=60, lua=300))

    if kind == "block":
        k = 0.5 + 0.5 * math.sin(t * 20) * (1 - p)
        return merge(g, dict(lua=lerp(54, 20, 0.7), lfa=lerp(-30, -70, 0.7),
                             rua=lerp(118, 60, 0.7), rfa=lerp(-6, -70, 0.7),
                             ta=-90 - k * 3, rooty=BASE_ROOTY - 8 - k * 3,
                             lth=76, lsh=100, rth=110, rsh=86))

    if kind == "dodge":
        k = math.sin(p * math.pi)
        return merge(g, dict(ta=-88 - k * 16, rooty=BASE_ROOTY - k * 6,
                             lua=54 - k * 20, rua=118 + k * 10, lth=80, rth=106))

    if kind == "hit":
        k = strike_curve(p)
        return merge(g, dict(ta=-88 + k * 22, rooty=BASE_ROOTY + k * 8,
                             lua=54 + k * 40, lfa=-30 + k * 20,
                             rua=118 + k * 20, lth=70 - k * 6, rth=116 + k * 8))

    if kind == "knockdown":
        k = ease_in_out(p)
        return merge(g, dict(ta=lerp(-88, -8, k), rooty=BASE_ROOTY + k * 150,
                             lua=lerp(54, 120, k), lfa=lerp(-30, 40, k),
                             rua=lerp(118, 150, k), rfa=lerp(-6, 30, k),
                             lth=lerp(74, 96, k), lsh=lerp(104, 92, k),
                             rth=lerp(112, 80, k), rsh=lerp(84, 96, k)))

    if kind == "getup":
        k = ease_in_out(p)
        return merge(g, dict(ta=lerp(-8, -88, k),
                             rooty=lerp(BASE_ROOTY + 150, BASE_ROOTY, k),
                             lua=lerp(120, 54, k), rua=lerp(150, 118, k),
                             lth=lerp(96, 74, k), rth=lerp(80, 112, k)))

    if kind == "ko":
        return merge(g, dict(ta=-6, rooty=BASE_ROOTY + 156,
                             lua=120, lfa=40, rua=150, rfa=30,
                             lth=96, lsh=92, rth=80, rsh=96, lft=10, rft=10))

    if kind == "flyback":
        k = strike_curve(p)
        return merge(g, dict(ta=-88 + k * 60, rooty=BASE_ROOTY + k * 40,
                             lua=54 + k * 90, rua=118 + k * 70,
                             lth=74 + k * 40, rth=112 + k * 30))

    if kind == "victory":
        k = smooth(p)
        b = math.sin(t * 3.0) * 2
        return merge(g, dict(lua=lerp(54, 250, k), lfa=lerp(-30, 250, k),
                             rua=118 + k * 6, ta=-90 + b,
                             rooty=BASE_ROOTY - k * 4 + b, lth=74, rth=112))

    return g


# ----------------------------------------------------------------------------
# CHOREOGRAPHY  (per-fighter action schedule + hit / whoosh / freeze events)
# ----------------------------------------------------------------------------
def sched(*rows):
    return sorted(rows, key=lambda r: r[0])


RONIN_ACTIONS = sched(
    (0.0, 5.0, "guard"),
    (5.0, 10.5, "circle"),
    (10.5, 15.0, "guard"),
    (15.0, 16.4, "block"),
    (16.4, 18.2, "guard"),
    (17.3, 18.0, "jab"),
    (18.0, 19.0, "guard"),
    (18.9, 19.6, "kick"),
    (19.6, 21.4, "guard"),
    (21.4, 22.1, "block"),
    (22.1, 25.0, "guard"),
    (25.0, 26.0, "circle"),
    (26.6, 27.4, "sweep"),
    (27.4, 30.8, "guard"),
    (30.8, 34.0, "circle"),
    (34.3, 35.0, "jab"),
    (35.0, 36.3, "guard"),
    (36.2, 36.9, "hook"),
    (36.9, 37.3, "guard"),
    (37.2, 38.0, "upper"),
    (38.0, 38.9, "guard"),
    (38.9, 40.3, "windup"),
    (40.3, 44.5, "guard"),
    (45.4, 47.0, "windup"),
    (47.0, 47.5, "spinkick"),
    (47.5, 53.0, "guard"),
    (53.0, 60.0, "victory"),
)

BLAZE_ACTIONS = sched(
    (0.0, 5.0, "guard"),
    (5.0, 8.2, "circle"),
    (7.9, 8.5, "jab"),
    (8.5, 11.0, "circle"),
    (10.8, 11.5, "hook"),
    (11.5, 15.0, "circle"),
    (15.4, 16.2, "hook"),
    (16.2, 17.4, "guard"),
    (17.6, 18.0, "hit"),
    (18.0, 19.0, "guard"),
    (19.2, 19.6, "hit"),
    (19.6, 21.4, "guard"),
    (21.4, 22.1, "upper"),
    (22.1, 25.0, "guard"),
    (25.0, 26.2, "walk"),
    (26.2, 26.9, "hook"),
    (26.9, 27.3, "guard"),
    (27.1, 27.6, "knockdown"),
    (27.6, 29.4, "getup"),
    (29.4, 34.0, "guard"),
    (34.3, 35.0, "guard"),
    (34.7, 35.2, "hit"),
    (35.2, 36.4, "guard"),
    (35.6, 36.3, "hook"),
    (36.3, 36.9, "guard"),
    (36.6, 37.0, "block"),
    (37.0, 37.6, "guard"),
    (37.7, 38.2, "hit"),
    (38.2, 40.0, "guard"),
    (40.0, 40.6, "hit"),
    (40.6, 44.5, "guard"),
    (47.1, 47.7, "flyback"),
    (47.7, 60.0, "ko"),
)


def circle_x(f, t):
    if f == "ronin":
        return 780 + math.sin(t * 1.1) * 40
    return 1150 + math.sin(t * 1.1 + 2.2) * 40


def pos_for(f, kind, p, t):
    base = circle_x(f, t)
    if kind == "walk" and f == "blaze":
        return lerp(base, 980, ease_in_out(p))
    if kind == "windup" and f == "ronin":
        return lerp(base, 900, smooth(p) * 0.6)
    if kind == "spinkick":
        return lerp(900, 940, ease_out(p))
    if kind in ("knockdown", "getup", "ko"):
        return lerp(1080, 1160, clamp((t - 27.0) / 2.0))
    if kind == "flyback":
        return lerp(1160, 1320, ease_out(p))
    return base


def fighter_state(f, t, freeze_t=None):
    tt = freeze_t if freeze_t is not None else t
    actions = RONIN_ACTIONS if f == "ronin" else BLAZE_ACTIONS
    kind, p = "guard", 0.0
    for (t0, t1, k) in actions:
        if t0 <= tt < t1:
            kind, p = k, clamp((tt - t0) / (t1 - t0))
            break
    else:
        kind, p = actions[-1][2], 1.0
    pose = pose_action(f, kind, p, tt, {})
    pose["rootx"] = pos_for(f, kind, p, tt)
    pose["_kind"] = kind
    pose["_p"] = p
    return pose


# ----------------------------------------------------------------------------
# HITS / WHOOSHES / FREEZES — shared with the audio module for perfect sync
# ----------------------------------------------------------------------------
# (t_land, victim, part, strength 0..1, comic word, damage, sfx)
HITS = [
    (16.0, "ronin", "head", 0.45, "BAM!",   8,  "impact_light"),
    (17.75, "blaze", "head", 0.55, "POW!",  10, "impact"),
    (19.35, "blaze", "body", 0.6, "WHAM!",  12, "impact"),
    (21.9, "ronin", "guard", 0.5, "CLANG!", 6, "clang"),
    (27.1, "blaze", "legs", 0.8, "THUD!",  18, "impact_heavy"),
    (34.8, "blaze", "head", 0.55, "POW!",  8,  "impact"),
    (36.0, "ronin", "head", 0.5, "BAM!",   8,  "impact"),
    (36.75, "blaze", "guard", 0.55, "CLANG!", 4, "clang"),
    (37.85, "blaze", "head", 0.7, "WHAM!", 12, "impact"),
    (40.2, "blaze", "head", 1.0, "K.O.?", 25, "impact_heavy"),
    (47.2, "blaze", "head", 1.0, "FINISH!", 100, "finisher"),
]

WHOOSHES = [
    (8.2, "blaze", "jab"),
    (11.2, "blaze", "hook"),
    (26.6, "blaze", "hook"),
]

FREEZES = [
    (27.1, 27.55),
    (40.2, 40.7),
    (47.2, 48.0),
]


def health_at(f, t):
    hp = 100.0
    for (tl, victim, part, s, word, dmg, sfx) in HITS:
        if victim == f and tl <= t:
            hp -= dmg
    return clamp(hp / 100.0)


def in_freeze(t):
    for (t0, t1) in FREEZES:
        if t0 <= t < t1:
            return t0
    return None


# ----------------------------------------------------------------------------
# CAMERA
# ----------------------------------------------------------------------------
def scene_bounds(t):
    return [
        (0.0, 4.5, 960, 540, 1.02),
        (4.5, 15.0, 965, 560, 1.10),
        (15.0, 24.0, 960, 570, 1.16),
        (24.0, 34.0, 960, 575, 1.12),
        (34.0, 45.0, 960, 565, 1.20),
        (45.0, 53.0, 960, 560, 1.24),
        (53.0, 60.0, 900, 545, 1.04),
    ]


def scene_cam(t):
    rows = scene_bounds(t)
    for i, (t0, t1, cx, cy, z) in enumerate(rows):
        if t0 <= t < t1 or (i == len(rows) - 1 and t >= t0):
            if i < len(rows) - 1:
                nt0, nt1, ncx, ncy, nz = rows[i + 1]
                k = smooth(seq(t1 - 0.7, t1, t))
                cx, cy, z = lerp(cx, ncx, k), lerp(cy, ncy, k), lerp(z, nz, k)
            return cx, cy, z
    return rows[0][2], rows[0][3], rows[0][4]


def hit_pulse(t):
    zoom = 0.0
    shx = shy = 0.0
    for (tl, victim, part, s, word, dmg, sfx) in HITS:
        d = t - tl
        if 0 <= d < 0.5:
            e = math.exp(-d / 0.16) * s
            zoom += 0.16 * e
            ph = tl * 12.9898
            shx += math.sin(d * 60 + ph) * 16 * e
            shy += math.cos(d * 71 + ph) * 12 * e
    return zoom, shx, shy


def camera(t):
    cx, cy, z = scene_cam(t)
    pz, shx, shy = hit_pulse(t)
    hx = math.sin(t * 0.9) * 4 + math.sin(t * 2.3) * 2
    hy = math.cos(t * 0.7) * 3
    return dict(cx=cx, cy=cy, zoom=z + pz, shakex=shx + hx, shakey=shy + hy)


# ----------------------------------------------------------------------------
# BACKGROUND
# ----------------------------------------------------------------------------
def draw_sky(base, mood, t):
    g = grad_cached("sky_" + mood, *MOODS[mood])
    base.alpha_composite(g.convert("RGBA"))


def draw_sun(p, mood, t):
    if mood == "night":
        p.circle(1500, 210, 62, fill=(238, 240, 255))
        p.circle(1478, 196, 58, fill=(30, 28, 60))
        for i in range(40):
            a = i * 2.399
            r = 90 + (i % 5) * 26
            p.circle(1500 + math.cos(a) * r, 210 + math.sin(a) * r,
                     1.6 + (i % 3), fill=(255, 255, 255, 170))
    else:
        sx, sy = 1560, 300
        glow, gp = new_layer()
        gp.circle(sx, sy, 210, fill=(255, 226, 160, 120))
        glow = glow.filter(ImageFilter.GaussianBlur(int(70 * SS)))
        p.d._image.alpha_composite(glow)
        p.circle(sx, sy, 78, fill=(255, 240, 200))


def draw_ridge(p, base_y, amp, color, seed, parallax, camx, w=W, step=26):
    rnd = random.Random(seed)
    pts = [(0, base_y + 200)]
    x = 0.0
    phase = rnd.uniform(0, 6.28)
    while x <= w + step:
        y = base_y + math.sin(x * 0.004 + phase) * amp + math.sin(x * 0.011 + seed) * amp * 0.4
        pts.append((x, y))
        x += step
    pts.append((w, base_y + 300))
    pts = [(px - camx * parallax, py) for (px, py) in pts]
    p.poly(pts, fill=color)


def draw_city(p, base_y, color, camx, parallax=0.5):
    rnd = random.Random(1234)
    x = -100 - camx * parallax
    while x < W + 100:
        bw = rnd.uniform(46, 96)
        bh = rnd.uniform(70, 230)
        p.rect((x, base_y - bh, x + bw, base_y + 40), fill=color)
        for wy in range(int(base_y - bh + 14), int(base_y - 8), 22):
            for wx in range(int(x + 8), int(x + bw - 8), 18):
                if rnd.random() < 0.16:
                    p.rect((wx, wy, wx + 6, wy + 9), fill=(255, 214, 130))
        x += bw + rnd.uniform(8, 26)


def draw_floor(p, camx, mood):
    top = GROUND
    p.rect((-40, top, W + 40, H + 40), fill=(52, 40, 60))
    p.rect((-40, top, W + 40, top + 14), fill=(70, 54, 80))
    for i in range(1, 9):
        y = top + (H - top) * (i / 9.0) ** 1.5
        p.line([(-40, y), (W + 40, y)], w=2, fill=(38, 28, 48, 160))
    p.line([(-40, top + 14), (W + 40, top + 14)], w=3, fill=(255, 200, 140, 120))


def draw_crowd_front(p, t, camx):
    y = H - 30
    for i in range(26):
        x = i * 78 + (camx * 0.15 % 78) - 40
        bob = math.sin(t * 3 + i) * 5
        r = 20 + (i % 3) * 4
        p.circle(x, y - 26 + bob, r, fill=(16, 12, 24, 235))
        p.ellipse((x - 26, y - 6 + bob, x + 26, y + 40), fill=(16, 12, 24, 235))


def draw_embers(p, t, camx, n=26):
    rnd = random.Random(7)
    for i in range(n):
        sx = rnd.uniform(0, W)
        sy = rnd.uniform(120, GROUND)
        sp = 12 + (i % 5) * 7
        y = (sy - t * sp) % (GROUND - 80) + 60
        x = sx + math.sin(t * 0.8 + i) * 24 - camx * 0.1
        a = int(120 + 120 * math.sin(t * 2 + i))
        p.circle(x, y, 1.6 + (i % 3), fill=(255, 170, 90, a))


# ----------------------------------------------------------------------------
# EFFECTS
# ----------------------------------------------------------------------------
def starburst(p, x, y, r, spikes, rot, fill, ink, alpha=255):
    pts = []
    for i in range(spikes * 2):
        a = rot + i * math.pi / spikes
        rr = r if i % 2 == 0 else r * 0.5
        pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr))
    p.poly(pts, fill=fill[:3] + (alpha,))
    p.line(pts + [pts[0]], w=3, fill=ink[:3] + (alpha,))


def impact_hit(p, x, y, s, t_land, t, accent):
    d = t - t_land
    if d < 0 or d > 0.42:
        return
    k = ease_out(d / 0.42, 2.0)
    r = (40 + 150 * s) * (0.4 + 1.5 * (1 - math.exp(-d * 22)))
    rot = t_land * 3.0
    core, cp = new_layer()
    cp.circle(x, y, r * 0.55, fill=(255, 255, 240, int(220 * (1 - k))))
    core = core.filter(ImageFilter.GaussianBlur(int(10 * SS)))
    p.d._image.alpha_composite(core)
    starburst(p, x, y, r, 9, rot, (255, 236, 120), (40, 30, 20), int(235 * (1 - k * 0.8)))
    starburst(p, x, y, r * 0.62, 7, -rot, accent, (255, 255, 255), int(200 * (1 - k)))
    for i in range(8):
        a = rot + i * math.pi / 4
        r0, r1 = r * 0.7, r * (1.5 + 0.5 * math.sin(i + t_land))
        p.line([(x + math.cos(a) * r0, y + math.sin(a) * r0),
                (x + math.cos(a) * r1, y + math.sin(a) * r1)],
               w=3, fill=(255, 255, 255, int(150 * (1 - k))))


def dust_puff(p, x, y, r, alpha):
    c, cp = new_layer()
    cp.circle(x, y, r, fill=(220, 210, 200, alpha))
    c = c.filter(ImageFilter.GaussianBlur(int(6 * SS)))
    p.d._image.alpha_composite(c)


def ko_stars(p, x, y, t, t0):
    if t < t0:
        return
    for i in range(4):
        a = t * 4 + i * math.pi / 2
        r = 34 + math.sin(t * 6 + i) * 5
        sx, sy = x + math.cos(a) * r, y - 14 + math.sin(a) * r * 0.5
        starburst(p, sx, sy, 9, 5, a, (255, 226, 90), (60, 40, 10))


def comic_word(target, x, y, text, size, rot, fill, t_land, t, life=0.9, pop_from=1.0):
    """rotated, ink-outlined comic word drawn at native 1080p onto `target`."""
    d = t - t_land
    if d < 0 or d > life:
        return
    k = d / life
    if k < 0.18:
        sc = pop_from + (1 - pop_from) * ease_out_back(k / 0.18, 3.2)
    else:
        sc = 1.0
    alpha = 255 if k < 0.6 else int(255 * (1 - (k - 0.6) / 0.4))
    f = font(int(size * sc))
    bbox = f.getbbox(text)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad = 20
    tile = Image.new("RGBA", (tw + pad * 2, th + pad * 2), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    cx, cy = tile.size[0] / 2, tile.size[1] / 2
    td.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), text, font=f,
            fill=fill[:3] + (alpha,), stroke_width=6, stroke_fill=(28, 22, 30, alpha))
    tile = tile.rotate(rot, resample=Image.BICUBIC, expand=True)
    target.alpha_composite(tile, (int(x - tile.size[0] / 2), int(y - tile.size[1] / 2)))


# ----------------------------------------------------------------------------
# WORLD RENDER
# ----------------------------------------------------------------------------
def render_world(t):
    mood = "night"
    if t >= 4.5:
        mood = "dusk"
    if t >= 34.0:
        mood = "blaze"
    if t >= 53.0:
        mood = "golden"

    fz = in_freeze(t)
    wt = fz if fz is not None else t
    cam = camera(t)
    camx = cam["cx"]

    base = Image.new("RGBA", (int(W * SS), int(H * SS)), (0, 0, 0, 255))
    draw_sky(base, mood, wt)
    bp = Pen(ImageDraw.Draw(base))
    draw_sun(bp, mood, wt)
    draw_ridge(bp, 690, 60, lerp_c((30, 26, 56), MOODS[mood][1], 0.25), 3, 0.18, camx)
    draw_ridge(bp, 740, 44, (26, 22, 46), 8, 0.34, camx)
    draw_city(bp, 800, (22, 18, 38), camx, parallax=0.5)
    draw_floor(bp, camx, mood)
    draw_embers(bp, wt, camx)

    flayer, fp = new_layer()
    ps = {f: fighter_state(f, wt, freeze_t=fz) for f in ("ronin", "blaze")}
    FIGHTERS["ronin"]["_tf"] = wt
    FIGHTERS["blaze"]["_tf"] = wt

    def ghosts_for(f):
        kind = ps[f]["_kind"]
        if kind in ("jab", "hook", "cross", "upper", "kick", "sweep", "spinkick", "windup"):
            if ps[f]["_p"] < 0.55:
                g0 = fighter_state(f, max(0, wt - 0.05), freeze_t=fz)
                g1 = fighter_state(f, max(0, wt - 0.10), freeze_t=fz)
                return [(g0, 90), (g1, 45)]
        return []

    pts = {}
    for f in ("blaze", "ronin"):
        pts[f] = draw_fighter(fp, f, FIGHTERS[f], ps[f], ghosts_for(f))

    base.alpha_composite(flayer)

    ilayer, ip = new_layer()
    for (tl, victim, part, s, word, dmg, sfx) in HITS:
        if 0 <= t - tl <= 0.45:
            pt = pts[victim]
            if part == "head":
                hx, hy = pt["head"]
            elif part == "body":
                hx, hy = pt["chest"]
            elif part == "legs":
                hx, hy = (pt["hip"][0], pt["hip"][1] + 60)
            else:
                hx, hy = pt["chest"]
            impact_hit(ip, hx, hy, s, tl, t, FIGHTERS[victim]["accent"])

    if health_at("blaze", t) <= 0.001 and t > 48.5:
        hp = pts["blaze"]["head"]
        ko_stars(ip, hp[0], hp[1], t, 48.5)

    base.alpha_composite(ilayer)

    clayer, cp = new_layer()
    draw_crowd_front(cp, wt, camx)
    base.alpha_composite(clayer)

    return base, cam, ps


# ----------------------------------------------------------------------------
# POST / SCREEN OVERLAY
# ----------------------------------------------------------------------------
def proj(cam, x, y):
    cw = W / cam["zoom"]
    left = cam["cx"] - cw / 2 + cam["shakex"]
    top = cam["cy"] - (H / cam["zoom"]) / 2 + cam["shakey"]
    return ((x - left) * cam["zoom"], (y - top) * cam["zoom"])


_GRAD_CACHE["vig"] = None


def vignette(img, strength=0.30):
    if _GRAD_CACHE["vig"] is None or _GRAD_CACHE["vig"].size != img.size:
        w_, h_ = img.size
        yy, xx = np.mgrid[0:h_, 0:w_]
        nx = (xx / w_ - 0.5) * 2
        ny = (yy / h_ - 0.5) * 2
        r = np.sqrt(nx * nx * 0.9 + ny * ny)
        v = np.clip(1.0 - strength * np.clip(r - 0.5, 0, 3) ** 1.6, 0.0, 1.0)
        _GRAD_CACHE["vig"] = Image.fromarray((v * 255).astype(np.uint8), "L")
    return Image.composite(img, Image.new("RGB", img.size, (10, 8, 18)),
                           _GRAD_CACHE["vig"])


_GRAIN = None


def add_grain(img, t):
    global _GRAIN
    if _GRAIN is None:
        rnd = np.random.default_rng(5)
        _GRAIN = [((rnd.normal(0, 1, (H, W)) * 10).astype(np.int16)) for _ in range(6)]
    g = _GRAIN[int(t * FPS) % 6]
    arr = np.asarray(img).astype(np.int16)
    arr = np.clip(arr + g[:, :, None], 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def draw_healthbars(img, t):
    layer, pen = new_screen_layer()

    def bar(x0, y0, w, h, frac, col, flip):
        pen.rrect((x0, y0, x0 + w, y0 + h), h / 2, fill=(20, 18, 28, 210),
                  outline=(240, 240, 245, 255), width=3)
        iw = (w - 12) * frac
        if flip:
            pen.rrect((x0 + 6 + (w - 12) - iw, y0 + 6, x0 + w - 6, y0 + h - 6),
                      (h - 12) / 2, fill=col + (255,))
        else:
            pen.rrect((x0 + 6, y0 + 6, x0 + 6 + iw, y0 + h - 6),
                      (h - 12) / 2, fill=col + (255,))
    bar(48, 50, 440, 38, health_at("ronin", t), FIGHTERS["ronin"]["accent"], flip=False)
    bar(W - 48 - 440, 50, 440, 38, health_at("blaze", t), FIGHTERS["blaze"]["accent"], flip=True)
    pen.text((48 + 220, 34), "RONIN", 30, fill=(255, 255, 255), ink=(20, 16, 30), sw=4)
    pen.text((W - 48 - 220, 34), "BLAZE", 30, fill=(255, 255, 255), ink=(20, 16, 30), sw=4)
    img.alpha_composite(layer)
    return img


def draw_letterbox(img):
    layer, pen = new_screen_layer()
    bh = int(H * 0.052)
    pen.rect((0, 0, W, bh), fill=(8, 6, 14, 255))
    pen.rect((0, H - bh, W, H), fill=(8, 6, 14, 255))
    img.alpha_composite(layer)
    return img


def screen_overlay(img, cam, ps, t):
    ov, pen = new_screen_layer()
    for (tl, victim, part, s, word, dmg, sfx) in HITS:
        if 0 <= t - tl <= 0.95:
            pt = pts_screen(cam, ps, victim, part)
            wob = math.sin((t - tl) * 30) * 3
            comic_word(ov, pt[0] + wob, pt[1] - 46, word, 66 + 44 * s,
                       (random.random() - 0.5) * 16, (255, 232, 90), tl, t,
                       life=0.9, pop_from=1.9)
    for (tw, att, kind) in WHOOSHES:
        if 0 <= t - tw <= 0.28:
            pt = pts_screen(cam, ps, att, "head")
            for i in range(4):
                a = (i / 4) * math.tau + tw
                r0, r1 = 40, 40 + 130 * (1 - (t - tw) / 0.28)
                pen.line([(pt[0] + math.cos(a) * r0, pt[1] + math.sin(a) * r0),
                          (pt[0] + math.cos(a) * r1, pt[1] + math.sin(a) * r1)],
                         w=3, fill=(255, 255, 255, 150))
    img.alpha_composite(ov)
    return img


def pts_screen(cam, ps, f, part):
    fd = FIGHTERS[f]
    rootx, rooty, facing = ps[f]["rootx"], ps[f]["rooty"], fd["facing"]
    j = fk(ps[f])
    if part == "head":
        lp = j["head"]
    elif part == "body":
        lp = (j["hip"][0] * 0.4 + j["neck"][0] * 0.6,
              j["hip"][1] * 0.4 + j["neck"][1] * 0.6)
    else:
        lp = j["hip"]
    wp = to_world(lp, rootx, rooty, facing)
    return proj(cam, wp[0], wp[1])


# ----------------------------------------------------------------------------
# FRAME
# ----------------------------------------------------------------------------
def render_frame(i):
    t = i / FPS
    world, cam, ps = render_world(t)

    cw = W / cam["zoom"]
    ch = H / cam["zoom"]
    left = cam["cx"] - cw / 2 + cam["shakex"]
    top = cam["cy"] - ch / 2 + cam["shakey"]
    box = (int(left * SS), int(top * SS), int((left + cw) * SS), int((top + ch) * SS))
    crop = world.crop(box)

    if in_freeze(t) is not None:
        crop = crop.filter(ImageFilter.GaussianBlur(3.0))

    img = crop.resize((W, H), Image.LANCZOS).convert("RGBA")
    img = screen_overlay(img, cam, ps, t)
    img = draw_healthbars(img, t)

    for (tl, victim, part, s, word, dmg, sfx) in HITS:
        d = t - tl
        if s >= 0.8 and 0 <= d < 0.22:
            k = 1 - d / 0.22
            flash, fpn = new_screen_layer()
            fpn.rect((0, 0, W, H), fill=(255, 255, 255, int(190 * k ** 1.3)))
            img.alpha_composite(flash)

    img = draw_cards(img, t)
    draw_letterbox(img)
    out = img.convert("RGB")
    out = vignette(out)
    return out


def draw_cards(img, t):
    layer, pen = new_screen_layer()

    a = int(255 * smooth(seq(0.2, 1.0, t)) * (1 - smooth(seq(3.6, 4.3, t))))
    if a > 0:
        pen.text((W / 2, 320), "STICK RIVALS", 92, fill=(255, 232, 90, a),
                 ink=(20, 16, 30, a), sw=10)
        pen.text((W / 2, 408), "A 60-SECOND SHOWDOWN", 28, fill=(255, 255, 255, a),
                 ink=(20, 16, 30, a), sw=5)
        pen.text((W / 2 - 340, 566), "RONIN", 58, fill=FIGHTERS["ronin"]["accent"] + (a,),
                 ink=(10, 10, 20, a), sw=7)
        pen.text((W / 2 + 340, 566), "BLAZE", 58, fill=FIGHTERS["blaze"]["accent"] + (a,),
                 ink=(10, 10, 20, a), sw=7)
        pen.text((W / 2, 566), "VS", 70, fill=(255, 255, 255, a), ink=(10, 10, 20, a), sw=8)

    a = int(255 * smooth(seq(53.2, 53.9, t)))
    if a > 0 and t < 57.5:
        pen.text((W / 2, 300), "RONIN WINS!", 92, fill=(255, 232, 90, a),
                 ink=(20, 16, 30, a), sw=10)
        pen.text((W / 2, 396), ar("K.O.  ·  رونين يفوز"), 28, fill=(255, 255, 255, a),
                 ink=(20, 16, 30, a), sw=5)

    if t >= 57.0:
        fade = int(255 * (1 - smooth(seq(59.4, 60.0, t))))
        pen.rect((0, 0, W, H), fill=(10, 8, 18, int(220 * smooth(seq(57.0, 57.8, t)))))
        pen.text((W / 2, H / 2 - 20), "STICK RIVALS", 104, fill=(255, 232, 90, fade),
                 ink=(10, 8, 18, fade), sw=10)
        pen.text((W / 2, H / 2 + 80), "two sticks. one winner.", 32,
                 fill=(220, 224, 240, fade), ink=(10, 8, 18, fade), sw=5)
    img.alpha_composite(layer)
    return img


# ----------------------------------------------------------------------------
# cli / encode
# ----------------------------------------------------------------------------
args_workers = 2


def _worker(args):
    i, outdir = args
    img = render_frame(i)
    if outdir is None:
        return i, img.tobytes()
    path = os.path.join(outdir, "f_%05d.png" % i)
    img.save(path, optimize=False, compress_level=1)
    return i, b""


def encode(out_path, audio_path, start, end):
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
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-level", "4.0", "-threads", "2",
            "-movflags", "+faststart", "-shortest", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    jobs = [(i, None) for i in range(start, end)]
    t0 = _time.time()
    with Pool(args_workers) as pool:
        for n, (i, raw) in enumerate(pool.imap(_worker, jobs, chunksize=2), 1):
            proc.stdin.write(raw)
            if n % 48 == 0 or n == len(jobs):
                el = _time.time() - t0
                print("frame %d/%d  %.0fs elapsed, eta %.0fs" %
                      (n, len(jobs), el, el / n * (len(jobs) - n)), flush=True)
    proc.stdin.close()
    rc = proc.wait()
    print("ffmpeg exit", rc, "in %.1fs" % (_time.time() - t0))
    return rc


def main():
    global args_workers
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=str, default=None)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--end", type=int, default=NFRAMES)
    ap.add_argument("--outdir", type=str, default="/tmp/frames")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--encode", type=str, default=None)
    ap.add_argument("--audio", type=str, default=None)
    a = ap.parse_args()
    args_workers = a.workers

    if a.preview:
        os.makedirs("/tmp/preview", exist_ok=True)
        for s in a.preview.split(","):
            t0 = _time.time()
            img = render_frame(int(float(s) * FPS))
            path = "/tmp/preview/sf_%05.2f.png" % float(s)
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
                print("frame %d/%d  %.1fs elapsed, eta %.1fs" %
                      (n, len(jobs), el, el / n * (len(jobs) - n)), flush=True)
    print("done in %.1fs" % (_time.time() - t0))


if __name__ == "__main__":
    main()
