"""Synthesize the full 15s office soundtrack for the 'Busy?' monkey video.
Natural office ambience only: room tone, keyboard, footsteps, chair, cloth, breath,
plus the manager's single spoken word placed in the room. NO MUSIC.
"""
import numpy as np, subprocess, wave, os

SR = 48000
DUR = 15.0
N = int(round(SR * DUR))
OUT = "/home/user/neurio/output/audio"
os.makedirs(OUT, exist_ok=True)

import imageio_ffmpeg
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

rng = np.random.default_rng(20261006)

# stereo bed
buf = np.zeros((2, N), dtype=np.float64)
t_axis = np.arange(N) / SR


def add(sig, start, gain=1.0, pan=0.0):
    """pan: -1 left .. +1 right"""
    i = int(round(start * SR))
    if i < 0:
        sig = sig[-i:]
        i = 0
    if i >= N or len(sig) == 0:
        return
    n = min(len(sig), N - i)
    if n <= 0:
        return
    s = sig[:n]
    gl = gain * np.sqrt((1.0 - pan) / 2.0)
    gr = gain * np.sqrt((1.0 + pan) / 2.0)
    buf[0, i:i + n] += s * gl
    buf[1, i:i + n] += s * gr


def smooth_bandpass(sig, lo, hi, order=4.0):
    """Cheap smooth band-pass in the frequency domain."""
    S = np.fft.rfft(sig)
    f = np.fft.rfftfreq(len(sig), 1.0 / SR)
    m = 1.0 / (1.0 + (f / max(lo, 1e-6)) ** order)
    m *= 1.0 / (1.0 + (f / max(hi, 1e-6)) ** order)
    return np.fft.irfft(S * m, n=len(sig))


def env(n, attack, decay):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-5), 0, 1)
    return a * np.exp(-t / max(decay, 1e-5))


def pink(n, rng):
    w = rng.standard_normal(n)
    S = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1.0 / SR)
    f[0] = f[1]
    S /= np.sqrt(f)
    x = np.fft.irfft(S, n=n)
    return x / (np.max(np.abs(x)) + 1e-9)


# ---------------------------------------------------------------- room tone
for ch in range(2):
    rt = pink(N, rng)
    rt = smooth_bandpass(rt, 30, 900, 3.0)
    rt /= (np.max(np.abs(rt)) + 1e-9)
    buf[ch] += 0.021 * rt
    # faint electrical/AC hum
    buf[ch] += 0.0035 * np.sin(2 * np.pi * 100 * t_axis + ch)
    buf[ch] += 0.0016 * np.sin(2 * np.pi * 300 * t_axis + 1.1 * ch)
# very slow air movement swell
for ch in range(2):
    swell = 1.0 + 0.35 * np.sin(2 * np.pi * 0.037 * t_axis + 2.0 * ch)
    buf[ch] *= swell


# ---------------------------------------------------------------- keyboard
def keystroke(rng, hard=1.0):
    n = int(SR * 0.07)
    click = smooth_bandpass(rng.standard_normal(n), 1600, 6500, 3.0) * env(n, 0.0006, 0.0055)
    f0 = rng.uniform(150, 235)
    thock = np.sin(2 * np.pi * f0 * np.arange(n) / SR) * env(n, 0.0015, 0.020)
    body = smooth_bandpass(rng.standard_normal(n), 90, 420, 3.0) * env(n, 0.002, 0.028)
    return hard * (0.95 * click + 0.62 * thock + 0.30 * body)


def typing(dur, rate, gain, rng, start, pan=0.06, hard=1.0, pause_prob=0.07):
    """Scatter keystrokes over [start, start+dur] with human-ish timing."""
    t = 0.04
    while t < dur - 0.04:
        k = keystroke(rng, hard=hard * rng.uniform(0.8, 1.15))
        # keystrokes land on the desk slightly left of the camera mic
        add(k, start + t, gain * (0.9 + 0.2 * rng.random()), pan + rng.uniform(-0.06, 0.06))
        gap = (1.0 / rate) * rng.uniform(0.55, 1.55)
        if rng.random() < pause_prob:
            gap += rng.uniform(0.10, 0.38)
        t += gap


# 0-4s : relaxed, natural working pace
typing(3.55, 4.3, 0.205, rng, start=0.25, pause_prob=0.10)
# 4-7s : hears footsteps -> types much faster
typing(2.45, 8.4, 0.275, rng, start=4.15, pause_prob=0.03, hard=1.12)
# 7-10s : intense pretending
typing(2.5, 9.2, 0.265, rng, start=7.05, pause_prob=0.02, hard=1.15)
# 10-12s: stops typing entirely
# 12-15s: frozen / deadpan - still no typing


# ---------------------------------------------------------------- footsteps
def footstep(rng, weight=1.0):
    n = int(SR * 0.4)
    heel = smooth_bandpass(rng.standard_normal(n), 55, 850, 3.0) * env(n, 0.004, 0.030)
    tap = smooth_bandpass(rng.standard_normal(n), 900, 3200, 3.0) * env(n, 0.001, 0.010)
    return weight * (0.95 * heel + 0.22 * tap)


def walk(times, gain, rng, pan_from, pan_to):
    for i, tt in enumerate(times):
        k = i / max(1, len(times) - 1)
        pan = pan_from + (pan_to - pan_from) * k
        add(footstep(rng, weight=0.9 + 0.25 * rng.random()), tt, gain, pan)


# manager approaches (behind, right of frame), 4-6s
walk([4.62, 5.02, 5.42], 0.145, rng, 0.55, 0.30)
# walks past the desk 7-9s
walk([7.30, 7.72], 0.175, rng, 0.25, -0.10)
# walks away 8.4-9.9s
walk([8.40, 8.85, 9.30], 0.115, rng, -0.25, -0.55)
# quietly returns at 12s, then stands still beside the desk
walk([12.06, 12.30, 12.54], 0.125, rng, -0.45, -0.15)


# ---------------------------------------------------------------- chair, cloth, breath
def chair_creak(rng, dur=0.85, lo=260, hi=1500):
    n = int(SR * dur)
    x = smooth_bandpass(rng.standard_normal(n), lo, hi, 3.0)
    e = np.hanning(n) ** 1.4
    am = 1.0 + 0.5 * np.sin(2 * np.pi * 7.5 * np.arange(n) / SR + rng.uniform(0, 6))
    y = x * e * am
    return y / (np.max(np.abs(y)) + 1e-9)


# sitting up straighter at 4s, leaning back at 10.2s, small shift at 13.6s
add(chair_creak(rng, 0.55, 300, 1700), 4.02, 0.055, -0.10)
add(chair_creak(rng, 0.95, 220, 1300), 10.16, 0.085, -0.05)
add(chair_creak(rng, 0.40, 320, 1600), 13.62, 0.045, -0.05)


def cloth(rng, dur=0.30, lo=900, hi=5200):
    n = int(SR * dur)
    x = smooth_bandpass(rng.standard_normal(n), lo, hi, 3.0)
    e = np.hanning(n) ** 1.2
    return (x * e) / (np.max(np.abs(x * e)) + 1e-9)


add(cloth(rng, 0.45), 10.22, 0.020, -0.05)   # jacket/shirt rustle as he leans back
add(cloth(rng, 0.30), 4.05, 0.014, -0.05)    # straightening the tie
add(cloth(rng, 0.25), 13.60, 0.011, -0.05)


def breath(rng, dur=0.7, lo=350, hi=1900, inhale=False):
    n = int(SR * dur)
    x = smooth_bandpass(rng.standard_normal(n), lo, hi, 2.5)
    if inhale:
        e = np.clip(np.arange(n) / (0.7 * n), 0, 1) ** 1.5 * np.exp(-np.arange(n) / (2.2 * n))
    else:
        e = np.clip(np.arange(n) / (0.12 * n), 0, 1) * np.exp(-np.arange(n) / (0.5 * n))
    y = x * e
    return y / (np.max(np.abs(y)) + 1e-9)


add(breath(rng, 0.75, inhale=False), 10.55, 0.030, -0.04)  # tired exhale after the manager leaves
add(breath(rng, 0.60, inhale=True), 12.60, 0.020, -0.04)   # sharp quiet inhale when he notices


# ---------------------------------------------------------------- manager's line
speech_path = "/home/user/neurio/output/audio/manager_busy.mp3"
SPEECH_AT = 13.05
if os.path.exists(speech_path):
    raw = subprocess.run(
        [FFMPEG, "-v", "error", "-i", speech_path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True,
    ).stdout
    sp = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    # trim leading/trailing near-silence so the word lands exactly on the beat
    a = np.abs(sp)
    if len(sp):
        thr = max(1e-4, 0.012 * a.max())
        idx = np.where(a > thr)[0]
        if len(idx):
            sp = sp[max(0, idx[0] - int(0.03 * SR)): min(len(sp), idx[-1] + int(0.06 * SR))]
        sp = sp / (np.max(np.abs(sp)) + 1e-9) * 0.85
        # short room reverb so the voice sits in the office
        rt = int(0.26 * SR)
        ir = rng.standard_normal(rt) * np.exp(-np.arange(rt) / (0.055 * SR))
        ir = smooth_bandpass(ir, 120, 6000, 2.5)
        ir /= np.sqrt(np.sum(ir ** 2))
        wet = np.convolve(sp, ir)[: len(sp) + 0]
        wet = wet / (np.max(np.abs(wet)) + 1e-9)
        voice = 0.94 * sp + 0.13 * wet
        add(voice, SPEECH_AT, 0.80, pan=0.10)
    else:
        print("!! speech file empty")
else:
    print("!! no speech file found, soundtrack has no voice")

# ---------------------------------------------------------------- master
peak = np.max(np.abs(buf))
buf = buf * (0.92 / peak)
# gentle soft-clip glue + very light high-shelf soften
buf = np.tanh(buf * 1.05) / np.tanh(1.05)

out_wav = os.path.join(OUT, "office_ambience.wav")
data = (np.clip(buf, -1, 1).T * 32767.0).astype("<i2")
with wave.open(out_wav, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
print("wrote", out_wav, "peak", float(np.max(np.abs(buf))))
