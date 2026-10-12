#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bash Baqi Racing — 60 s soundtrack + SFX, synthesised from scratch with numpy.

  python3 tools/video/audio.py --out out/track.wav
"""
import argparse
import math

import numpy as np

SR = 44100
DUR = 60.0
N = int(SR * DUR)

rng = np.random.default_rng(7)


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def buf():
    return np.zeros(N, dtype=np.float32), np.zeros(N, dtype=np.float32)


def idx(t, dur):
    a = int(t * SR)
    b = min(N, a + int(dur * SR))
    if a >= N or b <= a:
        return None, None
    return a, b


def add(L, R, t, sig, pan=0.0):
    a, b = idx(t, len(sig) / SR)
    if a is None:
        return
    n = b - a
    g = 0.5 * (1 - pan), 0.5 * (1 + pan)
    L[a:b] += sig[:n] * g[0] * 2
    R[a:b] += sig[:n] * g[1] * 2


def env(n, a=0.005, d=0.2, s=0.0, r=0.1, sus=0.0):
    """simple ADSR-ish envelope of n samples"""
    e = np.zeros(n, dtype=np.float32)
    na = max(1, int(a * SR))
    nd = max(1, int(d * SR))
    nr = max(1, int(r * SR))
    ns = max(0, n - na - nd - nr)
    k = 0
    e[k:k + na] = np.linspace(0, 1, na)
    k += na
    if ns > 0:
        e[k:k + nd] = np.linspace(1, sus, nd) if sus > 0 else np.linspace(1, 0, nd)
        k += nd
        e[k:k + ns] = sus
        k += ns
    e[k:k + nr] = np.linspace(e[k - 1] if k > 0 else 1, 0, min(nr, n - k))
    return e


def expdec(n, tau):
    return np.exp(-np.arange(n) / (tau * SR)).astype(np.float32)


def lp(x, cutoff):
    """one-pole low-pass (vectorised via simple recursion in numpy)"""
    if cutoff >= SR / 2.2:
        return x
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    # python loop over blocks is too slow; use scipy-free trick: recursive filter
    from numpy import float32
    b = 1 - a
    # implement with lfilter-style loop in C via np.convolve? -> use cumulative trick
    # y[n] = a*y[n-1] + b*x[n]  =>  y = b * conv(x, a^n)  (truncated)
    k = int(min(len(x), 6 * SR / max(cutoff, 1)))
    ker = b * (a ** np.arange(k, dtype=np.float64))
    y = np.convolve(x.astype(np.float64), ker, mode="full")[:len(x)]
    return y.astype(np.float32)


def hp(x, cutoff):
    return x - lp(x, cutoff)


def saw(freq, n, detune=0.0):
    tt = np.arange(n, dtype=np.float32) / SR
    f = freq * (1 + detune)
    return (2 * ((tt * f) % 1.0) - 1).astype(np.float32)


def sq(freq, n, duty=0.5):
    tt = np.arange(n, dtype=np.float32) / SR
    return np.where((tt * freq) % 1.0 < duty, 1.0, -1.0).astype(np.float32)


def tri(freq, n):
    tt = np.arange(n, dtype=np.float32) / SR
    ph = (tt * freq) % 1.0
    return (4 * np.abs(ph - 0.5) - 1).astype(np.float32)


def sine(freq, n):
    tt = np.arange(n, dtype=np.float32) / SR
    return np.sin(2 * math.pi * freq * tt).astype(np.float32)


NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7,
        "G#": 8, "A": 9, "A#": 10, "B": 11}


def f_of(name):
    if name == "-":
        return 0.0
    p = NOTE[name[:-1]]
    octv = int(name[-1])
    midi = 12 * (octv + 1) + p
    return 440.0 * 2 ** ((midi - 69) / 12)


# ----------------------------------------------------------------------------
# instruments
# ----------------------------------------------------------------------------
def kick(amp=1.0):
    n = int(0.38 * SR)
    tt = np.arange(n) / SR
    f = 46 + 92 * np.exp(-tt * 42)
    ph = 2 * math.pi * np.cumsum(f) / SR
    body = np.sin(ph) * expdec(n, 0.115)
    click = rng.normal(0, 1, n) * expdec(n, 0.004) * 0.35
    return ((body + click) * amp * 0.95).astype(np.float32)


def clap(amp=1.0):
    n = int(0.22 * SR)
    x = rng.normal(0, 1, n)
    x = hp(x, 900)
    e = np.zeros(n, dtype=np.float32)
    for off, g in ((0.0, 0.55), (0.008, 0.7), (0.017, 0.85), (0.03, 1.0)):
        k = int(off * SR)
        e[k:] += expdec(n - k, 0.055) * g
    return (x * e * amp * 0.55).astype(np.float32)


def hat(amp=0.4, long=False):
    n = int((0.14 if long else 0.055) * SR)
    x = hp(rng.normal(0, 1, n), 7000)
    return (x * expdec(n, 0.02 if not long else 0.06) * amp).astype(np.float32)


def crash(amp=0.5):
    n = int(1.7 * SR)
    x = hp(rng.normal(0, 1, n), 4500)
    return (x * expdec(n, 0.55) * amp).astype(np.float32)


def bass(freq, n, amp=0.6, cut=520):
    x = 0.6 * saw(freq, n) + 0.4 * sq(freq, n, 0.5)
    x = lp(x, cut)
    e = np.ones(n, dtype=np.float32)
    aa = min(n, int(0.006 * SR))
    e[:aa] = np.linspace(0, 1, aa)
    e[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
    return (x * e * amp).astype(np.float32)


def pluck(freq, n, amp=0.35):
    x = 0.5 * tri(freq, n) + 0.3 * saw(freq, n, 0.004) + 0.2 * sine(freq * 2, n)
    x = lp(x, 2600)
    e = expdec(n, 0.17)
    aa = min(n, int(0.004 * SR))
    e[:aa] *= np.linspace(0, 1, aa)
    return (x * e * amp).astype(np.float32)


def pad(freqs, n, amp=0.16, cut=1500):
    x = np.zeros(n, dtype=np.float32)
    for f in freqs:
        for det in (-0.006, 0.0, 0.007):
            x += saw(f, n, det)
    x /= (3 * len(freqs))
    x = lp(x, cut)
    e = np.ones(n, dtype=np.float32)
    na = min(n, int(0.25 * SR))
    nr = min(n, int(0.4 * SR))
    e[:na] = np.linspace(0, 1, na) ** 1.4
    e[-nr:] *= np.linspace(1, 0, nr)
    return (x * e * amp).astype(np.float32)


def whoosh(dur=0.9, amp=0.5, f0=400, f1=2600):
    n = int(dur * SR)
    x = rng.normal(0, 1, n)
    tt = np.arange(n) / SR
    # fake band sweep: mix two static filters with crossfading weights
    a = lp(x, 900) * (1 - tt / dur)
    b = hp(lp(x, f1), 700) * (tt / dur)
    m = a + b
    env_ = np.sin(np.pi * (tt / dur) ** 0.9) ** 1.2
    sweep = sine(300, n) * np.linspace(0, 0.25, n)
    return ((m * env_ * amp) + sweep * env_).astype(np.float32)


def impact(amp=0.9):
    n = int(0.6 * SR)
    tt = np.arange(n) / SR
    f = 60 * np.exp(-tt * 6) + 28
    ph = 2 * math.pi * np.cumsum(f) / SR
    body = np.sin(ph) * expdec(n, 0.22)
    noise = lp(rng.normal(0, 1, n), 400) * expdec(n, 0.09)
    return ((body + 0.6 * noise) * amp).astype(np.float32)


def chime(freqs, amp=0.3, step=0.075):
    out = np.zeros(int((0.6 + step * len(freqs)) * SR), dtype=np.float32)
    for i, f in enumerate(freqs):
        n = int(0.6 * SR)
        s = (sine(f, n) + 0.35 * sine(f * 2.01, n)) * expdec(n, 0.22) * amp
        k = int(i * step * SR)
        out[k:k + n] += s
    return out


def cheer(dur=3.2, amp=0.32):
    n = int(dur * SR)
    x = lp(rng.normal(0, 1, n), 3200)
    x = hp(x, 500)
    tt = np.arange(n) / SR
    env_ = np.clip(np.sin(np.pi * (tt / dur) ** 0.7), 0, 1) ** 0.8
    flutter = 0.65 + 0.35 * np.sin(2 * math.pi * 7.5 * tt + 3 * np.sin(2 * math.pi * 2.2 * tt))
    return (x * env_ * flutter * amp).astype(np.float32)


def firework(amp=0.5):
    n = int(0.9 * SR)
    body = hp(rng.normal(0, 1, n), 1800) * expdec(n, 0.13)
    thud = sine(70, n) * expdec(n, 0.06)
    return ((body + 0.5 * thud) * amp).astype(np.float32)


def engine(dur, amp=0.16, f0=104):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    wob = 1 + 0.045 * np.sin(2 * math.pi * 5.5 * tt) + 0.02 * np.sin(2 * math.pi * 11.3 * tt)
    ph = 2 * math.pi * np.cumsum(f0 * wob) / SR
    x = 0.55 * np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.12 * saw(f0 * wob, n) * 0.4
    x += 0.10 * lp(rng.normal(0, 1, n), 900)
    e = np.ones(n, dtype=np.float32)
    aa = min(n, int(0.35 * SR))
    e[:aa] = np.linspace(0, 1, aa)
    e[-aa:] *= np.linspace(1, 0, aa)
    return (x * e * amp).astype(np.float32)


def sweep_up(dur=1.2, f0=180, f1=1400, amp=0.22):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (tt / dur)
    ph = 2 * math.pi * np.cumsum(f) / SR
    e = np.linspace(0, 1, n) ** 1.5
    return ((np.sin(ph) * 0.7 + saw(f, n) * 0.15) * e * amp).astype(np.float32)


# ----------------------------------------------------------------------------
# arrangement
# ----------------------------------------------------------------------------
BPM = 124.0
BEAT = 60.0 / BPM              # 0.4839 s
BAR = BEAT * 4                 # 1.9355 s

CHORDS = {                     # bar index -> (root, triad)
    "C": ("C2", ["C4", "E4", "G4"]),
    "G": ("G2", ["G3", "B3", "D4"]),
    "Am": ("A2", ["A3", "C4", "E4"]),
    "F": ("F2", ["F3", "A3", "C4"]),
}
PROG = ["C", "G", "Am", "F"] * 8     # 32 bars ≈ 62 s, we only use what fits


def bar_chord(i):
    return CHORDS[PROG[i % len(PROG)]]


MELODY = [   # (beat, length, note) over one 4-beat bar, A-minor pentatonic-ish
    (0.0, 0.5, "E5"), (0.5, 0.5, "G5"), (1.0, 0.5, "A5"), (1.5, 0.5, "G5"),
    (2.0, 1.0, "E5"), (3.0, 0.5, "D5"), (3.5, 0.5, "C5"),
]
MELODY_B = [
    (0.0, 0.75, "A5"), (0.75, 0.25, "G5"), (1.0, 1.0, "E5"), (2.0, 0.5, "G5"),
    (2.5, 0.5, "A5"), (3.0, 1.0, "C6"),
]
LEAD_FINALE = [
    (0.0, 1.0, "C6"), (1.0, 1.0, "B5"), (2.0, 1.0, "A5"), (3.0, 1.0, "G5"),
    (4.0, 1.0, "A5"), (5.0, 1.0, "C6"), (6.0, 2.0, "E6"),
]


def build():
    L, R = buf()

    # ---------------- music ----------------
    t_music = 0.0
    bar = 0
    while t_music < DUR - 0.2:
        bt = t_music
        name = PROG[bar % len(PROG)]
        root, triad = CHORDS[name]
        intro = bt < 5.8
        drop = 5.8 <= bt < 17.9          # full groove (drive scene)
        build_up = 17.9 <= bt < 21.5      # snare roll into the jump
        quiet = 21.5 <= bt < 25.2         # airborne, music thin
        full2 = 25.2 <= bt < 41.6         # race
        final = 41.6 <= bt < 51.6          # finish / triumph
        outro = bt >= 51.6

        if not intro and not quiet:
            # kick on 1 & 3 (four-on-the-floor in the loud sections)
            for b in range(4):
                if (b % 2 == 0) or final or full2:
                    add(L, R, bt + b * BEAT, kick(0.9 if b == 0 else 0.75), 0)
            # claps on 2 & 4
            for b in (1, 3):
                add(L, R, bt + b * BEAT, clap(0.8), 0.05)
            # hats on 8ths
            for i in range(8):
                amp = 0.20 if i % 2 else 0.12
                add(L, R, bt + i * BEAT / 2, hat(amp, long=(i % 2 == 1)), 0.18)
            # bass: root on 8ths, octave hops
            patt = [0, 0, 12, 0, 7, 0, 12, 0]
            for i, semi in enumerate(patt):
                f = f_of(root) * 2 ** (semi / 12)
                add(L, R, bt + i * BEAT / 2, bass(f, int(BEAT / 2 * SR * 0.95), 0.5, 560), 0)
            # chord stabs on off-beats
            for i in (1, 2, 3):
                if i == 2 and bar % 2 == 0:
                    continue
                s = pad([f_of(x) for x in triad], int(BEAT * 0.42 * SR), 0.10, 1900)
                add(L, R, bt + i * BEAT + BEAT / 2, s, -0.15)
        elif intro:
            # soft pad + rising plucks
            s = pad([f_of(x) for x in triad], int(BAR * SR), 0.13, 1200)
            add(L, R, bt, s, 0)
            if bt > 2.0:
                for i in range(4):
                    f = f_of(triad[i % 3]) * 2
                    add(L, R, bt + i * BEAT / 2, pluck(f, int(0.4 * SR), 0.14), -0.3)
        else:  # quiet (airborne)
            s = pad([f_of(x) for x in triad], int(BAR * SR), 0.10, 900)
            add(L, R, bt, s, 0)
            for i in range(2):
                add(L, R, bt + i * BEAT * 2, pluck(f_of(triad[i % 3]) * 2, int(0.5 * SR), 0.13), 0.3)

        # melody
        if drop or full2 or final:
            mel = MELODY_B if (bar % 4 == 3) else MELODY
            if final:
                mel = LEAD_FINALE if bar % 4 == 3 else MELODY
            for (bpos, blen, nm) in mel:
                n = int(blen * BEAT * SR * 0.92)
                gain = 0.20 if full2 or drop else 0.22
                add(L, R, bt + bpos * BEAT, pluck(f_of(nm), n, gain), -0.22)

        # snare roll build
        if build_up:
            k = (bt - 17.9) / 3.6
            for i in range(16):
                sub = i / 16.0
                if rng.random() < 0.35 + 0.6 * k * sub:
                    add(L, R, bt + i * BEAT / 4, clap(0.18 + 0.4 * k), 0.0)
        # crashes on section starts
        if abs(bt - 5.8) < 0.01 or abs(bt - 25.6) < 0.01 or abs(bt - 41.6) < 0.01:
            add(L, R, bt, crash(0.45), 0)

        t_music += BAR
        bar += 1

    # intro pad riser
    add(L, R, 0.0, pad([f_of("A3"), f_of("C4"), f_of("E4")], int(5.6 * SR), 0.12, 1000), 0)
    add(L, R, 4.2, sweep_up(1.5, 160, 1800, 0.20), 0)

    # final chord + outro pad
    s = pad([f_of("C4"), f_of("E4"), f_of("G4"), f_of("C5")], int(7.0 * SR), 0.20, 1700)
    add(L, R, 51.6, s, 0)
    add(L, R, 51.6, chime([f_of("C5"), f_of("E5"), f_of("G5"), f_of("C6")], 0.22, 0.16), 0.1)

    # ---------------- sfx ----------------
    add(L, R, 0.05, whoosh(1.1, 0.42, 300, 1800), 0)
    add(L, R, 0.85, chime([f_of("C5"), f_of("G5")], 0.18, 0.09), 0)
    add(L, R, 5.5, whoosh(0.9, 0.34), -0.1)

    # engine drone through the driving scenes
    for t0, dur, amp in ((6.2, 11.4, 0.12), (18.6, 3.1, 0.14), (22.2, 2.9, 0.07),
                         (30.3, 11.0, 0.13), (42.2, 2.6, 0.13), (52.4, 2.0, 0.06)):
        add(L, R, t0, engine(dur, amp, f0=98 + 12 * math.sin(t0)), 0.0)
    add(L, R, 11.4, engine(1.4, 0.16, f0=126), 0)

    # jump: take-off, air, landing
    add(L, R, 21.4, sweep_up(1.4, 200, 2200, 0.22), 0)
    add(L, R, 21.6, whoosh(1.0, 0.4), 0)
    add(L, R, 25.6, impact(0.95), 0)
    add(L, R, 25.6, crash(0.36), 0.1)
    add(L, R, 25.9, whoosh(0.7, 0.28), -0.2)

    # item box pickup + turbo
    add(L, R, 33.35, chime([f_of("E5"), f_of("G5"), f_of("B5"), f_of("E6")], 0.26, 0.07), -0.15)
    add(L, R, 33.9, whoosh(1.3, 0.5, 200, 3200), 0)
    add(L, R, 33.9, sweep_up(1.2, 240, 2600, 0.24), 0.2)
    add(L, R, 40.3, whoosh(0.8, 0.3), -0.2)

    # finish: crowd + fanfare + fireworks
    add(L, R, 45.1, cheer(4.6, 0.34), 0)
    add(L, R, 45.15, crash(0.34), -0.1)
    add(L, R, 45.3, chime([f_of("C5"), f_of("E5"), f_of("G5"), f_of("C6"), f_of("E6")], 0.30, 0.12), 0)
    for k, tt in enumerate((46.0, 46.7, 47.4, 48.2, 49.0)):
        add(L, R, tt, firework(0.32), (-1) ** k * 0.25)

    # whoosh into the outro
    add(L, R, 51.3, whoosh(1.0, 0.3, 500, 1400), 0.1)

    # ---------------- master ----------------
    master = np.stack([L, R])
    master = np.tanh(master * 1.12)                     # soft clip / glue
    # tame the top end (synthesised noise is hissy) and give the mix some body
    master[0] = lp(master[0], 11000)
    master[1] = lp(master[1], 11000)
    # gentle high shelf cut + dc block
    master = master - master.mean(axis=1, keepdims=True)
    peak = np.max(np.abs(master))
    master = master / max(peak, 1e-6) * 0.89
    # 200 ms fade in / 900 ms fade out
    nf = int(0.2 * SR)
    master[:, :nf] *= np.linspace(0, 1, nf)
    nf2 = int(0.9 * SR)
    master[:, -nf2:] *= np.linspace(1, 0, nf2) ** 1.3
    return master


def write_wav(path, stereo):
    import wave
    data = (np.clip(stereo.T, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/track.wav")
    a = ap.parse_args()
    m = build()
    write_wav(a.out, m)
    print("wrote", a.out, m.shape, "peak", float(np.max(np.abs(m))))


if __name__ == "__main__":
    main()
