#!/usr/bin/env python3
"""
designs.py — ten sublimation designs in the K-Studio house style.

  python3 tools/designs/designs.py            # everything
  python3 tools/designs/designs.py d03 d07    # just a few

Outputs (4500x5400 @ 300 dpi):
  etsy-designs/png/<id>-<slug>.png     transparent PNG, print ready
  etsy-designs/svg/<id>-<slug>.svg     vector version
  etsy-designs/preview/<id>.jpg        1000x1000 listing preview
"""
import math
import os
import random
import sys

import render as R
import icons as I

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "etsy-designs"))
W, H = 4500, 5400
INK = R.INK if hasattr(R, "INK") else "#2A211C"
CREAM = "#F7F0DF"
GOLD = R.GOLD
GOLD2 = R.GOLD2


# --------------------------------------------------------------------------- #
#  text helpers
# --------------------------------------------------------------------------- #
def line(txt, size, x, y, fill=CREAM, ink=INK, lw=9, font="cond", tracking=4, anchor="middle",
         shadow=True, paint=None, uid="ln"):
    """A plain lettered line with a thick sticker outline (optional fabric fill)."""
    letters, total = R.layout(txt, font, size, x, y, tracking, anchor)
    out = []
    for i, L in enumerate(letters):
        if not L["ch"].strip():
            continue
        d, _ = R.placed_path(font, L["ch"], size, L["x"], y)
        if shadow:
            out.append('<path d="%s" fill="#000" opacity=".2" transform="translate(%s %s)"/>'
                       % (d, R._num(size * .04), R._num(size * .05)))
        if paint:
            cid = "%s%d" % (uid, i)
            out.append('<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, d))
            out.append('<path d="%s" fill="%s"/>' % (d, fill))
            out.append('<g clip-path="url(#%s)">%s</g>' % (cid, paint(L["x"], y - size * .5)))
        out.append('<g stroke="%s" stroke-width="%s" stroke-linejoin="round">'
                   '<path d="%s" fill="%s"/></g>' % (ink, lw * 2, d, "none" if paint else fill))
    return "".join(out)


def script(txt, size, x, y, fill=GOLD2, ink=INK, lw=7, font="script", tracking=0,
           anchor="middle", shadow=False, paint=None, uid="sc"):
    """Script line (no sticker outline by default) with optional fabric fill."""
    letters, total = R.layout(txt, font, size, x, y, tracking, anchor)
    out = []
    for i, L in enumerate(letters):
        if not L["ch"].strip():
            continue
        d, _ = R.placed_path(font, L["ch"], size, L["x"], y)
        if shadow:
            out.append('<path d="%s" fill="#000" opacity=".18" transform="translate(%s %s)"/>'
                       % (d, R._num(size * .03), R._num(size * .04)))
        if paint:
            cid = "%s%d" % (uid, i)
            out.append('<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, d))
            out.append('<path d="%s" fill="%s"/>' % (d, fill))
            out.append('<g clip-path="url(#%s)">%s</g>' % (cid, paint(L["x"], y - size * .5)))
        else:
            out.append('<path d="%s" fill="%s"/>' % (d, fill))
        out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
                   % (d, ink, R._num(lw)))
    return "".join(out)


def patchword(txt, texs, size, x, y, tracking=0, anchor="middle", lw=18, sw=9, bounce=0.0,
              jitter=0.0, seed=1, outline=INK, stitch=CREAM, shadow=True, uid="pw", extra=None):
    """Word made of fabric letters; `texs` is a list of texture painters used in rotation."""
    rng = random.Random(seed)
    letters, total = R.layout(txt, "blk", size, x, y, tracking, anchor)
    out = []
    n = max(1, len(letters) - 1)
    for i, L in enumerate(letters):
        L.update(font="blk", uid="%s%d" % (uid, i))
        if not L["ch"].strip():
            continue
        dy = -math.sin(i / n * math.pi) * size * bounce if bounce else 0.0
        rot = (i - n / 2) * jitter if jitter else 0.0
        tex = texs[i % len(texs)] if texs else None
        out.append(R.letter(L, paint=tex, fill="#F1D2A6", outline=outline, lw=lw, stitch=stitch,
                            sw=sw, shadow=shadow, dy=dy, rot=rot,
                            extra=extra(i, L["ch"], L) if extra else ""))
    return "".join(out), total


def star_row(d, n, y, x0, x1, size=70, fill=GOLD):
    for i in range(n):
        x = x0 + (x1 - x0) * i / max(1, n - 1)
        d.add('<path d="%s" fill="%s" stroke="%s" stroke-width="6" stroke-linejoin="round"/>'
              % (R.star(x, y, size, inner=.44), fill, INK))


# --------------------------------------------------------------------------- #
#  01 · HOLLY JOLLY — leopard patchwork + faux applique tree
# --------------------------------------------------------------------------- #
def d01():
    d = R.Doc(W, H)
    leo = R.texture("leopard", seed=12)
    chk = R.texture("gingham", a="#C0392B", b="#FBF3E4", tile=190)
    d.add(patchword("HOLLY", [leo, chk, leo, chk, leo], 760, W / 2, 1200, -14, lw=22, sw=10,
                    uid="h1")[0])
    d.add(R.ribbon_bow(W / 2, 1950, 300, fill=CREAM, lw=14, uid="b1"))
    d.add(I.place(I.pine_tree(fill="#2E6B4F", lw=4.4), W / 2, 3200, 1750))
    d.add(patchword("JOLLY", [leo, chk, leo, chk, leo], 760, W / 2, 4230, -14, lw=22, sw=10,
                    uid="h2")[0])
    d.add(script("merry & bright", 330, W / 2, 4700, fill=GOLD2))
    star_row(d, 2, 640, 560, W - 560, 80)
    return d


# --------------------------------------------------------------------------- #
#  02 · MERRY CHRISTMAS — six different fabrics, one bow
# --------------------------------------------------------------------------- #
def d02():
    d = R.Doc(W, H)
    texs = [
        R.texture("gingham", a="#C0392B", b="#FBF3E4", tile=175),
        R.texture("leopard", seed=31),
        R.texture("trees", bg="#2E6B4F", dot="#F3E4C4", tile=170),
        R.texture("polka", bg="#C0392B", dot="#F6EBD2", tile=165, r=17),
        R.texture("plaid", base="#8B3A3A", a="#F3D9A4", b="#2E6B4F", tile=190),
        R.texture("stripes", a="#2E6B4F", b="#FBF3E4", tile=170, n=5),
    ]
    d.add(patchword("MERRY", texs, 700, W / 2, 1080, -10, bounce=.05, uid="m", lw=22, sw=10)[0])
    d.add(R.ribbon_bow(W / 2, 1720, 270, fill=CREAM, lw=13, uid="b2"))
    d.add(patchword("CHRISTMAS", texs[2:] + texs[:3], 480, W / 2, 2290, 4, uid="c", lw=16, sw=8)[0])
    d.add(I.place(I.holly(lw=3.6), 900, 1700, 420))
    d.add(I.place(I.holly(lw=3.6), 3600, 1700, 420))
    leo = R.texture("leopard", seed=5)
    d.add(I.place(I.pine_tree(paint=leo, fill="#F1D2A6", lw=5.2, uid="lt"), W / 2, 3520, 1650))
    d.add(R.ribbon_bow(W / 2, 2820, 210, fill="#C0392B", lw=11, uid="b3"))
    d.add(script("to the world", 300, W / 2, 4620, fill=GOLD2))
    d.add(script("holly jolly christmas", 210, W / 2, 4880, fill=CREAM, lw=6, font="hand"))
    for x, y, sz in ((430, 2300, 95), (4070, 2260, 110), (520, 4790, 80), (4000, 4760, 90)):
        d.add(I.place('<g fill="none" stroke="%s" stroke-width="6" stroke-linecap="round">%s</g>'
                      % (GOLD, R.snowflake(50, 50, 34)), x, y, sz))
    return d


# --------------------------------------------------------------------------- #
#  03 · LEOPARD CHRISTMAS TREE (hero listing)
# --------------------------------------------------------------------------- #
def d03():
    d = R.Doc(W, H)
    leo = R.texture("leopard", seed=21, tile=260)
    gold = R.texture("leopard", base=GOLD2, rosette="#B4802E", ring="#FFF0C4", seed=9, tile=240)
    d.add(I.place(I.pine_tree(paint=leo, fill="#F1D2A6", lw=5.6, uid="t3"), W / 2, 2050, 3300))
    d.add(R.ribbon_bow(W / 2, 640, 430, fill=CREAM, lw=18, uid="b4"))
    rng = random.Random(4)
    for i in range(10):
        x = W / 2 + rng.uniform(-1000, 1000) * (1 - abs(i - 5) / 8)
        y = rng.uniform(1250, 3050)
        d.add('<circle cx="%s" cy="%s" r="%s" fill="%s" stroke="%s" stroke-width="10"/>'
              % (R._num(x), R._num(y), R._num(rng.uniform(48, 74)),
                 rng.choice([CREAM, GOLD, "#C0392B"]), INK))
    d.add(patchword("MERRY", None, 520, W / 2, 4150, 14, lw=20, sw=9, uid="m3")[0])
    d.add(script("CHRISTMAS", 620, W / 2, 4820, fill="#F1D2A6", lw=12, paint=gold))
    for x, y, sz in ((640, 800, 110), (3860, 700, 130), (600, 4900, 90), (3900, 4820, 100)):
        d.add(I.place(I.star_badge(GOLD), x, y, sz))
    return d


# --------------------------------------------------------------------------- #
#  04 · CHRISTMAS PLEASE — coquette cocktails
# --------------------------------------------------------------------------- #
def d04():
    d = R.Doc(W, H)
    texs = [R.texture("gingham", a="#C0392B", b="#FBF3E4", tile=180),
            R.texture("leopard", base="#F6E1C6", seed=44)]
    d.add(patchword("CHRISTMAS", texs, 520, W / 2, 900, 6, uid="cp", lw=17, sw=8)[0])
    # three martinis, coquette styling (bows, cherries, candy cane stirrers)
    for i, (x, s_) in enumerate([(1150, 1250), (2250, 1400), (3350, 1250)]):
        y = 2150
        d.add(I.place(I.martini(ink=INK, glass=CREAM, drink="#E8A598"), x, y, s_))
        d.add(R.ribbon_bow(x, y + s_ * .30, s_ * .13, fill=CREAM if i != 1 else "#C0392B",
                           lw=7, uid="bm%d" % i))
        if i != 1:
            d.add(I.place(I.candy_cane(), x + s_ * .22, y - s_ * .30, s_ * .52, rot=22))
        else:
            d.add(R.ribbon_bow(x, y - s_ * .26, s_ * .22, fill="#C0392B", lw=10, uid="bmt"))
            d.add('<circle cx="%s" cy="%s" r="26" fill="#C0392B" stroke="%s" stroke-width="7"/>'
                  % (R._num(x + s_ * .30), R._num(y - s_ * .40), INK))
    d.add(script("please.", 760, W / 2, 3480, fill=CREAM, lw=14))
    d.add(R.ribbon_bow(W / 2, 2860, 230, fill=GOLD2, lw=11, uid="b5"))
    d.add(line("SANTA MARTINI", 230, W / 2, 3760, fill=GOLD2, lw=9, tracking=22))
    d.add(line("LET'S GET FESTIVE", 150, W / 2, 3980, fill=CREAM, lw=6, tracking=26, font="bebas"))
    # hanging ornaments along the bottom
    for i, x in enumerate((900, 2250, 3600)):
        d.add('<path d="M%s 4180L%s %s" stroke="%s" stroke-width="7" stroke-linecap="round"/>'
              % (R._num(x), R._num(x), R._num(4330), INK))
        d.add('<circle cx="%s" cy="%s" r="%s" fill="%s" stroke="%s" stroke-width="10"/>'
              % (R._num(x), R._num(4420), R._num(95), [CREAM, "#C0392B", GOLD][i], INK))
        d.add(R.ribbon_bow(x, 4290, 90, fill=GOLD2, lw=7, uid="bo%d" % i))
    for x, y, sz in ((620, 1400, 90), (3900, 1350, 100), (700, 3250, 80), (3820, 3200, 90)):
        d.add(I.place(I.snowflake(50, 50, 36), x, y, sz))
    d.add(script("cheers, santa baby", 220, W / 2, 4780, fill=CREAM, lw=6, font="hand"))
    return d


# --------------------------------------------------------------------------- #
#  05 · GIVE THANKS — polka letters + gold doodle bow + turkey
# --------------------------------------------------------------------------- #
def d05():
    d = R.Doc(W, H)
    pola = R.texture("polka", bg="#3F5B49", dot=CREAM, tile=150, r=13)
    texs = [pola, R.texture("polka", bg="#8B5A2B", dot=CREAM, tile=150, r=13)]
    d.add(line("GIVE", 520, W / 2, 900, fill=CREAM, lw=16, tracking=26))
    d.add(line("THANKS", 620, W / 2, 1650, fill=CREAM, lw=18, tracking=12))
    # gold line-art bow sitting behind the words
    d.add('<g opacity=".95">%s</g>' % I.bow_small(fill=GOLD))
    d.add(I.place(I.bow_small(fill=GOLD), W / 2, 2050, 700))
    d.add(I.place(I.turkey(lw=4.6), W / 2, 3250, 1450))
    d.add(I.place(I.pumpkin(), 1250, 3350, 700))
    d.add(I.place(I.leaf(fill="#C0562F"), 3450, 3150, 620))
    d.add(I.place(I.acorn(), 3550, 3750, 480))
    d.add(I.place(I.leaf(fill="#D9A93C"), 1000, 3900, 520))
    d.add(script("thankful always", 260, W / 2, 4500, fill=GOLD2))
    for x, y, sz in ((700, 700, 90), (3800, 700, 90)):
        d.add(I.place(I.wheat(), x, y, sz))
    return d


# --------------------------------------------------------------------------- #
#  06 · THANKFUL — scribbled hand-lettered fall
# --------------------------------------------------------------------------- #
def d06():
    d = R.Doc(W, H)
    texs = [R.texture("polka", bg="#8B5A2B", dot=CREAM, tile=150, r=13),
            R.texture("stripes", a="#C0562F", b=CREAM, tile=150, n=5)]
    # hand-drawn "THANKFUL": Caveat, thick sticker + scribble hatch
    d.add(line("THANKFUL", 640, W / 2, 1250, fill="#E4813C", lw=20, font="hand", tracking=8))
    d.add(script("a little louder", 240, W / 2, 1620, fill=CREAM, lw=6, font="hand"))
    d.add(I.place(I.turkey(lw=5), W / 2, 2800, 1250))
    d.add(I.place(I.pumpkin(), 1150, 2900, 620))
    d.add(I.place(I.leaf(fill="#C0562F"), 3400, 2750, 560))
    d.add(I.place(I.acorn(), 1000, 3500, 430))
    d.add(I.place(I.leaf(fill="#D9A93C"), 3520, 3400, 470))
    d.add(patchword("FALL", texs, 380, W / 2, 4300, 18, uid="fl", lw=12, sw=6)[0])
    d.add(script("vibes", 320, W / 2, 4750, fill=GOLD2))
    for x, y, sz in ((620, 620, 80), (3880, 620, 80), (640, 3900, 70), (3850, 3850, 70)):
        d.add(I.place(I.wheat(), x, y, sz))
    return d


# --------------------------------------------------------------------------- #
#  07 · SMALL TOWN CHRISTMAS — vintage red truck
# --------------------------------------------------------------------------- #
def truck(ink=INK, lw=4.4, body="#C0392B", cream=CREAM):
    out = [
        # bed
        '<path d="M8 56H56V78H8Z" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (body, ink, R._num(lw)),
        # cab
        '<path d="M56 44H66L78 56H88V78H56Z" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (body, ink, R._num(lw)),
        # window
        '<path d="M60 48H68L76 58H60Z" fill="%s" stroke="%s" stroke-width="%s"/>' % ("#BFD8E8", ink, R._num(lw * .8)),
        # tree in the bed
        '<path d="M32 8L46 30H18Z" fill="#2E6B4F" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (ink, R._num(lw)),
        '<path d="M32 20L48 44H16Z" fill="#2E6B4F" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (ink, R._num(lw)),
        '<path d="M29 44H35V56H29Z" fill="#8B5A2B" stroke="%s" stroke-width="%s"/>' % (ink, R._num(lw * .8)),
        # wheels
        '<circle cx="24" cy="80" r="11" fill="%s" stroke="%s" stroke-width="%s"/>' % (cream, ink, R._num(lw)),
        '<circle cx="24" cy="80" r="4" fill="%s"/>' % ink,
        '<circle cx="76" cy="80" r="11" fill="%s" stroke="%s" stroke-width="%s"/>' % (cream, ink, R._num(lw)),
        '<circle cx="76" cy="80" r="4" fill="%s"/>' % ink,
        # wreath on the door
        '<circle cx="72" cy="68" r="5.5" fill="none" stroke="#2E6B4F" stroke-width="4"/>',
    ]
    return "".join(out)


def d07():
    d = R.Doc(W, H)
    d.add(I.place(truck(), W / 2, 1600, 2500))
    d.add(line("SMALL TOWN", 470, W / 2, 3150, fill=CREAM, lw=16, tracking=10))
    d.add(script("christmas", 720, W / 2, 3900, fill=GOLD2, lw=12))
    d.add(I.place(I.pine_tree(fill="#2E6B4F", lw=4), 900, 1250, 900))
    d.add(I.place(I.pine_tree(fill="#2E6B4F", lw=4), 3600, 1250, 900))
    d.add(script("est. in the country", 220, W / 2, 4400, fill=CREAM, lw=6, font="hand"))
    for x, y, sz in ((560, 2400, 90), (3940, 2400, 90), (700, 4600, 70), (3800, 4600, 70)):
        d.add(I.place('<g fill="none" stroke="%s" stroke-width="6">%s</g>' % (CREAM, R.snowflake(50, 50, 34)), x, y, sz))
    return d


# --------------------------------------------------------------------------- #
#  08 · CHRISTMAS RACCOON — funny holiday
# --------------------------------------------------------------------------- #
def d08():
    d = R.Doc(W, H)
    d.add(I.place(I.raccoon(lw=5), W / 2, 1750, 2200))
    d.add(I.place(I.santa_hat(), W / 2, 780, 1150, rot=-8))
    d.add(I.place(I.coffee_cup(), 3300, 2600, 800, rot=12))
    d.add(R.ribbon_bow(W / 2, 2950, 300, fill="#C0392B", lw=14, uid="b8"))
    d.add(line("FULLY BOOKED", 400, W / 2, 3600, fill=CREAM, lw=14, tracking=8))
    d.add(line("NO REFUNDS", 400, W / 2, 4020, fill=GOLD2, lw=14, tracking=8))
    d.add(script("on holiday cheer", 280, W / 2, 4450, fill=CREAM, lw=8, font="hand"))
    for x, y, sz in ((620, 1150, 90), (3900, 1150, 90), (640, 4300, 80), (3860, 4300, 80)):
        d.add(I.place('<g fill="none" stroke="%s" stroke-width="6">%s</g>' % (GOLD, R.snowflake(50, 50, 34)), x, y, sz))
    return d


# --------------------------------------------------------------------------- #
#  09 · TAKE IT TO THE HOOP — minimal sport line art
# --------------------------------------------------------------------------- #
def d09():
    d = R.Doc(W, H)
    d.add(line("TAKE IT", 520, W / 2, 1000, fill=CREAM, lw=16, tracking=14))
    d.add(I.place(I.basketball_hoop(lw=4.6), W / 2, 1900, 1500))
    d.add(I.place(I.basketball(lw=4.6), 1180, 2450, 700))
    d.add(I.place(I.sneaker(lw=4.6), 3320, 2500, 1000, rot=-6))
    d.add(script("to the hoop", 560, W / 2, 3350, fill=CREAM, lw=12))
    d.add('<g opacity=".22">%s</g>' % (
        '<g transform="translate(2250 3900)"><path d="%s" fill="none" stroke="%s" stroke-width="5"/>'
        '<path d="%s" fill="none" stroke="%s" stroke-width="5"/></g>'
        % (R.grid(0, 0, 3000, 900, 10, 3, seed=4), INK, R.grid(0, 0, 3000, 900, 10, 3, seed=9), INK)),
    )
    d.add(line("GAME DAY", 250, W / 2, 4280, fill=GOLD2, lw=8, tracking=22))
    for x, y, sz in ((740, 1150, 80), (3780, 1120, 90), (820, 3600, 70), (3700, 3560, 80)):
        d.add(I.place('<path d="%s" fill="%s"/>' % (R.sparkle(50, 50, 40), GOLD), x, y, sz))
    d.add(script("sports mom era", 230, W / 2, 4650, fill=CREAM, lw=6, font="hand"))
    return d


# --------------------------------------------------------------------------- #
#  10 · MAMA — western patchwork name + coquette bows
# --------------------------------------------------------------------------- #
def d10():
    d = R.Doc(W, H)
    texs = [
        R.texture("leopard", seed=61),
        R.texture("gingham", a="#C0392B", b="#FBF3E4", tile=170),
        R.texture("polka", bg="#8B5A2B", dot=CREAM, tile=160, r=14),
        R.texture("plaid", base="#3F5B49", a="#F3D9A4", b="#C0392B", tile=185),
    ]
    d.add(patchword("MAMA", texs, 1000, W / 2, 1900, -20, uid="ma", lw=26, sw=12, jitter=1.2)[0])
    d.add(R.ribbon_bow(W / 2, 700, 330, fill=CREAM, lw=16, uid="b10", gold=GOLD))
    d.add(R.ribbon_bow(W / 2, 2750, 300, fill=GOLD2, lw=15, uid="b11"))
    d.add(line("WESTERN MAMA", 260, W / 2, 3200, fill=CREAM, lw=9, tracking=26))
    d.add(I.place(I.boot(), 1500, 4000, 900, rot=-10))
    d.add(I.place(I.cowboy_hat(), 3000, 4000, 1000, rot=8))
    d.add(script("mama needs a minute", 250, W / 2, 4700, fill=GOLD2, lw=7))
    for x, y, sz in ((620, 1400, 90), (3880, 1400, 90), (660, 3400, 80), (3840, 3400, 80)):
        d.add(I.place(I.star_badge(GOLD), x, y, sz))
    return d


DESIGNS = ["d01", "d02", "d03", "d04", "d05", "d06", "d07", "d08", "d09", "d10"]
NAMES = {
    "d01": "holly-jolly-leopard",
    "d02": "merry-christmas-patchwork",
    "d03": "leopard-christmas-tree",
    "d04": "christmas-please-cocktails",
    "d05": "give-thanks-turkey",
    "d06": "thankful-fall-scribble",
    "d07": "small-town-christmas-truck",
    "d08": "christmas-raccoon-funny",
    "d09": "take-it-to-the-hoop",
    "d10": "western-mama-patchwork",
}


def build(ids):
    for sub in ("png", "svg", "preview"):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
    for i in ids:
        doc = globals()[i]()
        base = "%s-%s" % (i, NAMES[i])
        doc.save_png(os.path.join(OUT, "png", base + ".png"))
        doc.save_svg(os.path.join(OUT, "svg", base + ".svg"))
        doc.save_png(os.path.join(OUT, "preview", i + ".jpg" if False else i + "-preview.png"),
                     width=1100)
        print("built", base)


if __name__ == "__main__":
    args = sys.argv[1:] or DESIGNS
    build(args)
