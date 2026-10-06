#!/usr/bin/env python3
"""
Monkey-boss typing animation  ->  monkey_typing.mp4

Takes a single still photo (monkey.png) and brings it to life with
procedural mesh-warping (no AI video model):
  * fingers tapping keys individually, hands drifting across the keyboard
  * a big "slam" on the keyboard (kaydrab f PC!) with camera shake
  * head bobbing / nodding, breathing shoulders, eye blinks
  * clock second hand ticking
  * slow cinematic push-in + handheld micro drift
  * synthesized audio: key clicks, clock ticks, slam thud, room tone

Usage:  python3 animate.py   (needs numpy, opencv-python-headless, pillow, imageio-ffmpeg)
"""
import math, os, subprocess, wave
import numpy as np
import cv2
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "monkey.png")
OUT = os.path.join(HERE, "monkey_typing.mp4")

FPS = 30
DUR = 12.0
OUT_W, OUT_H = 1080, 1920
SR = 44100
rng = np.random.default_rng(7)

img = cv2.imread(SRC, cv2.IMREAD_COLOR).astype(np.float32)
H, W = img.shape[:2]
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)


# ---------------------------------------------------------------- helpers
def gauss(cx, cy, sx, sy):
    return np.exp(-(((XX - cx) / sx) ** 2 + ((YY - cy) / sy) ** 2) * 0.5).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def arm_mask(p0, p1, width, s0=-0.15, s1=0.55):
    """weight along a segment p0(elbow side)->p1(fingertips): 0 at elbow, 1 at hand"""
    p0 = np.array(p0, np.float32); p1 = np.array(p1, np.float32)
    d = p1 - p0; L = np.linalg.norm(d); u = d / L; n = np.array([-u[1], u[0]])
    s = ((XX - p0[0]) * u[0] + (YY - p0[1]) * u[1]) / L
    q = (XX - p0[0]) * n[0] + (YY - p0[1]) * n[1]
    along = smoothstep(s0, s1, s) * (1 - smoothstep(1.05, 1.35, s))
    across = np.exp(-0.5 * (q / width) ** 2)
    return (along * across).astype(np.float32)


# ---------------------------------------------------------------- masks (source-pixel coords)
# front (left-in-image) hand: forearm from cuff (~420,1040) to fingertips (~640,1165)
M_HAND_F = arm_mask((330, 1000), (650, 1165), 62)
# back hand on the right: cuff (~670,985) to fingertips (~715,1085)
M_HAND_B = arm_mask((640, 930), (720, 1090), 42, s0=-0.1, s1=0.6)

# individual fingertips (front hand: 4, back hand: 3)
FINGERS = [
    (598, 1164, 11, 0), (626, 1158, 11, 0), (646, 1147, 10, 0), (660, 1133, 9, 0),
    (690, 1078, 10, 1), (712, 1082, 10, 1), (735, 1070, 9, 1),
]
M_FING = []
for fx, fy, r, _ in FINGERS:
    # elongated blob pointing back toward knuckles (up-left)
    m = np.maximum(gauss(fx, fy - 6, r, r * 1.3), 0.8 * gauss(fx - 14, fy - 22, r * 1.1, r * 1.1))
    M_FING.append(m.astype(np.float32))

# head (pivot at neck)
HEAD_PIVOT = (440.0, 770.0)
M_HEAD = (gauss(440, 590, 150, 150) * (1 - smoothstep(700, 770, YY))).astype(np.float32)
M_HEAD = np.clip(M_HEAD * 1.6, 0, 1)

# torso/shoulders breathing
M_TORSO = (gauss(390, 760, 260, 160) * (1 - smoothstep(930, 1010, YY))).astype(np.float32)

# eyes: (cx, top_of_lid, lid_line_now, bottom, half_width)
EYES = [(480, 597, 606, 619, 19), (534, 600, 609, 621, 18)]

# clock (centre / radius in source pixels)
CLOCK_C = (485.0, 183.0)
CLOCK_R = 78.0


# ---------------------------------------------------------------- timeline
SLAM_T = 8.6          # strike moment of the big keyboard smash
SLAM_UP = 0.45        # anticipation duration
CALM_T = SLAM_T + 0.9 # typing resumes

taps = []  # (time, finger index)
t = 0.25
while t < DUR - 0.2:
    if SLAM_T - SLAM_UP - 0.1 < t < CALM_T:
        t = CALM_T; continue
    rush = 1.0 + 0.6 * (t > SLAM_T - 3.5)            # typing gets angrier before the slam
    f = int(rng.integers(0, len(FINGERS)))
    taps.append((t, f))
    t += rng.uniform(0.07, 0.17) / rush
blinks = [1.6, 4.7, 7.1, 10.4, 11.3]


def tap_curve(dt):
    """finger lift (0..1) around a key strike at dt=0"""
    if -0.11 < dt < 0:
        x = (dt + 0.11) / 0.11
        if x < 0.6:
            return math.sin(x / 0.6 * math.pi / 2)          # lift up
        return 1 - ((x - 0.6) / 0.4) ** 2                    # snap down onto the key
    if 0 <= dt < 0.06:
        return -0.25 * math.sin(dt / 0.06 * math.pi)  # press down a hair
    return 0.0


def slam_curve(t):
    """hands lift then smash. returns (lift 0..1, shake strength)"""
    a = SLAM_T - SLAM_UP
    if a <= t < SLAM_T:
        x = (t - a) / SLAM_UP
        lift = math.sin(min(x / 0.7, 1) * math.pi / 2) if x < 0.85 else (1 - (x - 0.85) / 0.15)
        return lift, 0.0
    if SLAM_T <= t < SLAM_T + 0.12:
        return -0.25 * math.sin((t - SLAM_T) / 0.12 * math.pi), 1.0
    if t >= SLAM_T:
        return 0.0, math.exp(-(t - SLAM_T) * 7)
    return 0.0, 0.0


def blink_amount(t):
    for b in blinks:
        d = t - b
        if 0 <= d < 0.20:
            return math.sin(d / 0.20 * math.pi) ** 0.7
    return 0.0


# ---------------------------------------------------------------- frame renderer
def render(t):
    dx = np.zeros((H, W), np.float32)   # backward map offsets (source = p + d)
    dy = np.zeros((H, W), np.float32)

    lift, shake = slam_curve(t)

    # --- hand drifts + bobs (move with typing rhythm)
    hfx = 3.0 * math.sin(t * 1.3) + 1.5 * math.sin(t * 3.1 + 1)
    hfy = 1.2 * math.sin(t * 2.2)
    hbx = 2.5 * math.sin(t * 1.1 + 2) + 1.2 * math.sin(t * 2.7)
    hby = 1.0 * math.sin(t * 2.6 + 0.5)
    # recent tap energy -> little hand bounce
    for tt, fi in taps:
        d = t - tt
        if -0.12 < d < 0.06:
            c = tap_curve(d)
            if FINGERS[fi][3] == 0: hfy -= 1.6 * c
            else: hby -= 1.4 * c
    # slam: both hands up high, then smash
    hfy -= 22 * lift; hby -= 16 * lift
    hfx -= 4 * lift
    dx -= M_HAND_F * hfx; dy -= M_HAND_F * hfy
    dx -= M_HAND_B * hbx; dy -= M_HAND_B * hby

    # --- individual finger taps
    for tt, fi in taps:
        d = t - tt
        if -0.12 < d < 0.07:
            c = tap_curve(d)
            amp = 9.0
            dy += M_FING[fi] * amp * c          # content moves up (lift)
            dx += M_FING[fi] * amp * 0.35 * c

    # --- head: slow sway + nod + reaction to slam
    th = 0.9 * math.sin(t * 2 * math.pi / 4.4) + 0.35 * math.sin(t * 2 * math.pi / 1.7 + 0.7)
    hx = 1.5 * math.sin(t * 0.9)
    hy = 1.0 * math.sin(t * 2 * math.pi / 3.6)
    if SLAM_T - SLAM_UP <= t < SLAM_T + 1.0:     # angry head: lean back, then nod hard
        u = t - (SLAM_T - SLAM_UP)
        th += -2.2 * math.sin(min(u / SLAM_UP, 1) * math.pi / 2) * (1 if t < SLAM_T else 0)
        if t >= SLAM_T:
            v = t - SLAM_T
            th += 3.0 * math.exp(-v * 6) * math.cos(v * 18) - 2.2 * math.exp(-v * 5) * 0
            hy += 5 * math.exp(-v * 6) * math.cos(v * 14)
    a = math.radians(th)
    px, py = HEAD_PIVOT
    # inverse rotation for backward mapping
    ca, sa = math.cos(-a), math.sin(-a)
    sx = ca * (XX - px) - sa * (YY - py) + px
    sy = sa * (XX - px) + ca * (YY - py) + py
    dx += M_HEAD * (sx - XX - hx)
    dy += M_HEAD * (sy - YY - hy)

    # --- breathing
    br = 1.8 * math.sin(t * 2 * math.pi / 3.8)
    dy -= M_TORSO * br * smoothstep(1000, 650, YY)

    mx = XX + dx; my = YY + dy

    # --- eye blinks: stretch the upper lid down over the eye
    bk = blink_amount(t)
    if bk > 0:
        for cx, top, lid, bot, hw in EYES:
            L = lid + (bot + 1 - lid) * bk               # current lid edge
            src_top = top - 10                           # lid skin band starts above eye
            y0, y1 = int(src_top), int(math.ceil(L)) + 1
            x0, x1 = cx - hw - 6, cx + hw + 7
            ys = np.arange(y0, y1, dtype=np.float32)[:, None]
            xs = np.arange(x0, x1, dtype=np.float32)[None, :]
            # horizontal elliptical falloff
            ex = np.clip(1 - ((xs - cx) / (hw + 4)) ** 2, 0, 1) ** 0.6
            band = lid - src_top
            ysrc = src_top + (ys - src_top) * band / max(L - src_top, 1e-3)
            ysrc = np.where(ys <= L, ysrc, ys)
            w = ex * (ys <= L)
            my[y0:y1, x0:x1] = my[y0:y1, x0:x1] * (1 - w) + (ysrc + dy[y0:y1, x0:x1]) * w

    frame = cv2.remap(img, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)

    # lash shadow line on blink
    if bk > 0.15:
        for cx, top, lid, bot, hw in EYES:
            L = lid + (bot + 1 - lid) * bk
            ov = np.zeros_like(frame[..., 0])
            cv2.ellipse(ov, (cx * 4, int(L * 4)), ((hw - 2) * 4, 3 * 4), 0, 0, 180, 1.0, -1,
                        cv2.LINE_AA, shift=2)
            ov = cv2.GaussianBlur(ov, (5, 5), 1.2) * 0.45 * bk
            frame *= (1 - ov[..., None] * 0.6)

    # --- clock second hand (ticks each second with tiny overshoot)
    sec = math.floor(t) + 12
    ft = t - math.floor(t)
    jit = 0.0 if ft > 0.12 else -0.25 * math.sin(ft / 0.12 * math.pi) * (1 - ft / 0.12)
    ang = (sec + min(ft / 0.05, 1) - 1 + jit + 1) * 6.0
    ang = math.radians(ang - 90)
    S = 4
    cx, cy = CLOCK_C
    ox = int((cx - CLOCK_R - 10)); oy = int((cy - CLOCK_R - 10))
    sz = int(2 * CLOCK_R + 20)
    layer = np.zeros((sz * S, sz * S), np.float32)
    lx, ly = (cx - ox) * S, (cy - oy) * S
    tip = (lx + math.cos(ang) * CLOCK_R * 0.86 * S, ly + math.sin(ang) * CLOCK_R * 0.86 * S)
    tail = (lx - math.cos(ang) * CLOCK_R * 0.2 * S, ly - math.sin(ang) * CLOCK_R * 0.2 * S)
    cv2.line(layer, (int(tail[0]), int(tail[1])), (int(tip[0]), int(tip[1])), 1.0, int(1.6 * S), cv2.LINE_AA)
    cv2.circle(layer, (int(lx), int(ly)), int(3.2 * S), 1.0, -1, cv2.LINE_AA)
    layer = cv2.resize(layer, (sz, sz), interpolation=cv2.INTER_AREA)[..., None]
    # soft shadow
    shadow = cv2.GaussianBlur(np.roll(np.roll(layer[..., 0], 2, 0), 1, 1), (7, 7), 2)[..., None] * 0.25
    reg = frame[oy:oy + sz, ox:ox + sz]
    reg *= (1 - shadow)
    red = np.array([40, 40, 205], np.float32)  # BGR
    reg[:] = reg * (1 - layer) + red * layer

    # --- camera: slow push-in + handheld drift + slam shake
    z = 1.035 + 0.075 * smoothstep(0, DUR, t)
    if t >= SLAM_T:                                  # punch-in on the smash
        z += 0.04 * math.exp(-(t - SLAM_T) * 4)
    fcx = 500 + 30 * smoothstep(0, DUR, t)          # drift toward the hands/face
    fcy = 860 + 40 * smoothstep(0, DUR, t)
    jx = 2.0 * math.sin(t * 0.7) + 1.2 * math.sin(t * 1.9 + 1)
    jy = 1.6 * math.sin(t * 0.9 + 2) + 1.0 * math.sin(t * 2.3)
    if shake > 0:
        jx += shake * 14 * math.sin(t * 91)
        jy += shake * 11 * math.sin(t * 77 + 1)
    # clamp so we never show outside the photo
    vw, vh = W / z, H / z
    fcx = min(max(fcx + jx, vw / 2), W - vw / 2)
    fcy = min(max(fcy + jy, vh / 2), H - vh / 2)
    s = OUT_W / vw
    Mx = np.array([[s, 0, OUT_W / 2 - s * fcx], [0, s, OUT_H / 2 - s * fcy]], np.float32)
    out = cv2.warpAffine(frame, Mx, (OUT_W, OUT_H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)

    # slam flash + subtle vignette
    if 0 <= t - SLAM_T < 0.15:
        out = out + (1 - (t - SLAM_T) / 0.15) * 35
    out = out * VIGNETTE
    return np.clip(out, 0, 255).astype(np.uint8)


vy, vx = np.mgrid[0:OUT_H, 0:OUT_W].astype(np.float32)
r = np.sqrt(((vx - OUT_W / 2) / (OUT_W * 0.75)) ** 2 + ((vy - OUT_H / 2) / (OUT_H * 0.75)) ** 2)
VIGNETTE = (1 - 0.28 * smoothstep(0.45, 1.0, r))[..., None].astype(np.float32)


# ---------------------------------------------------------------- audio
def make_audio(path):
    n = int(DUR * SR)
    a = np.zeros(n, np.float32)
    # room tone: brown-ish noise + faint city hum
    wn = rng.standard_normal(n).astype(np.float32)
    brown = np.cumsum(wn); brown -= np.convolve(brown, np.ones(4000) / 4000, mode="same")
    a += 0.004 * brown / (np.abs(brown).max() + 1e-6)
    a += 0.003 * wn * 0.3

    def add(sig, t0, gain):
        i = int(t0 * SR)
        if i >= n: return
        j = min(n, i + len(sig))
        a[i:j] += gain * sig[: j - i]

    def key_click(var):
        L = int(0.07 * SR); tt = np.arange(L) / SR
        noise = rng.standard_normal(L).astype(np.float32)
        # crude band-pass: diff of two lowpasses
        def lp(x, k):
            return np.convolve(x, np.ones(k) / k, mode="same")
        click = (lp(noise, 3) - lp(noise, 14)) * np.exp(-tt / (0.006 + 0.003 * var))
        thock = np.sin(2 * np.pi * (180 + 90 * var) * tt) * np.exp(-tt / 0.018)
        rel = np.zeros(L, np.float32)
        k = int(0.045 * SR)
        rel[k:] = (lp(noise, 4) - lp(noise, 12))[k:] * np.exp(-(tt[k:] - tt[k]) / 0.004) * 0.35
        return (click * 1.0 + thock * 0.35 + rel).astype(np.float32)

    for tt, fi in taps:
        add(key_click(rng.uniform()), tt, rng.uniform(0.18, 0.32))

    # clock ticks
    for s in range(int(DUR) + 1):
        L = int(0.03 * SR); tt = np.arange(L) / SR
        tick = np.sin(2 * np.pi * 2900 * tt) * np.exp(-tt / 0.0025) + 0.5 * rng.standard_normal(L) * np.exp(-tt / 0.0015)
        add(tick.astype(np.float32), s + 0.005, 0.035)

    # whoosh on lift + slam thud + keyboard rattle
    L = int(SLAM_UP * SR); tt = np.arange(L) / SR
    wh = rng.standard_normal(L) * np.sin(np.pi * tt / SLAM_UP) ** 2
    wh = np.convolve(wh, np.ones(30) / 30, mode="same")
    add(wh.astype(np.float32), SLAM_T - SLAM_UP, 0.5)
    L = int(0.9 * SR); tt = np.arange(L) / SR
    f = 55 + 70 * np.exp(-tt * 18)
    thud = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.16)
    crack = rng.standard_normal(L) * np.exp(-tt / 0.03)
    add((thud * 0.9 + crack * 0.35).astype(np.float32), SLAM_T, 0.9)
    for k in range(14):
        add(key_click(rng.uniform()), SLAM_T + rng.uniform(0, 0.05), rng.uniform(0.15, 0.35))
    for k in range(5):  # little rattles after
        add(key_click(rng.uniform()), SLAM_T + 0.08 + k * 0.045 + rng.uniform(0, 0.02), 0.12 * (1 - k / 5))

    # soft fades + normalise
    fade = int(0.25 * SR)
    a[:fade] *= np.linspace(0, 1, fade); a[-fade:] *= np.linspace(1, 0, fade)
    a = a / (np.abs(a).max() + 1e-6) * 0.89
    pcm = (a * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


# ---------------------------------------------------------------- main
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "preview":
        for tt in map(float, sys.argv[2:]):
            cv2.imwrite(os.path.join(HERE, f"prev_{tt:.2f}.png"), render(tt))
        sys.exit()

    wav = os.path.join(HERE, "_audio.wav")
    make_audio(wav)
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [ff, "-y", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{OUT_W}x{OUT_H}", "-r", str(FPS), "-i", "-",
           "-i", wav,
           "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
           "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    nf = int(DUR * FPS)
    for i in range(nf):
        p.stdin.write(render(i / FPS).tobytes())
        if i % 60 == 0:
            print(f"frame {i}/{nf}", flush=True)
    p.stdin.close(); p.wait()
    os.remove(wav)
    print("wrote", OUT)
