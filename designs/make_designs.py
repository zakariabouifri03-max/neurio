#!/usr/bin/env python3
"""
Neurio — Etsy design pack generator
10 minimal ("rayhin") print-on-demand designs, exactly 1:1 (3000x3000 PNG, transparent).

Style system: thick clean line art + retro palette (burnt orange / mustard / teal / rust)
+ Bebas Neue display type + Montserrat taglines. Everything is drawn procedurally at
2x (6000px) and downsampled with Lanczos -> crisp anti-aliased vector-quality output.

Outputs
  designs/NN-name.png     3000x3000 RGBA transparent  (POD-ready: tee, mug, poster...)
  designs/previews/*.jpg  3000x3000 on cream           (Etsy listing photo)
  designs/preview-grid.jpg                            (contact sheet of all 10)

Run:  python3 designs/make_designs.py
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
PREV = os.path.join(HERE, "previews")
os.makedirs(PREV, exist_ok=True)

S = 6000       # supersample canvas
FINAL = 3000   # final square output (1:1 ratio)

# ── retro palette ──────────────────────────────────────────────────────────────
INK     = (43, 36, 31, 255)
CREAM   = (245, 237, 223, 255)
PAPER   = (252, 249, 242, 255)
ORANGE  = (216, 108, 41, 255)
MUSTARD = (233, 186, 62, 255)
TEAL    = (62, 141, 137, 255)
RUST    = (193, 76, 47, 255)
BROWN   = (124, 86, 58, 255)
NAVY    = (47, 66, 88, 255)
OLIVE   = (124, 126, 70, 255)
GOLD    = (198, 148, 46, 255)
CRUST   = (203, 143, 72, 255)


def F(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), int(size))


def lw(f):
    """line width at supersample scale"""
    return max(2, int(S * f))


# ── text helpers (with letter tracking) ────────────────────────────────────────
def tw(d, text, font, tr=0):
    if not text:
        return 0
    return sum(d.textlength(c, font=font) for c in text) + tr * (len(text) - 1)


def ttext(d, cx, cy, text, font, fill, tr=0):
    """centered tracked text, cy = vertical middle"""
    x = cx - tw(d, text, font, tr) / 2
    for c in text:
        d.text((x, cy), c, font=font, fill=fill, anchor="lm")
        x += d.textlength(c, font=font) + tr


def fit_font(d, text, maxw, start, tr_ratio=0.02, name="BebasNeue_400Regular.ttf"):
    size = start
    while size > 30:
        f = F(name, size)
        if tw(d, text, f, int(size * tr_ratio)) <= maxw:
            return f, int(size * tr_ratio)
        size -= 6
    return F(name, 30), int(30 * tr_ratio)


# ── shape helpers ──────────────────────────────────────────────────────────────
def poly(d, pts, fill=None, outline=INK, w=None):
    if fill:
        d.polygon(pts, fill=fill)
    if outline:
        d.line(list(pts) + [pts[0]], fill=outline, width=w or lw(0.008), joint="curve")


def circ(d, cx, cy, r, fill=None, outline=INK, w=None):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill, outline=outline,
              width=w or lw(0.008))


def dashed(d, p0, p1, dash, gap, fill, width):
    x0, y0 = p0
    x1, y1 = p1
    L = math.hypot(x1 - x0, y1 - y0)
    if L == 0:
        return
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    t = 0.0
    while t < L:
        t2 = min(t + dash, L)
        d.line([(x0 + ux * t, y0 + uy * t), (x0 + ux * t2, y0 + uy * t2)],
               fill=fill, width=width)
        t += dash + gap


def sparkle(d, cx, cy, r, fill):
    """4-point star"""
    pts = [(cx, cy - r), (cx + r * .28, cy - r * .28), (cx + r, cy),
           (cx + r * .28, cy + r * .28), (cx, cy + r),
           (cx - r * .28, cy + r * .28), (cx - r, cy),
           (cx - r * .28, cy - r * .28)]
    poly(d, pts, fill=fill, outline=None)


def paste_layer(img, box, fn, angle=0):
    """draw fn(ld, w, h) on a local layer and composite onto img (optional rotation)"""
    w, h = box[2] - box[0], box[3] - box[1]
    L = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(L)
    fn(ld, w, h, L)
    if angle:
        L = L.rotate(angle, expand=True, resample=Image.BICUBIC)
        cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
        img.alpha_composite(L, (int(cx - L.width / 2), int(cy - L.height / 2)))
    else:
        img.alpha_composite(L, (box[0], box[1]))


# ══════════════════════════════════════════════════════════════════════════════
#  ART — each function draws centered at (cx, cy) inside radius R
# ══════════════════════════════════════════════════════════════════════════════
def art_disc_golf(img, cx, cy, R):
    # retro sun with stripes
    def sun(ld, w, h, L):
        r = w * .48
        ccx, ccy = w / 2, h / 2
        circ(ld, ccx, ccy, r, fill=ORANGE, w=lw(0.009))
        for yy, col in ((-.22, MUSTARD), (.02, TEAL), (.26, MUSTARD), (.50, TEAL)):
            ld.rectangle([0, ccy + yy * r - .085 * r, w, ccy + yy * r + .085 * r], fill=col)
        # clip stripes to the sun with a mask
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).ellipse([ccx - r, ccy - r, ccx + r, ccy + r], fill=255)
        stripes = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        for yy, col in ((-.22, MUSTARD), (.02, TEAL), (.26, MUSTARD), (.50, TEAL)):
            ImageDraw.Draw(stripes).rectangle(
                [0, ccy + yy * r - .085 * r, w, ccy + yy * r + .085 * r], fill=col)
        stripes.putalpha(m)
        L.alpha_composite(stripes)
        circ(ld, ccx, ccy, r, outline=INK, w=lw(0.009))
    box = [int(cx - R * .62), int(cy - R * .72), int(cx + R * .62), int(cy + R * .42)]
    paste_layer(img, box, sun)

    d = ImageDraw.Draw(img)
    # mountains
    poly(d, [(cx - 1.02 * R, cy + .30 * R), (cx - .48 * R, cy - .12 * R),
             (cx + .06 * R, cy + .30 * R)], fill=TEAL, w=lw(0.009))
    poly(d, [(cx - .12 * R, cy + .30 * R), (cx + .34 * R, cy - .02 * R),
             (cx + 1.02 * R, cy + .30 * R)], fill=MUSTARD, w=lw(0.009))
    # basket
    by = cy + .30 * R
    d.line([(cx, by + .48 * R), (cx, by + .04 * R)], fill=INK, width=lw(0.011))
    poly(d, [(cx - .40 * R, by - .06 * R), (cx + .40 * R, by - .06 * R),
             (cx + .30 * R, by + .22 * R), (cx - .30 * R, by + .22 * R)],
         fill=None, w=lw(0.009))
    d.line([(cx - .40 * R, by - .06 * R), (cx + .40 * R, by - .06 * R)],
           fill=INK, width=lw(0.009))
    for i in range(-3, 4):  # chains
        x = cx + i * .105 * R
        d.line([(x, by - .06 * R), (x + (i % 2) * .03 * R, by + .16 * R)],
               fill=INK, width=lw(0.005))
        circ(d, x + (i % 2) * .03 * R, by + .17 * R, R * .022, fill=None, w=lw(0.004))
    poly(d, [(cx, by - .18 * R), (cx + .16 * R, by - .12 * R), (cx, by - .06 * R)],
         fill=RUST, outline=None)
    d.line([(cx, by - .18 * R), (cx, by - .06 * R)], fill=INK, width=lw(0.005))
    # ground + grass
    d.line([(cx - 1.05 * R, by + .48 * R), (cx + 1.05 * R, by + .48 * R)],
           fill=INK, width=lw(0.009))
    for gx in (-.62, -.30, .38, .70):
        x = cx + gx * R
        d.line([(x, by + .48 * R), (x - .07 * R, by + .60 * R)], fill=INK, width=lw(0.005))
        d.line([(x, by + .48 * R), (x + .07 * R, by + .60 * R)], fill=INK, width=lw(0.005))
    # flying disc
    def disc(ld, w, h, L):
        ld.ellipse([0, h * .3, w, h * .7], fill=CREAM, outline=INK, width=lw(0.006))
    paste_layer(img, [int(cx - .95 * R), int(cy - .62 * R), int(cx - .55 * R),
                      int(cy - .42 * R)], disc, angle=18)


def art_mahjong(img, cx, cy, R):
    def tile(ld, w, h, kind):
        ld.rounded_rectangle([0, 0, w, h], radius=w * .12, fill=PAPER,
                             outline=INK, width=lw(0.009))
        if kind == "bamboo":
            for r_i in range(3):
                x = w * (.28 + r_i * .22)
                ld.line([(x, h * .18), (x, h * .78)], fill=TEAL, width=lw(0.008))
                for s in range(3):
                    yy = h * (.24 + s * .22)
                    ld.line([(x - w * .07, yy), (x + w * .07, yy)],
                            fill=TEAL, width=lw(0.007))
        elif kind == "dots":
            for r_i in range(2):
                for c_i in range(3):
                    x = w * (.30 + r_i * .40)
                    y = h * (.26 + c_i * .24)
                    circ(ld, x, y, w * .085, fill=ORANGE, outline=None)
        else:  # red dragon
            ld.rounded_rectangle([0, 0, w, h], radius=w * .12, fill=RUST,
                                 outline=INK, width=lw(0.009))
            bw = w * .11
            ld.rectangle([w * .5 - bw / 2, h * .22, w * .5 + bw / 2, h * .78], fill=INK)
            ld.rectangle([w * .28, h * .5 - bw / 2, w * .72, h * .5 + bw / 2], fill=INK)
    tw_, th_ = R * .78, R * 1.0
    paste_layer(img, [int(cx - tw_ * 1.06), int(cy - R * .18),
                      int(cx + tw_ * .06), int(cy - R * .18 + th_)],
                lambda ld, w, h, L: tile(ld, w, h, "bamboo"), angle=-9)
    paste_layer(img, [int(cx - tw_ * .06), int(cy - R * .18),
                      int(cx + tw_ * 1.06), int(cy - R * .18 + th_)],
                lambda ld, w, h, L: tile(ld, w, h, "dots"), angle=9)
    paste_layer(img, [int(cx - tw_ * .52), int(cy - R * .98),
                      int(cx + tw_ * .52), int(cy - R * .98 + th_)],
                lambda ld, w, h, L: tile(ld, w, h, "dragon"))
    d = ImageDraw.Draw(img)
    for sx, sy, r in ((-1.05, -.9, .045), (1.02, -.55, .035), (-.85, .55, .03)):
        sparkle(d, cx + sx * R, cy + sy * R, r * R, MUSTARD)


def art_pickleball(img, cx, cy, R):
    def paddle(ld, w, h, L):
        ld.rounded_rectangle([w * .12, 0, w * .88, h * .78], radius=w * .3,
                             fill=TEAL, outline=INK, width=lw(0.009))
        ld.rounded_rectangle([w * .34, h * .74, w * .66, h], radius=w * .12,
                             fill=BROWN, outline=INK, width=lw(0.008))
        for r_i in range(3):
            for c_i in range(4):
                x = w * (.26 + c_i * .16)
                y = h * (.14 + r_i * .18)
                circ(ld, x, y, w * .038, fill=CREAM, outline=None)
    paste_layer(img, [int(cx - R * .58), int(cy - R * .78), int(cx + R * .58),
                      int(cy + R * .78)], paddle, angle=-16)
    d = ImageDraw.Draw(img)
    bx, by = cx + .58 * R, cy - .52 * R
    circ(d, bx, by, R * .17, fill=MUSTARD, w=lw(0.008))
    for a in range(0, 360, 60):
        x = bx + R * .085 * math.cos(math.radians(a))
        y = by + R * .085 * math.sin(math.radians(a))
        circ(d, x, y, R * .022, fill=INK, outline=None)
    for i in range(2):
        d.arc([bx - R * (.30 + i * .12), by - R * (.30 + i * .12),
               bx + R * (.30 + i * .12), by + R * (.30 + i * .12)],
              -60, 20, fill=INK, width=lw(0.006))
    dashed(d, (cx - 1.0 * R, cy + .82 * R), (cx + 1.0 * R, cy + .82 * R),
           R * .07, R * .05, INK, lw(0.007))


def art_hedgehog(img, cx, cy, R):
    d = ImageDraw.Draw(img)
    # feet
    for fx in (-.28, .22):
        d.ellipse([cx + fx * R - .12 * R, cy + .28 * R,
                   cx + fx * R + .12 * R, cy + .44 * R], fill=CREAM,
                  outline=INK, width=lw(0.007))
    # spiky back
    body = [cx - .82 * R, cy - .42 * R, cx + .82 * R, cy + .68 * R]
    d.pieslice(body, 180, 360, fill=MUSTARD, outline=INK, width=lw(0.009))
    rx, ry = .82 * R, .55 * R
    for a in range(185, 356, 12):
        th = math.radians(a)
        x0, y0 = cx + rx * math.cos(th), cy + .13 * R + ry * math.sin(th)
        x1 = cx + (rx + .16 * R) * math.cos(th - .05)
        y1 = cy + .13 * R + (ry + .16 * R) * math.sin(th - .05)
        x2 = cx + (rx + .16 * R) * math.cos(th + .05)
        y2 = cy + .13 * R + (ry + .16 * R) * math.sin(th + .05)
        poly(d, [(x0, y0), (x1, y1), (x2, y2)], fill=INK, outline=None)
    # face
    circ(d, cx - .60 * R, cy + .06 * R, R * .24, fill=CREAM, w=lw(0.009))
    circ(d, cx - .70 * R, cy + .02 * R, R * .045, fill=INK, outline=None)
    d.arc([cx - .68 * R, cy + .04 * R, cx - .52 * R, cy + .16 * R], 20, 120,
          fill=INK, width=lw(0.005))
    d.line([(cx - .60 * R, cy + .06 * R), (cx - .86 * R, cy + .10 * R)],
           fill=INK, width=lw(0.005))
    circ(d, cx - .87 * R, cy + .10 * R, R * .028, fill=RUST, outline=None)
    # leaf on head
    def leaf(ld, w, h, L):
        ld.ellipse([0, 0, w, h], fill=OLIVE, outline=INK, width=lw(0.006))
        ld.line([(w * .12, h * .5), (w * .88, h * .5)], fill=INK, width=lw(0.004))
    paste_layer(img, [int(cx - .05 * R), int(cy - .72 * R), int(cx + .35 * R),
                      int(cy - .40 * R)], leaf, angle=-35)
    sparkle(d, cx + .78 * R, cy - .30 * R, R * .05, ORANGE)


def art_bernese(img, cx, cy, R):
    d = ImageDraw.Draw(img)
    # floppy ears (higher, closer to the head)
    for s in (-1, 1):
        d.ellipse([cx + s * .56 * R - .26 * R, cy - .62 * R,
                   cx + s * .56 * R + .26 * R, cy - .06 * R], fill=RUST,
                  outline=INK, width=lw(0.009))
    # head
    circ(d, cx, cy - .05 * R, R * .68, fill=INK, outline=None)
    # narrow white blaze
    d.rounded_rectangle([cx - .11 * R, cy - .76 * R, cx + .11 * R, cy + .26 * R],
                        radius=R * .10, fill=PAPER, outline=None)
    # white muzzle
    d.ellipse([cx - .30 * R, cy + .08 * R, cx + .30 * R, cy + .46 * R],
              fill=PAPER, outline=None)
    # rust cheeks (on the black fur, smaller)
    for s in (-1, 1):
        d.ellipse([cx + s * .40 * R - .15 * R, cy + .14 * R,
                   cx + s * .40 * R + .15 * R, cy + .36 * R], fill=RUST, outline=None)
        circ(d, cx + s * .28 * R, cy - .26 * R, R * .065, fill=RUST, outline=None)
        circ(d, cx + s * .28 * R, cy - .12 * R, R * .055, fill=PAPER, outline=None)
        circ(d, cx + s * .28 * R, cy - .12 * R, R * .028, fill=INK, outline=None)
    # nose + smile (on the white muzzle)
    poly(d, [(cx - .08 * R, cy + .16 * R), (cx + .08 * R, cy + .16 * R),
             (cx, cy + .25 * R)], fill=INK, outline=None)
    d.arc([cx - .13 * R, cy + .24 * R, cx, cy + .38 * R], 15, 115, fill=INK,
          width=lw(0.005))
    d.arc([cx, cy + .24 * R, cx + .13 * R, cy + .38 * R], 65, 165, fill=INK,
          width=lw(0.005))
    # collar with tag
    d.arc([cx - .60 * R, cy + .40 * R, cx + .60 * R, cy + 1.02 * R], 18, 162,
          fill=TEAL, width=lw(0.016))
    circ(d, cx, cy + .80 * R, R * .075, fill=GOLD, outline=INK, w=lw(0.006))
    sparkle(d, cx - .86 * R, cy - .60 * R, R * .045, MUSTARD)
    sparkle(d, cx + .88 * R, cy - .46 * R, R * .038, TEAL)


def art_ham_radio(img, cx, cy, R):
    d = ImageDraw.Draw(img)
    # radio waves
    for i, rr in enumerate((.55, .78, 1.01)):
        d.arc([cx - rr * R, cy - rr * R * .8, cx + rr * R, cy + rr * R * .8],
              -48, -12, fill=TEAL, width=lw(0.008))
        d.arc([cx - rr * R, cy - rr * R * .8, cx + rr * R, cy + rr * R * .8],
              192, 228, fill=TEAL, width=lw(0.008))
    # mic capsule
    d.rounded_rectangle([cx - .34 * R, cy - .58 * R, cx + .34 * R, cy + .30 * R],
                        radius=R * .30, fill=MUSTARD, outline=INK, width=lw(0.009))
    for i in range(4):
        y = cy - .40 * R + i * .17 * R
        d.line([(cx - .22 * R, y), (cx + .22 * R, y)], fill=INK, width=lw(0.006))
    d.rectangle([cx - .34 * R, cy + .02 * R, cx + .34 * R, cy + .12 * R], fill=TEAL)
    d.line([(cx - .34 * R, cy + .07 * R), (cx + .34 * R, cy + .07 * R)],
           fill=INK, width=lw(0.007))
    # stand + base
    d.line([(cx, cy + .30 * R), (cx, cy + .62 * R)], fill=INK, width=lw(0.011))
    d.rounded_rectangle([cx - .40 * R, cy + .60 * R, cx + .40 * R, cy + .76 * R],
                        radius=R * .07, fill=BROWN, outline=INK, width=lw(0.008))
    sparkle(d, cx - .95 * R, cy - .68 * R, R * .05, ORANGE)
    sparkle(d, cx + .98 * R, cy + .30 * R, R * .04, RUST)


def art_sourdough(img, cx, cy, R):
    d = ImageDraw.Draw(img)
    # jar
    jx0, jy0, jx1, jy1 = cx - .92 * R, cy - .34 * R, cx - .18 * R, cy + .72 * R
    d.rounded_rectangle([jx0, jy0, jx1, jy1], radius=R * .10, fill=PAPER,
                        outline=INK, width=lw(0.009))
    d.rectangle([jx0 + .06 * R, jy0 + .16 * R, jx1 - .06 * R, jy0 + .26 * R],
                fill=(232, 226, 210, 255))
    for bx, by, br in ((-.30, .05, .07), (-.12, .18, .055), (-.34, .32, .05),
                       (-.20, .44, .06), (-.36, .55, .045), (-.14, .60, .04)):
        circ(d, cx + bx * R, cy + by * R, br * R, fill=TEAL, outline=None)
    # cloth cover
    poly(d, [(jx0 - .04 * R, jy0 + .02 * R), (cx - .55 * R, jy0 - .42 * R),
             (cx - .18 * R + .04 * R, jy0 + .02 * R)], fill=RUST, w=lw(0.009))
    d.line([(jx0 - .02 * R, jy0 - .06 * R), (jx1 + .02 * R, jy0 - .06 * R)],
           fill=INK, width=lw(0.006))
    # bread
    bx, by = cx + .42 * R, cy + .34 * R
    d.ellipse([bx - .44 * R, by - .30 * R, bx + .44 * R, by + .30 * R],
              fill=CRUST, outline=INK, width=lw(0.009))
    for i in range(3):
        x = bx - .22 * R + i * .22 * R
        d.line([(x - .07 * R, by - .14 * R), (x + .07 * R, by - .22 * R)],
               fill=INK, width=lw(0.006))
    # steam
    for i in range(2):
        d.arc([cx - .78 * R + i * .12 * R, cy - .78 * R,
               cx - .48 * R + i * .12 * R, cy - .48 * R], 90, 270,
              fill=TEAL, width=lw(0.006))
    sparkle(d, cx + .88 * R, cy - .48 * R, R * .045, MUSTARD)


def art_stargazer(img, cx, cy, R):
    # crescent moon
    def moon(ld, w, h, L):
        r = w * .48
        circ(ld, w / 2, h / 2, r, fill=MUSTARD, outline=INK, w=lw(0.008))
        circ(ld, w / 2 + r * .55, h / 2 - r * .28, r * .82, fill=(0, 0, 0, 0),
             outline=None)
    paste_layer(img, [int(cx - 1.05 * R), int(cy - .95 * R), int(cx - .35 * R),
                      int(cy - .25 * R)], moon)
    d = ImageDraw.Draw(img)
    # stars
    for sx, sy, r, col in ((-.55, -.55, .05, ORANGE), (.55, -.75, .04, TEAL),
                           (.90, -.30, .045, MUSTARD), (-.95, -.15, .035, TEAL)):
        sparkle(d, cx + sx * R, cy + sy * R, r * R, col)
    circ(d, cx + .18 * R, cy - .88 * R, R * .035, fill=INK, outline=None)
    circ(d, cx - .30 * R, cy - .30 * R, R * .028, fill=INK, outline=None)

    # telescope on tripod
    def tube(ld, w, h, L):
        ld.rounded_rectangle([0, 0, w, h], radius=h * .45, fill=TEAL,
                             outline=INK, width=lw(0.009))
        ld.rectangle([w * .82, h * .30, w, h * .70], fill=NAVY)
        ld.rounded_rectangle([w * .20, -h * .55, w * .38, h * .18], radius=h * .1,
                             fill=NAVY, outline=INK, width=lw(0.007))
    paste_layer(img, [int(cx - .30 * R), int(cy - .42 * R), int(cx + .78 * R),
                      int(cy - .18 * R)], tube, angle=-24)
    tx, ty = cx + .18 * R, cy + .28 * R
    d.line([(tx, ty), (tx - .55 * R, ty + .68 * R)], fill=BROWN, width=lw(0.012))
    d.line([(tx, ty), (tx + .58 * R, ty + .66 * R)], fill=BROWN, width=lw(0.012))
    d.line([(tx, ty), (tx + .02 * R, ty + .74 * R)], fill=BROWN, width=lw(0.012))
    d.line([(cx - .95 * R, cy + .80 * R), (cx + 1.02 * R, cy + .80 * R)],
           fill=INK, width=lw(0.008))


def art_bird(img, cx, cy, R):
    d = ImageDraw.Draw(img)
    # branch
    d.line([(cx - 1.0 * R, cy + .52 * R), (cx - .3 * R, cy + .44 * R),
            (cx + .5 * R, cy + .50 * R), (cx + 1.02 * R, cy + .40 * R)],
           fill=BROWN, width=lw(0.016), joint="curve")
    for lx, ly, ang in ((-.55, .30, 30), (.15, .24, -25), (.70, .22, 40)):
        def leaf(ld, w, h, L):
            ld.ellipse([0, 0, w, h], fill=OLIVE, outline=INK, width=lw(0.005))
        paste_layer(img, [int(cx + lx * R - .14 * R), int(cy + ly * R - .30 * R),
                          int(cx + lx * R + .14 * R), int(cy + ly * R - .02 * R)],
                    leaf, angle=ang)
    # bird
    bx, by = cx + .05 * R, cy + .10 * R
    poly(d, [(bx - .30 * R, by + .06 * R), (bx - .78 * R, by + .34 * R),
             (bx - .62 * R, by - .02 * R), (bx - .30 * R, by - .10 * R)],
         fill=NAVY, w=lw(0.008))
    d.ellipse([bx - .34 * R, by - .26 * R, bx + .34 * R, by + .26 * R],
              fill=TEAL, outline=INK, width=lw(0.009))
    circ(d, bx + .30 * R, by - .30 * R, R * .21, fill=TEAL, w=lw(0.009))
    poly(d, [(bx + .48 * R, by - .32 * R), (bx + .72 * R, by - .24 * R),
             (bx + .48 * R, by - .18 * R)], fill=ORANGE, outline=None)
    circ(d, bx + .36 * R, by - .34 * R, R * .045, fill=PAPER, outline=None)
    circ(d, bx + .37 * R, by - .34 * R, R * .022, fill=INK, outline=None)
    d.arc([bx - .26 * R, by - .10 * R, bx + .18 * R, by + .34 * R], 20, 160,
          fill=INK, width=lw(0.006))
    d.ellipse([bx - .18 * R, by - .06 * R, bx + .16 * R, by + .24 * R],
              fill=MUSTARD, outline=INK, width=lw(0.006))
    for lx in (-.10, .12):
        d.line([(bx + lx * R, by + .26 * R), (bx + lx * R, cy + .44 * R)],
               fill=INK, width=lw(0.006))
    # binoculars hanging from the branch
    hx, hy = cx - .62 * R, cy + .04 * R
    d.line([(hx, cy + .44 * R), (hx, hy + .04 * R)], fill=INK, width=lw(0.007))
    for s in (-1, 1):
        circ(d, hx + s * .18 * R, hy + .18 * R, R * .17, fill=NAVY, w=lw(0.008))
        circ(d, hx + s * .18 * R - .05 * R, hy + .11 * R, R * .038, fill=PAPER,
             outline=None)
    d.rectangle([hx - .05 * R, hy + .07 * R, hx + .05 * R, hy + .26 * R], fill=NAVY)
    d.line([(hx - .05 * R, hy + .07 * R), (hx - .05 * R, hy + .26 * R)],
           fill=INK, width=lw(0.005))
    d.line([(hx + .05 * R, hy + .07 * R), (hx + .05 * R, hy + .26 * R)],
           fill=INK, width=lw(0.005))


def art_brew(img, cx, cy, R):
    d = ImageDraw.Draw(img)
    # bottle
    d.rounded_rectangle([cx - .78 * R, cy - .10 * R, cx - .34 * R, cy + .78 * R],
                        radius=R * .08, fill=BROWN, outline=INK, width=lw(0.009))
    d.rectangle([cx - .63 * R, cy - .58 * R, cx - .49 * R, cy - .08 * R], fill=BROWN)
    d.line([(cx - .63 * R, cy - .08 * R), (cx - .63 * R, cy - .58 * R)],
           fill=INK, width=lw(0.008))
    d.line([(cx - .49 * R, cy - .08 * R), (cx - .49 * R, cy - .58 * R)],
           fill=INK, width=lw(0.008))
    d.rounded_rectangle([cx - .67 * R, cy - .66 * R, cx - .45 * R, cy - .56 * R],
                        radius=R * .03, fill=GOLD, outline=INK, width=lw(0.007))
    d.rounded_rectangle([cx - .72 * R, cy + .06 * R, cx - .40 * R, cy + .38 * R],
                        radius=R * .04, fill=PAPER, outline=INK, width=lw(0.007))
    for i in range(3):
        circ(d, cx - .64 * R + i * .12 * R, cy + .22 * R, R * .028,
             fill=ORANGE, outline=None)
    # glass with beer + foam
    gx, gy = cx + .30 * R, cy - .30 * R
    poly(d, [(gx - .30 * R, gy), (gx + .30 * R, gy), (gx + .20 * R, gy + .95 * R),
             (gx - .20 * R, gy + .95 * R)], fill=PAPER, w=lw(0.009))
    poly(d, [(gx - .25 * R, gy + .22 * R), (gx + .25 * R, gy + .22 * R),
             (gx + .17 * R, gy + .88 * R), (gx - .17 * R, gy + .88 * R)],
         fill=MUSTARD, outline=None)
    for s in (-1, 0, 1):
        circ(d, gx + s * .17 * R, gy - .02 * R, R * .13, fill=PAPER,
             outline=INK, w=lw(0.007))
    circ(d, gx - .17 * R, gy + .05 * R, R * .05, fill=PAPER, outline=INK, w=lw(0.006))
    # hops cone
    hx, hy = cx + .42 * R, cy + .48 * R
    for i in range(4):
        r = R * (.20 - i * .035)
        yy = hy - i * .13 * R
        d.ellipse([hx - r, yy - r * .55, hx + r, yy + r * .55], fill=OLIVE,
                  outline=INK, width=lw(0.006))
    d.line([(hx, hy + .06 * R), (hx, hy + .26 * R)], fill=INK, width=lw(0.006))
    sparkle(d, cx + .92 * R, cy - .55 * R, R * .045, TEAL)


ARTS = {
    "disc_golf": art_disc_golf, "mahjong": art_mahjong, "pickleball": art_pickleball,
    "hedgehog": art_hedgehog, "bernese": art_bernese, "ham_radio": art_ham_radio,
    "sourdough": art_sourdough, "stargazer": art_stargazer, "bird": art_bird,
    "brew": art_brew,
}

DESIGNS = [
    ("01-disc-golf",    "DISC GOLF",        "MAY YOUR DISCS FLY STRAIGHT", "disc_golf", ORANGE),
    ("02-mahjong",      "MAHJONG NIGHT",    "FOUR PLAYERS \u2022 NO MERCY", "mahjong",   RUST),
    ("03-pickleball",   "PICKLEBALL",       "KITCHEN POLICE",              "pickleball", TEAL),
    ("04-hedgehog-mom", "HEDGEHOG MOM",     "SMALL BUT SPICY",             "hedgehog",  MUSTARD),
    ("05-bernese-dog",  "BERNESE DOG MOM",  "FLUFFY AND PROUD",            "bernese",   RUST),
    ("06-ham-radio",    "HAM RADIO CLUB",   "73 \u2022 GOOD DX",           "ham_radio", TEAL),
    ("07-sourdough",    "SOURDOUGH CLUB",   "FED THE STARTER TODAY",       "sourdough", BROWN),
    ("08-stargazer",    "STARGAZER CLUB",   "I COME OUT AT NIGHT",         "stargazer", NAVY),
    ("09-bird-nerd",    "BIRD NERD CLUB",   "UP AT 5AM FOR BIRDS",         "bird",      OLIVE),
    ("10-home-brew",    "HOME BREW CLUB",   "I BREW THEREFORE I AM",       "brew",      GOLD),
]


def compose(title, tagline, art_key, accent):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # title (auto-fit, Bebas Neue)
    tf, tr = fit_font(d, title, S * .84, S * .155)
    ttext(d, S / 2, S * .135, title, tf, INK, tr)

    # art badge
    ARTS[art_key](img, S / 2, S * .47, S * .235)

    # tagline
    gf = F("Montserrat_600SemiBold.ttf", S * .030)
    ttext(d, S / 2, S * .725, tagline, gf, accent, int(S * .011))

    # rule with diamond
    ry = S * .795
    d.line([(S * .22, ry), (S * .465, ry)], fill=INK, width=lw(0.006))
    d.line([(S * .535, ry), (S * .78, ry)], fill=INK, width=lw(0.006))
    poly(d, [(S / 2, ry - S * .016), (S / 2 + S * .016, ry), (S / 2, ry + S * .016),
             (S / 2 - S * .016, ry)], fill=accent, outline=None)
    for s in (-1, 1):
        circ(d, S / 2 + s * S * .255, ry, S * .008, fill=INK, outline=None)
    return img


def finalize(img):
    return img.resize((FINAL, FINAL), Image.LANCZOS)


def preview(img):
    """design on cream background -> listing photo"""
    bg = Image.new("RGBA", (FINAL, FINAL), CREAM)
    art = img.resize((int(FINAL * .88), int(FINAL * .88)), Image.LANCZOS)
    bg.alpha_composite(art, (int(FINAL * .06), int(FINAL * .06)))
    return bg.convert("RGB")


def main():
    thumbs = []
    for fname, title, tag, art, accent in DESIGNS:
        img = finalize(compose(title, tag, art, accent))
        img.save(os.path.join(HERE, fname + ".png"))
        pv = preview(img)
        pv.save(os.path.join(PREV, fname + ".jpg"), quality=92)
        thumbs.append((fname, pv.resize((640, 640), Image.LANCZOS)))
        print("ok", fname, img.size, img.mode)

    # contact sheet 5x2
    cols, rows, cell, pad, label = 5, 2, 640, 26, 54
    W = cols * cell + (cols + 1) * pad
    H = rows * (cell + label) + (rows + 1) * pad
    sheet = Image.new("RGB", (W, H), CREAM)
    sd = ImageDraw.Draw(sheet)
    lf = F("Montserrat_600SemiBold.ttf", 26)
    for i, (fname, th) in enumerate(thumbs):
        r, c = divmod(i, cols)
        x = pad + c * (cell + pad)
        y = pad + r * (cell + label + pad)
        sheet.paste(th, (x, y))
        sd.text((x + cell / 2, y + cell + label / 2), fname, font=lf, fill=INK,
                anchor="mm")
    sheet.save(os.path.join(HERE, "preview-grid.jpg"), quality=90)
    print("ok preview-grid.jpg", sheet.size)


if __name__ == "__main__":
    main()
