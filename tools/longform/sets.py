"""Sets: night lab, night boardroom, paper table, black cards. Each returns a
frame plus the lamp pools to punch through the night grade."""
import math
import random

from PIL import Image, ImageDraw

from kit import (CREAM, GOLD, GREY, GREY_D, H, INK, INK_SOFT, LIME, NAVY, NAVY_2, NIGHT, PAPER,
                 W, WHITE, draw_char, font, gradient, ink_circle, ink_rect, ink_line, paper, poly, text)


def _bokeh(d, rng, n, y0, y1, col, r=46):
    for _ in range(n):
        x = rng.uniform(0, W)
        y = rng.uniform(y0, y1)
        rr = rng.uniform(r * 0.4, r)
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=col)


def lab(img, night=True, seed=1):
    """A cluttered engineering lab: shelves, bench, lamp, oscilloscope."""
    d = ImageDraw.Draw(img)
    rng = random.Random(seed)
    d.rectangle((0, 0, W, H), fill=NAVY_2)
    # back wall panels
    for i in range(7):
        x = i * (W / 7)
        d.rectangle((x, 0, x + W / 7 - 6, H * 0.62), fill=(27, 38, 66) if i % 2 else (31, 43, 74))
    # shelf with parts
    shelf_y = 300
    for k, y in enumerate((shelf_y, shelf_y + 210)):
        d.rectangle((90, y, W - 140, y + 18), fill=(58, 46, 40), outline=INK, width=5)
        x = 130
        while x < W - 220:
            w = rng.uniform(46, 96)
            h = rng.uniform(40, 96)
            c = rng.choice([(78, 86, 104), (96, 74, 62), (62, 84, 78), (104, 96, 78)])
            ink_rect(d, (x, y - h, x + w, y), c, 4, (5, 5))
            x += w + 26
    # corkboard with notes
    ink_rect(d, (1150, 120, 1720, 520), (70, 58, 48), 6, (8, 8))
    for i in range(7):
        x = 1180 + (i % 4) * 128
        y = 150 + (i // 4) * 170
        ink_rect(d, (x, y, x + 104, y + 132), (226, 218, 198), 2, (6, 6))
        for j in range(4):
            d.line((x + 12, y + 26 + j * 26, x + 92, y + 26 + j * 26), fill=(150, 142, 128), width=3)
        d.ellipse((x + 44, y - 8, x + 60, y + 8), fill=(196, 72, 58), outline=INK, width=3)
    # bench
    ink_rect(d, (0, 760, W, 1200), (86, 62, 46), 0, (0, 0), ow=2)
    d.rectangle((0, 760, W, 782), fill=(128, 96, 70))
    d.line((0, 782, W, 782), fill=INK, width=6)
    # oscilloscope
    ink_rect(d, (1290, 600, 1700, 760), (46, 54, 66), 12)
    d.rectangle((1310, 620, 1600, 740), fill=(28, 48, 44), outline=INK, width=4)
    pts = [(1310 + i * 14, 680 + math.sin(i * 0.7) * 46) for i in range(21)]
    d.line(pts, fill=(122, 226, 168), width=5, joint="curve")
    for i in range(4):
        ink_circle(d, (1636, 640 + i * 34), 13, (196, 92, 74), 4, (0, 0))
    # desk lamp (warm) and a stool
    ink_line(d, [(420, 760), (420, 640), (500, 620)], 9)
    poly(d, [(468, 596), (600, 640), (540, 690)], (206, 168, 96), 6)
    d.line((468, 596, 600, 640), fill=INK, width=6)
    # scattered parts on bench
    for i in range(9):
        x = 140 + i * 150 + rng.uniform(-20, 20)
        y = 700 + rng.uniform(-16, 14)
        ink_rect(d, (x, y, x + rng.uniform(40, 84), y + rng.uniform(18, 30)), rng.choice([(70, 78, 92), (108, 88, 70)]), 3, (5, 5))
    pools = [(520, 640, 760, 1.0), (1500, 690, 520, 0.55)] if night else []
    return img, pools


def boardroom(img, night=True, seed=2):
    """Long table, chairs, a TV glow, a chart on the wall."""
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=(24, 33, 58))
    for i in range(9):
        x = i * (W / 9)
        d.rectangle((x, 0, x + 2, H), fill=(20, 28, 50))
    # ceiling lights
    for i in range(4):
        x = 280 + i * 460
        d.line((x, 0, x, 70), fill=INK, width=6)
        ink_rect(d, (x - 110, 70, x + 110, 108), (222, 208, 170), 8, (6, 6))
        d.rectangle((x - 90, 108, x + 90, 118), fill=(255, 238, 190))
    # wall chart
    ink_rect(d, (180, 220, 700, 520), PAPER, 6, (8, 8))
    d.line((230, 300, 230, 490), fill=INK, width=5)
    d.line((230, 490, 660, 490), fill=INK, width=5)
    for i, v in enumerate((0.5, 0.72, 0.9, 0.86)):
        bx = 260 + i * 96
        d.rectangle((bx, 486 - 170 * v, bx + 62, 486), fill=(150, 176, 140) if i < 3 else (196, 96, 82), outline=INK, width=4)
    text(d, (236, 236), "FILM", size=44, f="marker", fill=INK, ow=3)
    # the television glow, back-left of table
    d.rectangle((1410, 200, 1810, 460), fill=(22, 30, 52), outline=INK, width=8)
    for i in range(9):
        d.rectangle((1424 + i * 42, 214, 1424 + i * 42 + 36, 444), fill=(58, 82, 96) if i % 2 else (74, 104, 118))
    # table
    poly(d, [(150, 800), (1770, 800), (1610, 1080), (310, 1080)], (58, 44, 34), 8)
    d.polygon([(180, 806), (1740, 806), (1600, 1074), (320, 1074)], fill=(74, 56, 42))
    # chairs
    for i in range(5):
        x = 260 + i * 350
        ink_rect(d, (x - 78, 690, x + 78, 812), (40, 46, 62), 14, (8, 8))
    pools = [(1520, 330, 620, 1.0), (700, 300, 700, 0.35)] if night else []
    return img, pools


def desk(img, night=True, seed=3):
    """Close desk surface, for closeups."""
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=(30, 40, 66))
    ink_rect(d, (0, 620, W, 1200), (86, 62, 46), 0, (0, 0), ow=2)
    d.rectangle((0, 620, W, 648), fill=(128, 96, 70))
    d.line((0, 648, W, 648), fill=INK, width=7)
    paper(d, (1250, 700, 1780, 1040), PAPER, 7, 4, 6, (10, 10))
    ink_rect(d, (140, 720, 420, 830), (70, 78, 92), 6, (8, 8))
    pools = [(960, 500, 900, 1.0)] if night else []
    return img, pools


def black(img, lines=(), color=NIGHT):
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=color)
    return img, []


def void(img, color=(18, 24, 42)):
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=color)
    return img, []


def portrait(img, night=True, seed=5):
    """Wall + lamp pool, for closeups. A faint desk edge at the bottom."""
    d = ImageDraw.Draw(img)
    rng = random.Random(seed)
    d.rectangle((0, 0, W, H), fill=(30, 40, 66))
    for i in range(8):
        x = i * (W / 8)
        d.rectangle((x, 0, x + 2, H), fill=(26, 36, 60))
    # framed certificate / a strip of wall detail
    ink_rect(d, (1360, 150, 1760, 480), (46, 58, 84), 6, (8, 8))
    d.rectangle((1384, 174, 1736, 456), outline=(120, 132, 158), width=4)
    for i in range(5):
        d.line((1420, 240 + i * 40, 1700 - (i % 3) * 60, 240 + i * 40), fill=(96, 108, 136), width=4)
    # desk lip
    d.rectangle((0, 980, W, H), fill=(74, 54, 40))
    d.rectangle((0, 980, W, H * 0.99), fill=(128, 96, 70))
    d.line((0, 980, W, 980), fill=INK, width=7)
    pools = [(760, 420, 900, 1.0), (1560, 300, 620, 0.4)] if night else []
    return img, pools
