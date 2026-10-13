#!/usr/bin/env python3
"""Generates every sound effect and the music for BlockStrike Royale.

All audio is synthesised from scratch (noise, oscillators, envelopes), so it is 100% original.
Requires: numpy, soundfile.   Usage:  python3 tools/gen_audio.py  (from the blockstrike folder)
"""
import os
import numpy as np
import soundfile as sf

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "audio")
rng = np.random.default_rng(1337)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(dur, attack=0.005, decay=0.2, sustain=0.0):
    t = t_axis(dur)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.exp(-np.maximum(t - attack, 0) / max(decay, 1e-4))
    return a * (sustain + (1 - sustain) * d)


def noise(dur):
    return rng.uniform(-1, 1, int(SR * dur))


def lowpass(x, cutoff):
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc)
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def sine(freq, dur, phase=0.0):
    t = t_axis(dur)
    if callable(freq):
        f = freq(t)
        return np.sin(2 * np.pi * np.cumsum(f) / SR + phase)
    return np.sin(2 * np.pi * freq * t + phase)


def square(freq, dur, duty=0.5):
    t = t_axis(dur)
    return np.where((t * freq) % 1.0 < duty, 1.0, -1.0)


def tri(freq, dur):
    t = t_axis(dur)
    return 2 * np.abs(2 * ((t * freq) % 1.0) - 1) - 1


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[:len(p)] += p
    return out


def pad(x, dur):
    n = int(SR * dur)
    return np.concatenate([x, np.zeros(max(0, n - len(x)))])[:max(n, len(x))]


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1.0
    return x / m * peak


def soft_clip(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)


def echo(x, delay, gain, n=3):
    out = pad(x, len(x) / SR + delay * n)
    d = int(delay * SR)
    for k in range(1, n + 1):
        out[k * d:k * d + len(x)] += x * (gain ** k)
    return out


def save_wav(name, x, peak=0.9):
    path = os.path.join(OUT, name + ".wav")
    sf.write(path, norm(x, peak).astype(np.float32), SR, subtype="PCM_16")


def save_ogg(name, x, peak=0.85):
    path = os.path.join(OUT, name + ".ogg")
    sf.write(path, norm(x, peak).astype(np.float32), SR, format="OGG", subtype="VORBIS")


def loopable(x, fade=0.25):
    n = int(SR * fade)
    head, body = x[:n], x[n:]
    ramp = np.linspace(0, 1, n)
    body[-n:] = body[-n:] * (1 - ramp) + head * ramp
    return body


def gunshot(dur, body_hz, crack_cut, thump_hz, decay, tail=0.0):
    crack = highpass(noise(dur), crack_cut) * env(dur, 0.001, decay * 0.35)
    body = lowpass(noise(dur), body_hz) * env(dur, 0.002, decay)
    thump = sine(lambda t: thump_hz * (1 + 2 * np.exp(-t * 40)), dur) * env(dur, 0.001, decay * 0.8)
    x = soft_clip(crack * 0.8 + body * 1.4 + thump * 0.9, 2.2)
    if tail > 0:
        x = echo(x, tail, 0.25, 3)
    return x


def build_sfx():
    save_wav("shot_ar", gunshot(0.45, 1800, 2500, 90, 0.07, 0.09))
    save_wav("shot_smg", gunshot(0.3, 2400, 3000, 120, 0.045, 0.06))
    save_wav("shot_sg", gunshot(0.7, 1100, 1800, 60, 0.13, 0.11))
    save_wav("shot_sr", gunshot(1.1, 1500, 3500, 70, 0.11, 0.18))
    save_wav("shot_pistol", gunshot(0.35, 2000, 2800, 110, 0.05, 0.07))
    w = lowpass(noise(0.28), 1600) * np.sin(np.linspace(0, np.pi, int(SR * 0.28))) ** 2
    save_wav("swing", w, 0.6)
    save_wav("throw", lowpass(noise(0.22), 2200) * np.sin(np.linspace(0, np.pi, int(SR * 0.22))) ** 2, 0.55)
    save_wav("pin", mix(sine(3200, 0.05) * env(0.05, 0.001, 0.01), pad(sine(4100, 0.05) * env(0.05, 0.001, 0.012), 0.12)[::-1][::-1]), 0.5)
    boom = lowpass(noise(1.8), 500) * env(1.8, 0.004, 0.45) * 2.2 + sine(lambda t: 55 * (1 + np.exp(-t * 8)), 1.8) * env(1.8, 0.003, 0.5)
    save_wav("explosion", soft_clip(boom, 2.5))
    save_wav("smoke", lowpass(highpass(noise(1.4), 900), 4000) * env(1.4, 0.05, 0.6), 0.5)
    clk = lambda f: highpass(noise(0.05), 1500) * env(0.05, 0.001, 0.008) + sine(f, 0.05) * env(0.05, 0.001, 0.01) * 0.5
    r = np.zeros(int(SR * 0.9))
    for at, f in [(0.05, 900), (0.12, 1300), (0.55, 700), (0.62, 1500)]:
        c = clk(f)
        i = int(at * SR)
        r[i:i + len(c)] += c
    save_wav("reload", r, 0.55)
    save_wav("swap", mix(clk(1100), pad(np.zeros(1), 0.04), np.concatenate([np.zeros(int(0.07 * SR)), clk(1600)])), 0.5)
    chime = np.zeros(int(SR * 0.7))
    for k, f in enumerate([523, 659, 784, 1046]):
        s = sine(f, 0.4) * env(0.4, 0.005, 0.15)
        i = int(k * 0.07 * SR)
        chime[i:i + len(s)] += s
    save_wav("heal", chime, 0.5)
    save_wav("hit", highpass(noise(0.06), 2500) * env(0.06, 0.0005, 0.012) + sine(1800, 0.06) * env(0.06, 0.0005, 0.02) * 0.6, 0.55)
    save_wav("hit_head", sine(2600, 0.2) * env(0.2, 0.001, 0.06) + sine(3900, 0.2) * env(0.2, 0.001, 0.04) * 0.5, 0.6)
    k1 = sine(1320, 0.25) * env(0.25, 0.002, 0.08)
    k2 = sine(1760, 0.3) * env(0.3, 0.002, 0.12)
    save_wav("kill", mix(k1, np.concatenate([np.zeros(int(0.09 * SR)), k2])), 0.7)
    save_wav("knock", mix(lowpass(noise(0.2), 600) * env(0.2, 0.002, 0.05), np.concatenate([np.zeros(int(0.05 * SR)), sine(990, 0.25) * env(0.25, 0.002, 0.08)])), 0.65)
    save_wav("death", sine(lambda t: 440 * np.exp(-t * 1.6), 0.8) * env(0.8, 0.01, 0.35, 0.2) + square(110, 0.8) * env(0.8, 0.01, 0.3) * 0.15, 0.55)
    save_wav("pickup", sine(lambda t: 600 + 2400 * t, 0.13) * env(0.13, 0.002, 0.05), 0.5)
    save_wav("step", lowpass(noise(0.09), 450) * env(0.09, 0.002, 0.025), 0.5)
    save_wav("block", sine(lambda t: 320 * (1 + 0.5 * np.exp(-t * 60)), 0.16) * env(0.16, 0.001, 0.04) + lowpass(noise(0.16), 1500) * env(0.16, 0.001, 0.02), 0.6)
    sup = mix(lowpass(noise(1.2), 900) * env(1.2, 0.3, 0.5), np.concatenate([np.zeros(int(0.5 * SR)), (square(880, 0.12) * env(0.12, 0.002, 0.05)) * 0.3,
        np.zeros(int(0.06 * SR)), (square(1175, 0.18) * env(0.18, 0.002, 0.07)) * 0.3]))
    save_wav("supply", sup, 0.6)
    save_wav("click", sine(1400, 0.04) * env(0.04, 0.0005, 0.008) + highpass(noise(0.04), 3000) * env(0.04, 0.0005, 0.004) * 0.4, 0.45)
    coin = mix(sine(1568, 0.3) * env(0.3, 0.001, 0.08), np.concatenate([np.zeros(int(0.07 * SR)), sine(2093, 0.35) * env(0.35, 0.001, 0.12)]))
    save_wav("buy", coin, 0.6)
    lv = np.zeros(int(SR * 1.0))
    for k, f in enumerate([523, 659, 784, 1046, 1318]):
        s = (square(f, 0.3, 0.25) * 0.3 + sine(f, 0.3)) * env(0.3, 0.003, 0.12)
        i = int(k * 0.09 * SR)
        lv[i:i + len(s)] += s
    save_wav("levelup", lv, 0.6)
    fan = np.zeros(int(SR * 2.8))
    notes = [(0.0, 523, 0.18), (0.18, 659, 0.18), (0.36, 784, 0.18), (0.54, 1046, 0.5), (1.1, 880, 0.18), (1.28, 1046, 1.2)]
    for at, f, d in notes:
        s = (square(f, d + 0.3, 0.3) * 0.35 + tri(f, d + 0.3)) * env(d + 0.3, 0.004, d * 0.8, 0.3)
        i = int(at * SR)
        fan[i:i + len(s)] += s
    chord = (sine(261.6, 1.5) + sine(329.6, 1.5) + sine(392, 1.5)) * env(1.5, 0.05, 0.8, 0.4) * 0.5
    fan[int(1.28 * SR):int(1.28 * SR) + len(chord)] += chord
    save_wav("victory", fan, 0.75)
    df = np.zeros(int(SR * 1.8))
    for k, f in enumerate([392, 349, 311, 262]):
        s = (tri(f, 0.6) + square(f / 2, 0.6, 0.5) * 0.15) * env(0.6, 0.005, 0.3, 0.2)
        i = int(k * 0.3 * SR)
        df[i:i + len(s)] += s
    save_wav("defeat", df, 0.65)
    save_wav("countdown", square(880, 0.16, 0.5) * env(0.16, 0.002, 0.08) * 0.5, 0.5)
    save_wav("zone", sine(lambda t: 520 + 180 * np.sin(2 * np.pi * 3 * t), 1.0) * env(1.0, 0.05, 0.6, 0.5), 0.5)
    save_wav("chute", lowpass(noise(0.6), 1200) * (0.5 + 0.5 * np.abs(np.sin(np.linspace(0, 9 * np.pi, int(SR * 0.6))))) * env(0.6, 0.01, 0.3), 0.55)
    save_wav("error", square(130, 0.25, 0.5) * env(0.25, 0.002, 0.1) * 0.5, 0.45)
    wind = lowpass(noise(3.0), 500) * (0.7 + 0.3 * np.sin(np.linspace(0, 4 * np.pi, int(SR * 3.0))))
    save_ogg("wind", loopable(wind))
    t = t_axis(3.0)
    drone = (square(48, 3.0, 0.3) * 0.4 + sine(96, 3.0) * 0.6 + lowpass(noise(3.0), 300) * 0.5) * (0.8 + 0.2 * np.sin(2 * np.pi * 14 * t))
    save_ogg("plane", loopable(lowpass(drone, 900)))


def note_freq(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def build_music():
    bpm = 118
    beat = 60.0 / bpm
    bars = 16
    dur = bars * 4 * beat
    out = np.zeros(int(SR * dur) + SR)
    prog = [[48, 52, 55], [43, 47, 50], [45, 48, 52], [41, 45, 48]]  # C G Am F
    mrng = np.random.default_rng(2026)
    scale = [60, 62, 64, 67, 69, 72, 74, 76]
    idx = 3

    def put(sig, at):
        i = int(at * SR)
        out[i:i + len(sig)] += sig[:max(0, len(out) - i)]

    for bar in range(bars):
        ch = prog[bar % 4]
        b0 = bar * 4 * beat
        for k in range(8):
            f = note_freq(ch[0] - 12 + (12 if k % 2 else 0))
            put(tri(f, beat * 0.5) * env(beat * 0.5, 0.004, 0.15, 0.2) * 0.45, b0 + k * beat * 0.5)
        for k in range(4):
            for n in ch:
                put(square(note_freq(n), beat * 0.25, 0.25) * env(beat * 0.25, 0.003, 0.06) * 0.06, b0 + k * beat + beat * 0.5)
        if bar >= 2:
            pattern = [1, 0, 1, 1, 0, 1, 0, 1] if bar % 2 == 0 else [1, 1, 0, 1, 1, 0, 1, 0]
            for k in range(8):
                if pattern[k]:
                    idx = int(np.clip(idx + mrng.integers(-2, 3), 0, len(scale) - 1))
                    f = note_freq(scale[idx] + (12 if bar >= 8 and bar < 12 else 0))
                    length = beat * (0.5 if k < 7 else 0.9)
                    put((square(f, length, 0.5) * 0.25 + tri(f, length) * 0.5) * env(length, 0.005, length * 0.6, 0.3) * 0.32, b0 + k * beat * 0.5)
        for k in range(4):
            if k % 2 == 0:
                put(sine(lambda t: 120 * np.exp(-t * 18) + 40, 0.25) * env(0.25, 0.001, 0.1) * 0.9, b0 + k * beat)
            else:
                put(highpass(noise(0.18), 1200) * env(0.18, 0.001, 0.05) * 0.35, b0 + k * beat)
            put(highpass(noise(0.05), 6000) * env(0.05, 0.0005, 0.012) * 0.15, b0 + k * beat + beat * 0.5)
    out = out[:int(SR * dur)]
    save_ogg("music_menu", soft_clip(out * 0.9, 1.2), 0.7)
    t = t_axis(16.0)
    amb = lowpass(noise(16.0), 380) * 0.6 + sine(110, 16.0) * 0.05 * (1 + np.sin(2 * np.pi * 0.1 * t))
    save_ogg("music_match", loopable(amb, 1.0), 0.4)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    build_sfx()
    build_music()
    print("audio written to", os.path.abspath(OUT))
    for f in sorted(os.listdir(OUT)):
        print("  ", f, os.path.getsize(os.path.join(OUT, f)), "bytes")
