"""Music bed, SFX, ducking and mastering, built to the same timeline as the
picture. The voice is never processed: it only gets its chapter-card gaps
inserted, exactly where plan.py put the silent cards.

  python3 tools/longform/audio.py projects/cute-camera [--music-db -20]
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan as PLAN
from kit import clamp

FF = os.environ.get("FFMPEG") or __import__("imageio_ffmpeg").get_ffmpeg_exe()
SR = 48000


def load(path, sr=SR):
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def env_db(x, win=1024):
    n = max(1, len(x) // win)
    r = np.sqrt(np.mean(np.reshape(x[: n * win], (n, win)) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(r + 1e-9)


# ---------------------------------------------------------------- voice
def build_voice(P, cards):
    """Join the parts with the gaps align.py assumed, then cut the silent cards in."""
    t = json.load(open(os.path.join(P, "timing.json")))
    parts = t["parts"]
    segs, pos = [], 0.0
    for (f, off, total) in parts:
        a = load(os.path.join(P, "voice", f))
        segs.append((off, a))
    end = max(o + len(a) / SR for o, a in segs)
    n = int((end + 0.4) * SR)
    voice = np.zeros(n, np.float32)
    for off, a in segs:
        i = int(off * SR)
        voice[i:i + len(a)] += a
    # place the silent cards: walk the shifted timeline, cut a gap of `dur`
    # into the voice wherever a card begins
    pieces, cursor = [], 0
    shift = 0.0
    for c in cards:
        at_src = c["at"] - shift
        cut = int(max(cursor, at_src * SR))
        pieces.append(voice[cursor:cut])
        pieces.append(np.zeros(int(c["dur"] * SR), np.float32))
        cursor = cut
        shift += c["dur"]
    pieces.append(voice[cursor:])
    v = np.concatenate(pieces).astype(np.float32)
    return v, t


# ---------------------------------------------------------------- music
def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


CHORDS = {
    # Am - F - C - G, a bed that stays out of the way
    "am": [57, 60, 64, 69],
    "f": [53, 57, 60, 65],
    "c": [48, 55, 60, 64],
    "g": [55, 59, 62, 67],
}


def pluck(f, dur, sr=SR, amp=0.3, bright=0.6):
    n = int(dur * sr)
    t = np.arange(n) / sr
    env = np.exp(-t * 6.5) * (1 - np.exp(-t * 220))
    w = (np.sin(2 * np.pi * f * t) * 1.0 +
         np.sin(2 * np.pi * f * 2 * t) * 0.32 * bright +
         np.sin(2 * np.pi * f * 3 * t) * 0.14 * bright +
         np.sin(2 * np.pi * f * 4.01 * t) * 0.06 * bright)
    return (w * env * amp).astype(np.float32)


def pad(f, dur, sr=SR, amp=0.12):
    n = int(dur * sr)
    t = np.arange(n) / sr
    env = np.minimum(1, t / 0.6) * np.minimum(1, (dur - t) / 0.9)
    env = np.clip(env, 0, 1)
    w = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.005 * t + 0.4) +
         0.22 * np.sin(2 * np.pi * f * 2 * t))
    return (w * env * amp).astype(np.float32)


def music_bed(total, mood="business", sr=SR):
    n = int(total * sr)
    out = np.zeros(n, np.float32)
    order = ["am", "f", "c", "g"]
    bar = 60 / 92 * 4  # 92 bpm, 4 beats
    rng = np.random.default_rng(11)
    t = 0.0
    bar_i = 0
    while t < total - 0.2:
        ch = order[bar_i % 4]
        notes = CHORDS[ch]
        # 8-bar arrangement: bars 4-6 drop the high pluck and add a bass pulse
        sparse = (bar_i % 8) in (3, 4, 5)
        for k, m in enumerate(notes):
            f = midi(m + (12 if k == 3 and not sparse else 0))
            if sparse and k == 3:
                continue
            p = pluck(f, 1.5, sr, amp=0.10 if k < 3 else 0.055, bright=0.5)
            i = int((t + k * 0.0) * sr)
            j = min(len(out), i + len(p))
            out[i:j] += p[: j - i]
        if bar_i % 2 == 0:
            p = pad(midi(notes[0] - 12), bar * 0.98, sr, amp=0.075)
            i = int(t * sr)
            j = min(len(out), i + len(p))
            out[i:j] += p[: j - i]
        # soft heartbeat on the beat when sparse
        if sparse:
            for b in (0, 2):
                i = int((t + b * bar / 4) * sr)
                ln = int(0.22 * sr)
                tt = np.arange(ln) / sr
                kick = np.sin(2 * np.pi * (70 - 30 * tt) * tt) * np.exp(-tt * 22) * 0.13
                j = min(len(out), i + ln)
                out[i:j] += kick.astype(np.float32)[: j - i]
        t += bar
        bar_i += 1
    # gentle high shelf cut so it never fights the voice
    out = np.convolve(out, np.array([0.25, 0.5, 0.25], np.float32), mode="same")
    return out.astype(np.float32)


# ---------------------------------------------------------------- sfx
def sfx_pop(sr=SR, amp=0.16):
    t = np.arange(int(0.09 * sr)) / sr
    f = 620 + 900 * t / 0.09
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 45) * amp).astype(np.float32)


def sfx_stamp(sr=SR, amp=0.5):
    n = int(0.26 * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(3)
    thud = np.sin(2 * np.pi * 86 * t) * np.exp(-t * 26) * 0.9
    noise = rng.normal(0, 1, n).astype(np.float32) * np.exp(-t * 60) * 0.5
    return ((thud + noise) * amp).astype(np.float32)


def sfx_whoosh(sr=SR, amp=0.18, dur=0.34):
    n = int(dur * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(5)
    noise = rng.normal(0, 1, n).astype(np.float32)
    env = np.sin(np.pi * t / dur) ** 2
    k = np.exp(-((np.arange(n) - n * 0.55) ** 2) / (2 * (n * 0.12) ** 2))
    return (noise * env * k * amp).astype(np.float32)


def sfx_boom(sr=SR, amp=0.32, dur=1.1):
    n = int(dur * sr)
    t = np.arange(n) / sr
    f = 62 * np.exp(-t * 1.1) + 34
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 3.2) * amp).astype(np.float32)


def sfx_shutter(sr=SR, amp=0.30):
    a = sfx_stamp(sr, 1.0)
    b = np.zeros(int(0.14 * sr), np.float32)
    out = np.concatenate([a[: int(0.05 * sr)], b, a[: int(0.04 * sr)]])
    return (out * amp).astype(np.float32)


def sfx_tick(sr=SR, amp=0.10):
    n = int(0.05 * sr)
    t = np.arange(n) / sr
    return (np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 90) * amp).astype(np.float32)


def add(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i < 0 or i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def build_sfx(shots, total):
    buf = np.zeros(int(total * SR), np.float32)
    for s in shots:
        kind = s["kind"].__name__
        t0, t1 = s["s0"], s["s1"]
        if kind == "ChapterShot":
            add(buf, sfx_boom(), t0 + 0.02, 0.9)
            add(buf, sfx_whoosh(amp=0.22, dur=0.5), t0 - 0.1, 1.0)
            continue
        if kind == "PolaroidShot":
            add(buf, sfx_shutter(), t0 + 0.12, 1.0)
            add(buf, sfx_boom(amp=0.20, dur=1.6), t0 + 0.2, 0.8)
            continue
        kw = s["kw"]
        # label pops, cued from the shot's own words
        sh = None
        for spec in kw.get("labels", []):
            word = spec[2]
            at = _cue(kw.get("sents", []), word)
            if at is None:
                continue
            add(buf, sfx_pop(), at, 0.8)
        for spec in kw.get("stamp", []):
            word = spec[2]
            at = _cue(kw.get("sents", []), word)
            if at is None:
                continue
            add(buf, sfx_stamp(), at - 0.02, 1.0)
        for it in kw.get("items", []):
            if it[0] == "counter":
                word = it[4]
                at = _cue(kw.get("sents", []), word)
                if at is None:
                    continue
                for k in range(6):
                    add(buf, sfx_tick(), at + k * 0.11, 0.7 - k * 0.08)
            elif it[0] == "icon":
                word = it[4]
                at = _cue(kw.get("sents", []), word)
                if at is not None:
                    add(buf, sfx_pop(), at, 0.5)
        # a soft whoosh on every cut
        add(buf, sfx_whoosh(amp=0.05, dur=0.22), t0, 0.5)
    return buf


def _cue(sents, word):
    for s in sents:
        for w in s["text"].replace(",", " ").replace(".", " ").split():
            if w.strip("\"'?!;:“”").lower().startswith(word.lower()):
                return s["start"]
    return None


# ---------------------------------------------------------------- mix
def duck_env(voice, total, sr=SR, target_db=-19.0, floor=0.45):
    """Follow the voice with a slow envelope; music drops under speech."""
    n = int(total * sr)
    win = int(0.05 * sr)
    v = np.abs(voice[:n])
    pad = np.zeros(int(n / win + 2) * win, np.float32)
    pad[: len(v)] = v
    rms = np.sqrt(np.mean(pad.reshape(-1, win) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    speech = (db > -38).astype(np.float32)
    # smooth: attack 60 ms, release 400 ms
    k = np.empty_like(speech)
    a_att, a_rel = 0.25, 0.02
    acc = 0.0
    for i, s in enumerate(speech):
        a = a_att if s > acc else a_rel
        acc += (s - acc) * a
        k[i] = acc
    gain = 1.0 - k * (1.0 - floor)
    g = np.repeat(gain, win)[:n]
    if len(g) < n:
        g = np.pad(g, (0, n - len(g)), constant_values=gain[-1] if len(gain) else 1.0)
    return g.astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("P")
    ap.add_argument("--music-db", type=float, default=-20.0)
    ap.add_argument("--mood", default="business")
    a = ap.parse_args()
    P = a.P
    work = os.path.join(P, "work")
    os.makedirs(work, exist_ok=True)
    shots, cards, total, audio_end = PLAN.build_plan(P)

    voice, timing = build_voice(P, cards)
    n = int(total * SR)
    v = np.zeros(n, np.float32)
    v[: min(n, len(voice))] = voice[: min(n, len(voice))]
    v = v / (np.max(np.abs(v)) + 1e-9) * 0.85
    peak_before = 20 * np.log10(np.sqrt(np.mean(v ** 2)) + 1e-9)

    bed = music_bed(total, a.mood)
    bed = bed[:n] if len(bed) >= n else np.pad(bed, (0, n - len(bed)))
    duck = duck_env(v, total)
    music_gain = 10 ** (a.music_db / 20.0)
    bed = bed / (np.max(np.abs(bed)) + 1e-9) * 0.9 * music_gain * duck * 2.4

    sfx = build_sfx(shots, total)
    sfx = sfx / (np.max(np.abs(sfx)) + 1e-9) * 0.55

    mix = v + bed + sfx
    mix = np.tanh(mix * 1.12) * 0.92
    mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.94
    import soundfile as sf
    sf.write(os.path.join(work, "mix.wav"), mix.astype(np.float32), SR)
    print(f"voice rms {peak_before:.1f} dB  music {a.music_db} dB  total {total:.2f}s")
    print("mix ->", os.path.join(work, "mix.wav"))


if __name__ == "__main__":
    main()
