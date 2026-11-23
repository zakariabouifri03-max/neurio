"""Drawing kit for the ReachMora 2D look: flat fills, one near-black ink line,
hard shadow, hand-lettered type. PIL + numpy only (no skia in this sandbox).

Style bible:
  - every shape gets a #18161B outline (5-7 px at 1080p)
  - flat fills, one hard offset shadow
  - night = deep navy multiplied down with warm lamp pools punched back in
  - labels: lime or cream hand-lettering with a thick ink stroke
  - stamps and marker rings in red
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
INK = (24, 22, 27)
INK_SOFT = (38, 36, 44)
NAVY = (16, 24, 44)
NAVY_2 = (23, 33, 58)
NIGHT = (11, 16, 30)
CREAM = (244, 233, 205)
PAPER = (246, 240, 226)
LIME = (216, 238, 108)
RED = (206, 76, 60)
RED_DEEP = (158, 48, 38)
GREY = (150, 152, 158)
GREY_D = (96, 99, 108)
BLUE = (96, 128, 178)
GOLD = (226, 178, 78)
WHITE = (250, 250, 246)

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
_FONTS = {
    "brush": "CaveatBrush-Regular.ttf",
    "kalam": "Kalam-Regular.ttf",
    "kalam_b": "Kalam-Bold.ttf",
    "marker": "PermanentMarker-Regular.ttf",
}
_cache = {}


def font(name, size):
    key = (name, size)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(os.path.join(FONT_DIR, _FONTS[name]), size)
    return _cache[key]


# ---------------------------------------------------------------- easing
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def ease_out(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def ease_in(t):
    t = clamp(t)
    return t ** 3


def ease_io(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def overshoot(t, s=1.9):
    """Snap with a little overshoot, like a hand-drawn pop."""
    t = clamp(t)
    return 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2


def seg(t, a, b):
    """0..1 progress of t inside [a,b]."""
    if b <= a:
        return 1.0 if t >= b else 0.0
    return clamp((t - a) / (b - a))


# ---------------------------------------------------------------- canvas
def new_canvas(w=W, h=H, color=NIGHT):
    img = Image.new("RGB", (w, h), color)
    return img, ImageDraw.Draw(img)


def text(d, xy, s, size=64, f="brush", fill=CREAM, ink=INK, ow=8, anchor="la", shadow=None):
    """Hand-lettering with a thick ink stroke around it."""
    ft = font(f, size)
    x, y = xy
    if shadow:
        d.text((x + shadow[0], y + shadow[1]), s, font=ft, fill=shadow[2], anchor=anchor,
               stroke_width=ow, stroke_fill=INK)
    d.text((x, y), s, font=ft, fill=fill, anchor=anchor, stroke_width=ow, stroke_fill=ink)


def text_plain(d, xy, s, size=44, f="kalam_b", fill=CREAM, anchor="la"):
    d.text(xy, s, font=font(f, size), fill=fill, anchor=anchor)


def shadow_box(d, box, fill, r=10, off=(9, 9), outline=INK, ow=6):
    x0, y0, x1, y1 = box
    d.rounded_rectangle((x0 + off[0], y0 + off[1], x1 + off[0], y1 + off[1]), r, fill=INK_SOFT)
    d.rounded_rectangle(box, r, fill=fill, outline=outline, width=ow)


def ink_rect(d, box, fill, r=0, off=(9, 9), ow=6):
    shadow_box(d, box, fill, r, off, INK, ow)


def ink_line(d, pts, w=7, fill=INK):
    d.line(pts, fill=fill, width=w, joint="curve")


def ink_circle(d, c, r, fill, ow=6, off=(8, 8)):
    d.ellipse((c[0] - r + off[0], c[1] - r + off[1], c[0] + r + off[0], c[1] + r + off[1]), fill=INK_SOFT)
    d.ellipse((c[0] - r, c[1] - r, c[0] + r, c[1] + r), fill=fill, outline=INK, width=ow)


def poly(d, pts, fill, ow=6, off=(8, 8)):
    d.polygon([(x + off[0], y + off[1]) for x, y in pts], fill=INK_SOFT)
    d.polygon(pts, fill=fill)
    d.line(list(pts) + [pts[0]], fill=INK, width=ow, joint="curve")


def paper(d, box, fill=PAPER, lines=6, r=4, ow=6, off=(10, 10), line_col=(176, 170, 158)):
    shadow_box(d, box, fill, r, off, INK, ow)
    x0, y0, x1, y1 = box
    step = (y1 - y0) / (lines + 2)
    for i in range(lines):
        y = y0 + step * (i + 1.4)
        d.line((x0 + 26, y, x1 - 34 - (i % 3) * 40, y), fill=line_col, width=4)


# ---------------------------------------------------------------- lighting
def gradient(w, h, top, bottom):
    a = np.zeros((h, w, 3), np.uint8)
    t = np.linspace(0, 1, h)[:, None, None]
    for i in range(3):
        a[:, :, i] = (top[i] * (1 - t[:, :, 0]) + bottom[i] * t[:, :, 0]).astype(np.uint8)
    return Image.fromarray(a, "RGB")


def radial(w, h, cx, cy, r, strength=1.0, color=(255, 226, 168)):
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt(((xx - cx) / r) ** 2 + ((yy - cy) / r) ** 2)
    fall = np.clip(1 - dist, 0, 1) ** 1.9 * strength
    return fall, color


def night_light(img, pools=(), dark=0.62, tint=(9, 13, 26)):
    """Multiply the frame down, then punch warm lamp pools back in."""
    a = np.asarray(img).astype(np.float32)
    h, w = a.shape[:2]
    shade = np.ones((h, w), np.float32)
    glow = np.zeros((h, w, 3), np.float32)
    for (cx, cy, r, st) in pools:
        fall, col = radial(w, h, cx, cy, r, st)
        shade += fall * (1.0 - dark) / dark
        glow[:, :, 0] += fall * col[0]
        glow[:, :, 1] += fall * col[1]
        glow[:, :, 2] += fall * col[2]
    shade = np.clip(shade, 0, 3)
    out = a * shade[:, :, None] * dark
    out += glow * 0.30
    t = np.array(tint, np.float32)
    out = out * 0.94 + t * 0.06
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


_VIG = None


def vignette(img, strength=0.42):
    global _VIG
    if _VIG is None or _VIG.shape[:2] != (img.height, img.width):
        h, w = img.height, img.width
        yy, xx = np.mgrid[0:h, 0:w]
        dx = (xx - w / 2) / (w / 2)
        dy = (yy - h / 2) / (h / 2)
        r = np.sqrt(dx * dx * 0.86 + dy * dy)
        _VIG = np.clip(1 - strength * np.clip(r - 0.55, 0, 2) ** 1.6, 0.15, 1).astype(np.float32)
    a = np.asarray(img).astype(np.float32) * _VIG[:, :, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def grain(img, amount=7, seed=0):
    rng = np.random.default_rng(seed)
    a = np.asarray(img).astype(np.int16)
    n = rng.integers(-amount, amount + 1, a.shape[:2], dtype=np.int16)[:, :, None]
    return Image.fromarray(np.clip(a + n, 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------- puppet
def _arm(d, sx, sy, ex, ey, col, w=17):
    d.line((sx, sy, ex, ey), fill=INK, width=w + 10)
    d.line((sx, sy, ex, ey), fill=col, width=w)


def draw_char(img, x, y, s=1.0, who="sasson", pose="stand", expr="neutral", flip=False, seated=False):
    """A round-head ink puppet. Returns the sprite image and its anchor (feet/base)."""
    hh = int(430 * s)
    ww = int(330 * s)
    sp = Image.new("RGBA", (ww * 2, hh * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(sp)
    cx = ww
    base = hh * 1.72

    if who == "sasson":
        suit, shirt, hair = (108, 122, 148), CREAM, (58, 48, 52)
    elif who == "kellner":
        suit, shirt, hair = (52, 58, 78), (232, 230, 226), (118, 112, 108)
    else:
        suit, shirt, hair = (30, 32, 44), (44, 48, 62), (26, 26, 32)

    head_r = 92 * s
    head_cy = base - 300 * s

    # body
    bw, bh = 108 * s, 150 * s
    torso_top = head_cy + head_r * 0.72
    poly_pts = [(cx - bw, torso_top), (cx + bw, torso_top), (cx + bw * 1.12, torso_top + bh), (cx - bw * 1.12, torso_top + bh)]
    poly(d, poly_pts, suit, ow=max(4, int(6 * s)), off=(0, 0))
    # shirt V
    d.polygon([(cx - 34 * s, torso_top), (cx + 34 * s, torso_top), (cx, torso_top + 74 * s)], fill=shirt)
    # tie
    d.polygon([(cx - 11 * s, torso_top + 16 * s), (cx + 11 * s, torso_top + 16 * s), (cx + 15 * s, torso_top + 66 * s), (cx - 15 * s, torso_top + 66 * s)], fill=(150, 70, 62) if who == "sasson" else (90, 96, 110))
    # neck
    d.rectangle((cx - 22 * s, head_cy + head_r * 0.55, cx + 22 * s, torso_top + 6 * s), fill=shirt, outline=INK, width=max(3, int(5 * s)))

    # legs / seated
    if seated:
        d.rounded_rectangle((cx - bw * 1.05, torso_top + bh, cx + bw * 1.05, torso_top + bh + 46 * s), 12, fill=suit, outline=INK, width=max(4, int(6 * s)))
        d.rounded_rectangle((cx - 92 * s, torso_top + bh + 20 * s, cx + 20 * s, torso_top + bh + 92 * s), 14, fill=suit, outline=INK, width=max(4, int(6 * s)))
    else:
        for sgn in (-1, 1):
            lx = cx + sgn * 40 * s
            d.line((lx, torso_top + bh - 4 * s, lx + sgn * 12 * s, base), fill=INK, width=int(34 * s))
            d.line((lx, torso_top + bh - 4 * s, lx + sgn * 12 * s, base), fill=(44, 46, 58), width=int(22 * s))
            d.rounded_rectangle((lx + sgn * 12 * s - 30 * s, base - 14 * s, lx + sgn * 12 * s + 34 * s, base + 10 * s), 8, fill=INK)

    # arms
    sh_y = torso_top + 32 * s
    if pose == "hold":
        _arm(d, cx - bw * 0.95, sh_y, cx - 96 * s, sh_y + 96 * s, suit, int(16 * s))
        _arm(d, cx + bw * 0.95, sh_y, cx + 96 * s, sh_y + 96 * s, suit, int(16 * s))
    elif pose == "point":
        _arm(d, cx - bw * 0.95, sh_y, cx - 96 * s, sh_y + 104 * s, suit, int(16 * s))
        _arm(d, cx + bw * 0.95, sh_y, cx + 190 * s, sh_y - 40 * s, suit, int(16 * s))
    elif pose == "fold":
        _arm(d, cx - bw * 0.95, sh_y, cx + 40 * s, sh_y + 70 * s, suit, int(16 * s))
        _arm(d, cx + bw * 0.95, sh_y, cx - 40 * s, sh_y + 84 * s, suit, int(16 * s))
    else:
        _arm(d, cx - bw * 0.95, sh_y, cx - 118 * s, sh_y + 130 * s, suit, int(16 * s))
        _arm(d, cx + bw * 0.95, sh_y, cx + 118 * s, sh_y + 130 * s, suit, int(16 * s))

    # head
    skin = (232, 198, 170) if who in ("sasson", "kellner") else (96, 92, 104)
    d.ellipse((cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r), fill=skin, outline=INK, width=max(4, int(7 * s)))

    # hair
    if who == "sasson":
        d.chord((cx - head_r - 6 * s, head_cy - head_r - 20 * s, cx + head_r + 6 * s, head_cy + head_r * 0.42), 180, 360, fill=hair, outline=INK, width=max(4, int(6 * s)))
        d.chord((cx - head_r - 2 * s, head_cy - head_r - 30 * s, cx + head_r * 0.9, head_cy + head_r * 0.1), 180, 330, fill=hair, outline=INK, width=max(3, int(5 * s)))
    elif who == "kellner":
        d.chord((cx - head_r - 4 * s, head_cy - head_r - 10 * s, cx + head_r + 4 * s, head_cy + head_r * 0.1), 180, 360, fill=hair, outline=INK, width=max(4, int(6 * s)))
    else:
        d.chord((cx - head_r - 4 * s, head_cy - head_r - 12 * s, cx + head_r + 4 * s, head_cy + head_r * 0.05), 180, 360, fill=hair, outline=INK, width=max(4, int(6 * s)))

    # face
    ey = head_cy - 12 * s
    if who == "board1" or who == "board2":
        pass
    else:
        for sgn in (-1, 1):
            ex = cx + sgn * 34 * s
            if expr == "shut":
                d.line((ex - 14 * s, ey, ex + 14 * s, ey), fill=INK, width=int(6 * s))
            else:
                d.ellipse((ex - 8 * s, ey - 9 * s, ex + 8 * s, ey + 9 * s), fill=INK)
        if expr == "frown":
            d.arc((cx - 34 * s, head_cy + 26 * s, cx + 34 * s, head_cy + 74 * s), 200, 340, fill=INK, width=int(7 * s))
        elif expr == "talk":
            d.ellipse((cx - 22 * s, head_cy + 34 * s, cx + 22 * s, head_cy + 64 * s), fill=(96, 52, 52), outline=INK, width=int(4 * s))
        elif expr == "smile":
            d.arc((cx - 34 * s, head_cy + 12 * s, cx + 34 * s, head_cy + 62 * s), 20, 160, fill=INK, width=int(7 * s))
        else:
            d.line((cx - 20 * s, head_cy + 46 * s, cx + 20 * s, head_cy + 46 * s), fill=INK, width=int(6 * s))

    # glasses for kellner / sasson
    if who in ("kellner", "sasson"):
        gl = (30, 34, 44)
        for sgn in (-1, 1):
            ex = cx + sgn * 34 * s
            d.rounded_rectangle((ex - 30 * s, ey - 24 * s, ex + 30 * s, ey + 24 * s), 8, outline=gl, width=int(6 * s))
        d.line((cx - 4 * s, ey, cx + 4 * s, ey), fill=gl, width=int(5 * s))

    if flip:
        sp = sp.transpose(Image.FLIP_LEFT_RIGHT)
        ww = sp.size[0] - ww
    box = sp.getbbox()
    if box is None:
        return sp, (0, 0)
    return sp.crop(box), (ww - box[0], base - box[1])


def place_char(img, sprite, anchor, x, y, s=1.0, alpha=255):
    """x,y is where the puppet's base sits on the canvas."""
    ax, ay = anchor
    sw, sh = sprite.size
    if s != 1.0:
        sprite = sprite.resize((max(1, int(sw * s)), max(1, int(sh * s))), Image.LANCZOS)
        ax, ay = ax * s, ay * s
        sw, sh = sprite.size
    if alpha < 255:
        a = sprite.getchannel("A").point(lambda v: int(v * alpha / 255))
        sprite = sprite.copy()
        sprite.putalpha(a)
    img.paste(sprite, (int(x - ax), int(y - ay)), sprite)


# ---------------------------------------------------------------- icons
def ic_camera(d, t=0, o=(0, 0), s=1.0):
    """The toaster-camera: boxy body, lens, cassette deck."""
    x, y = o
    w, h = 300 * s, 200 * s
    shadow_box(d, (x - w / 2, y - h / 2, x + w / 2, y + h / 2), (128, 132, 142), 18, (10, 10), INK, 7)
    d.rounded_rectangle((x - w / 2 + 26 * s, y - h / 2 + 22 * s, x + w / 2 - 26 * s, y - h / 2 + 62 * s), 8, fill=(70, 74, 84), outline=INK, width=5)
    ink_circle(d, (x - 52 * s, y + 12 * s), 56 * s, (58, 64, 78), 7)
    ink_circle(d, (x - 52 * s, y + 12 * s), 30 * s, (150, 180, 196), 5)
    d.rounded_rectangle((x + 24 * s, y - 22 * s, x + w / 2 - 30 * s, y + 62 * s), 8, fill=(86, 90, 100), outline=INK, width=6)
    for i in range(3):
        d.line((x + 34 * s, y - 4 * s + i * 20 * s, x + w / 2 - 40 * s, y - 4 * s + i * 20 * s), fill=(40, 42, 50), width=5)
    d.rounded_rectangle((x - 20 * s, y - h / 2 - 18 * s, x + 52 * s, y - h / 2 + 8 * s), 6, fill=(206, 96, 82), outline=INK, width=5)


def ic_sensor(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 110 * s, y - 90 * s, x + 110 * s, y + 90 * s), (74, 96, 84), 8, (9, 9), INK, 6)
    for i in range(4):
        for j in range(3):
            d.rectangle((x - 78 * s + i * 42 * s, y - 60 * s + j * 42 * s, x - 44 * s + i * 42 * s, y - 26 * s + j * 42 * s), fill=(126, 168, 140), outline=INK, width=3)
    for i in range(6):
        d.line((x - 110 * s + i * 44 * s, y - 90 * s, x - 110 * s + i * 44 * s, y - 110 * s), fill=INK, width=5)
        d.line((x - 110 * s + i * 44 * s, y + 90 * s, x - 110 * s + i * 44 * s, y + 110 * s), fill=INK, width=5)


def ic_cassette(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 130 * s, y - 88 * s, x + 130 * s, y + 88 * s), (72, 76, 90), 10, (9, 9), INK, 6)
    d.rounded_rectangle((x - 96 * s, y - 50 * s, x + 96 * s, y + 50 * s), 8, fill=(232, 226, 210), outline=INK, width=5)
    for sgn in (-1, 1):
        ink_circle(d, (x + sgn * 46 * s, y), 26 * s, (60, 64, 76), 5, (0, 0))
        d.ellipse((x + sgn * 46 * s - 9 * s, y - 9 * s, x + sgn * 46 * s + 9 * s, y + 9 * s), fill=(232, 226, 210))


def ic_film(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    ink_circle(d, (x, y), 96 * s, (46, 48, 60), 7)
    ink_circle(d, (x, y), 42 * s, CREAM, 5, (0, 0))
    d.ellipse((x - 14 * s, y - 14 * s, x + 14 * s, y + 14 * s), fill=(46, 48, 60))
    for i in range(8):
        a = i * math.pi / 4
        d.ellipse((x + math.cos(a) * 70 * s - 8 * s, y + math.sin(a) * 70 * s - 8 * s,
                   x + math.cos(a) * 70 * s + 8 * s, y + math.sin(a) * 70 * s + 8 * s), fill=(232, 224, 200), outline=INK, width=3)


def ic_canister(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 78 * s, y - 96 * s, x + 78 * s, y + 96 * s), (58, 62, 74), 12, (9, 9), INK, 6)
    d.rectangle((x - 78 * s, y - 96 * s, x + 78 * s, y - 34 * s), fill=(198, 72, 58))
    d.rectangle((x - 78 * s, y - 34 * s, x + 78 * s, y - 26 * s), fill=CREAM)
    text(d, (x, y + 40 * s), "FILM", size=int(44 * s), f="marker", fill=CREAM, ow=5, anchor="mm")


def ic_print(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 118 * s, y - 92 * s, x + 118 * s, y + 92 * s), WHITE, 4, (10, 10), INK, 6)
    d.rectangle((x - 100 * s, y - 74 * s, x + 100 * s, y + 40 * s), fill=(120, 140, 160), outline=INK, width=4)
    d.ellipse((x + 40 * s, y - 58 * s, x + 74 * s, y - 24 * s), fill=CREAM)
    d.polygon([(x - 100 * s, y + 40 * s), (x - 10 * s, y - 26 * s), (x + 100 * s, y + 40 * s)], fill=(84, 104, 124), outline=INK, width=4)


def ic_chemical(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 66 * s, y - 20 * s, x + 66 * s, y + 120 * s), (86, 118, 96), 16, (9, 9), INK, 6)
    d.rectangle((x - 26 * s, y - 96 * s, x + 26 * s, y - 20 * s), fill=(206, 216, 206), outline=INK, width=5)
    d.rectangle((x - 66 * s, y + 10 * s, x + 66 * s, y + 110 * s), fill=(126, 158, 126))
    d.line((x - 66 * s, y + 10 * s, x + 66 * s, y + 10 * s), fill=INK, width=5)
    d.rounded_rectangle((x - 30 * s, y - 112 * s, x + 30 * s, y - 92 * s), 6, fill=(198, 72, 58), outline=INK, width=5)


def ic_newspaper(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 220 * s, y - 250 * s, x + 220 * s, y + 250 * s), PAPER, 4, (12, 12), INK, 6)
    text(d, (x - 196 * s, y - 214 * s), "THE DAILY", size=int(52 * s), f="marker", fill=INK, ow=3, anchor="la")
    d.line((x - 196 * s, y - 150 * s, x + 196 * s, y - 150 * s), fill=INK, width=8)
    for i in range(15):
        d.line((x - 196 * s, y - 120 * s + i * 30 * s, x + 196 * s - (i % 4) * 46 * s, y - 120 * s + i * 30 * s), fill=(168, 162, 150), width=5)


def ic_tv(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 200 * s, y - 160 * s, x + 200 * s, y + 150 * s), (72, 76, 88), 22, (10, 10), INK, 7)
    d.rounded_rectangle((x - 168 * s, y - 128 * s, x + 148 * s, y + 108 * s), 16, fill=(150, 176, 190), outline=INK, width=5)
    d.ellipse((x - 120 * s, y - 100 * s, x + 0 * s, y + 40 * s), fill=(206, 220, 220))


def ic_chart(d, t=0, o=(0, 0), s=1.0, vals=(0.35, 0.55, 0.75, 0.9)):
    x, y = o
    d.line((x - 300 * s, y + 180 * s, x + 300 * s, y + 180 * s), fill=INK, width=8)
    d.line((x - 300 * s, y + 180 * s, x - 300 * s, y - 220 * s), fill=INK, width=8)
    for i, v in enumerate(vals):
        bx = x - 260 * s + i * 150 * s
        bh = 380 * s * v
        shadow_box(d, (bx, y + 176 * s - bh, bx + 96 * s, y + 176 * s), LIME if i == len(vals) - 1 else CREAM, 4, (8, 8), INK, 6)


def ic_arrow(d, t=0, o=(0, 0), s=1.0, up=True):
    x, y = o
    if up:
        pts = [(x - 90 * s, y + 200 * s), (x + 90 * s, y + 200 * s), (x + 90 * s, y - 120 * s),
               (x + 210 * s, y - 120 * s), (x, y - 300 * s), (x - 210 * s, y - 120 * s), (x - 90 * s, y - 120 * s)]
    else:
        pts = [(x - 90 * s, y - 200 * s), (x + 90 * s, y - 200 * s), (x + 90 * s, y + 120 * s),
               (x + 210 * s, y + 120 * s), (x, y + 300 * s), (x - 210 * s, y + 120 * s), (x - 90 * s, y + 120 * s)]
    poly(d, pts, LIME if up else RED, 7)


def ic_pixels(d, t=0, o=(0, 0), s=1.0, filled=1.0, seed=3):
    x, y = o
    n = 10
    cell = 34 * s
    ox = x - n * cell / 2
    oy = y - n * cell / 2
    rng = np.random.default_rng(seed)
    mask = rng.random((n, n))
    for i in range(n):
        for j in range(n):
            v = ((i - 3.2) ** 2 + (j - 4) ** 2) < 10
            on = (j * n + i) / (n * n) < filled
            if not on:
                continue
            c = (232, 224, 206) if (v and mask[i, j] > 0.25) else (110, 112, 120)
            d.rectangle((ox + i * cell, oy + j * cell, ox + (i + 1) * cell, oy + (j + 1) * cell), fill=c, outline=INK, width=2)


def ic_medal(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    poly(d, [(x - 60 * s, y - 210 * s), (x + 60 * s, y - 210 * s), (x + 20 * s, y - 60 * s), (x - 20 * s, y - 60 * s)],
         (198, 72, 58), 6)
    ink_circle(d, (x, y + 30 * s), 96 * s, GOLD, 7)
    ink_circle(d, (x, y + 30 * s), 66 * s, (240, 210, 130), 4, (0, 0))
    text(d, (x, y + 30 * s), "★", size=int(72 * s), f="marker", fill=INK, ow=0, anchor="mm")


def ic_robot(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 90 * s, y - 60 * s, x + 90 * s, y + 130 * s), (196, 202, 210), 10, (9, 9), INK, 6)
    ink_circle(d, (x, y - 110 * s), 60 * s, (196, 202, 210), 6)
    for sgn in (-1, 1):
        d.ellipse((x + sgn * 24 * s - 10 * s, y - 122 * s, x + sgn * 24 * s + 10 * s, y - 102 * s), fill=INK)
    d.line((x, y - 170 * s, x, y - 150 * s), fill=INK, width=6)
    d.ellipse((x - 10 * s, y - 186 * s, x + 10 * s, y - 166 * s), fill=RED, outline=INK, width=4)


def ic_brick(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 70 * s, y - 150 * s, x + 70 * s, y + 150 * s), (72, 74, 84), 16, (10, 10), INK, 6)
    d.rounded_rectangle((x - 40 * s, y - 110 * s, x + 40 * s, y - 10 * s), 6, fill=(126, 160, 140), outline=INK, width=4)
    for i in range(3):
        for j in range(3):
            ink_circle(d, (x - 30 * s + j * 30 * s, y + 40 * s + i * 30 * s), 9 * s, (198, 200, 206), 3, (0, 0))
    d.line((x, y - 186 * s, x + 24 * s, y - 220 * s), fill=INK, width=7)


def ic_pc(d, t=0, o=(0, 0), s=1.0):
    x, y = o
    shadow_box(d, (x - 160 * s, y - 120 * s, x + 160 * s, y + 110 * s), (206, 200, 186), 14, (10, 10), INK, 6)
    d.rectangle((x - 120 * s, y - 84 * s, x + 120 * s, y + 60 * s), fill=(64, 92, 96), outline=INK, width=5)
    shadow_box(d, (x - 220 * s, y + 120 * s, x + 220 * s, y + 170 * s), (206, 200, 186), 8, (9, 9), INK, 6)


def ic_question(d, t=0, o=(0, 0), s=1.0):
    text(d, o, "?", size=int(420 * s), f="marker", fill=LIME, ow=12, anchor="mm")


def ic_filmcan_lid(d, t=0, o=(0, 0), s=1.0):
    ic_canister(d, t, o, s)


ICONS = {
    "camera": ic_camera, "sensor": ic_sensor, "cassette": ic_cassette, "film": ic_film,
    "canister": ic_canister, "print": ic_print, "chemical": ic_chemical, "newspaper": ic_newspaper,
    "tv": ic_tv, "chart": ic_chart, "arrow": ic_arrow, "pixels": ic_pixels, "medal": ic_medal,
    "robot": ic_robot, "brick": ic_brick, "pc": ic_pc, "question": ic_question,
}


def icon(img, name, o, s=1.0, **kw):
    d = ImageDraw.Draw(img)
    ICONS[name](d, 0, o, s, **kw)
