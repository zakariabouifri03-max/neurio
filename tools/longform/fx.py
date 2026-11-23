"""Effects: hand-lettered pop labels, rubber stamps, marker rings, tags,
lower thirds, typed chapter cards, polaroid frames."""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from kit import (CREAM, H, INK, LIME, RED, RED_DEEP, W, clamp, ease_out, font, ink_circle,
                 ink_rect, overshoot, seg, text, text_plain)


def _sprite(size, draw_fn):
    sp = Image.new("RGBA", size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(sp))
    return sp


def label_sprite(s, size=76, fill=LIME, f="brush", ow=11, pad=40):
    ft = font(f, size)
    tw = int(ft.getlength(s)) + pad * 2
    hh = int(size * 1.9)
    sp = Image.new("RGBA", (tw, hh), (0, 0, 0, 0))
    d = ImageDraw.Draw(sp)
    d.text((pad, hh * 0.72), s, font=ft, fill=fill, stroke_width=ow, stroke_fill=INK, anchor="ls")
    return sp


def paste_pop(img, sp, c, age, life=0.34, anchor="mm", alpha=255):
    """Pop a sprite in with an overshoot, centred on c (or anchored)."""
    if age < 0:
        return
    k = overshoot(seg(age, 0, life))
    if k <= 0.01:
        return
    w0, h0 = sp.size
    w, h = max(2, int(w0 * k)), max(2, int(h0 * k))
    s2 = sp.resize((w, h), Image.BILINEAR) if (w, h) != (w0, h0) else sp
    if alpha < 255:
        a = s2.getchannel("A").point(lambda v: int(v * alpha / 255))
        s2 = s2.copy()
        s2.putalpha(a)
    ax = {"mm": 0.5, "lm": 0.0, "rm": 1.0}[anchor]
    x = int(c[0] - w * ax)
    y = int(c[1] - h * 0.52)
    img.paste(s2, (x, y), s2)


def stamp_sprite(s, size=92, color=RED, f="marker", angle=-7, ow=0):
    ft = font(f, size)
    tw = int(ft.getlength(s))
    pad = 34
    w0, h0 = tw + pad * 2, int(size * 1.75)
    sp = Image.new("RGBA", (w0, h0), (0, 0, 0, 0))
    d = ImageDraw.Draw(sp)
    d.rounded_rectangle((6, 6, w0 - 6, h0 - 6), 10, outline=color, width=9)
    d.text((w0 / 2, h0 * 0.72), s, font=ft, fill=color, anchor="ms")
    return sp.rotate(angle, expand=True, resample=Image.BICUBIC)


def paste_stamp(img, sp, c, age, life=0.13, settle=0.85, alpha=255):
    """A stamp lands hard: fast scale down to 1.0 with a tiny bounce."""
    if age < 0:
        return
    c = (max(sp.size[0] / 2 + 50, min(img.width - sp.size[0] / 2 - 50, c[0])),
         max(sp.size[1] / 2 + 40, min(img.height - sp.size[1] / 2 - 40, c[1])))
    t = seg(age, 0, life)
    k = 1.0 + (1.0 - t) * 0.9
    if age > life:
        k = 1.0
    w0, h0 = sp.size
    w, h = max(2, int(w0 * k)), max(2, int(h0 * k))
    s2 = sp.resize((w, h), Image.BILINEAR)
    a = int(alpha * min(1.0, 0.45 + 0.55 * t))
    if a < 255:
        ch = s2.getchannel("A").point(lambda v: int(v * a / 255))
        s2 = s2.copy()
        s2.putalpha(ch)
    img.paste(s2, (int(c[0] - w / 2), int(c[1] - h / 2)), s2)


def marker_ring(img, c, r, age, color=RED, width=11, life=0.5):
    """A hand-drawn red ring that draws itself on."""
    if age < 0:
        return
    t = ease_out(seg(age, 0, life))
    if t <= 0:
        return
    over = 1.06 + 0.02 * math.sin(age * 30)
    pad = int(r * 0.4) + 24
    sp = Image.new("RGBA", (int((r + pad) * 2 * over), int((r + pad) * 2 * over)), (0, 0, 0, 0))
    d = ImageDraw.Draw(sp)
    cx, cy = sp.size[0] / 2, sp.size[1] / 2
    n = 90
    pts = []
    for i in range(int(n * t) + 2):
        a = -0.5 + (i / n) * (2 * math.pi * 1.12)
        rr = r * (1 + 0.035 * math.sin(a * 3 + 1.2))
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.92))
    if len(pts) > 2:
        d.line(pts, fill=color, width=width, joint="curve")
    img.paste(sp, (int(c[0] - sp.size[0] / 2), int(c[1] - sp.size[1] / 2)), sp)
    return pts


def tag_sprite(s, size=38, fill=CREAM, bg=INK):
    ft = font("kalam_b", size)
    tw = int(ft.getlength(s))
    sp = Image.new("RGBA", (tw + 56, int(size * 2.1)), (0, 0, 0, 0))
    d = ImageDraw.Draw(sp)
    d.rectangle((0, 0, tw + 52, int(size * 2.05)), fill=bg)
    d.rectangle((8, 8, tw + 44, int(size * 2.05) - 8), outline=fill, width=3)
    d.text((28, size * 1.35), s, font=ft, fill=fill)
    return sp


def lower_third(img, s, sub, c, age, dur):
    """Slides in from the left, holds, slides out."""
    tin = ease_out(seg(age, 0, 0.35))
    tout = ease_out(seg(age, dur - 0.35, dur))
    if age < 0 or age > dur:
        return
    x = -700 * (1 - tin) + (-700 * tout)
    sp = _sprite((980, 150), lambda d: (
        d.rectangle((0, 0, 940, 128), fill=INK),
        d.rectangle((10, 10, 930, 118), outline=CREAM, width=4),
        d.text((38, 74), s, font=font("marker", 46), fill=CREAM),
        d.text((40, 118), sub, font=font("kalam", 30), fill=(190, 196, 210)),
    ))
    img.paste(sp, (int(c[0] + x), int(c[1])), sp)


def chapter(img, title, k, sub=""):
    """Black chapter card typed in white hand-lettering."""
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, H), fill=(14, 18, 32))
    a = clamp(k * 2.4)
    col = tuple(int(v * (0.35 + 0.65 * a)) for v in CREAM)
    text(d, (W / 2, H / 2 - 30), title, size=132, f="brush", fill=col, ow=10, anchor="mm")
    d.line((W / 2 - 210, H / 2 + 62, W / 2 + 210, H / 2 + 62), fill=(150, 150, 160), width=5)
    if sub:
        d.text((W / 2, H / 2 + 128), sub, font=font("kalam", 42), fill=(176, 182, 196), anchor="mm")
    return img


def polaroid(img, sp_inner, c, age, angle=3.2, scale=1.0):
    """A polaroid frame dropping in and settling."""
    t = ease_out(seg(age, 0, 0.55))
    drop = (1 - t) * -260
    pad = 26
    inner_w = int(760 * scale)
    inner_h = int(inner_w * sp_inner.size[1] / sp_inner.size[0])
    frame = Image.new("RGBA", (inner_w + pad * 2, inner_h + pad * 2 + int(90 * scale)), (250, 249, 244, 255))
    d = ImageDraw.Draw(frame)
    frame.paste(sp_inner.resize((inner_w, inner_h), Image.LANCZOS), (pad, pad))
    d.rectangle((pad, pad, pad + inner_w, pad + inner_h), outline=(210, 205, 195), width=3)
    fr = frame.rotate(angle, expand=True, resample=Image.BICUBIC)
    img.paste(fr, (int(c[0] - fr.size[0] / 2), int(c[1] - fr.size[1] / 2 + drop)), fr)
    return fr


def shutter_flash(img, k):
    if k <= 0:
        return img
    a = np.asarray(img).astype(np.float32)
    a = a + (255 - a) * (0.85 * k)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def wipe_in(img, k, color=(14, 18, 32)):
    """A quick vertical wipe, for whip cuts."""
    if k >= 1:
        return img
    a = np.asarray(img).copy()
    edge = int(W * ease_out(k))
    a[:, : max(0, W - edge)] = color
    return Image.fromarray(a, "RGB")
