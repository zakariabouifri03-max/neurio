#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
"Lock the Clock" — documentary underscore + SFX, synthesised with numpy.

Reads tools/explainer/timeline.json (built by prepare_narration.py) so the bed
ducks under the narration and lands on scene boundaries, then mixes the narration
clips in and writes one 48 kHz stereo master.

  python3 tools/explainer/audio.py --timeline tools/explainer/timeline.json \
      --out tools/explainer/audio/master.wav
"""
import argparse
import json
import math

import numpy as np

SR = 48000
DUR = 60.0
N = int(SR * DUR)

rng = np.random.default_rng(11)

# key / tempo --------------------------------------------------------------
BPM = 70.0
BEAT = 60.0 / BPM
# D minor-ish documentary palette (root D2 ~73.42 Hz)
D2, F2, A2, C3, D3, G2 = 73.42, 87.31, 110.0, 130.81, 146.83, 98.00


def buf():
    return np.zeros(N, dtype=np.float32)


def add(M, t, sig, gain=1.0):
    a = int(t * SR)
    if a >= N:
        return
    n = min(N - a, len(sig))
    M[a:a + n] += sig[:n] * gain


# --- instruments ----------------------------------------------------------
def env_exp(n, a=0.005, rel=0.3):
    e = np.zeros(n, dtype=np.float32)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na) ** 2
    e[na:] = np.exp(-np.arange(n - na) / max(1, rel * SR))
    return e


def pad(n, f, det=0.0):
    t = np.arange(n) / SR
    f2 = f * (1 + det)
    s = (np.sin(2 * math.pi * f * t) * 0.55 +
         np.sin(2 * math.pi * f2 * t + 0.7) * 0.35 +
         np.sin(2 * math.pi * f * 2 * t) * 0.10)
    return s.astype(np.float32)


def sub_thump(f=50.0, dur=0.6, punch=0.4):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = f * (1 + punch * np.exp(-t * 20))
    ph = 2 * math.pi * (f0 * t - punch / 20 * np.exp(-t * 20))
    return (np.sin(ph) * np.exp(-t * 5)).astype(np.float32) * env_exp(n, 0.002, 0.4)


def tick(freq=2500, dur=0.03, bright=1.0):
    n = max(8, int(dur * SR))
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n) * 0.4
    s = (np.sin(2 * math.pi * freq * t) * 0.6 * bright + noise)
    return (s * np.exp(-t * 120)).astype(np.float32)


def whoosh(dur=0.7, f0=300, f1=3000, up=True, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    # sweep a bandpass by simple resonator of moving center freq
    fc = f0 * (f1 / f0) ** (np.linspace(0, 1, n) ** (1.6 if up else 0.7))
    if not up:
        fc = fc[::-1].copy()
    # cheap 1-pole bandpass: difference of lowpasses
    y = np.zeros(n, dtype=np.float32)
    a = np.exp(-2 * math.pi * (fc / SR) * 0.5)
    lo = np.zeros(n); lo2 = np.zeros(n)
    for i in range(1, n):
        lo[i] = a[i] * lo[i - 1] + (1 - a[i]) * noise[i]
    for i in range(1, n):
        lo2[i] = a[i] * lo2[i - 1] + (1 - a[i]) * lo[i]
    y = lo - lo2
    e = np.sin(np.linspace(0, math.pi, n)) ** 1.5
    return (y * e * gain * 3).astype(np.float32)


def riser(dur=1.4, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    # white-noise swell with rising high shelf
    hp = noise - np.convolve(noise, np.ones(24) / 24, 'same')
    e = (np.linspace(0, 1, n) ** 2.4)
    return (hp * e * gain).astype(np.float32)


def camera_click():
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    a = tick(3200, 0.02, 1.0)
    b = tick(1400, 0.03, 0.6)
    sig = np.zeros(n)
    sig[:len(a)] += a
    k = int(0.02 * SR)
    sig[k:k + len(b)] += b
    return sig.astype(np.float32)


def chime_good():
    t = np.arange(int(0.8 * SR)) / SR
    s = (np.sin(2 * math.pi * 587 * t) * 0.5 + np.sin(2 * math.pi * 880 * t) * 0.3)
    return (s * np.exp(-t * 4)).astype(np.float32)


def build(tl):
    M = buf()
    # ---- harmonic bed: chords per scene block (1-based chunk ranges) -----
    prog = [(1, 3, (D2, F2, A2)), (3, 5, (G2, D3, F2)),
            (5, 7, (D2, C3, A2)), (7, 9, (G2, F2, D3)),
            (9, 11, (D2, A2, D3))]
    starts = {c["i"]: c for c in tl["chunks"]}

    def span(a, b):
        s0 = starts[a]["start"]
        s1 = starts[b]["start"] if b in starts else tl["total"]
        return s0, min(s1, tl["total"])

    for a, b, chord in prog:
        s0, s1 = span(a, b)
        n = max(1, int((s1 - s0) * SR))
        for k, f in enumerate(chord):
            add(M, s0, pad(n, f, det=0.0015 * (k - 1)), 0.16 / (k + 1))

    # ---- sub pulse -------------------------------------------------------
    t = 0.0
    while t < DUR - 0.5:
        active = any(starts[c]["start"] <= t <= starts[c]["end"] for c in starts
                     if c in (1, 4, 5, 6, 7))
        add(M, t, sub_thump(48, 0.5, 0.5), 0.30 if active else 0.10)
        t += BEAT * 2

    # ---- clock ticks (hook + repeal) ------------------------------------
    for c in (1, 8):
        s, e = starts[c]["start"], starts[c]["end"]
        tt, i = s, 0
        while tt < e:
            add(M, tt, tick(2400 + (i % 2) * 500, 0.03, 1.0), 0.5)
            tt += BEAT / 2
            i += 1

    # ---- transitions / booms at boundaries ------------------------------
    for c in tl["chunks"]:
        s = c["start"]
        if c["i"] == 1:
            add(M, max(0, s - 0.15), whoosh(0.8, 200, 2400, True, 0.8), 0.8)
            add(M, s + 0.05, sub_thump(40, 0.8, 0.6), 0.9)
        else:
            add(M, s - 0.35, whoosh(0.5, 400, 2600, True, 0.5), 0.5)
            add(M, s, sub_thump(44, 0.6, 0.5), 0.5)
    # archival shutter accents
    for c in (2, 5, 9):
        add(M, starts[c]["start"] + 0.4, camera_click(), 0.6)
    # reveal risers
    add(M, starts[5]["start"] - 1.2, riser(1.4, 0.5), 0.6)
    add(M, starts[10]["start"] - 1.0, riser(1.2, 0.5), 0.6)
    # closing chime
    add(M, starts[10]["end"] + 0.2, chime_good(), 0.5)

    # ---- duck under narration -------------------------------------------
    duck = np.ones(N, dtype=np.float32)
    for c in tl["chunks"]:
        a = max(0, int((c["start"] - 0.12) * SR))
        b = min(N, int((c["end"] + 0.25) * SR))
        n = b - a
        e = np.ones(n)
        atk = min(n, int(0.1 * SR))
        rel = min(n, int(0.2 * SR))
        e[:atk] = np.linspace(1.0, 0.42, atk)
        e[atk:n - rel] = 0.42
        e[n - rel:] = np.linspace(0.42, 1.0, rel)
        duck[a:b] = np.minimum(duck[a:b], e)
    M *= duck
    return M


def _read_wav(path):
    import wave
    w = wave.open(path)
    n = w.getnframes()
    ch = w.getnchannels()
    sw = w.getsampwidth()
    sr = w.getframerate()
    data = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch == 2:
        data = data.reshape(-1, 2).mean(axis=1)
    return data, sr


def resample(sig, sr0, sr1):
    if sr0 == sr1:
        return sig
    n = int(len(sig) * sr1 / sr0)
    idx = np.linspace(0, len(sig) - 1, n)
    i0 = np.floor(idx).astype(int)
    i1 = np.minimum(i0 + 1, len(sig) - 1)
    f = idx - i0
    return sig[i0] * (1 - f) + sig[i1] * f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--narr", default=None)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    tl = json.load(open(args.timeline))
    M = build(tl)

    master = M.copy()
    narrdir = args.narr or tl.get("narrdir", "narr/proc")
    for c in tl["chunks"]:
        p = c.get("file")
        if not p:
            continue
        sig, sr = _read_wav(p)
        sig = resample(sig, sr, SR)
        add(master, c["start"], sig, 1.0)

    # gentle master glue: soft-clip + loudness-ish normalise
    master = np.tanh(master * 1.15) * 0.85
    peak = np.max(np.abs(master)) or 1
    master = master / peak * 0.92

    import wave
    w = wave.open(args.out, "wb")
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    st = np.stack([master, master], axis=1)
    w.writeframes((st * 32767).astype(np.int16).tobytes())
    w.close()
    print("wrote", args.out, f"{len(master)/SR:.2f}s peak {peak:.2f}")


if __name__ == "__main__":
    main()
