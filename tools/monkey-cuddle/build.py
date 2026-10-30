#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Midnight Monkey Cuddle — 15 s vertical (1080x1920, 30 fps) animatic.

Takes five photoreal keyframes (one per story beat) plus the user's first frame,
registers them into a shared camera space, then animates them with:

  * a very slow push-in + hand-held drift (low-frequency sum-of-sines, no jitter pops)
  * eased cross-dissolves on the beat boundaries (3 s / 6 s / 9 s / 12 s)
  * a subtle local "breathing" warp in the blanket / chest band
  * phone-camera look: faint sensor grain, exposure breathing, warm grade, vignette

Frames are piped straight into libx264 as rawvideo, then the ambience track from
audio.py is muxed in.  ffmpeg comes from $FFMPEG, else imageio-ffmpeg's binary.

    python3 tools/monkey-cuddle/build.py \
        --first "frames/kf0.png" \
        --keys  frames/kf2.png frames/kf3.png frames/kf4b.png frames/kf5.png \
        --audio /tmp/amb.wav --out media/monkey-cuddle/monkey-cuddle-15s.mp4
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

import numpy as np
from PIL import Image

# ---------------------------------------------------------------------------
# delivery specs
# ---------------------------------------------------------------------------
FPS = 30
DUR = 15.0
NFRAME = int(FPS * DUR)
W, H = 1080, 1920                       # vertical 9:16
BEAT = DUR / 5.0                        # 3.0 s per story beat
XFADE = 1.1                             # cross-dissolve width (s) — short, so nothing 'morphs'
CANVAS_MARGIN = 1.14                    # head-room around the reference frame
CANVAS_SS = 2.0                         # supersample factor of the canvas
REGROW = 1.06                           # extra crop kept for rotation safety

BLEND_A = 0.95                          # dissolve starts this long before a beat edge
PUSH = (1.030, 1.085)                   # slow push-in, zoom at t=0 -> t=DUR


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------
def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def gray(a: np.ndarray) -> np.ndarray:
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def _boxblur(a: np.ndarray, r: int) -> np.ndarray:
    """separable box blur via cumulative sums (works on float arrays)"""
    p = np.pad(a, ((r + 1, r), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=0)
    a = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
    p = np.pad(a, ((0, 0), (r + 1, r)), mode="edge")
    c = np.cumsum(p, axis=1)
    return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)


def highpass(g: np.ndarray) -> np.ndarray:
    """keep edges / texture, drop the big flat areas (pillow, blanket, wall)"""
    sm = _boxblur(_boxblur(g.astype(np.float32), 3), 3)
    hp = g.astype(np.float32) - sm
    sd = hp.std() + 1e-9
    return np.clip(hp, -3.0 * sd, 3.0 * sd)


def fft_peakshift(a: np.ndarray, b: np.ndarray):
    """phase correlation -> (dy, dx, score) of b relative to a"""
    ha, wa = a.shape
    hb, wb = b.shape
    h = 1 << int(np.ceil(np.log2(ha + hb)))
    w = 1 << int(np.ceil(np.log2(wa + wb)))
    A = np.fft.rfft2(a, (h, w))
    B = np.fft.rfft2(b, (h, w))
    R = A * np.conj(B)
    R /= np.abs(R) + 1e-9
    r = np.fft.irfft2(R, (h, w))
    iy, ix = np.unravel_index(int(np.argmax(r)), r.shape)
    score = float(r[iy, ix])
    dy = iy if iy <= h // 2 else iy - h
    dx = ix if ix <= w // 2 else ix - w
    return dy, dx, score


def register(ref_g: np.ndarray, img_g: np.ndarray, scales) -> tuple[float, int, int, float]:
    """brute-force scale + phase-correlation shift that best maps img onto ref"""
    rh, rw = ref_g.shape
    best = (-9e9, 1.0, 0, 0)
    for s in scales:
        nw, nh = max(16, int(round(rw * s))), max(16, int(round(rh * s)))
        b = np.array(Image.fromarray(img_g).resize((nw, nh), Image.BILINEAR), dtype=np.float32)
        b -= b.mean()
        a = np.array(ref_g, dtype=np.float32) - ref_g.mean()
        na, nb = np.linalg.norm(a) + 1e-9, np.linalg.norm(b) + 1e-9
        dy, dx, peak = fft_peakshift(a / na, b / nb)
        # shift of the *content*: ref pixel (y,x) ~ img pixel (y*s - dy, x*s - dx)
        score = peak
        if score > best[0]:
            best = (score, s, dx, dy)
    return best[1], best[2], best[3], best[0]


# ---------------------------------------------------------------------------
# stage 1 — one shared camera space, anchored on the alarm clock
# ---------------------------------------------------------------------------
# The 06:00 digits are a rigid, uniquely coloured object present in every
# keyframe, so they pin down both the zoom (digit-block width) and the pan
# (digit centroid) far more reliably than a global image correlation.
CLOCK_MASK = dict(bmin=140.0, rk=1.25, gk=1.10, ytop=0.30)


def clock_anchor(path: str):
    im = np.asarray(Image.open(path).convert("RGB"), np.float32)
    h, w = im.shape[:2]
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    m = (b > CLOCK_MASK["bmin"]) & (b > r * CLOCK_MASK["rk"]) & (b > g * CLOCK_MASK["gk"])
    m[int(h * CLOCK_MASK["ytop"]):, :] = False
    ys, xs = np.nonzero(m)
    if len(xs) < 40:
        raise SystemExit(f"could not find the clock digits in {path}")
    return dict(cx=float(xs.mean()), cy=float(ys.mean()),
                w=float(xs.max() - xs.min() + 1), h=float(ys.max() - ys.min() + 1),
                n=int(len(xs)))


def mirror_extend(im: Image.Image, pad_frac: float = 0.34):
    """reflect the frame outwards so the canvas never shows a flat black band"""
    a = np.array(im)
    h, w = a.shape[:2]
    pt = pb = pl = pr = int(round(pad_frac * min(w, h) * 0.5))
    pt = int(round(pad_frac * h)); pb = int(round(pad_frac * h))
    pl = int(round(pad_frac * w)); pr = int(round(pad_frac * w))
    pt = min(pt, h - 1); pb = min(pb, h - 1); pl = min(pl, w - 1); pr = min(pr, w - 1)
    ext = np.pad(a, ((pt, pb), (pl, pr), (0, 0)), mode="reflect")
    return Image.fromarray(ext), pl, pt


def colour_match(im: np.ndarray, ref: np.ndarray, strength: float = 0.65) -> np.ndarray:
    """Reinhard transfer of mean/std in a soft-luma space, kept gentle"""
    out = im.copy()
    for c in range(3):
        a, b = im[..., c], ref[..., c]
        ma, sa = a.mean(), a.std() + 1e-5
        mb, sb = b.mean(), b.std() + 1e-5
        out[..., c] = (a - ma) / sa * sb * strength + (mb * strength + ma * (1.0 - strength))
    return out


def centre_patch(im: Image.Image, frac=0.7) -> np.ndarray:
    w, h = im.size
    dx, dy = int(w * (1 - frac) / 2), int(h * (1 - frac) / 2)
    return np.asarray(im.crop((dx, dy, w - dx, h - dy)).resize((160, 280), Image.BILINEAR), np.float32)


def build_canvases(paths, tune=None, verbose=True):
    anchors = [clock_anchor(p) for p in paths]
    a0 = anchors[0]
    ref = Image.open(paths[0]).convert("RGB")
    rw, rh = ref.size
    ref_patch = centre_patch(ref)

    ch = int(round(rh * CANVAS_SS * CANVAS_MARGIN))
    cw = int(round(ch * 9 / 16))
    if cw < int(round(rw * CANVAS_SS * 1.02)):
        cw = int(round(rw * CANVAS_SS * 1.02))
        ch = int(round(cw * 16 / 9))
    cw += cw % 2
    ch += ch % 2
    cx, cy = cw // 2, ch // 2
    x_ref0 = cx - rw * CANVAS_SS / 2.0          # canvas x of reference pixel 0
    y_ref0 = cy - rh * CANVAS_SS / 2.0

    aligned, meta = [], []
    for i, (p, an) in enumerate(zip(paths, anchors)):
        im = Image.open(p).convert("RGB")
        f = (a0["w"] / an["w"]) * (tune[i] if tune else 1.0)
        # top-left of this frame expressed in reference pixels
        ox = a0["cx"] - an["cx"] * f
        oy = a0["cy"] - an["cy"] * f
        arr = colour_match(np.asarray(im, np.float32), ref_patch)
        im2 = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        ext, pl, pt = mirror_extend(im2)
        tw = int(round(ext.size[0] * f * CANVAS_SS))
        th = int(round(ext.size[1] * f * CANVAS_SS))
        big = ext.resize((tw, th), Image.LANCZOS)
        canvas = Image.new("RGB", (cw, ch), (16, 11, 9))
        canvas.paste(big, (int(round(x_ref0 + ox * CANVAS_SS - pl * f * CANVAS_SS)),
                           int(round(y_ref0 + oy * CANVAS_SS - pt * f * CANVAS_SS))))
        aligned.append(canvas)
        meta.append((f, ox, oy))
        if verbose:
            print(f"  {os.path.basename(p):>9}  clock {an['w']:.0f}x{an['h']:.0f}px @"
                  f" ({an['cx']:.0f},{an['cy']:.0f})  ->  x{f:.3f}  off ({ox:+.0f},{oy:+.0f})")
    return aligned, (cw, ch)


# ---------------------------------------------------------------------------
# stage 2 — the moving camera
# ---------------------------------------------------------------------------
def wobble(t):
    """hand-held drift: translation (canvas px @1x), tiny roll (deg)"""
    jx = (4.6 * np.sin(2 * np.pi * 0.113 * t + 1.10)
          + 2.3 * np.sin(2 * np.pi * 0.271 * t + 2.70)
          + 1.1 * np.sin(2 * np.pi * 0.617 * t + 0.41))
    jy = (3.4 * np.sin(2 * np.pi * 0.089 * t + 0.31)
          + 1.9 * np.sin(2 * np.pi * 0.233 * t + 4.02)
          + 0.9 * np.sin(2 * np.pi * 0.541 * t + 1.77))
    roll = 0.16 * np.sin(2 * np.pi * 0.071 * t + 0.9) + 0.06 * np.sin(2 * np.pi * 0.317 * t + 2.2)
    return jx, jy, roll


def weights_for(t):
    """which two keyframes are on screen at time t, and their mix"""
    n = 5
    idx = t / BEAT
    k = int(np.floor(idx))
    frac = idx - k
    if k >= n - 1:
        return n - 1, n - 1, 0.0
    # dissolve only around the beat boundary
    half = (XFADE / 2) / BEAT
    a = smoothstep((frac - (1.0 - half)) / (2 * half))
    return k, k + 1, float(a)


def crop_window(canvas, t, jx, jy, roll):
    cw, ch = canvas.size
    z = PUSH[0] + (PUSH[1] - PUSH[0]) * (t / DUR) ** 1.35
    bw = cw / (z * REGROW)
    bh = ch / (z * REGROW)
    # keep it exactly 9:16
    if bw / bh > 9 / 16:
        bw = bh * 9 / 16
    else:
        bh = bw * 16 / 9
    x0 = (cw - bw) / 2 + jx * CANVAS_SS
    y0 = (ch - bh) / 2 + jy * CANVAS_SS
    x0 = min(max(x0, 0), cw - bw)
    y0 = min(max(y0, 0), ch - bh)
    win = canvas.crop((int(round(x0)), int(round(y0)), int(round(x0 + bw)), int(round(y0 + bh))))
    win = win.resize((int(round(W * 1.10)), int(round(H * 1.10))), Image.LANCZOS)
    win = win.rotate(roll, resample=Image.BICUBIC, expand=False, fillcolor=(0, 0, 0))
    ox = (win.size[0] - W) // 2
    oy = (win.size[1] - H) // 2
    return win if win.size == (W, H) else win.crop((ox, oy, ox + W, oy + H))


# ---------------------------------------------------------------------------
# stage 3 — grade + breathing + grain
# ---------------------------------------------------------------------------
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
_vx = (XX / W - 0.5) * 2.0
_vy = (YY / H - 0.5) * 2.0
VIGNETTE = (1.0 - 0.30 * np.clip((_vx ** 2 * 0.85 + _vy ** 2 * 0.75) - 0.30, 0, None) ** 0.85)[..., None].astype(np.float32)
# feather mask for the blanket/chest band (1 = full breathing displacement)
BAND = smoothstep((YY[:, :1] / H - 0.50) / 0.18).astype(np.float32)
_rows = np.arange(H, dtype=np.float32)[:, None]


def breathe(a: np.ndarray, t: float) -> np.ndarray:
    ph = 2 * np.pi * (0.243 * t + 0.05 * np.sin(2 * np.pi * 0.037 * t))
    amp = 3.0 * np.sin(ph)
    off = (BAND * amp)
    idx = np.clip(np.rint(_rows + off), 0, H - 1).astype(np.int32)[:, 0]
    return a[idx]


def grade(a: np.ndarray) -> np.ndarray:
    a = a * VIGNETTE
    # gentle S-curve around 0.5, warm balance
    a = 0.5 + (a - 0.5) * 1.055
    a = a * np.array([1.022, 1.000, 0.972], np.float32)
    a = a + 0.012 * np.array([1.0, 0.72, 0.45], np.float32) * (1.0 - a)  # warm lifted blacks
    return a


def render(canvases, out_pipe, seed=7):
    rng = np.random.default_rng(seed)
    for f in range(NFRAME):
        t = f / FPS
        jx, jy, roll = wobble(t)
        k, k2, a = weights_for(t)
        img = np.asarray(crop_window(canvases[k], t, jx, jy, roll), np.float32) / 255.0
        if a > 0.0 and k2 != k:
            im2 = np.asarray(crop_window(canvases[k2], t, jx, jy, roll), np.float32) / 255.0
            img = img * (1.0 - a) + im2 * a
        img = breathe(img, t)
        img = grade(img)
        # sensor grain + auto-exposure breathing
        g = rng.normal(0.0, 0.0072, (H, W, 1)).astype(np.float32)
        img = img + g * (1.15 - 0.35 * img)
        img *= 1.0 + 0.004 * np.sin(2 * np.pi * 0.19 * t + 1.3)
        img = np.clip(img, 0.0, 1.0)
        out_pipe.write((img * 255.0 + 0.5).astype(np.uint8).tobytes())
        if f % 60 == 0:
            print(f"  frame {f:>3}/{NFRAME}", flush=True)


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(os.path.dirname(here))
    ap.add_argument("--first", default=os.path.join(root, "media/monkey-cuddle/frames/kf0.png"))
    ap.add_argument("--keys", nargs=4, default=[
        os.path.join(root, "media/monkey-cuddle/frames/kf2.png"),
        os.path.join(root, "media/monkey-cuddle/frames/kf3.png"),
        os.path.join(root, "media/monkey-cuddle/frames/kf4b.png"),
        os.path.join(root, "media/monkey-cuddle/frames/kf5.png"),
    ])
    ap.add_argument("--audio", default=None)
    ap.add_argument("--out", default=os.path.join(root, "media/monkey-cuddle/monkey-cuddle-15s.mp4"))
    ap.add_argument("--crf", type=int, default=19)
    ap.add_argument("--tune", default="1.0,0.95,1.0,0.93,1.0",
                    help="comma separated per-frame zoom multipliers (5 values)")
    ap.add_argument("--preview", default=None, help="comma separated times -> PNG stills")
    args = ap.parse_args()

    paths = [args.first] + list(args.keys)
    print("registering keyframes…")
    tune = [float(x) for x in args.tune.split(',')] if args.tune else None
    canvases, (cw, ch) = build_canvases(paths, tune)
    print(f"  canvas {cw}x{ch}")

    if args.preview:
        from PIL import ImageDraw
        for s in args.preview.split(","):
            t = float(s)
            jx, jy, roll = wobble(t)
            k, k2, a = weights_for(t)
            im = np.asarray(crop_window(canvases[k], t, jx, jy, roll), np.float32) / 255.0
            im = grade(breathe(im, t))
            p = os.path.join(root, "media/monkey-cuddle", f"preview-{t:04.1f}.png")
            Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).save(p)
            print("  wrote", p)
        return

    ff = os.environ.get("FFMPEG")
    if not ff:
        try:
            import imageio_ffmpeg
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ff = "ffmpeg"

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = os.path.splitext(args.out)[0] + ".video-only.mp4"
    cmd = [ff, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0",
           "-an", "-c:v", "libx264", "-preset", "slow", "-crf", str(args.crf),
           "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-g", str(FPS * 2), tmp]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    print("rendering…")
    render(canvases, p.stdin)
    p.stdin.close()
    if p.wait() != 0:
        sys.exit("ffmpeg failed")

    if args.audio and os.path.exists(args.audio):
        cmd = [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", tmp, "-i", args.audio,
               "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
               "-movflags", "+faststart", args.out]
        subprocess.run(cmd, check=True)
        os.remove(tmp)
    else:
        os.replace(tmp, args.out)
    print("wrote", args.out, f"({os.path.getsize(args.out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
