#!/usr/bin/env python3
"""
Bash Baqi Racing — trailer / intro generator.

Renders every frame with Pillow and pipes raw RGB straight into ffmpeg
(bundled through imageio-ffmpeg), which encodes H.264 + a synthesized
engine-and-impact soundtrack. No browser, no GPU, no external assets.

  python3 make_trailer.py bash-baqi-intro.mp4 [--w 1280 --h 720 --fps 30 --dur 10]
"""
import argparse, math, os, random, subprocess

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import imageio_ffmpeg
import arabic_reshaper
from bidi.algorithm import get_display

FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--w", type=int, default=1280)
ap.add_argument("--h", type=int, default=720)
ap.add_argument("--fps", type=int, default=30)
ap.add_argument("--dur", type=float, default=10.0)
ap.add_argument("--seed", type=int, default=7)
a = ap.parse_args()

W, H, FPS, DUR = a.w, a.h, a.fps, a.dur
N = int(FPS * DUR)
HORIZON = int(H * (0.355 if H > W else 0.42))
FOCAL = W * (0.74 if H > W else 0.52)   # tighter lens for vertical, wider for 16:9
CAM_H = 2.1
ROAD_W = 1.75          # half width of the asphalt, world units
random.seed(a.seed)

SKY_H = (188, 150, 104)  # sky colour at the horizon, used as haze


def fit(txt, px, maxw, bold=True):
    """Largest font <= px whose rendered width fits maxw (works for any aspect)."""
    f = ImageFont.truetype(FONT_B if bold else FONT_R, max(8, int(px)))
    while f.getlength(txt) > maxw and f.size > 9:
        f = ImageFont.truetype(FONT_B if bold else FONT_R, f.size - 2)
    return f


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def ease_out(t, p=3):
    return 1 - (1 - clamp(t)) ** p


def lerp_c(c1, c2, k):
    k = clamp(k)
    return tuple(int(c1[i] + (c2[i] - c1[i]) * k) for i in range(3))


def project(x, y, z):
    z = max(z, 0.5)
    s = FOCAL / z
    return W / 2 + x * s, HORIZON + (CAM_H - y) * s


# ------------------------------------------------------------------ scene plate
def build_bg():
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(HORIZON):
        t = y / max(1, HORIZON - 1)
        if t < 0.6:
            k = t / 0.6
            c = lerp_c((44, 74, 140), (198, 134, 98), k)          # night blue -> warm
        else:
            k = (t - 0.6) / 0.4
            c = lerp_c((196, 132, 96), (245, 196, 130), k)        # warm -> gold
        d.line([(0, y), (W, y)], fill=c)
    sun_y = HORIZON - int(H * 0.03)
    for r in range(int(H * 0.40), 0, -2):                          # soft sun bloom
        k = 1 - r / (H * 0.40)
        g = Image.new("RGB", (W, H))
        ImageDraw.Draw(g).ellipse([W * .5 - r * 2.0, sun_y - r * 2.0,
                                   W * .5 + r * 2.0, sun_y + r * 2.0],
                                  fill=(255, 176, 96))
        img = Image.blend(img, g, alpha=0.012 * k)
    d = ImageDraw.Draw(img)
    d.ellipse([W * .5 - H * .075, sun_y - H * .075, W * .5 + H * .075, sun_y + H * .075],
              fill=(255, 244, 206))
    sea_h = int(H * 0.065)
    for y in range(HORIZON, HORIZON + sea_h):                      # sea
        k = (y - HORIZON) / sea_h
        d.line([(0, y), (W, y)], fill=lerp_c((92, 130, 168), (34, 74, 122), k))
    for i in range(70):                                            # glints
        yy = HORIZON + random.randint(2, sea_h - 2)
        xx = random.randint(-100, W)
        ln = random.randint(10, 90)
        k = 1 - (yy - HORIZON) / sea_h
        d.line([(xx, yy), (xx + ln, yy)], fill=lerp_c((92, 130, 168), (255, 214, 150), k * 0.7))
    for y in range(HORIZON + sea_h, H):                            # sand
        k = (y - HORIZON) / (H - HORIZON)
        d.line([(0, y), (W, y)], fill=lerp_c((214, 178, 118), (150, 116, 76), k))
    for i in range(30):                                            # dune ripples
        yy = int(HORIZON + sea_h + (H * 0.55) * (i / 30) ** 1.8)
        xx = random.randint(-W // 3, W)
        ln = random.randint(W // 8, W // 3)
        d.line([(xx, yy), (xx + ln, yy)], fill=(196, 162, 106), width=1)
    # asphalt
    hw_far = FOCAL * ROAD_W / 120
    d.polygon([(W / 2 - hw_far, HORIZON), (W / 2 + hw_far, HORIZON),
               (W / 2 + FOCAL * ROAD_W / CAM_H, H), (W / 2 - FOCAL * ROAD_W / CAM_H, H)],
              fill=(62, 61, 68))
    return img


BG = build_bg()
VIGNETTE = Image.new("L", (W, H), 0)
ImageDraw.Draw(VIGNETTE).ellipse([-W * .28, -H * .42, W * 1.28, H * 1.38], fill=255)
VIGNETTE = VIGNETTE.filter(ImageFilter.GaussianBlur(W * 0.055))
DARK = Image.new("RGB", (W, H), (0, 0, 0))


# ------------------------------------------------------------------ elements
def draw_dashes(d, scroll):
    for i in range(34):
        z = ((i * 8.5 - scroll) % 136) + 2.0
        if z < 5.4 or 5.4 < z < 11.8:
            continue
        hw = FOCAL * 0.115 / z
        y1 = HORIZON + CAM_H * FOCAL / z
        y2 = HORIZON + CAM_H * FOCAL / (z + 3.6)
        if y1 < H + 40 and y2 > HORIZON:
            d.polygon([(W / 2 - hw, y1), (W / 2 + hw, y1),
                       (W / 2 + hw * 0.8, y2), (W / 2 - hw * 0.8, y2)], fill=(240, 238, 228))


def draw_edges(d):
    for sgn in (-1, 1):
        pts = [project(sgn * (ROAD_W - 0.13), 0.01, 2.0 + i * 1.6) for i in range(110)]
        d.line(pts, fill=(226, 198, 118), width=2)


def draw_palm(d, x, z, size, sway, t):
    """Silhouette palm, hazed by distance so the horizon stays readable."""
    if z < 11.0:
        return
    x *= 1 + max(0.0, 20.0 - z) / 6.5          # keep near palms off the tarmac
    bs = FOCAL / z * size
    haze = clamp((z - 12.0) / 62)
    col = lerp_c((44, 32, 30), SKY_H, haze)
    bx, by = project(x, 0, z)
    tx, ty = project(x, 2.5 * size, z)
    d.line([(bx, by), (tx, ty)], fill=col, width=max(2, int(bs * 0.18)))
    n = 7
    for i in range(n):
        side = -1 if i < n / 2 else 1
        k = (i % (n / 2)) / max(1, n / 2 - 1)          # 0 = horizontal, 1 = upright
        ang = (0.06 + 0.55 * (1 - k)) * math.pi * 0.5
        ln = bs * (1.0 + 0.22 * math.sin(i * 2.1)) * (0.75 + 0.35 * k)
        ex = tx + side * math.cos(ang) * ln
        ey = ty + math.sin(ang) * ln * 0.30 + ln * 0.42      # fronds droop
        cx = tx + (ex - tx) * 0.55
        cy = ty + (ey - ty) * 0.20 - ln * 0.18
        d.line([(tx, ty), (cx, cy), (ex, ey)], fill=col, width=max(2, int(bs * 0.15)))
    d.ellipse([tx - bs * .16, ty - bs * .10, tx + bs * .16, ty + bs * .12], fill=col)


def draw_kart(d, t, scroll, lane, z, colour, dark):
    """Simple rear-view rival kart at a given z, with bob + sway."""
    zz = z
    sc = FOCAL / zz
    bob = 1.6 * math.sin(t * 7.0 + lane)
    gx = W / 2 + (lane + 0.10 * math.sin(t * 1.3 + lane)) * sc
    gy = HORIZON + CAM_H * sc + bob
    def P(wx, wy):
        return (gx + wx * sc, gy - wy * sc)
    haze = clamp((zz - 8) / 60)
    body = lerp_c(colour, SKY_H, haze * 0.5)
    darkc = lerp_c(dark, SKY_H, haze * 0.5)
    wr = 0.34 * sc
    for sgn in (-1, 1):
        cx, cy = P(sgn * 0.72, 0.34)
        d.ellipse([cx - wr * .55, cy - wr * 1.55, cx + wr * .55, cy + wr * .55], fill=lerp_c((26, 24, 26), SKY_H, haze * 0.4))
    d.polygon([P(-0.62, 0.30), P(0.62, 0.30), P(0.50, 0.80), P(-0.50, 0.80)], fill=body)
    d.polygon([P(-0.50, 0.80), P(0.50, 0.80), P(0.42, 0.95), P(-0.42, 0.95)], fill=darkc)
    d.line([P(-0.44, 0.95), P(-0.34, 1.5), P(0.34, 1.5), P(0.44, 0.95)],
           fill=lerp_c((40, 38, 42), SKY_H, haze), width=max(2, int(sc * 0.03)))
    d.line([P(-0.38, 0.66), P(0.38, 0.66)], fill=lerp_c((255, 90, 50), SKY_H, haze), width=max(2, int(sc * 0.035)))


def draw_coins(d, t, scroll):
    for i in range(9):
        z = ((i * 14.0 - scroll * 1.0) % 74) + 11.0
        x = ((i * 5) % 3 - 1) * 1.05
        y = 0.60 + 0.16 * math.sin(t * 2.0 + i * 0.7)
        cx, cy = project(x, y, z)
        r = FOCAL * 0.30 / z
        if r < 1.5:
            continue
        wob = abs(math.cos(t * 2.2 + i))            # spinning coin
        d.ellipse([cx - r * wob, cy - r, cx + r * wob, cy + r], fill=(255, 206, 60))
        if r > 4:
            d.ellipse([cx - r * wob, cy - r, cx + r * wob, cy + r], outline=(190, 130, 20),
                      width=max(1, int(r * 0.18)))


def draw_buggy(d, t, dust_layer=None):
    """Rear view of a beach buggy — the thing the camera is chasing."""
    sway = 0.16 * math.sin(t * 1.9) + 0.05 * math.sin(t * 7.3)
    bob = 2.0 * math.sin(t * 6.1) + 3.0 * math.sin(t * 13.7)
    z = 7.4
    s = FOCAL / z
    gx, gy = W / 2 + (-0.30 + sway) * s, HORIZON + CAM_H * s + bob
    ww = 0.62 * s                                   # wheel radius-ish
    def P(wx, wy):
        return (gx + wx * s, gy - wy * s)
    # dust
    for i in range(34):
        ph = (t * 1.5 + i * 0.147) % 1.0
        side = -1 if i % 2 else 1
        px, py = P(side * (0.45 + ph * 1.05), 0.10 + ph * 0.30)
        r = int((0.06 + ph * 0.30) * s)
        al = int(105 * (1 - ph) ** 1.7)
        if al <= 2:
            continue
        dd = ImageDraw.Draw(dust_layer)
        dd.ellipse([px - r, py - r * 0.72, px + r, py + r * 0.72],
                   fill=(238, 216, 178, al))
    # wheels
    for sgn in (-1, 1):
        cx, cy = P(sgn * 0.72, 0.34)
        d.ellipse([cx - ww * .58, cy - ww, cx + ww * .58, cy + ww], fill=(26, 24, 26))
        d.ellipse([cx - ww * .26, cy - ww * .46, cx + ww * .26, cy + ww * .46], fill=(120, 118, 122))
    # chassis / body
    body = [P(-0.62, 0.30), P(0.62, 0.30), P(0.50, 0.78), P(-0.50, 0.78)]
    d.polygon(body, fill=(212, 62, 48))
    d.polygon([P(-0.52, 0.78), P(0.52, 0.78), P(0.44, 0.92), P(-0.44, 0.92)], fill=(168, 38, 30))
    # roll cage
    cw = max(3, int(s * 0.035))
    d.line([P(-0.44, 0.92), P(-0.36, 1.5), P(0.36, 1.5), P(0.44, 0.92)], fill=(38, 36, 40), width=cw)
    d.line([P(-0.36, 1.5), P(0.0, 1.62)], fill=(38, 36, 40), width=cw)
    d.line([P(0.36, 1.5), P(0.0, 1.62)], fill=(38, 36, 40), width=cw)
    # rear light bar + exhausts
    lw = max(2, int(s * 0.02))
    d.line([P(-0.40, 0.66), P(0.40, 0.66)], fill=(255, 72, 40), width=lw * 2)
    for sgn in (-1, 1):
        d.line([P(sgn * 0.30, 0.30), P(sgn * 0.30, 0.08)], fill=(150, 148, 152), width=max(2, int(s * 0.03)))
    # plate
    tl, br = P(-0.20, 0.58), P(0.20, 0.42)
    d.rectangle([tl[0], tl[1], br[0], br[1]], fill=(238, 236, 224))


def draw_streaks(d, scroll):
    for i in range(70):
        z = ((i * 7.3 + scroll * 1.4) % 140) + 6.0
        x = ((i * 37) % 300 - 150) / 150 * 16
        if abs(x) < 2.6:
            continue
        y = 0.5 + (i % 4) * 0.22
        x1, y1 = project(x, y, z)
        x2, y2 = project(x, y, z + 4.0)
        if HORIZON < y2 < H:
            k = clamp(1 - z / 110)
            c = int(90 * k)
            d.line([(x1, y1), (x2, y2)], fill=(c, c, c), width=1)


def draw_hud(d, t):
    """Fake gameplay HUD so the clip reads as real footage."""
    app = ease_out((t - 1.0) / 1.2)
    if app <= 0.01:
        return
    al = int(235 * app)
    spd = int(118 + 46 * (0.5 + 0.5 * math.sin(t * 2.3)) + 8 * math.sin(t * 11))
    card = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    fb = ImageFont.truetype(FONT_B, int(H * 0.062))
    fs = ImageFont.truetype(FONT_B, int(H * 0.024))
    cd.text((int(W * 0.045), int(H * 0.835)), f"{spd}", font=fb,
            fill=(255, 255, 255, al), stroke_width=2, stroke_fill=(0, 0, 0, al))
    cd.text((int(W * 0.045) + fb.getlength(f"{spd}") + 10, int(H * 0.878)), "KM/H", font=fs,
            fill=(255, 226, 140, al))
    cd.text((int(W * 0.95), int(H * 0.855)), "1st", font=fb, anchor="ra",
            fill=(255, 220, 90, al), stroke_width=2, stroke_fill=(0, 0, 0, al))
    cd.text((int(W * 0.95), int(H * 0.908)), "of 6", font=fs, anchor="ra",
            fill=(255, 255, 255, al))
    cd.text((int(W * 0.30), int(H * 0.855)), f"COINS {1240 + int(t * 24)}", font=fs,
            fill=(255, 214, 110, al), stroke_width=2, stroke_fill=(0, 0, 0, al))
    cd.text((int(W * 0.70), int(H * 0.855)), f"LAP {1 + int(t / 4)}/3", font=fs,
            fill=(255, 255, 255, al), stroke_width=2, stroke_fill=(0, 0, 0, al))
    card.alpha_composite(card) if False else None
    return card


# ------------------------------------------------------------------ encoding
ff = imageio_ffmpeg.get_ffmpeg_exe()
audio = (
    "aevalsrc='"
    "0.30*sin(2*PI*(58+15*sin(2*PI*3.1*t))*t)"
    "+0.20*sin(2*PI*(92+26*sin(2*PI*2.3*t))*t)"
    "+0.09*sin(2*PI*(186+40*sin(2*PI*4.7*t))*t)"
    "+0.06*sin(2*PI*(2400+600*sin(2*PI*0.7*t))*t)*sin(2*PI*3.5*t)"
    "+0.38*sin(2*PI*48*t)*exp(-7*max(t-3.0\\,0))*lt(t\\,4.4)"
    "+0.34*sin(2*PI*62*t)*exp(-6*max(t-6.3\\,0))*lt(t\\,7.4)"
    f"':s=44100:d={DUR}"
)
proc = subprocess.Popen([
    ff, "-y", "-loglevel", "error",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
    "-f", "lavfi", "-i", audio,
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-shortest", a.out,
], stdin=subprocess.PIPE)

def plate(base, xy, txt, font, fill, stroke=None, sw=0, plate_rgba=(0, 0, 0, 130), pad=None):
    """Draw text on a soft dark pill so it stays readable over the scene."""
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lay)
    x, y = xy
    if pad is None:
        pad = int(font.size * 0.36)
    bb = ld.textbbox(xy, txt, font=font, anchor="mm", stroke_width=sw)
    ld.rounded_rectangle([bb[0] - pad, bb[1] - pad * 0.55, bb[2] + pad, bb[3] + pad * 0.55],
                         radius=int(font.size * 0.42), fill=plate_rgba)
    lay = lay.filter(ImageFilter.GaussianBlur(2))
    if stroke:
        ld = ImageDraw.Draw(lay)
        ld.text(xy, txt, font=font, anchor="mm", fill=fill, stroke_width=sw, stroke_fill=stroke)
    else:
        ld = ImageDraw.Draw(lay)
        ld.text(xy, txt, font=font, anchor="mm", fill=fill)
    base.alpha_composite(lay)


TITLE = "BASH BAQI RACING"
AR = get_display(arabic_reshaper.reshape("سباق باغي على الشاطئ"))
SUB = "50 CARS  •  50 TRACKS  •  PLAYS IN YOUR BROWSER"
T0 = 2.7                       # title slam
IMPACTS = (T0, 6.3)

EC_START = DUR - 2.9
for f in range(N):
    t = f / FPS
    scroll = t * 24.0
    ec = ease_out((t - EC_START) / 1.0)      # end-card progress
    dis = 1.0 - ec                           # title stack dissolves into the end card
    img = BG.copy()
    d = ImageDraw.Draw(img)
    draw_edges(d)
    draw_dashes(d, scroll)
    draw_streaks(d, scroll)
    for k in range(18):                                   # palms, far to near
        z = 88 - k * 9.0 - (scroll * 0.85) % 9.0
        if z < 7:
            continue
        draw_palm(d, (-1 if k % 2 else 1) * (4.6 + (k % 5) * 1.15), z, 1.0 + (k % 3) * 0.3,
                  math.sin(t * 1.1 + k), t)
    for lane, zz, col, dk in ((-1.05, 16.5, (58, 118, 214), (30, 70, 150)),
                              (1.10, 27.0, (214, 196, 60), (150, 126, 30)),
                              (-0.95, 44.0, (96, 190, 120), (40, 120, 70))):
        draw_kart(d, t, scroll, lane, zz, col, dk)
    draw_coins(d, t, scroll)
    dust = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw_buggy(d, t, dust)
    img = Image.alpha_composite(img.convert("RGBA"), dust).convert("RGB")

    hud = draw_hud(d, t)
    if hud:
        img = Image.alpha_composite(img.convert("RGBA"), hud).convert("RGB")

    img = Image.composite(img, DARK, Image.blend(Image.new("L", (W, H), 255), VIGNETTE, 0.50))

    # ---------------------------------------------------------- title sequence
    base = img.convert("RGBA")
    if t >= T0 - 0.35:
        p = ease_out((t - (T0 - 0.35)) / 1.0, 4)
        fnt = fit(TITLE, H * (0.05 + 0.085 * p), W * 0.88)
        y = int(H * 0.235)
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(glow).text((W // 2, y), TITLE, font=fnt, anchor="mm",
                                  fill=(255, 150, 50, int(120 * dis)), stroke_width=3)
        base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(20)))
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(lay)
        ld.text((W // 2 + 3, y + 4), TITLE, font=fnt, anchor="mm", fill=(0, 0, 0, int(150 * dis)))
        ld.text((W // 2, y), TITLE, font=fnt, anchor="mm",
                fill=(255, 255, 255, int(255 * clamp(p * 1.5) * dis)),
                stroke_width=2, stroke_fill=(255, 170, 60, int(255 * dis)))
        base.alpha_composite(lay)
    if t >= T0 + 0.30:
        pa = ease_out((t - (T0 + 0.30)) / 0.9)
        plate(base, (W // 2, int(H * 0.395)), AR,
              fit(AR, H * 0.056, W * 0.78),
              (255, 240, 170, int(255 * pa)), (70, 32, 8, int(210 * pa)), 2,
              (18, 10, 4, int(150 * pa)))
    if t >= T0 + 1.0:
        pa = ease_out((t - (T0 + 1.0)) / 0.9)
        plate(base, (W // 2, int(H * 0.500)), SUB,
              fit(SUB, H * 0.026, W * 0.70),
              (255, 255, 255, int(245 * pa * dis)), None, 0, (10, 10, 14, int(140 * pa * dis)))
    if ec > 0.01:
        base.alpha_composite(Image.new("RGBA", (W, H), (6, 8, 20, int(165 * ec))))
        al = int(255 * ec)
        plate(base, (W // 2, int(H * 0.50)), "PLAY FREE  >",
              fit("PLAY FREE  >", H * 0.062, W * 0.62),
              (255, 255, 255, al), (30, 70, 170, al), 3, (18, 30, 70, int(200 * ec)))
        plate(base, (W // 2, int(H * 0.60)), "50 CARS  50 TRACKS  FREE OFFLINE",
              fit("50 CARS  50 TRACKS  FREE OFFLINE", H * 0.024, W * 0.62, bold=False),
              (232, 234, 248, int(225 * ec)), None, 0, (0, 0, 0, 0))
    img = base.convert("RGB")

    # ---------------------------------------------------------- impact + fades
    shake = 0.0
    for imp in IMPACTS:
        if imp <= t < imp + 0.45:
            shake = max(shake, (1 - (t - imp) / 0.45) * 10)
    if t < 0.7:
        img = Image.blend(img, DARK, 1 - t / 0.7)
    if t > DUR - 0.8:
        img = Image.blend(img, DARK, (t - (DUR - 0.8)) / 0.8)
    if shake > 0.3:
        img = img.transform((W, H), Image.AFFINE,
                            (1, 0, -int(math.sin(t * 95) * shake), 0, 1, -int(math.cos(t * 81) * shake * 0.6)))

    proc.stdin.write(img.tobytes())
    if f % 60 == 0:
        print(f"  frame {f}/{N}", flush=True)

proc.stdin.close()
proc.wait()
print("done ->", a.out, os.path.getsize(a.out) // 1024, "KB")
