#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Midnight Monkey Cuddle — 15 s bedroom ambience, synthesised from scratch.

No music, no dialogue.  Only what the room would sound like:

  * low room tone (brown noise, rolled off, with a slow draft drift)
  * two sets of soft, slightly out-of-phase sleeping breaths (him left, her right)
  * three tiny blanket/fleece shifts, timed to the picture cuts
  * a couple of very quiet, distant macaque "coo" sounds

    python3 tools/monkey-cuddle/audio.py --out /tmp/amb.wav
"""
from __future__ import annotations

import argparse
import wave

import numpy as np

SR = 48000
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(20261030)


# ---------------------------------------------------------------------------
# dsp helpers
# ---------------------------------------------------------------------------
def spectral(x: np.ndarray, lo: float, hi: float, slope: float = 0.35) -> np.ndarray:
    """smooth band-pass-ish mask applied in the frequency domain"""
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    m = np.ones_like(f)
    if lo > 0:
        m *= 1.0 / (1.0 + (lo / np.maximum(f, 1e-6)) ** (2 * slope * 4))
    if hi < SR / 2:
        m *= 1.0 / (1.0 + (f / hi) ** (2 * slope * 4))
    return np.fft.irfft(X * m, n)


def brown(n: int) -> np.ndarray:
    w = rng.normal(0, 1, n)
    b = np.cumsum(w)
    b -= np.linspace(b[0], b[-1], n)
    return b / (np.abs(b).max() + 1e-9)


def env_ad(n: int, attack: float, decay: float, curve: float = 1.6) -> np.ndarray:
    a = max(1, int(attack * SR))
    e = np.zeros(n, dtype=np.float64)
    e[:a] = np.linspace(0, 1, a) ** 1.2
    d = n - a
    if d > 0:
        e[a:] = np.exp(-np.linspace(0, 1, d) * (5.0 / max(decay, 0.05))) ** curve
    return e


def place(L, R, t, sig, pan=0.0, gain=1.0):
    a = int(t * SR)
    if a >= N:
        return
    b = min(N, a + len(sig))
    s = sig[: b - a] * gain
    L[a:b] += s * np.sqrt(0.5 * (1 - pan))
    R[a:b] += s * np.sqrt(0.5 * (1 + pan))


# ---------------------------------------------------------------------------
# layers
# ---------------------------------------------------------------------------
def room_tone() -> tuple[np.ndarray, np.ndarray]:
    base = spectral(brown(N), 18, 190, 0.5)
    base /= np.abs(base).max()
    draft = 0.55 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.031 * np.arange(N) / SR - 0.7))
    base *= draft
    air = spectral(rng.normal(0, 1, N), 2200, 9000, 0.4)
    air /= np.abs(air).max()
    l = base * 0.85 + air * 0.055
    r = np.roll(base, 311) * 0.85 + np.roll(air, 733) * 0.055
    return l, r


def breath(t0: float, dur_in: float, dur_out: float, bright: float):
    """one soft nasal breath: filtered noise, inhale then exhale"""
    n = int((dur_in + 0.10 + dur_out) * SR)
    noise = spectral(rng.normal(0, 1, n), 220 * bright, 1500 * bright, 0.42)
    noise /= np.abs(noise).max() + 1e-9
    e = np.zeros(n)
    a = int(dur_in * SR)
    e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2.0
    g = int(0.10 * SR)
    hold = np.linspace(1.0, 0.55, g)
    e[a:a + g] = hold
    b = min(n, a + g + int(dur_out * SR))
    e[a + g:b] = 0.55 * np.exp(-np.linspace(0, 1, b - a - g) * 3.2)
    return noise * e * env_ad(n, 0.001, 0.0001)[:n] if False else noise * e


def breathing(L, R, t_start: float, period: float, pan: float, gain: float,
              jitter: float):
    t = t_start
    while t < DUR - 0.4:
        j = rng.normal(0, jitter)
        p = period * (1.0 + j)
        place(L, R, t, breath(t, 0.42 * p, 0.50 * p, 1.0 + 0.25 * rng.normal()),
              pan=pan, gain=gain * (1.0 + 0.10 * rng.normal()))
        t += p * (1.0 + 0.05 * rng.normal())


def blanket(L, R, t, gain=1.0, pan=0.0):
    n = int(0.55 * SR)
    nz = spectral(rng.normal(0, 1, n), 900, 7200, 0.45)
    nz /= np.abs(nz).max() + 1e-9
    a = max(1, int(0.045 * SR))
    e = np.exp(-np.linspace(0, 1, n) * 4.2)
    e[:a] *= np.linspace(0, 1, a)
    # fine fleece "chatter"
    chat = spectral(rng.normal(0, 1, n), 2600, 9500, 0.4)
    chat /= np.abs(chat).max() + 1e-9
    chat *= np.exp(-np.linspace(0, 1, n) * 9.0)
    place(L, R, t, nz * e + 0.5 * chat, pan=pan, gain=gain)


def coo(L, R, t, f0=225.0, gain=1.0, pan=-0.15):
    """a quiet, distant macaque coo: glided tone + harmonics + a breathy edge"""
    d = 0.62
    n = int(d * SR)
    tt = np.arange(n) / SR
    vib = 1.0 + 0.018 * np.sin(2 * np.pi * 6.2 * tt + 0.4)
    gl = f0 * (1.0 + 0.16 * np.sin(np.pi * np.minimum(tt / d, 1.0)) ** 1.4) * vib
    ph = 2 * np.pi * np.cumsum(gl) / SR
    tone = np.sin(ph) + 0.36 * np.sin(2 * ph + 0.5) + 0.16 * np.sin(3 * ph + 1.1) + 0.08 * np.sin(4 * ph)
    tone *= np.exp(-np.linspace(0, 1, n) * 2.4) * env_ad(n, 0.055, 0.5)
    hiss = spectral(rng.normal(0, 1, n), 900, 3200, 0.4)
    hiss /= np.abs(hiss).max() + 1e-9
    hiss *= np.exp(-np.linspace(0, 1, n) * 6.0) * 0.35
    place(L, R, t, tone * 0.9 + hiss, pan=pan, gain=gain)


# ---------------------------------------------------------------------------
def build() -> tuple[np.ndarray, np.ndarray]:
    L, R = room_tone()
    L *= 0.055
    R *= 0.055

    # him (left, slower, deeper), her (right, a touch quicker and lighter)
    breathing(L, R, 0.55, 3.72, pan=-0.34, gain=0.030, jitter=0.045)
    breathing(L, R, 1.35, 3.35, pan=0.30, gain=0.024, jitter=0.05)

    # fleece shifts, aligned with the picture beats
    blanket(L, R, 2.92, 0.050, -0.10)
    blanket(L, R, 3.42, 0.028, 0.20)
    blanket(L, R, 6.05, 0.045, 0.26)
    blanket(L, R, 6.62, 0.022, 0.32)
    blanket(L, R, 9.02, 0.038, -0.05)
    blanket(L, R, 11.95, 0.044, 0.10)
    blanket(L, R, 12.55, 0.020, -0.18)

    # two distant, contented sounds
    coo(L, R, 4.15, 214.0, 0.030, -0.22)
    coo(L, R, 10.35, 246.0, 0.021, 0.26)

    mix = np.stack([L, R], 1)
    mix = np.tanh(mix * 1.15) / 1.15          # gentle, inaudible limiting
    mix *= 0.5 * 10 ** (-3.0 / 20) / (np.abs(mix).max() + 1e-9)
    # 40 ms fade in/out so nothing clicks
    f = int(0.04 * SR)
    mix[:f] *= np.linspace(0, 1, f)[:, None]
    mix[-f:] *= np.linspace(1, 0, f)[:, None]
    return mix[:, 0], mix[:, 1]


def write_wav(path: str, L: np.ndarray, R: np.ndarray):
    data = np.stack([L, R], 1)
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/amb.wav")
    a = ap.parse_args()
    L, R = build()
    write_wav(a.out, L, R)
    print("wrote", a.out, f"peak {np.abs(np.stack([L,R],1)).max():.3f}")
