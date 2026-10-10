#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
"Lock the Clock" — vertical 4K (2160x3840) editorial explainer, Pillow frames
encoded with the ffmpeg shipped by imageio-ffmpeg.

  preview: python3 tools/explainer/render.py --preview 0.8,2,5,8,12,16,21,26,31,36,41,46,51,56,59
  encode:  python3 tools/explainer/render.py --encode video/lock-the-clock-4k.mp4 \
             --audio tools/explainer/audio/master.wav
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time as _t

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import design as D
from design import (NAVY, NAVY_2, NAVY_3, LINE, LINE_SOFT, INK, INK_DIM, MUTE,
                    FAINT, RED, RED_D, RED_L, SUN, SUN_D, TEAL, font, text, tlen,
                    fit_size, wrap, rr, hairline, vgrad, radial_glow, grain,
                    clamp, lerp, mix, seq, ease_out, ease_in, ease_in_out,
                    ease_out_expo, ease_out_back, MapFit)

import imageio_ffmpeg as ffp
FF = ffp.get_ffmpeg_exe()

FPS = 30
W, H = 2160, 3840
ML = 150
CAP_Y = 3360
PROG = None

TEXTS = {
    1: "In 1974, America tried to lock the clock. Permanently.",
    2: "Gas lines ran for miles. So Congress made daylight saving time year-round — to save 150,000 barrels of oil a day.",
    3: "On January sixth, the clocks jumped ahead. But the sun didn't.",
    4: "Sunrise slid past eight in the morning. In Detroit, Minneapolis, and Seattle — nine o'clock, or later.",
    5: "Children walked to school in the dark. In Florida, eight schoolchildren died that January. The year before: two.",
    6: "Parents called it Daylight Disaster Time. Approval collapsed from 79 percent to 42 — in eight weeks.",
    7: "The promised oil savings? Around one percent. And even that number was disputed.",
    8: "Ten months later, Congress reversed course. October 27th, 1974 — the clocks rolled back.",
    9: "Fifty-two years later, the House has voted to lock the clock again.",
    10: "The sun hasn't changed. Only the argument has.",
}

SUNRISE = {"Seattle": (8, 56), "Fargo": (9, 11), "Minneapolis": (8, 50),
           "Detroit": (9, 0), "Chicago": (8, 17), "New York": (8, 19),
           "Denver": (8, 20), "Miami": (8, 8), "Los Angeles": (7, 58)}
CITY_LL = {"Seattle": (47.61, -122.33), "Detroit": (42.33, -83.05),
           "Minneapolis": (44.98, -93.27), "Chicago": (41.88, -87.63),
           "New York": (40.71, -74.01), "Miami": (25.76, -80.19),
           "Los Angeles": (34.05, -118.24), "Denver": (39.74, -104.99),
           "Fargo": (46.88, -96.79)}

_BG = None


def bg():
    global _BG
    if _BG is None:
        b = vgrad((W, H), (13, 26, 45), (6, 12, 24)).convert("RGBA")
        d = ImageDraw.Draw(b, "RGBA")
        for x in range(ML, W - ML + 1, 140):
            d.line([(x, 150), (x, H - 150)], fill=(255, 255, 255, 10), width=2)
        g = radial_glow((W, H), W * 0.5, H * 0.30, W * 0.95, (30, 62, 110), 1.6, 0.45)
        b.alpha_composite(g)
        yy, xx = np.mgrid[0:H, 0:W]
        dd = np.sqrt(((xx - W / 2) / (W * 0.60)) ** 2 + ((yy - H / 2) / (H * 0.60)) ** 2)
        aa = (np.clip(dd - 0.5, 0, 1) * 160).astype(np.uint8)
        sh = Image.new("RGBA", (W, H), (3, 6, 14, 255))
        b = Image.composite(sh, b, Image.fromarray(aa, "L"))
        _BG = b.convert("RGB")
    return _BG


def chrome(d, t):
    text(d, (ML, 120), "LOCK THE CLOCK", font(58, D.INTER, 800), fill=INK, spacing=7)
    d.rectangle([ML, 200, ML + 118, 218], fill=RED)
    text(d, (ML, 258), "A 60-SECOND EXPLAINER", font(44, D.INTER, 600), fill=MUTE, spacing=5)
    text(d, (W - ML, 128), "EP.01 · 1974", font(50, D.INTER, 700), fill=INK_DIM,
         anchor="ra", spacing=4)
    d.rectangle([0, H - 28, W, H], fill=(18, 30, 50))
    d.rectangle([0, H - 28, W * (t / 60.0), H], fill=RED)


# ---------------------------------------------------------------- captions
def _balance(words, f, maxw):
    n = len(words)
    allw = " ".join(words)
    if n <= 3 or tlen(allw, f, 2) <= maxw * 0.62:
        return wrap(allw, f, maxw, 2)
    best = None
    for i in range(2, n - 1):
        a = " ".join(words[:i]); b = " ".join(words[i:])
        w = max(tlen(a, f, 2), tlen(b, f, 2))
        if w <= maxw and (best is None or w < best[0]):
            best = (w, i)
    if best is None:
        return wrap(allw, f, maxw, 2)
    return [" ".join(words[:best[1]]), " ".join(words[best[1]:])]


def caption(im, idx, t, c):
    d = ImageDraw.Draw(im, "RGBA")
    words = TEXTS[idx].split()
    wts = [len(w) + 0.6 for w in words]
    tot = sum(wts)
    frac = seq(c["start"] + 0.05, c["end"], t)
    f = font(76, D.INTER, 700)
    maxw = W - 2 * ML
    lines = _balance(words, f, maxw)
    acc = 0.0; active = len(words) - 1
    for i, w in enumerate(words):
        acc += wts[i] / tot
        if frac <= acc:
            active = i
            break
    nlines = len(lines)
    top = CAP_Y + (3 - nlines) * 60
    wi = 0
    # soft backdrop pill
    ph = nlines * 118 + 60
    d.rounded_rectangle([70, top - 40, W - 70, top - 40 + ph], radius=40,
                        fill=(3, 8, 18, 150))
    for li, line in enumerate(lines):
        lw = tlen(line, f, 2)
        x = (W - lw) / 2
        y = top + li * 118
        for w in line.split():
            if wi < active:
                col = INK
            elif wi == active:
                col = SUN
            else:
                col = FAINT
            text(d, (x, y), w, f, fill=col, spacing=2)
            x += tlen(w, f, 2) + f.getlength(" ")
            wi += 1


# ---------------------------------------------------------------- scenes
def scene_hook(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    cx, cy, r = W / 2, 1500, 470
    hour = 1 + ease_out_back(seq(0.05, 0.6, p)) * 2
    D.clock(d, cx, cy, r, hour, 0, face=NAVY_2, rim=INK, hands=RED)
    yy = lerp(70, 0, ease_out_back(seq(0.15, 0.55, p)))
    text(d, (W / 2, 2420 + yy), "AMERICA TRIED", font(180, D.BC, "Black"),
         fill=INK, anchor="ma", spacing=4)
    text(d, (W / 2, 2640 + yy), "TO LOCK THE CLOCK", font(180, D.BC, "Black"),
         fill=RED, anchor="ma", spacing=4)
    if seq(0.45, 0.8, p) > 0:
        text(d, (W / 2, 2940), "· 1 9 7 4 ·", font(96, D.INTER, 800), fill=SUN,
             anchor="ma", spacing=6)


def _pump(d, x, y, col):
    d.rounded_rectangle([x, y - 320, x + 210, y], radius=22, fill=col)
    d.rectangle([x + 32, y - 280, x + 178, y - 196], fill=NAVY)
    d.rounded_rectangle([x + 44, y - 130, x + 166, y - 64], radius=10,
                        fill=(255, 255, 255, 70))


def scene_gas(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    text(d, (ML, 430), "THE SPARK · 1973 OIL EMBARGO", font(56, D.INTER, 800),
         fill=SUN, spacing=5)
    text(d, (ML, 570), "GAS LINES", font(170, D.BC, "Black"), fill=INK)
    text(d, (ML, 760), "RAN FOR MILES", font(170, D.BC, "Black"), fill=INK)
    base = 2000
    for i in range(4):
        _pump(d, ML + i * 470, base, NAVY_3 if i % 2 else NAVY_2)
    off = ease_in_out(seq(0.1, 0.8, p)) * 260
    for i in range(5):
        cx = ML + 60 + i * 390 + off
        cy = 2420
        d.rounded_rectangle([cx, cy - 96, cx + 310, cy + 44], radius=44,
                            fill=NAVY_3)
        d.ellipse([cx + 44, cy + 24, cx + 128, cy + 108], fill=INK)
        d.ellipse([cx + 196, cy + 24, cx + 280, cy + 108], fill=INK)
    v = int(150000 * ease_out_expo(seq(0.35, 0.95, p)))
    text(d, (ML, 2760), f"{v:,}", font(210, D.BC, "Black"), fill=SUN)
    text(d, (ML, 3010), "BARRELS A DAY THE FIX WAS SUPPOSED TO SAVE",
         font(48, D.INTER, 600), fill=INK_DIM)


def scene_switch(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    cx, cy, r = W / 2, 1350, 470
    hour = 2 + ease_out_back(seq(0.25, 0.6, p))
    D.clock(d, cx, cy, r, hour, 0, face=NAVY_2, rim=INK, hands=RED)
    text(d, (cx, cy + r + 150), "JAN 6, 1974 · 2:00 AM", font(62, D.INTER, 800),
         fill=INK, anchor="ma", spacing=4)
    hy = 2620
    d.rectangle([ML, hy, W - ML, hy + 6], fill=LINE)
    sy = lerp(hy + 260, hy + 130, ease_out(seq(0.3, 0.9, p)))
    d.ellipse([cx - 130, sy - 130, cx + 130, sy + 130], fill=mix(NAVY_3, SUN, 0.25))
    text(d, (W / 2, 3000), "THE SUN DIDN'T MOVE.", font(120, D.BC, "Black"),
         fill=RED, anchor="ma")
    text(d, (W / 2, 3170), "WE DID.", font(120, D.BC, "Black"), fill=INK, anchor="ma")


def scene_map(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    text(d, (ML, 430), "SUNRISE UNDER PERMANENT DST", font(56, D.INTER, 800),
         fill=SUN, spacing=5)
    text(d, (ML, 570), "MORNINGS WENT DARK", font(140, D.BC, "Black"), fill=INK)
    mf = MapFit((ML - 20, 820, W - ML + 20, 2400))
    mf.draw(d, fill=NAVY_3, outline=(80, 105, 140), width=3,
            reveal=ease_in_out(seq(0.05, 0.55, p)))
    order = ["Detroit", "Fargo", "Seattle", "Minneapolis", "Chicago", "New York", "Miami"]
    for i, name in enumerate(order):
        a = seq(0.35 + i * 0.07, 0.5 + i * 0.07, p)
        if a <= 0:
            continue
        la, lo = CITY_LL[name]
        x, y = mf.xy(lo, la)
        big = name in ("Detroit", "Fargo", "Seattle")
        r = lerp(4, 24 if big else 15, ease_out_back(a))
        d.ellipse([x - r, y - r, x + r, y + r], fill=RED if big else SUN,
                  outline=INK, width=4)
        hh, mm = SUNRISE[name]
        text(d, (x + 36, y), f"{name} {hh}:{mm:02d}",
             font(54 if big else 44, D.INTER, 800 if big else 600),
             fill=RED_L if big else INK_DIM, anchor="lm", spacing=1)
    text(d, (ML, 2680), "IN THE NORTH, SUNRISE PASSED 9 A.M.",
         font(64, D.INTER, 700), fill=INK)
    text(d, (ML, 2810), "SCHOOL STARTED BEFORE THE SUN CAME UP",
         font(48, D.INTER, 500), fill=MUTE)


def scene_florida(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    text(d, (ML, 430), "FLORIDA · JANUARY 1974", font(56, D.INTER, 800),
         fill=RED_L, spacing=5)
    text(d, (ML, 570), "KIDS WALKED TO", font(150, D.BC, "Black"), fill=INK)
    text(d, (ML, 750), "SCHOOL IN THE DARK", font(150, D.BC, "Black"), fill=INK)
    D.bars(d, (ML, 1150, W - ML, 1700), [8, 2], ["JAN 1974", "JAN 1973"],
           [RED, TEAL], prog=seq(0.3, 0.85, p), vmax=9,
           label_f=font(58, D.INTER, 700), value_f=font(58, D.INTER, 800),
           value_fmt=lambda v: f"{v:.0f} KIDS KILLED")
    if seq(0.6, 0.9, p) > 0:
        text(d, (ML, 1900), "SOME STATE OFFICIALS DISPUTED THE LINK",
             font(44, D.INTER, 500), fill=MUTE)


def scene_poll(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    text(d, (ML, 430), "PUBLIC OPINION", font(56, D.INTER, 800), fill=SUN, spacing=5)
    text(d, (ML, 570), "SUPPORT COLLAPSED", font(150, D.BC, "Black"), fill=INK)
    D.line_chart(d, (ML, 1000, W - ML, 1950), [0, 1, 2, 3], [79, 70, 55, 42],
                 RED, prog=seq(0.15, 0.8, p), width=10, dots=[0, 3],
                 dot_labels={0: ("79%", lambda x, y: (x + 120, y - 90)),
                             3: ("42%", lambda x, y: (x - 120, y + 90))},
                 label_f=font(64, D.INTER, 800), vmax=100,
                 area=(226, 59, 59, 40))
    k = ease_out_back(seq(0.6, 0.9, p))
    if k > 0:
        st = Image.new("RGBA", (1400, 340), (0, 0, 0, 0))
        sd = ImageDraw.Draw(st)
        sd.rounded_rectangle([12, 12, 1388, 328], radius=34, outline=RED, width=12)
        text(sd, (700, 170), "DAYLIGHT DISASTER TIME", font(96, D.BC, "Black"),
             fill=RED, anchor="mm", spacing=3)
        st = st.resize((max(2, int(1400 * k)), max(2, int(340 * k))))
        st = st.rotate(-7, expand=True, resample=Image.BICUBIC)
        im.paste(st, (W // 2 - st.width // 2, 2250), st)


def scene_energy(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    text(d, (ML, 430), "THE ENERGY VERDICT", font(56, D.INTER, 800), fill=SUN, spacing=5)
    v = ease_out_expo(seq(0.2, 0.7, p))
    text(d, (ML, 640), f"{v:.0f}%", font(430, D.BC, "Black"), fill=SUN)
    text(d, (ML, 1300), "THE PROMISED SAVINGS — DISPUTED", font(72, D.INTER, 700),
         fill=INK)
    text(d, (ML, 1470), "DOT CLAIMED ~1% IN 1975.", font(50, D.INTER, 500), fill=INK_DIM)
    text(d, (ML, 1560), "A 1976 FEDERAL REVIEW FOUND THEM", font(50, D.INTER, 500),
         fill=INK_DIM)
    text(d, (ML, 1650), "NOT STATISTICALLY REAL.", font(50, D.INTER, 700), fill=RED_L)


def scene_repeal(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    text(d, (ML, 430), "THE RETREAT", font(56, D.INTER, 800), fill=RED_L, spacing=5)
    cx, cy, r = W / 2, 1300, 430
    hour = 3 - ease_in_out(seq(0.25, 0.7, p))
    D.clock(d, cx, cy, r, hour, 0, face=NAVY_2, rim=INK, hands=RED)
    text(d, (cx, cy + r + 150), "OCT 27, 1974 · ROLL BACK", font(62, D.INTER, 800),
         fill=INK, anchor="ma", spacing=4)
    days = int(294 * ease_out_expo(seq(0.3, 0.9, p)))
    text(d, (W / 2, 2400), f"{days}", font(300, D.BC, "Black"), fill=RED, anchor="ma")
    text(d, (W / 2, 2720), "DAYS — THEN CONGRESS GAVE UP", font(62, D.INTER, 700),
         fill=INK, anchor="ma")


def scene_today(im, d, t, c):
    p = seq(c["start"], c["end"], t)
    text(d, (ML, 430), "2026 · AGAIN", font(56, D.INTER, 800), fill=SUN, spacing=5)
    text(d, (ML, 570), "THE HOUSE VOTED", font(150, D.BC, "Black"), fill=INK)
    text(d, (ML, 750), "TO LOCK IT AGAIN", font(150, D.BC, "Black"), fill=INK)
    D.bars(d, (ML, 1100, W - ML, 1650), [308, 117], ["YES", "NO"], [TEAL, RED],
           prog=seq(0.25, 0.8, p), vmax=425, label_f=font(64, D.INTER, 800),
           value_f=font(64, D.INTER, 800), value_fmt=lambda v: f"{v:.0f}")
    text(d, (ML, 1800), "SUNSHINE PROTECTION ACT · HOUSE 308–117",
         font(52, D.INTER, 700), fill=INK)
    if seq(0.6, 0.9, p) > 0:
        text(d, (ML, 1950), "THE SENATE HASN'T. NEXT CHANGE: NOV 1.",
             font(48, D.INTER, 600), fill=MUTE)


def scene_end(im, d, t, c):
    p = seq(c["start"], 60.0, t)
    text(d, (W / 2, 1450), "THE SUN HASN'T", font(170, D.BC, "Black"), fill=INK,
         anchor="ma")
    text(d, (W / 2, 1680), "CHANGED.", font(170, D.BC, "Black"), fill=INK, anchor="ma")
    text(d, (W / 2, 1980), "ONLY THE ARGUMENT HAS.", font(110, D.BC, "Black"),
         fill=RED, anchor="ma")
    if seq(0.4, 0.9, p) > 0:
        text(d, (W / 2, 3030), "SOURCES · DOT 1975 · NORC · FLORIDA PRESS · AASM",
             font(40, D.INTER, 500), fill=MUTE, anchor="ma", spacing=2)


SCENES = {1: scene_hook, 2: scene_gas, 3: scene_switch, 4: scene_map,
          5: scene_florida, 6: scene_poll, 7: scene_energy, 8: scene_repeal,
          9: scene_today, 10: scene_end}


def chunk_at(t):
    for c in PROG["chunks"]:
        if c["start"] - 0.4 <= t < c["end"] + 0.4:
            return c
    return PROG["chunks"][-1]


def frame(t):
    im = bg().copy()
    d = ImageDraw.Draw(im, "RGBA")
    c = chunk_at(t)
    SCENES[c["i"]](im, d, t, c)
    caption(im, c["i"], t, c)
    # dip-to-navy transitions
    a_in = 0.0 if c["i"] == 1 else 1 - ease_in_out(seq(c["start"], c["start"] + 0.24, t))
    a_out = ease_in_out(seq(c["end"] - 0.06, c["end"] + 0.28, t))
    a = max(a_in, a_out)
    if a > 0.01:
        ov = Image.new("RGBA", (W, H), (6, 12, 24, int(240 * a)))
        im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
    chrome(ImageDraw.Draw(im, "RGBA"), t)
    return im


SEG = 240  # frames per ffmpeg instance — bounds x264 memory on small boxes


def _enc_seg(seg_path, frames, t0, idx, total):
    cmd = [FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-pix_fmt", "yuv420p", "-threads", "1", seg_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                            stderr=subprocess.DEVNULL)
    for i in frames:
        proc.stdin.write(frame(i / FPS).tobytes())
    proc.stdin.close()
    rc = proc.wait()
    try:
        mav = [l for l in open("/proc/meminfo") if l.startswith("MemAvailable")][0].split()[1]
    except Exception:
        mav = "?"
    print(f"seg {idx}/{total} rc={rc} {_t.time()-t0:.0f}s avail={mav}kB", flush=True)
    return rc


def encode(out, audio=None):
    import tempfile
    t0 = _t.time()
    n = int(FPS * 60)
    segdir = tempfile.mkdtemp(prefix="ltc_seg_")
    parts = []
    total = (n + SEG - 1) // SEG
    for k in range(total):
        sp = os.path.join(segdir, f"seg_{k:03d}.mp4")
        _enc_seg(sp, range(k * SEG, min(n, (k + 1) * SEG)), t0, k, total)
        parts.append(sp)
    # concat + mux audio
    listf = os.path.join(segdir, "list.txt")
    with open(listf, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    cmd = [FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
           "-i", listf]
    if audio:
        cmd += ["-i", audio]
    cmd += ["-c:v", "copy"]
    if audio:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd += ["-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
    print("encoded", out, f"{_t.time()-t0:.0f}s")


def main():
    global PROG
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default=os.path.join(HERE, "timeline.json"))
    ap.add_argument("--preview", default=None)
    ap.add_argument("--encode", default=None)
    ap.add_argument("--audio", default=None)
    args = ap.parse_args()
    PROG = json.load(open(args.timeline))
    if args.preview:
        os.makedirs("/tmp/pv", exist_ok=True)
        for ts in args.preview.split(","):
            t = float(ts)
            frame(t).resize((810, 1440), Image.LANCZOS).save(f"/tmp/pv/t{t}.png")
            print("wrote", f"/tmp/pv/t{t}.png")
    if args.encode:
        encode(args.encode, args.audio)


if __name__ == "__main__":
    main()
