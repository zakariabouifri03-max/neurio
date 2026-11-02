#!/usr/bin/env python3
"""
render.py — tiny design engine used to build the K-Studio style sublimation PNGs.

Everything is vector: text is converted to real outlines (fontTools), fills are
seamless SVG <pattern>s (leopard, gingham, plaid, stripes, polka, tree, snow...),
then resvg rasterises the whole thing to a transparent PNG.

Note on textures: resvg blows up when a <pattern> unit is scaled by a big
`transform="scale(200)"` on a path, so every fill is *baked*: the pattern is
applied with `patternTransform` (offset + rotation) instead of a scaled tile.

No paid assets, no stock art: fonts are OFL, patterns and illustrations are drawn
here from code.
"""
import math
import os
import random
import subprocess
import tempfile

from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

HERE = os.path.dirname(os.path.abspath(__file__))

STITCH = "#F6E3BE"
GOLD = "#D9A93C"
GOLD2 = "#F3D177"
FONT_DIR = os.path.join(HERE, "..", "..", "etsy-designs", "fonts")


# --------------------------------------------------------------------------- #
#  fonts -> outlines
# --------------------------------------------------------------------------- #
class _Flatten(BasePen):
    """Pen that emits absolute M/L/C/Z tuples in font units (y-up)."""

    def __init__(self, glyphset):
        super().__init__(glyphset)
        self.out = []

    def _moveTo(self, p):
        self.out.append(("M", p))

    def _lineTo(self, p):
        self.out.append(("L", p))

    def _curveToOne(self, p1, p2, p3):
        self.out.append(("C", (p1, p2, p3)))

    def _qCurveToOne(self, p1, p2):
        self.out.append(("Q", (p1, p2)))

    def _closePath(self):
        self.out.append(("Z", None))


FONTS = {
    "blk": "AlfaSlabOne-Regular.ttf",       # chunky retro slab
    "blk2": "BowlbyOneSC-Regular.ttf",      # fat comic
    "cond": "Anton-Regular.ttf",            # condensed poster
    "bebas": "BebasNeue-Regular.ttf",       # condensed caps
    "script": "Lobster-Regular.ttf",        # bold script
    "hand": "Caveat[wght].ttf",             # marker script
    "thin": "ShadowsIntoLight.ttf",         # thin hand lettering
    "serif": "AbrilFatface-Regular.ttf",    # fat fashion serif
}

_cache = {}


def _font(name):
    if name not in _cache:
        f = TTFont(os.path.join(FONT_DIR, FONTS[name]))
        _cache[name] = (f, f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm)
    return _cache[name]


def _glyph_commands(font_name, ch):
    f, gs, cmap, upem = _font(font_name)
    gname = cmap.get(ord(ch))
    if gname is None:
        gname = cmap.get(ord("?"))
    pen = _Flatten(gs)
    gs[gname].draw(pen)
    width = f["hmtx"][gname][0]
    return pen.out, width, upem


def _num(v):
    s = ("%.2f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def char_path(font_name, ch):
    """Outline of one character in em units (1.0 = font size), y DOWN, at 0,0."""
    cmds, width, upem = _glyph_commands(font_name, ch)
    out = []
    for op, pts in cmds:
        if op in ("M", "L"):
            out.append("%s%s %s" % (op, _num(pts[0] / upem), _num(-pts[1] / upem)))
        elif op == "C":
            out.append("C" + " ".join("%s %s" % (_num(x / upem), _num(-y / upem)) for x, y in pts))
        elif op == "Q":
            out.append("Q" + " ".join("%s %s" % (_num(x / upem), _num(-y / upem)) for x, y in pts))
        else:
            out.append("Z")
    return "".join(out), width / upem


def text_width(text, font, size, tracking=0.0):
    w = 0.0
    adv = []
    for ch in text:
        _, a = char_path(font, ch)
        adv.append(a * size + tracking)
        w += a * size + tracking
    return w - tracking if text else 0.0, adv


def text_group(text, font="blk", size=100, x=0, y=0, tracking=0.0, anchor="middle",
               arc=0.0, jitter=0.0, rng=None, char_size=None):
    """
    Returns (svg_group_inner, width).  y is the baseline.
    arc>0 bends the line upward (like a badge arch), arc<0 downward.
    char_size: optional callable(i, ch) -> multiplier of size.
    """
    rng = rng or random.Random(0)
    widths = [char_path(font, c)[1] for c in text]
    sizes = [size * (char_size(i, c) if char_size else 1.0) for i, c in enumerate(text)]
    total = sum(widths[i] * sizes[i] + tracking for i in range(len(text))) - tracking
    if anchor == "middle":
        cx = x - total / 2
    elif anchor == "end":
        cx = x - total
    else:
        cx = x

    # arc geometry: fit circle through the line of characters
    use_arc = abs(arc) > 1e-6 and total > 0
    if use_arc:
        # sagitta s over chord L  ->  R = (L^2/4 + s^2) / (2s)
        L = total
        s = arc
        R = (L * L / 4 + s * s) / (2 * abs(s))
        sign = 1 if s > 0 else -1
        # centre of the circle below the chord for an upward arch
        ccx, ccy = cx + L / 2, y + sign * (R - s)
        base_angle = math.degrees(math.atan2(y - ccy, cx - ccx))

    parts = []
    for i, ch in enumerate(text):
        if ch.strip() == "":
            cx += widths[i] * sizes[i] + tracking
            continue
        d, _ = char_path(font, ch)
        sz = sizes[i]
        jy = rng.uniform(-jitter, jitter) if jitter else 0.0
        jr = rng.uniform(-jitter, jitter) * 0.25 if jitter else 0.0
        if use_arc:
            mid = cx + widths[i] * sz / 2
            ang = math.degrees(math.atan2(y - ccy, mid - ccx))
            tx = ccx + R * math.cos(math.radians(ang))
            ty = ccy + R * math.sin(math.radians(ang))
            rot = ang - base_angle - 90 * sign
            parts.append(
                '<g transform="translate(%s %s) rotate(%s) scale(%s)"><path d="%s"/></g>'
                % (_num(tx), _num(ty + jy), _num(rot + jr), _num(sz), d)
            )
        else:
            parts.append(
                '<g transform="translate(%s %s) rotate(%s) scale(%s)"><path d="%s"/></g>'
                % (_num(cx), _num(y + jy), _num(jr), _num(sz), d)
            )
        cx += widths[i] * sz + tracking
    return "".join(parts), total


def text_svg(text, fill, **kw):
    """Convenience: a filled text line (fill can be a pattern url)."""
    inner, _ = text_group(text, **kw)
    ind = kw.get("indent", "")
    return inner.replace("<path ", '<path fill="%s" ' % fill), 0



# --------------------------------------------------------------------------- #
#  textures  (flat tile SVG, no patterns, no grain)
# --------------------------------------------------------------------------- #
TEX = {}


def _mk(name):
    def deco(fn):
        TEX[name] = fn
        return fn
    return deco


def _wrap(fn, x, y, W, H, r):
    """Draw fn at the 3x3 neighbour copies, but only where a tile edge is crossed."""
    xs = [0]
    ys = [0]
    if x - r < 0:
        xs.append(W)
    if x + r > W:
        xs.append(-W)
    if y - r < 0:
        ys.append(H)
    if y + r > H:
        ys.append(-H)
    return "".join(fn(x + ox, y + oy) for ox in xs for oy in ys)


def _arc(cx, cy, rx, ry, a0, sweep, steps=10):
    pts = []
    for i in range(steps + 1):
        a = math.radians(a0 + sweep * i / steps)
        pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return "M" + "L".join("%s %s" % (_num(x), _num(y)) for x, y in pts)


@_mk("leopard")
def _leopard(o):
    base = o.get("base", "#F1D2A6")
    spot = o.get("spot", "#241E1A")
    ros = o.get("rosette", "#B57C42")
    ring = o.get("ring", "#F8E7C8")
    W = H = o.get("tile", 300)
    dens = o.get("density", 1.0)
    rng = random.Random(o.get("seed", 7))
    out = ['<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(H), base)]

    def blot(x, y):
        r = rng.uniform(26, 40)
        return ('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s" opacity=".55"/>'
                % (_num(x), _num(y), _num(r), _num(r * .78), ros))

    for _ in range(int(4 * dens)):
        out.append(_wrap(blot, rng.uniform(0, W), rng.uniform(0, H), W, H, 44))

    for i in range(int(6 * dens)):
        x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(30, 46)
        thick, a0, sweep = rng.uniform(11, 16), rng.uniform(0, 360), rng.uniform(150, 260)
        if i % 4 == 0:
            def solid(px, py):
                return ('<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s" opacity=".95"/>'
                        % (_num(px), _num(py), _num(r * .34), _num(r * .27), spot))
            out.append(_wrap(solid, x, y, W, H, 50))
        else:
            def pair(px, py):
                return ('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>'
                        % (_arc(px, py, r, r * .82, a0, sweep), spot, _num(thick)))
            out.append(_wrap(pair, x, y, W, H, 50))
            out.append(_wrap(lambda px, py: '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s" opacity=".9"/>'
                             % (_num(px), _num(py), _num(r * .16), _num(r * .13), ros), x, y, W, H, 50))
    return W, H, "".join(out)


@_mk("gingham")
def _gingham(o):
    a, b, W = o.get("a", "#D6453D"), o.get("b", "#FBF6ED"), o.get("tile", 150)
    h = W / 2
    return W, W, ('<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(W), b)
                  + '<g fill="%s" opacity=".5"><rect width="%s" height="%s"/>' % (a, _num(h), _num(W))
                  + '<rect width="%s" height="%s"/></g>' % (_num(W), _num(h))
                  + '<g fill="%s" opacity=".85"><rect width="%s" height="%s"/>' % (a, _num(h), _num(h))
                  + '<rect x="%s" y="%s" width="%s" height="%s"/></g>' % (_num(h), _num(h), _num(h), _num(h)))


@_mk("stripes")
def _stripes(o):
    a, b, W, n = o.get("a", "#1F4D3A"), o.get("b", "#FBF6ED"), o.get("tile", 160), o.get("n", 6)
    step = W / n
    c = ['<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(W), b)]
    for i in range(n):
        c.append('<rect x="%s" width="%s" height="%s" fill="%s"/>'
                 % (_num(i * step + step / 2), _num(step / 2), _num(W), a))
    return W, W, "".join(c)


@_mk("polka")
def _polka(o):
    bg, dot, W, r = o.get("bg", "#1F4D3A"), o.get("dot", "#F6EBD2"), o.get("tile", 150), o.get("r", 15)
    c = ['<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(W), bg)]
    for x, y in ((W * .25, W * .25), (W * .75, W * .75), (W * .75, W * .25), (W * .25, W * .75)):
        c.append(_wrap(lambda px, py: '<circle cx="%s" cy="%s" r="%s" fill="%s"/>'
                       % (_num(px), _num(py), _num(r), dot), x, y, W, W, r))
    return W, W, "".join(c)


@_mk("plaid")
def _plaid(o):
    base, c1, c2, W = o.get("base", "#2C2A4A"), o.get("a", "#E05A47"), o.get("b", "#F3D9A4"), o.get("tile", 220)
    c = ['<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(W), base)]
    for pos, w, col, op in ((0, W * .5, c1, .32), (W * .25, W * .09, c2, .9), (W * .72, W * .035, c1, .95)):
        c.append('<rect x="%s" width="%s" height="%s" fill="%s" opacity="%s"/>'
                 % (_num(pos), _num(w), _num(W), col, op))
        c.append('<rect y="%s" height="%s" width="%s" fill="%s" opacity="%s"/>'
                 % (_num(pos), _num(w), _num(W), col, op))
    return W, W, "".join(c)


@_mk("trees")
def _trees(o):
    bg, tree, W = o.get("bg", "#22493A"), o.get("dot", "#F3E4C4"), o.get("tile", 180)
    rng = random.Random(o.get("seed", 3))
    c = ['<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(W), bg)]
    for _ in range(5):
        x, y, s = rng.uniform(0, W), rng.uniform(0, W), rng.uniform(14, 22)
        c.append(_wrap(lambda px, py: '<path d="%s" fill="%s" opacity=".9"/>'
                       % (_pine(px, py, s), tree), x, y, W, W, s))
    return W, W, "".join(c)


@_mk("snow")
def _snow(o):
    bg, dot, W = o.get("bg", "#F4F8FC"), o.get("dot", "#CFE2F3"), o.get("tile", 150)
    rng = random.Random(o.get("seed", 5))
    c = ['<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(W), bg)]
    for _ in range(12):
        x, y, r = rng.uniform(0, W), rng.uniform(0, W), rng.uniform(2.5, 6)
        c.append(_wrap(lambda px, py: '<circle cx="%s" cy="%s" r="%s" fill="%s"/>'
                       % (_num(px), _num(py), _num(r), dot), x, y, W, W, r + 2))
    return W, W, "".join(c)


@_mk("candy")
def _candy(o):
    a, b, W = o.get("a", "#E23B3B"), o.get("b", "#FFF8F0"), o.get("tile", 160)
    step = W / 4
    c = ['<rect width="%s" height="%s" fill="%s"/>' % (_num(W), _num(W), b)]
    for i in range(-4, 8):
        x = i * step * 2
        c.append('<rect x="%s" y="%s" width="%s" height="%s" fill="%s" '
                 'transform="rotate(-35 %s %s)"/>' % (_num(x), _num(-W), _num(step), _num(W * 3),
                                                      a, _num(x), _num(W / 2)))
    return W, W, "".join(c)


def texture(kind, **o):
    """
    Returns paint(x, y, rot) -> SVG that fills whatever it is clipped to with
    this texture, positioned in absolute user units around (x, y).
    """
    W, H, body = TEX[kind](o)
    tile = ('<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">%s</svg>'
            % (_num(W), _num(H), _num(W), _num(H), body))
    import base64
    uri = "data:image/svg+xml;base64," + base64.b64encode(tile.encode()).decode()
    tid = _tex_id(uri, W, H)
    shift = o.get("shift", 0.0)

    def paint(x=0.0, y=0.0, rot=0.0, opacity=1.0):
        x += shift * W
        n = 6
        return ('<rect x="%s" y="%s" width="%s" height="%s" fill="url(#%s)" opacity="%s"/>'
                % (_num(x - n * W), _num(y - n * H), _num(2 * n * W), _num(2 * n * H), tid,
                   _num(opacity)))

    return paint


_TEX_IDS, _TEX_URIS = {}, {}


def _tex_id(uri, W=1, H=1):
    if uri not in _TEX_IDS:
        tid = "tex%d" % (len(_TEX_IDS) + 1)
        _TEX_IDS[uri] = tid
        _TEX_URIS[tid] = (uri, W, H)
    return _TEX_IDS[uri]


def _pine(x, y, s):
    return "M%s %sL%s %sL%s %sZ" % (_num(x), _num(y - s), _num(x - s * .62), _num(y + s * .3),
                                    _num(x + s * .62), _num(y + s * .3))


# --------------------------------------------------------------------------- #
#  text -> outlines (baked into world coordinates, so patterns never scale)
# --------------------------------------------------------------------------- #
def placed_path(font, ch, size, x, y, rot=0.0):
    """Glyph outline already positioned in world units (no <g transform> needed)."""
    cmds, width, upem = _glyph_commands(font, ch)
    k = size / upem
    ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))

    def T(p):
        px, py = p[0] * k, -p[1] * k
        return (x + px * ca - py * sa, y + px * sa + py * ca)

    out = []
    for op, pts in cmds:
        if op in ("M", "L"):
            q = T(pts)
            out.append("%s%s %s" % (op, _num(q[0]), _num(q[1])))
        elif op == "C":
            out.append("C" + " ".join("%s %s" % (_num(q[0]), _num(q[1])) for q in map(T, pts)))
        elif op == "Q":
            out.append("Q" + " ".join("%s %s" % (_num(q[0]), _num(q[1])) for q in map(T, pts)))
        else:
            out.append("Z")
    return "".join(out), width * k


def text_width(text, font, size, tracking=0.0):
    w = sum(char_path(font, c)[1] * size + tracking for c in text) - (tracking if text else 0)
    return w


def layout(text, font="blk", size=100, x=0, y=0, tracking=0.0, anchor="middle", char_size=None):
    """Per-character slots: ch, x, y, size, width, and the outline d (world units)."""
    widths = [char_path(font, c)[1] for c in text]
    sizes = [size * (char_size(i, c) if char_size else 1.0) for i, c in enumerate(text)]
    total = sum(widths[i] * sizes[i] + tracking for i in range(len(text))) - tracking
    if anchor == "middle":
        cx = x - total / 2
    elif anchor == "end":
        cx = x - total
    else:
        cx = x
    out = []
    for i, ch in enumerate(text):
        out.append(dict(ch=ch, x=cx, y=y, size=sizes[i], width=widths[i] * sizes[i], index=i))
        cx += widths[i] * sizes[i] + tracking
    return out, total


def letter(L, paint=None, fill="#fff", outline="#2A211C", lw=16, stitch=STITCH, sw=8,
           shadow=True, dy=0.0, rot=0.0, extra="", anchor=None):
    """One letter as a fabric sticker: shadow, fill (or texture), stitch, outline."""
    d, _ = placed_path(L["font"], L["ch"], L["size"],
                       L["x"] + (L.get("dx", 0)), L["y"] + dy, rot)
    g = []
    if shadow:
        g.append('<path d="%s" fill="#000" opacity=".24" transform="translate(%s %s)"/>'
                 % (d, _num(L["size"] * .035), _num(L["size"] * .05)))
    g.append('<path d="%s" fill="%s"/>' % (d, fill))
    if paint is not None:
        g.append('<clipPath id="cl_%s"><path d="%s"/></clipPath>'
                 '<g clip-path="url(#cl_%s)">%s</g>'
                 % (L["uid"], d, L["uid"], paint(L["x"], L["y"] - L["size"] * .5, rot)))
    if stitch:
        g.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" '
                 'stroke-dasharray="%s %s" opacity=".9"/>'
                 % (d, stitch, _num(sw), _num(sw * 4), _num(sw * 3)))
    body = "".join(g)
    if outline:
        body = ('<g stroke="%s" stroke-width="%s" stroke-linejoin="round">%s</g>'
                % (outline, _num(lw), body))
    return body + extra


def word(text, paint=None, fill="#fff", font="blk", size=100, x=0, y=0, tracking=0.0,
         anchor="middle", char_size=None, outline="#2A211C", lw=16, stitch=STITCH, sw=8,
         shadow=True, bounce=0.0, jitter=0.0, seed=1, extra=None, uid="w"):
    """
    Fabric-patch word. paint(x,y,rot) from texture() fills every letter.
    bounce: vertical offset (fraction of size) for a wave; jitter: rotation wiggle.
    """
    rng = random.Random(seed)
    letters, total = layout(text, font, size, x, y, tracking, anchor, char_size)
    out = []
    for i, L in enumerate(letters):
        L["font"] = font
        L["uid"] = "%s%d" % (uid, i)
        if not L["ch"].strip():
            continue
        dy = 0.0
        if bounce:
            dy = -math.sin(i / max(1, len(letters) - 1) * math.pi) * size * bounce
        if jitter:
            dy += rng.uniform(-1, 1) * size * jitter * .25
        r = (rng.uniform(-1, 1) * jitter * 22) if jitter else 0.0
        e = extra(i, L["ch"], L) if extra else ""
        out.append(letter(L, paint=paint, fill=fill, outline=outline, lw=lw, stitch=stitch,
                          sw=sw, shadow=shadow, dy=dy, rot=r, extra=e))
    return "".join(out), total


# --------------------------------------------------------------------------- #
#  drawing helpers
# --------------------------------------------------------------------------- #
STITCH = "#F6E3BE"
GOLD = "#D9A93C"
GOLD2 = "#F3D177"


def star(cx, cy, r, inner=.42, points=5, rot=-90):
    pts = []
    for i in range(points * 2):
        rr = r if i % 2 == 0 else r * inner
        a = math.radians(rot + i * 180 / points)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return "M" + "L".join("%s %s" % (_num(x), _num(y)) for x, y in pts) + "Z"


def sparkle(cx, cy, r, waist=.22):
    w = r * waist
    return ("M%s %sQ%s %s %s %sQ%s %s %s %sQ%s %s %s %sQ%s %s %s %sZ" % (
        _num(cx), _num(cy - r), _num(cx + w), _num(cy - w), _num(cx + r), _num(cy),
        _num(cx + w), _num(cy + w), _num(cx), _num(cy + r),
        _num(cx - w), _num(cy + w), _num(cx - r), _num(cy),
        _num(cx - w), _num(cy - w), _num(cx), _num(cy - r)))


def heart(cx, cy, s):
    return ("M%s %sC%s %s %s %s %s %sC%s %s %s %s %s %sZ" % (
        _num(cx), _num(cy + s * .8),
        _num(cx - s * 1.3), _num(cy - s * .35), _num(cx - s * .58), _num(cy - s * 1.1),
        _num(cx), _num(cy - s * .3),
        _num(cx + s * .58), _num(cy - s * 1.1), _num(cx + s * 1.3), _num(cy - s * .35),
        _num(cx), _num(cy + s * .8)))


def snowflake(cx, cy, r, arms=6):
    out = []
    for i in range(arms):
        a = math.radians(i * 180 / arms)
        out.append("M%s %sL%s %s" % (_num(cx), _num(cy), _num(cx + r * math.cos(a)),
                                     _num(cy + r * math.sin(a))))
        for t in (.5, .78):
            bx, by = cx + r * t * math.cos(a), cy + r * t * math.sin(a)
            for side in (-1, 1):
                aa = a + side * math.radians(40)
                out.append("M%s %sL%s %s" % (_num(bx), _num(by),
                                             _num(bx + r * .24 * math.cos(aa)),
                                             _num(by + r * .24 * math.sin(aa))))
    return "".join(out)


def grid(cx, cy, w, h, cols, rows, amp=12, seed=2):
    """Hand-drawn-ish wobbly grid used for the basketball / street designs."""
    rng = random.Random(seed)
    out = []
    for i in range(cols + 1):
        x = cx - w / 2 + w * i / cols
        pts = [(x + rng.uniform(-amp, amp) * .4, cy - h / 2 + h * k / 20 + rng.uniform(-amp, amp) * .3)
               for k in range(21)]
        out.append("M" + "L".join("%s %s" % (_num(a), _num(b)) for a, b in pts))
    for k in range(rows + 1):
        y = cy - h / 2 + h * k / rows
        pts = [(cx - w / 2 + w * i / 20 + rng.uniform(-amp, amp) * .3,
                y + rng.uniform(-amp, amp) * .4) for i in range(21)]
        out.append("M" + "L".join("%s %s" % (_num(a), _num(b)) for a, b in pts))
    return "".join(out)


def poly(pts, close=True):
    d = "M" + "L".join("%s %s" % (_num(x), _num(y)) for x, y in pts)
    return d + ("Z" if close else "")


def round_poly(pts, close=True):
    """Polygon whose corners are rounded with quadratic curves."""
    n = len(pts)
    mid = lambda a, b: ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    if not close:
        d = "M%s %s" % (_num(pts[0][0]), _num(pts[0][1]))
        for i in range(1, n - 1):
            m = mid(pts[i], pts[i + 1])
            d += "Q%s %s %s %s" % (_num(pts[i][0]), _num(pts[i][1]), _num(m[0]), _num(m[1]))
        d += "L%s %s" % (_num(pts[-1][0]), _num(pts[-1][1]))
        return d
    d = "M%s %s" % (_num(mid(pts[-1], pts[0])[0]), _num(mid(pts[-1], pts[0])[1]))
    for i in range(n):
        b, c = pts[i], pts[(i + 1) % n]
        m = mid(b, c)
        d += "Q%s %s %s %s" % (_num(b[0]), _num(b[1]), _num(m[0]), _num(m[1]))
    return d + "Z"


def patch(d, paint=None, fill="#F7F0DF", outline="#2A211C", lw=14, stitch=STITCH, dash=(34, 26),
          shadow=.3, uid="p", texture_rot=0.0):
    """A stitched-on fabric patch — the shop's signature element."""
    out = []
    if shadow:
        out.append('<path d="%s" fill="#000" opacity="%s" transform="translate(%s %s)"/>'
                   % (d, _num(shadow), _num(lw * .8), _num(lw * 1.2)))
    out.append('<path d="%s" fill="%s"/>' % (d, fill))
    if paint is not None:
        out.append('<clipPath id="cl_%s"><path d="%s"/></clipPath>'
                   '<g clip-path="url(#cl_%s)">%s</g>'
                   % (uid, d, uid, paint(0, 0, texture_rot)))
    out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
               % (d, outline, _num(lw)))
    if stitch:
        out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" '
                   'stroke-dasharray="%s %s" opacity=".95"/>'
                   % (d, stitch, _num(lw * .5), _num(dash[0]), _num(dash[1])))
    return "".join(out)


def fringe(d, color="#B98A4B", lw=10, dash="13 22"):
    """Frayed-thread edge drawn along a patch outline."""
    return ('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-dasharray="%s" '
            'stroke-linecap="round" opacity=".8"/>' % (d, color, _num(lw), dash))


def ribbon_bow(cx, cy, s, fill="#F6EDE0", outline="#2A211C", lw=12, stitch=STITCH, uid="bow",
               paint=None, gold=None):
    """Coquette bow: two tails + two loops + knot, every piece a stitched patch."""
    def pt(*xy):
        return "%s %s " % (_num(xy[0]), _num(xy[1]))

    def path(start, segs):
        d = "M" + pt(*start)
        for op, pts in segs:
            d += op + "".join(pt(*p) for p in pts)
        return d.strip() + " Z"

    loop_l = path((cx, cy), [
        ("C", [(cx - s * .40, cy - s * .70), (cx - s * 1.45, cy - s * .85), (cx - s * 1.50, cy - s * .10)]),
        ("C", [(cx - s * 1.55, cy + s * .60), (cx - s * .65, cy + s * .50), (cx - s * .05, cy)]),
    ])
    loop_r = path((cx, cy), [
        ("C", [(cx + s * .40, cy - s * .70), (cx + s * 1.45, cy - s * .85), (cx + s * 1.50, cy - s * .10)]),
        ("C", [(cx + s * 1.55, cy + s * .60), (cx + s * .65, cy + s * .50), (cx + s * .05, cy)]),
    ])
    tail_l = path((cx - s * .12, cy + s * .10), [
        ("C", [(cx - s * .30, cy + s * .62), (cx - s * .68, cy + s * 1.05), (cx - s * 1.00, cy + s * 1.28)]),
        ("L", [(cx - s * .72, cy + s * 1.30)]),
        ("C", [(cx - s * .45, cy + s * 1.15), (cx - s * .22, cy + s * .80), (cx - s * .02, cy + s * .30)]),
    ])
    tail_r = path((cx + s * .12, cy + s * .10), [
        ("C", [(cx + s * .30, cy + s * .62), (cx + s * .68, cy + s * 1.05), (cx + s * 1.00, cy + s * 1.28)]),
        ("L", [(cx + s * .72, cy + s * 1.30)]),
        ("C", [(cx + s * .45, cy + s * 1.15), (cx + s * .22, cy + s * .80), (cx + s * .02, cy + s * .30)]),
    ])
    g = paint or (lambda x, y, r=0: "")
    out = patch(tail_l, paint=g, fill=fill, outline=outline, lw=lw, stitch=stitch,
                shadow=.16, uid=uid + "t1")
    out += patch(tail_r, paint=g, fill=fill, outline=outline, lw=lw, stitch=stitch,
                 shadow=.16, uid=uid + "t2")
    out += patch(loop_l, paint=g, fill=fill, outline=outline, lw=lw, stitch=stitch,
                 shadow=.2, uid=uid + "l")
    out += patch(loop_r, paint=g, fill=fill, outline=outline, lw=lw, stitch=stitch,
                 shadow=.2, uid=uid + "r")
    knot = "M%s L%s L%s L%s Z" % (pt(cx - s * .26, cy - s * .22).strip(),
                                  pt(cx + s * .26, cy - s * .22).strip(),
                                  pt(cx + s * .20, cy + s * .30).strip(),
                                  pt(cx - s * .20, cy + s * .30).strip())
    out += ('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
            % (knot, fill, outline, _num(lw)))
    if gold:
        out += ('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-dasharray="%s %s" '
                'stroke-linecap="round" opacity=".9"/>'
                % (knot, gold, _num(lw * .45), _num(lw * 2), _num(lw * 1.6)))
    return out


def dots_ring(cx, cy, rx, ry, n, r, fill, op=1.0, rot=0.0):
    out = []
    for i in range(n):
        a = math.radians(rot + i * 360 / n)
        out.append('<circle cx="%s" cy="%s" r="%s" fill="%s" opacity="%s"/>'
                   % (_num(cx + rx * math.cos(a)), _num(cy + ry * math.sin(a)), _num(r), fill, _num(op)))
    return "".join(out)


# --------------------------------------------------------------------------- #
#  document
# --------------------------------------------------------------------------- #
class Doc:
    def __init__(self, w=4500, h=5400, bg=None, grain=True):
        self.w, self.h = w, h
        self.defs = []
        self.body = []
        self.bg = bg
        self.grain = grain
        self.small = (w * h <= 1200 * 1200)
        if grain and not self.small:
            self._texture()

    def _texture(self, tile=420, seed=11):
        rng = random.Random(seed)
        W = H = tile
        out = []
        for _ in range(90):
            x, y, r = rng.uniform(0, W), rng.uniform(0, H), rng.uniform(1.2, 4.4)
            out.append(_wrap(lambda px, py: '<circle cx="%s" cy="%s" r="%s" fill="%s" opacity="%s"/>'
                             % (_num(px), _num(py), _num(r), "#000" if rng.random() < .55 else "#fff",
                                _num(rng.uniform(.05, .13))), x, y, W, H, r + 2))
        self.defs.append('<pattern id="grain" width="%s" height="%s" patternUnits="userSpaceOnUse">%s</pattern>'
                         % (W, H, "".join(out)))

    def add(self, *svg):
        self.body.extend(svg)

    def svg(self):
        bg = ""
        if self.bg:
            bg = '<rect width="%s" height="%s" fill="%s"/>' % (self.w, self.h, self.bg)
        grain = ('<rect width="%s" height="%s" fill="url(#grain)" opacity=".5"/>' % (self.w, self.h)
                 if self.grain and not self.small else "")
        tex = "".join('<pattern id="%s" x="0" y="0" width="%s" height="%s" '
                      'patternUnits="userSpaceOnUse"><image width="%s" height="%s" '
                      'preserveAspectRatio="none" href="%s"/></pattern>' % (tid, tw, th, tw, th, uri)
                      for tid, (uri, tw, th) in _TEX_URIS.items())
        return ('<svg xmlns="http://www.w3.org/2000/svg" width="%s" height="%s" viewBox="0 0 %s %s">'
                '\n<defs>%s</defs>\n%s\n%s\n%s\n</svg>'
                % (self.w, self.h, self.w, self.h, "".join(self.defs) + tex, bg,
                   "".join(self.body), grain))

    def save_svg(self, path):
        s = self.svg()
        with open(path, "w") as f:
            f.write(s)
        return s

    def save_png(self, path, width=None, scale=1.0):
        s = self.svg()
        out_w = width or int(self.w * scale)
        tmp = path.rsplit(".", 1)[0] + ".svg"
        with open(tmp, "w") as f:
            f.write(s)
        node = (
            "const {Resvg}=require('@resvg/resvg-js');const fs=require('fs');"
            "const a=process.argv.slice(-2);"
            "const r=new Resvg(fs.readFileSync(a[0],'utf8'),{fitTo:{mode:'width',value:%d},"
            "background:'rgba(0,0,0,0)'});fs.writeFileSync(a[1],r.render().asPng());" % out_w
        )
        subprocess.run(["node", "-e", node, tmp, path], check=True,
                       cwd=os.path.join(HERE, "..", ".."))
        return path


def clip_paths(*uids):
    return "".join(u for u in uids if u)


def letter_clip(L):
    return clip_for(L)
