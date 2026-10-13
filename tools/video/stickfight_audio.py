#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
STICK RIVALS — 60 s fight soundtrack + SFX, synthesised with numpy.

Reuses the instrument primitives from audio.py and times every impact / whoosh /
clang to the exact moments in stickfight.HITS / WHOOSHES, so picture and sound
land together.

  python3 tools/video/stickfight_audio.py --out /tmp/fight.wav
"""
import argparse

import numpy as np

import audio as A            # the racing soundtrack's synth toolkit (SR, kick, ...)
from stickfight import HITS, WHOOSHES

SR = A.SR


def clang(amp=0.7):
    """metallic block/clash."""
    n = int(0.4 * SR)
    x = (A.sine(1250, n) * A.expdec(n, 0.12)
         + A.sine(1870, n) * A.expdec(n, 0.09)
         + 0.5 * A.sine(830, n) * A.expdec(n, 0.16))
    x += A.hp(A.rng.normal(0, 1, n), 3000) * A.expdec(n, 0.05) * 0.4
    return (x * amp).astype(np.float32)


def thump(amp=0.6):
    """soft body-thud under a landed hit."""
    n = int(0.25 * SR)
    x = A.sine(90, n) * A.expdec(n, 0.10)
    return (x * amp).astype(np.float32)


def intensity(bar):
    """percussion intensity 0..1 across the 25 bars of the fight."""
    pts = [(0, 0.0), (1, 0.15), (4, 0.35), (7, 0.6), (10, 0.7),
           (13, 0.85), (16, 1.0), (19, 1.0), (20, 0.55), (22, 0.5), (24, 0.4)]
    for i in range(len(pts) - 1):
        b0, v0 = pts[i]
        b1, v1 = pts[i + 1]
        if b0 <= bar <= b1:
            return v0 + (v1 - v0) * (bar - b0) / max(1e-6, (b1 - b0))
    return pts[-1][1]


def build():
    L, R = A.buf()
    BPM = 100.0
    BEAT = 60.0 / BPM
    BAR = BEAT * 4

    # --- low tension drone (A) humming under the whole fight ---
    A.add(L, R, 0.0, A.pad([55.0, 110.0, 164.81], int(60 * SR), amp=0.20, cut=900), 0.0)

    # --- percussive bed ---
    NBARS = 25
    root = 55.0
    for bar in range(NBARS):
        t0 = bar * BAR
        it = intensity(bar)
        if it <= 0.02:
            continue
        # bass pulse on the root
        A.add(L, R, t0, A.bass(root, int(BEAT * 1.6 * SR), amp=0.55 * it, cut=420), 0.0)
        # kick
        A.add(L, R, t0 + 0.0 * BEAT, A.kick(0.9 * it), 0.0)
        A.add(L, R, t0 + 2.0 * BEAT, A.kick(0.9 * it), 0.0)
        if it > 0.5:
            A.add(L, R, t0 + 3.5 * BEAT, A.kick(0.5 * it), 0.0)
        # snare / clap on 2 & 4
        A.add(L, R, t0 + 1.0 * BEAT, A.clap(0.7 * it), 0.12)
        A.add(L, R, t0 + 3.0 * BEAT, A.clap(0.7 * it), -0.12)
        # hats on eighths
        for e in range(8):
            pan = 0.25 if e % 2 else -0.25
            A.add(L, R, t0 + e * 0.5 * BEAT, A.hat(0.22 * it, long=(e % 2 == 1)), pan)
        # tension: push the root up to G in the climax bars
        if 13 <= bar <= 18 and bar % 2 == 1:
            A.add(L, R, t0 + 2.0 * BEAT, A.bass(49.0, int(BEAT * 1.2 * SR),
                                                amp=0.4 * it, cut=460), 0.0)

    # --- whooshes (whiffing strikes + the wind-up of every landed hit) ---
    for (tw, att, kind) in WHOOSHES:
        A.add(L, R, tw - 0.05, A.whoosh(dur=0.3, amp=0.45, f0=500, f1=2400),
              0.2 if att == "blaze" else -0.2)
    for (tl, victim, part, s, word, dmg, sfx) in HITS:
        pan = 0.3 if victim == "blaze" else -0.3
        A.add(L, R, tl - 0.17, A.whoosh(dur=0.22, amp=0.30 + 0.15 * s, f0=600, f1=2600), pan)

    # --- impacts, timed to each landed hit ---
    for (tl, victim, part, s, word, dmg, sfx) in HITS:
        pan = 0.28 if victim == "blaze" else -0.28
        if sfx == "impact_light":
            A.add(L, R, tl, A.impact(0.6 * (0.6 + s)), pan)
            A.add(L, R, tl, thump(0.4), pan)
        elif sfx == "impact":
            A.add(L, R, tl, A.impact(0.85), pan)
            A.add(L, R, tl, thump(0.5), pan)
        elif sfx == "impact_heavy":
            A.add(L, R, tl, A.impact(1.0), pan)
            A.add(L, R, tl, A.kick(0.8), 0.0)
            A.add(L, R, tl, thump(0.6), pan)
        elif sfx == "clang":
            A.add(L, R, tl, clang(0.8), pan)
            A.add(L, R, tl, A.impact(0.4), 0.0)
        elif sfx == "finisher":
            A.add(L, R, tl, A.impact(1.0), pan)
            A.add(L, R, tl, A.kick(1.0), 0.0)
            A.add(L, R, tl, A.crash(0.5), 0.0)
            A.add(L, R, tl, thump(0.7), pan)
            A.add(L, R, tl + 0.05, clang(0.5), 0.1)

    # --- riser into the finisher (45.0 -> 47.0) ---
    A.add(L, R, 45.0, A.sweep_up(dur=1.9, f0=160, f1=1500, amp=0.22), 0.0)
    A.add(L, R, 46.4, A.whoosh(dur=0.8, amp=0.5, f0=300, f1=3000), 0.0)

    # --- crowd ---
    A.add(L, R, 0.4, A.cheer(dur=3.0, amp=0.22), 0.0)        # intro swell
    A.add(L, R, 27.3, A.cheer(dur=2.0, amp=0.20), 0.0)       # after the takedown
    A.add(L, R, 40.3, A.cheer(dur=2.4, amp=0.26), 0.0)       # after the big uppercut
    A.add(L, R, 53.2, A.cheer(dur=5.5, amp=0.42), 0.0)       # victory roar
    A.add(L, R, 53.3, A.crash(0.4), 0.0)

    stereo = np.stack([L, R], axis=0)
    peak = float(np.max(np.abs(stereo)))
    if peak > 0.98:
        stereo *= 0.98 / peak
    return stereo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/fight.wav")
    a = ap.parse_args()
    m = build()
    A.write_wav(a.out, m)
    print("wrote", a.out, m.shape, "peak", float(np.max(np.abs(m))))


if __name__ == "__main__":
    main()
