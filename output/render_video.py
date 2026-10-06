"""Render the 15s vertical 'Busy?' macaque video.

Pipeline: photoreal AI keyframes -> continuous handheld camera (drift, rotation,
micro-jitter, digital zoom creep) -> breathing/sway warp -> autofocus hunting ->
auto-exposure breathing -> sensor grain -> H.264 (yuv420p, 1080x1920, 30fps).

Usage:
  python3 render_video.py --out out.mp4 [--scale 1.0] [--f0 0] [--f1 450]
  python3 render_video.py --preview            # fast 540x960 sanity pass
"""
import argparse, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageFilter

import imageio_ffmpeg
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

FPS = 30
DUR = 15.0
NF_TOTAL = int(round(FPS * DUR))          # 450

FRAMES_DIR = "/home/user/neurio/output/frames"
FRAME_FILES = {
    "f1": "f1_typing.png",
    "f2": "f2_noticed.png",
    "f3": "f3_manager_passes.png",
    "f4": "f4_exhausted.png",
    "f5": "f5_caught.png",
    "f6": "f6_deadpan.png",
}

# ---------------------------------------------------------------- story timeline (seconds)
# one continuous shot: keyframe held, then a short rack-focus style transition
SEGMENTS = [
    (0.00, 4.00, "f1"),    # pretending to work, typing normally
    (3.62, 7.00, "f2"),    # hears footsteps: sits up, fixes tie, types fast
    (6.62, 10.00, "f3"),   # manager walks past, intense fake focus
    (9.62, 12.00, "f4"),   # alone again: leans back, exhausted, head on hand
    (11.72, 13.55, "f5"),  # manager silently back: he freezes, caught
    (13.50, 15.00, "f6"),  # "Busy?" -> deadpan, slowly back to the laptop
]
TRANS_SEC = 0.30

# blinks: (time, keyframe, duration)
BLINKS = [(1.92, "f1", 0.13), (5.55, "f2", 0.12), (6.35, "f2", 0.11),
          (8.62, "f3", 0.13), (11.05, "f4", 0.16), (14.42, "f6", 0.12)]

# autofocus hunting / focus racks: (time, peak blur radius, duration)
AF_EVENTS = [(4.06, 1.25, 0.70), (7.02, 0.70, 0.55), (8.45, 0.45, 0.50),
             (11.86, 1.45, 0.95), (13.42, 0.60, 0.55)]

# auto-exposure reactions (brightness dip then recover), (time, dip, duration)
AE_EVENTS = [(7.00, 0.030, 0.75), (11.72, 0.038, 0.65), (13.50, 0.018, 0.45)]

SUBJECT_CY = 0.50      # vertical centre of the subject for the breathing warp
SUBJ_AMP_Y = 1.9       # px
GRAIN_SIGMA = 2.35


def load_frames(canvas_w, canvas_h):
    out = {}
    for k, fn in FRAME_FILES.items():
        im = Image.open(os.path.join(FRAMES_DIR, fn)).convert("RGB")
        w, h = im.size
        tw, th = w, int(round(w * 16 / 9))
        if th > h:
            th, tw = h, int(round(h * 9 / 16))
        im = im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th))
        out[k] = im.resize((canvas_w, canvas_h), Image.LANCZOS)
    return out


def smooth_noise(t, freqs, amps, rng):
    s = np.zeros_like(t)
    for f, a in zip(freqs, amps):
        s += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi))
    return s


def impulse_response(t, t0, dur, amp):
    """smooth 0->amp->0 bump"""
    x = (t - t0) / dur
    y = np.zeros_like(t)
    m = (x > 0) & (x < 1)
    y[m] = amp * np.sin(np.pi * x[m]) ** 2
    return y


def camera_path(nf):
    rng = np.random.default_rng(41)
    t = np.arange(nf) / FPS
    # slow handheld drift + micro jitter (smooth, never snappy)
    dx = smooth_noise(t, [0.037, 0.083, 0.17, 0.33, 0.61], [7.0, 4.2, 2.3, 1.1, 0.5], rng)
    dy = smooth_noise(t, [0.029, 0.071, 0.19, 0.41, 0.73], [8.0, 4.6, 2.4, 1.2, 0.5], rng)
    rot = smooth_noise(t, [0.043, 0.11, 0.23], [0.22, 0.11, 0.05], rng)          # degrees
    zoom = 1.055 + smooth_noise(t, [0.021, 0.047, 0.10], [0.011, 0.006, 0.0025], rng)
    # tiny operator jolts: sitting up fast, manager arriving
    for (et, amp) in [(4.03, 1.5), (7.01, 0.9), (11.74, 1.8), (13.45, 0.7)]:
        bump = impulse_response(t, et, 0.45, amp)
        wobb = np.sin(2 * np.pi * 2.3 * (t - et)) * bump
        dx += wobb * 0.8
        dy += wobb * 0.5
        rot += wobb * 0.035
    return dx, dy, rot, zoom


def blur_radius(t):
    r = np.full_like(t, 0.0)
    for (et_, peak, dur) in AF_EVENTS:
        r += impulse_response(t, et_, dur, peak)
    r += 0.10 * np.clip(smooth_noise(t, [0.12], [1.0], np.random.default_rng(5)), 0, None)
    return r


def exposure_gain(t):
    g = 1.0 + 0.010 * np.sin(2 * np.pi * 0.13 * t + 0.7) + 0.006 * np.sin(2 * np.pi * 0.31 * t + 2.1)
    for (et_, dip, dur) in AE_EVENTS:
        g -= dip * impulse_response(t, et_, dur, 1.0)
    return g


def affine_camera(im, cx, cy, sx, sy, rot_deg, zoom, W, H):
    th = math.radians(rot_deg)
    c, s = math.cos(th), math.sin(th)
    a = c / zoom
    b = -s / zoom
    d = s / zoom
    e = c / zoom
    cc = cx + sx - (a * (W / 2) + b * (H / 2))
    ff = cy + sy - (d * (W / 2) + e * (H / 2))
    return im.transform((W, H), Image.AFFINE, (a, b, cc, d, e, ff), resample=Image.BICUBIC)


def vertical_warp(arr, dy_row):
    """Per-row sub-pixel vertical shift (breathing / sway). arr float32 HxWx3."""
    H, W, _ = arr.shape
    rows = np.arange(H, dtype=np.float32)
    src = rows - dy_row
    y0 = np.floor(src).astype(np.int32)
    w = (src - y0).astype(np.float32)[:, None, None]
    y0 = np.clip(y0, 0, H - 2)
    idx0 = np.clip(y0, 0, H - 1)
    idx1 = np.clip(y0 + 1, 0, H - 1)
    out = arr[idx0] * (1.0 - w) + arr[idx1] * w
    return out


def vignette(W, H, strength=0.055):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    x = (x / W - 0.5) * 2
    y = (y / H - 0.5) * 2
    r2 = x * x + y * y
    return (1.0 - strength * np.clip(r2 / 2.0, 0, 1))[:, :, None].astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/home/user/neurio/output/busy_macaque_9x16_15s.mp4")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--f0", type=int, default=0)
    ap.add_argument("--f1", type=int, default=NF_TOTAL)
    ap.add_argument("--audio", default="/home/user/neurio/output/audio/office_ambience.wav")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    W = int(round(1080 * args.scale))
    H = int(round(1920 * args.scale))
    W = W - (W % 2)
    H = H - (H % 2)
    nf = args.f1 - args.f0
    if args.preview:
        W, H = 540, 960

    canvas_w = int(round(W * 1.126))
    canvas_h = int(round(H * 1.126))
    frames = load_frames(canvas_w, canvas_h)

    # blink composites (optional; built by build_blinks.py)
    blink_data = {}
    npz = "/home/user/neurio/output/frames/blink_masks.npz"
    if os.path.exists(npz):
        z = np.load(npz)
        for k in z.files:
            if k.endswith("_img"):
                key = k[:-4]
                blink_data[key] = (z[k].astype(np.float32), z[key + "_mask"].astype(np.float32))

    dx, dy, rot, zoom = camera_path(NF_TOTAL)
    t_all = np.arange(NF_TOTAL) / FPS
    blur_all = blur_radius(t_all)
    expo_all = exposure_gain(t_all)

    vig = vignette(W, H, 0.055)
    rng = np.random.default_rng(1234)

    cmd = [FFMPEG, "-y", "-v", "warning",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if os.path.exists(args.audio):
        cmd += ["-i", args.audio, "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
            "-profile:v", "high", "-level", "4.2", "-movflags", "+faststart"]
    if os.path.exists(args.audio):
        cmd += ["-shortest"]
    cmd += [args.out]

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for i in range(args.f0, args.f1):
            t = i / FPS
            # --- which keyframe(s) and blend weight
            cur = None
            for (s, e, k) in SEGMENTS:
                if s <= t < e:
                    cur = (s, e, k)
            if cur is None:
                cur = (SEGMENTS[-1][0], SEGMENTS[-1][1], SEGMENTS[-1][2])
            nxt = None
            for (s, e, k) in SEGMENTS:
                if s > t:
                    nxt = (s, e, k)
                    break
            z = float(zoom[min(i, NF_TOTAL - 1)])
            cx0, cy0 = canvas_w / 2.0, canvas_h / 2.0
            sx = float(dx[min(i, NF_TOTAL - 1)])
            sy = float(dy[min(i, NF_TOTAL - 1)])
            rt = float(rot[min(i, NF_TOTAL - 1)])

            imgA = affine_camera(frames[cur[2]], cx0, cy0, sx, sy, rt, z, W, H)
            w = 0.0
            if nxt is not None and (nxt[0] - t) <= TRANS_SEC:
                w = (TRANS_SEC - (nxt[0] - t)) / TRANS_SEC
                w = w * w * (3 - 2 * w)                      # smoothstep
            if w > 0:
                imgB = affine_camera(frames[nxt[2]], cx0, cy0, sx, sy, rt, z, W, H)
                arr = np.asarray(imgA, dtype=np.float32) * (1.0 - w) + np.asarray(imgB, dtype=np.float32) * w
            else:
                arr = np.asarray(imgA, dtype=np.float32)

            # --- blinking (eye-region crossfade on top of the held image)
            for (bt, bkey, bdur) in BLINKS:
                if bkey == cur[2] and abs(t - bt) <= bdur and bkey in blink_data:
                    bimg, bmask = blink_data[bkey]
                    if bimg.shape[:2] != (H, W):
                        bimg = np.asarray(Image.fromarray(bimg.astype(np.uint8)).resize((W, H), Image.LANCZOS), dtype=np.float32)
                        bmask = np.asarray(Image.fromarray((bmask * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), dtype=np.float32) / 255.0
                    k = 1.0 - abs(t - bt) / bdur
                    k = k * k * (3 - 2 * k)
                    if w > 0:      # during a transition subdue the blink
                        k *= (1.0 - w)
                    m = (bmask * k)[:, :, None]
                    arr = arr * (1.0 - m) + bimg * m

            # --- breathing / sway of the subject
            rows = np.arange(H, dtype=np.float32)
            rowmask = np.exp(-((rows - SUBJECT_CY * H) ** 2) / (2 * (0.36 * H) ** 2))
            amp = SUBJ_AMP_Y * args.scale
            dy_row = amp * rowmask * (0.65 * math.sin(2 * math.pi * 0.40 * t + 0.4)
                                      + 0.35 * math.sin(2 * math.pi * 0.17 * t + 1.9))
            arr = vertical_warp(arr, dy_row)

            # --- autofocus hunting
            br = float(blur_all[min(i, NF_TOTAL - 1)]) * args.scale
            if br > 0.12:
                im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(
                    ImageFilter.GaussianBlur(radius=min(br, 3.0)))
                arr = np.asarray(im, dtype=np.float32)

            # --- auto exposure + grain + vignette
            g = float(expo_all[min(i, NF_TOTAL - 1)])
            arr *= g
            arr *= vig
            if GRAIN_SIGMA > 0:
                s = GRAIN_SIGMA * args.scale
                arr += rng.normal(0, s, (H, W, 1)).astype(np.float32)
                arr += rng.normal(0, s * 0.42, (H, W, 3)).astype(np.float32)
            out = np.clip(arr, 0, 255).astype(np.uint8)
            proc.stdin.write(out.tobytes())
            if (i - args.f0) % 30 == 0:
                print(f"  frame {i - args.f0 + 1}/{nf}  t={t:5.2f}s", flush=True)
    finally:
        if proc.stdin:
            proc.stdin.close()
        rc = proc.wait()
    print("render exit", rc, "->", args.out)


if __name__ == "__main__":
    main()
