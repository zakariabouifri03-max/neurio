#!/usr/bin/env python3
"""
icons.py — the little hand-drawn-looking illustrations used by the designs.
Every icon returns SVG inside a 100x100 box (centred on 50,50) so it can be placed with
a simple translate/scale, and every icon follows the shop's recipe:
thick dark outline + cream/pattern fill + dashed "stitch" line + tiny gold accents.
"""
import math

from render import _num, star, sparkle, heart, snowflake, STITCH, GOLD
from render import patch, fringe, poly, round_poly

INK = "#2A211C"


def place(inner, x, y, size, rot=0):
    """Drop a 100x100-box icon so its centre lands on (x, y)."""
    return ('<g transform="translate(%s %s) rotate(%s) scale(%s) translate(-50 -50)">%s</g>'
            % (_num(x), _num(y), _num(rot), _num(size / 100.0), inner))


# --------------------------------------------------------------------------- #
#  Christmas
# --------------------------------------------------------------------------- #
def bough(x, y, half, top, bot):
    """One drooping pine bough, centred on x."""
    return ("M%s %s C%s %s %s %s %s %s L%s %s Q%s %s %s %s Z" % (
        _num(x), _num(top),
        _num(x + half * .30), _num(top + 10), _num(x + half * .55), _num(bot - 12),
        _num(x + half), _num(bot - 4),
        _num(x - half), _num(bot - 4),
        _num(x), _num(bot + 7), _num(x - half), _num(bot - 4)))


def pine_tree(paint=None, fill="#2E6B4F", ink=INK, lw=4.0, layers=4, stitch=True,
              trunk="#8B5A2B", star_top=GOLD, uid="tree", gild=None):
    """Layered faux-applique pine tree — the shop's hero shape."""
    out = ['<path d="M44 82L44 94L56 94L56 82Z" fill="%s" stroke="%s" '
           'stroke-width="%s" stroke-linejoin="round"/>' % (trunk, ink, _num(lw))]
    for i in range(layers):
        top = 4 + 19 * i
        bot = top + 34
        half = 44 - 9 * i
        out.append(patch(bough(50, 50, half, top, bot), paint=paint, fill=fill, outline=ink,
                         lw=lw, stitch=STITCH if stitch else None, dash=(7, 5),
                         shadow=.14, uid="%s%d" % (uid, i)))
        if gild is not None:
            out.append('<path d="%s" fill="%s" opacity=".85"/>'
                       % (bough(50, 50, half * .82, top + 6, bot - 3), gild))
    out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
               % (star(50, 0, 10, inner=.45), star_top, ink, _num(lw * .8)))
    return "".join(out)


def snowman(paint=None, fill="#F7F3EA", ink=INK, lw=5):
    out = []
    out.append(patch("M50 94a22 22 0 1 1 0-44a22 22 0 1 1 0 44Z", paint=paint, fill=fill,
                     outline=ink, lw=lw, stitch=STITCH, dash=(9, 8), uid="sm1"))
    out.append(patch("M50 52a16 16 0 1 1 0-32a16 16 0 1 1 0 32Z", paint=paint, fill=fill,
                     outline=ink, lw=lw, stitch=STITCH, dash=(9, 8), uid="sm2"))
    out.append(patch("M50 20a13 13 0 1 1 0-26a13 13 0 1 1 0 26Z", paint=paint, fill=fill,
                     outline=ink, lw=lw, stitch=STITCH, dash=(8, 7), uid="sm3"))
    # hat, face, scarf, buttons
    out.append('<path d="M33 2L67 2L67 -6L33 -6Z" fill="%s" stroke="%s" stroke-width="%s"/>' % ("#C0392B", ink, _num(lw)))
    out.append('<path d="M38 -6L62 -6L62 -20L38 -20Z" fill="%s" stroke="%s" stroke-width="%s"/>' % ("#C0392B", ink, _num(lw)))
    out.append('<circle cx="45" cy="14" r="2.4" fill="%s"/><circle cx="55" cy="14" r="2.4" fill="%s"/>' % (ink, ink))
    out.append('<path d="M50 18L58 21L50 24Z" fill="%s"/>' % "#E8792B")
    out.append('<path d="M34 48c8 5 24 5 32 0l-3 8c-8 4-18 4-26 0Z" fill="%s" stroke="%s" stroke-width="%s"/>'
               % ("#C0392B", ink, _num(lw * .8)))
    for cy in (60, 70, 80):
        out.append('<circle cx="50" cy="%s" r="2.6" fill="%s"/>' % (cy, ink))
    return "".join(out)


def candy_cane(ink=INK, lw=5):
    d = "M30 92L30 40a20 20 0 0 1 40 0"
    return ('<path d="%s" fill="none" stroke="%s" stroke-width="16" stroke-linecap="round"/>' % (d, "#F4EDE2")
            + '<path d="%s" fill="none" stroke="%s" stroke-width="16" stroke-linecap="round" stroke-dasharray="10 13"/>' % (d, "#C0392B")
            + '<path d="%s" fill="none" stroke="%s" stroke-width="20" stroke-linecap="round" opacity=".9" stroke-dasharray="1 0"/>' % ("M30 92L30 40a20 20 0 0 1 40 0", "none"))


def holly(ink=INK, lw=3.4):
    leaf = ("M50 52C42 40 30 36 22 40C26 50 36 56 50 52C60 60 74 58 80 50"
            "C74 40 60 40 50 52Z")
    out = ['<path d="%s" fill="#2E6B4F" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (leaf, ink, _num(lw))]
    for cx, cy in ((44, 62), (56, 62), (50, 70)):
        out.append('<circle cx="%s" cy="%s" r="6" fill="#C0392B" stroke="%s" stroke-width="%s"/>' % (cx, cy, ink, _num(lw)))
    out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" opacity=".5"/>' % (
        "M50 52L26 42M50 52L76 48", STITCH, _num(lw * .8)))
    return "".join(out)


def santa_hat(ink=INK, lw=4.5):
    return ('<path d="M18 66C22 40 42 24 62 30C74 33 82 42 84 52L88 62C80 70 60 74 40 72Z" '
            'fill="#C0392B" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (ink, _num(lw))
            + '<ellipse cx="88" cy="66" rx="9" ry="9" fill="#F7F3EA" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))
            + '<rect x="12" y="60" width="80" height="16" rx="8" fill="#F7F3EA" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw)))


def reindeer_head(ink=INK, lw=4.4):
    out = ['<path d="M50 30a22 22 0 1 1 0 44a22 22 0 1 1 0-44Z" fill="#A9773F" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))]
    out.append('<path d="M30 34C22 24 22 12 30 8M70 34C78 24 78 12 70 8" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (ink, _num(lw)))
    out.append('<path d="M28 44C26 34 18 30 12 32M72 44C74 34 82 30 88 32" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (ink, _num(lw * .8)))
    for x in (40, 60):
        out.append('<circle cx="%s" cy="48" r="3.2" fill="%s"/>' % (x, ink))
    out.append('<ellipse cx="50" cy="66" rx="12" ry="9" fill="#E8B4A8" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw * .7)))
    out.append('<circle cx="45" cy="64" r="2" fill="%s"/><circle cx="55" cy="64" r="2" fill="%s"/>' % (ink, ink))
    out.append(('<path d="M50 34L50 20" stroke="#C0392B" stroke-width="6" stroke-linecap="round"/>'))
    return "".join(out)


# --------------------------------------------------------------------------- #
#  Fall / thanksgiving
# --------------------------------------------------------------------------- #
def pumpkin(ink=INK, lw=4.4, body="#E4813C"):
    out = ['<path d="M50 30C64 30 80 42 80 58C80 76 66 88 50 88C34 88 20 76 20 58C20 42 36 30 50 30Z" fill="%s" stroke="%s" stroke-width="%s"/>' % (body, ink, _num(lw))]
    for x in (36, 50, 64):
        out.append('<path d="M%s 32C%s 46 %s 74 %s 86" fill="none" stroke="%s" stroke-width="%s" opacity=".55"/>'
                   % (x, x + (x - 50) * .4, x + (x - 50) * .4, x + (x - 50) * .35, ink, _num(lw * .7)))
    out.append('<path d="M50 30L50 18" stroke="#4E6B3A" stroke-width="7" stroke-linecap="round"/>')
    out.append('<path d="M50 20C58 12 70 12 76 18C68 24 58 24 50 20Z" fill="#4E6B3A" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw * .6)))
    return "".join(out)


def turkey(ink=INK, lw=4.2):
    out = []
    for i, a in enumerate(range(-60, 61, 20)):
        out.append('<g transform="rotate(%s 50 60)"><ellipse cx="50" cy="22" rx="10" ry="16" fill="%s" stroke="%s" stroke-width="%s" opacity=".95"/></g>'
                   % (a, ["#C0562F", "#E4813C", "#D9A93C", "#A9773F", "#C0562F", "#E4813C", "#D9A93C"][i], ink, _num(lw * .7)))
    out.append('<ellipse cx="50" cy="62" rx="22" ry="20" fill="#A9773F" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw)))
    out.append('<circle cx="50" cy="42" r="13" fill="#B98A4B" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw)))
    out.append('<path d="M58 44L70 48L58 51Z" fill="#E4813C" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw * .6)))
    out.append('<path d="M56 54C60 60 58 66 52 66" fill="none" stroke="#C0392B" stroke-width="4"/>')
    for x in (45, 55):
        out.append('<circle cx="%s" cy="39" r="2.4" fill="%s"/>' % (x, ink))
    out.append('<path d="M36 66C30 58 30 50 34 44" fill="none" stroke="%s" stroke-width="%s" opacity=".5"/>' % (ink, _num(lw * .6)))
    return "".join(out)


def leaf(ink=INK, lw=3.6, fill="#C0562F"):
    d = "M50 92C26 78 20 50 34 26C56 30 76 50 74 74C66 84 58 90 50 92Z"
    return ('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (d, fill, ink, _num(lw))
            + '<path d="M50 88L50 30M50 60L34 46M50 44L64 32" fill="none" stroke="%s" stroke-width="%s" opacity=".6"/>'
            % (STITCH, _num(lw * .8)))


def acorn(ink=INK, lw=3.6):
    return ('<path d="M50 92C36 84 28 70 30 56C40 46 60 46 70 56C72 70 64 84 50 92Z" fill="#A9773F" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))
            + '<path d="M26 56C34 44 66 44 74 56C66 62 34 62 26 56Z" fill="#8B5A2B" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))
            + '<path d="M50 44L50 32" stroke="%s" stroke-width="5" stroke-linecap="round"/>' % ink)


def sunflower(ink=INK, lw=3.4, petals=12):
    out = []
    for i in range(petals):
        a = i * 360 / petals
        out.append('<g transform="rotate(%s 50 50)"><ellipse cx="50" cy="26" rx="8" ry="15" fill="#E9B33C" stroke="%s" stroke-width="%s"/></g>'
                   % (_num(a), ink, _num(lw * .7)))
    out.append('<circle cx="50" cy="50" r="13" fill="#8B5A2B" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw)))
    return "".join(out)


def wheat(ink=INK):
    out = ['<path d="M50 96L50 40" stroke="%s" stroke-width="4" stroke-linecap="round"/>' % ink]
    for i, y in enumerate(range(42, 76, 9)):
        for side in (-1, 1):
            out.append('<ellipse cx="%s" cy="%s" rx="4.4" ry="7.5" fill="#D9A93C" stroke="%s" stroke-width="2" transform="rotate(%s %s %s)"/>'
                       % (_num(50 + side * 7), y, ink, _num(side * 35), _num(50 + side * 7), y))
    out.append('<ellipse cx="50" cy="34" rx="4.4" ry="8" fill="#D9A93C" stroke="%s" stroke-width="2"/>' % ink)
    return "".join(out)


# --------------------------------------------------------------------------- #
#  Coquette / cocktails
# --------------------------------------------------------------------------- #
def martini(ink=INK, lw=3.8, glass="#F3E9D6", drink="#E8A598"):
    out = ['<path d="M22 26H78L50 58L22 26Z" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (drink, ink, _num(lw))]
    out.append('<path d="M22 26H78L50 58L22 26Z" fill="none" stroke="%s" stroke-width="%s"/>' % (glass, _num(lw * .7)))
    out.append('<path d="M50 58L50 84M36 86L64 86" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (ink, _num(lw)))
    out.append('<path d="M62 18L70 8" stroke="%s" stroke-width="4" stroke-linecap="round"/>' % ink)
    out.append('<circle cx="42" cy="34" r="4.6" fill="#C0392B" stroke="%s" stroke-width="2"/>' % ink)
    out.append('<circle cx="56" cy="30" r="2.2" fill="#FBE3C0"/><circle cx="60" cy="26" r="1.8" fill="#FBE3C0"/>')
    return "".join(out)


def champagne(ink=INK, lw=3.8):
    out = ['<path d="M36 18H64C64 44 58 56 50 56C42 56 36 44 36 18Z" fill="#F6E7C8" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))]
    out.append('<path d="M50 56L50 84M36 88H64" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (ink, _num(lw)))
    out.append('<path d="M40 40C44 46 56 46 60 40" fill="none" stroke="%s" stroke-width="3" opacity=".6"/>' % ink)
    return "".join(out)


def bow_small(ink=INK, lw=3.6, fill=GOLD):
    """Tiny gold line bow used as an accent everywhere in the shop."""
    return ('<g fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M50 52C38 40 24 40 22 50C20 60 36 62 50 54"/>'
            '<path d="M50 52C62 40 76 40 78 50C80 60 64 62 50 54"/>'
            '<path d="M44 54L36 76M56 54L64 76"/><circle cx="50" cy="53" r="4" fill="%s"/></g>'
            % (fill, _num(lw), fill))


# --------------------------------------------------------------------------- #
#  Sport
# --------------------------------------------------------------------------- #
def basketball_hoop(ink=INK, lw=4.2):
    out = ['<path d="M56 26H84V58H56Z" fill="#F3E9D6" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))]
    out.append('<path d="M56 20H88" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (ink, _num(lw * 1.3)))
    out.append('<path d="M62 44H78V54H62Z" fill="none" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw * .8)))
    out.append('<path d="M30 30H56" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % ("#C0392B", _num(lw * 1.6)))
    out.append('<path d="M30 34L30 46M56 34L56 46" stroke="%s" stroke-width="2.4" opacity=".8"/>' % ink)
    out.append('<path d="M26 46C30 68 44 80 58 80C70 80 78 70 80 58" fill="none" stroke="%s" stroke-width="2.4" stroke-dasharray="5 5" opacity=".9"/>' % ink)
    return "".join(out)


def sneaker(ink=INK, lw=4.2):
    return ('<path d="M14 70C14 58 22 54 32 52C40 50 44 40 52 38C60 36 64 44 70 50C76 56 88 58 90 70Z" '
            'fill="#F3E9D6" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (ink, _num(lw))
            + '<path d="M12 70H92L90 80H14Z" fill="#A9773F" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))
            + '<path d="M40 48L52 58M46 44L58 54M52 42L64 52" stroke="%s" stroke-width="2.6" stroke-linecap="round"/>' % ink
            + '<path d="M70 60C78 58 84 62 86 66" fill="none" stroke="%s" stroke-width="2.4" opacity=".6"/>' % ink)


def basketball(ink=INK, lw=4.2, fill="#E4813C"):
    return ('<circle cx="50" cy="50" r="34" fill="%s" stroke="%s" stroke-width="%s"/>' % (fill, ink, _num(lw))
            + '<path d="M16 50H84M50 16V84" stroke="%s" stroke-width="%s" opacity=".85"/>' % (ink, _num(lw * .8))
            + '<path d="M30 22C44 34 44 66 30 78M70 22C56 34 56 66 70 78" fill="none" stroke="%s" stroke-width="%s" opacity=".85"/>' % (ink, _num(lw * .8)))


# --------------------------------------------------------------------------- #
#  Humour / cute animals
# --------------------------------------------------------------------------- #
def raccoon(ink=INK, lw=4.4):
    out = ['<path d="M20 34L14 14L34 22" fill="#8C8C8C" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (ink, _num(lw))]
    out.append('<path d="M80 34L86 14L66 22" fill="#8C8C8C" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (ink, _num(lw)))
    out.append('<path d="M50 24C68 24 82 40 82 56C82 74 68 88 50 88C32 88 18 74 18 56C18 40 32 24 50 24Z" fill="#9C9C9C" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw)))
    out.append('<path d="M18 50C26 40 40 44 50 48C60 44 74 40 82 50C74 60 62 62 50 58C38 62 26 60 18 50Z" fill="#3A3A3A"/>')
    out.append('<circle cx="40" cy="50" r="3.4" fill="#F7F3EA"/><circle cx="60" cy="50" r="3.4" fill="#F7F3EA"/>')
    out.append('<ellipse cx="50" cy="68" rx="16" ry="12" fill="#EDE6DA" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw * .7)))
    out.append('<path d="M50 62L50 68" stroke="%s" stroke-width="3"/>' % ink)
    out.append('<ellipse cx="50" cy="64" rx="5" ry="3.4" fill="%s"/>' % ink)
    out.append('<path d="M40 72C44 78 56 78 60 72" fill="none" stroke="%s" stroke-width="3"/>' % ink)
    return "".join(out)


def coffee_cup(ink=INK, lw=3.8):
    return ('<path d="M26 34H72L66 84H32Z" fill="#F3E9D6" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))
            + '<path d="M26 34H72L70 46H28Z" fill="%s"/>' % "#D9C7A8"
            + '<path d="M72 44C82 44 84 58 74 60" fill="none" stroke="%s" stroke-width="%s"/>' % (ink, _num(lw))
            + '<path d="M52 30L60 6" stroke="%s" stroke-width="4" stroke-linecap="round"/>' % ink
            + '<path d="M36 58H62" stroke="%s" stroke-width="2.4" opacity=".5"/>' % ink)


def heart_arrow(ink=INK, lw=3.6, fill="#C0392B"):
    return ('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
            % (heart(50, 46, 28), fill, ink, _num(lw))
            + '<path d="M8 74L86 34" stroke="%s" stroke-width="3.4" stroke-linecap="round"/>' % ink
            + '<path d="M8 74L20 70M8 74L14 62" stroke="%s" stroke-width="3.4" stroke-linecap="round"/>' % ink)


# --------------------------------------------------------------------------- #
#  Western
# --------------------------------------------------------------------------- #
def cowboy_hat(ink=INK, lw=4.4, fill="#A9773F"):
    out = ['<path d="M26 56C26 34 34 24 50 24C66 24 74 34 74 56Z" fill="%s" stroke="%s" stroke-width="%s"/>' % (fill, ink, _num(lw))]
    out.append('<path d="M10 58C24 50 34 54 50 54C66 54 76 50 90 58C84 72 68 78 50 78C32 78 16 72 10 58Z" fill="%s" stroke="%s" stroke-width="%s"/>' % (fill, ink, _num(lw)))
    out.append('<path d="M26 58C34 64 66 64 74 58" fill="none" stroke="%s" stroke-width="%s" opacity=".7"/>' % (STITCH, _num(lw * .8)))
    out.append('<path d="M28 46C36 50 64 50 72 46" fill="none" stroke="%s" stroke-width="3" opacity=".6"/>' % ink)
    return "".join(out)


def boot(ink=INK, lw=4.4, fill="#A9773F"):
    d = ("M34 12H62L60 56C60 64 68 66 76 70C86 74 88 84 80 88H30C22 88 20 80 24 72L34 56Z")
    out = ['<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (d, fill, ink, _num(lw))]
    out.append('<path d="M22 84H86" stroke="%s" stroke-width="6" stroke-linecap="round"/>' % ink)
    out.append('<path d="M40 18H56M40 26H56" stroke="%s" stroke-width="2.6" opacity=".7"/>' % STITCH)
    out.append('<path d="M50 40L58 46L50 52L42 46Z" fill="%s" stroke="%s" stroke-width="2.4"/>' % (GOLD, ink))
    return "".join(out)


def star_badge(ink=INK, lw=4.0, fill=GOLD):
    return ('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
            % (star(50, 50, 42, inner=.46), fill, ink, _num(lw))
            + '<circle cx="50" cy="50" r="22" fill="none" stroke="%s" stroke-width="3" stroke-dasharray="6 5" opacity=".8"/>' % ink)


def cactus(ink=INK, lw=4.0, fill="#4E7D5C"):
    d = ("M42 88V44C42 36 58 36 58 44V60M58 56H66C72 56 74 50 74 44V34"
         "M42 66H34C28 66 26 60 26 54V46")
    out = ['<path d="%s" fill="none" stroke="%s" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>' % (d, fill)]
    out.append('<path d="%s" fill="none" stroke="%s" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity=".001"/>' % (d, ink))
    out.append('<path d="%s" fill="none" stroke="%s" stroke-width="4" stroke-dasharray="0 0" opacity="0"/>' % (d, ink))
    return "".join(out)


# --------------------------------------------------------------------------- #
#  filler decorations
# --------------------------------------------------------------------------- #
def star_cluster(ink=INK, fill=GOLD):
    out = []
    for x, y, r in ((10, 80, 7), (90, 20, 5), (78, 86, 4.5)):
        out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="2.4" stroke-linejoin="round" opacity=".9"/>'
                   % (star(x, y, r, inner=.44), fill, ink))
    return "".join(out)


def sprig(ink=INK, lw=2.8, fill="none", color=GOLD):
    out = ['<path d="M50 96C50 70 50 44 54 16" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (color, _num(lw))]
    for i, y in enumerate((28, 44, 60, 76)):
        side = -1 if i % 2 else 1
        out.append('<path d="M%s %sC%s %s %s %s %s %s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>'
                   % (_num(52 + side * 2), y, _num(52 + side * 12), _num(y - 8),
                      _num(52 + side * 20), _num(y - 2), _num(52 + side * 22), _num(y + 8),
                      color, _num(lw)))
    return "".join(out)


def doodle_frame(ink=INK, w=760, h=760, r=40, lw=3):
    return ('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="none" stroke="%s" '
            'stroke-width="%s" stroke-dasharray="14 10" opacity=".55"/>'
            % (-w / 2, -h / 2, w, h, r, ink, lw))
