#!/usr/bin/env python3
"""Original audio generator for BlockStrike Royale.

Every sound effect and music loop in the game is synthesised from scratch by
this script (no sample libraries, no third-party audio).  It implements a small
signal-processing toolkit: oscillators, noise, envelopes, one-pole filters,
soft saturation, a Schroeder reverb and a tiny step sequencer for the music.

Output: blockstrike-royale/assets/audio/*.wav   (16-bit PCM, 22.05 kHz mono)

Usage:
    python3 tools/assets/gen_audio.py [--out DIR] [--only name ...] [--list]
"""
from __future__ import annotations

import argparse
import math
import os
import struct
import wave

SR = 22050


# --------------------------------------------------------------------------- #
#  DSP toolkit
# --------------------------------------------------------------------------- #
class Buf:
    """Simple float mono buffer."""

    def __init__(self, seconds: float = 0.0) -> None:
        self.data = [0.0] * max(1, int(seconds * SR))

    def __len__(self) -> int:
        return len(self.data)

    def add(self, other: "Buf", at: float = 0.0, gain: float = 1.0) -> None:
        start = int(at * SR)
        need = start + len(other)
        if need > len(self.data):
            self.data.extend([0.0] * (need - len(self.data)))
        for i, sample in enumerate(other.data):
            self.data[start + i] += sample * gain

    def mix_into(self, index: int, value: float) -> None:
        if 0 <= index < len(self.data):
            self.data[index] += value


def osc(freq: float, dur: float, wave_kind: str = "sine", detune: float = 0.0,
        vibrato: float = 0.0) -> Buf:
    buf = Buf(dur)
    phase = 0.0
    phase2 = 0.0
    for i in range(len(buf)):
        t = i / SR
        f = freq * (1.0 + vibrato * math.sin(2 * math.pi * 5.0 * t))
        phase += f / SR
        phase2 += (f * (1.0 + detune)) / SR
        a = phase % 1.0
        b = phase2 % 1.0
        if wave_kind == "sine":
            v = math.sin(2 * math.pi * a) + 0.5 * detune * math.sin(2 * math.pi * b)
        elif wave_kind == "saw":
            v = (2.0 * a - 1.0) + detune * (2.0 * b - 1.0)
        elif wave_kind == "square":
            v = (1.0 if a < 0.5 else -1.0) + detune * (1.0 if b < 0.5 else -1.0)
        elif wave_kind == "tri":
            v = 4.0 * abs(a - 0.5) - 1.0
        else:
            v = math.sin(2 * math.pi * a)
        buf.data[i] = v * 0.5
    return buf


class Rng:
    def __init__(self, seed: int) -> None:
        self.s = seed & 0x7FFFFFFF or 1

    def next(self) -> float:
        self.s = (1103515245 * self.s + 12345) & 0x7FFFFFFF
        return (self.s / 0x7FFFFFFF) * 2.0 - 1.0


def noise(dur: float, seed: int = 1) -> Buf:
    rng = Rng(seed)
    buf = Buf(dur)
    for i in range(len(buf)):
        buf.data[i] = rng.next()
    return buf


def env(buf: Buf, attack: float, decay: float, sustain: float = 0.0,
        release: float = 0.0, curve: float = 2.0) -> Buf:
    """ADSR-ish amplitude envelope, times in seconds."""
    n = len(buf)
    a = max(1, int(attack * SR))
    d = max(1, int(decay * SR))
    r = max(1, int(release * SR))
    s_start = a + d
    r_start = max(s_start, n - r)
    for i in range(n):
        if i < a:
            g = (i / a) ** 0.6
        elif i < s_start:
            g = 1.0 - (1.0 - sustain) * ((i - a) / d) ** curve
        elif i < r_start:
            g = sustain
        else:
            g = max(0.0, sustain * (1.0 - (i - r_start) / r))
        buf.data[i] *= g
    return buf


def expdecay(buf: Buf, half_life: float) -> Buf:
    k = math.log(0.5) / max(1e-4, half_life)
    for i in range(len(buf)):
        buf.data[i] *= math.exp(k * (i / SR))
    return buf


def lowpass(buf: Buf, cutoff: float, resonance: float = 0.0) -> Buf:
    dt = 1.0 / SR
    rc = 1.0 / (2 * math.pi * max(20.0, cutoff))
    alpha = dt / (rc + dt)
    out = 0.0
    for i, v in enumerate(buf.data):
        out += alpha * (v - out)
        buf.data[i] = out * (1.0 + resonance * 0.4)
    return buf


def highpass(buf: Buf, cutoff: float) -> Buf:
    dt = 1.0 / SR
    rc = 1.0 / (2 * math.pi * max(20.0, cutoff))
    alpha = rc / (rc + dt)
    prev_in = 0.0
    prev_out = 0.0
    for i, v in enumerate(buf.data):
        prev_out = alpha * (prev_out + v - prev_in)
        prev_in = v
        buf.data[i] = prev_out
    return buf


def sweep_filter(buf: Buf, start: float, end: float, resonance: float = 0.0) -> Buf:
    dt = 1.0 / SR
    out = 0.0
    n = len(buf)
    for i, v in enumerate(buf.data):
        cutoff = start + (end - start) * (i / max(1, n - 1))
        rc = 1.0 / (2 * math.pi * max(20.0, cutoff))
        alpha = dt / (rc + dt)
        out += alpha * (v - out)
        buf.data[i] = out * (1.0 + resonance * 0.3)
    return buf


def saturate(buf: Buf, drive: float = 1.6) -> Buf:
    for i, v in enumerate(buf.data):
        buf.data[i] = math.tanh(v * drive)
    return buf


def reverb(buf: Buf, mix: float = 0.3, decay: float = 0.5, seed: int = 3) -> Buf:
    """Tiny Schroeder reverb: 4 combs + 2 allpass, cheap but convincing."""
    combs = [(int(0.0297 * SR), 0.805), (int(0.0371 * SR), 0.827),
             (int(0.0411 * SR), 0.783), (int(0.0437 * SR), 0.764)]
    allpass = [(int(0.005 * SR), 0.7), (int(0.0017 * SR), 0.7)]
    wet = list(buf.data) + [0.0] * int(0.6 * SR)
    acc = [0.0] * len(wet)
    for size, feedback in combs:
        delay = [0.0] * size
        idx = 0
        for i in range(len(wet)):
            out = delay[idx]
            acc[i] += out * 0.25
            delay[idx] = wet[i] + out * feedback
            idx = (idx + 1) % size
    for size, gain in allpass:
        delay = [0.0] * size
        idx = 0
        for i in range(len(acc)):
            bufout = delay[idx]
            acc[i] = -gain * acc[i] + bufout
            delay[idx] = acc[i] * gain + bufout
            idx = (idx + 1) % size
    out = Buf(0)
    out.data = [0.0] * len(wet)
    for i in range(len(wet)):
        src = buf.data[i] if i < len(buf) else 0.0
        out.data[i] = src * (1.0 - mix) + acc[i] * mix * (decay * 3.0)
    return out


def normalize(buf: Buf, peak: float = 0.9) -> Buf:
    top = max((abs(v) for v in buf.data), default=0.0)
    if top < 1e-6:
        return buf
    k = peak / top
    for i in range(len(buf.data)):
        buf.data[i] *= k
    return buf


def fade(buf: Buf, fade_in: float = 0.003, fade_out: float = 0.02) -> Buf:
    a = int(fade_in * SR)
    b = int(fade_out * SR)
    n = len(buf)
    for i in range(min(a, n)):
        buf.data[i] *= i / max(1, a)
    for i in range(min(b, n)):
        buf.data[n - 1 - i] *= i / max(1, b)
    return buf


def mix(*buffers: Buf) -> Buf:
    out = Buf(0)
    out.data = [0.0] * max(len(b) for b in buffers)
    for b in buffers:
        for i, v in enumerate(b.data):
            out.data[i] += v
    return out


def track(path: str, buf: Buf, peak: float = 0.85) -> None:
    normalize(buf, peak)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(SR)
        frames = bytearray()
        for v in buf.data:
            s = int(max(-1.0, min(1.0, v)) * 32767)
            frames += struct.pack("<h", s)
        fh.writeframes(bytes(frames))


# --------------------------------------------------------------------------- #
#  Sound effects
# --------------------------------------------------------------------------- #
def sfx_gun(dur: float, body_freq: float, noise_hz: float, crack: float, seed: int,
            tail: float = 0.0) -> Buf:
    body = osc(body_freq, dur, "sine")
    expdecay(body, dur * 0.18)
    hiss = noise(dur, seed)
    sweep_filter(hiss, noise_hz, noise_hz * 0.28, resonance=0.5)
    expdecay(hiss, dur * 0.25)
    click = noise(0.012, seed + 5)
    highpass(click, 3500)
    expdecay(click, 0.004)
    out = mix(body, hiss, click)
    if crack > 0:
        cr = noise(min(0.05, dur), seed + 9)
        highpass(cr, 2000)
        expdecay(cr, 0.02)
        out.add(cr, 0.0, crack)
    saturate(out, 1.4)
    res = reverb(out, mix=0.18 if tail == 0 else tail, decay=0.35, seed=seed)
    trim = int((dur + 0.1) * SR)
    res.data = res.data[:trim]
    return fade(res, 0.001, 0.03)


def sfx_reload(seed: int) -> Buf:
    """Magazine out, in, and a charging handle clack."""
    out = Buf(0.75)
    for i, (t, pitch, dur) in enumerate([(0.02, 900, 0.05), (0.26, 620, 0.07),
                                         (0.5, 1200, 0.06), (0.62, 1500, 0.05)]):
        click = noise(dur, seed + i)
        lowpass(click, pitch, resonance=0.6)
        highpass(click, pitch * 0.35)
        expdecay(click, dur * 0.30)
        out.add(click, t, 0.8)
    metal = osc(480, 0.2, "tri")
    expdecay(metal, 0.05)
    out.add(metal, 0.26, 0.12)
    return fade(out)


def sfx_impact(kind: str, seed: int) -> Buf:
    if kind == "metal":
        out = Buf(0.35)
        for harmonic in (1.0, 2.7, 4.1, 5.9):
            tone = osc(1200 * harmonic, 0.3, "sine")
            expdecay(tone, 0.05 / harmonic)
            out.add(tone, 0.0, 0.35 / harmonic)
        tick = noise(0.02, seed)
        highpass(tick, 4000)
        expdecay(tick, 0.006)
        out.add(tick, 0.0, 0.5)
        return fade(out)
    if kind == "stone":
        out = noise(0.12, seed)
        lowpass(out, 2600, resonance=0.4)
        expdecay(out, 0.02)
        tone = osc(180, 0.1, "sine")
        expdecay(tone, 0.03)
        return fade(mix(out, tone))
    # generic
    out = noise(0.15, seed)
    lowpass(out, 1400, resonance=0.3)
    expdecay(out, 0.03)
    return fade(out)


def sfx_footstep(surface: str, seed: int) -> Buf:
    out = noise(0.09, seed)
    if surface == "grass":
        lowpass(out, 1800, resonance=0.3)
        expdecay(out, 0.012)
    elif surface == "wood":
        lowpass(out, 1200, resonance=0.5)
        expdecay(out, 0.018)
        tone = osc(150, 0.06, "tri")
        expdecay(tone, 0.02)
        out = mix(out, tone)
    elif surface == "stone":
        lowpass(out, 3200, resonance=0.4)
        expdecay(out, 0.010)
    elif surface == "water":
        lowpass(out, 900, resonance=0.6)
        expdecay(out, 0.03)
    elif surface == "snow":
        highpass(out, 900)
        lowpass(out, 5000)
        expdecay(out, 0.010)
    else:
        expdecay(out, 0.015)
    return fade(out, 0.001, 0.01)


def sfx_ui(kind: str) -> Buf:
    if kind == "click":
        return fade(env(osc(880, 0.07, "sine"), 0.002, 0.05), 0.001, 0.02)
    if kind == "back":
        return fade(env(osc(520, 0.09, "sine"), 0.002, 0.07), 0.001, 0.02)
    if kind == "confirm":
        a = env(osc(660, 0.10, "sine"), 0.002, 0.09)
        b = env(osc(990, 0.14, "sine"), 0.01, 0.12)
        return fade(mix(a, b))
    if kind == "error":
        a = env(osc(220, 0.16, "square"), 0.002, 0.14)
        b = env(osc(180, 0.18, "square"), 0.01, 0.16)
        return fade(mix(a, b), 0.001, 0.02)
    if kind == "purchase":
        out = Buf(0.6)
        for i, f in enumerate((660, 880, 1180, 1560)):
            out.add(env(osc(f, 0.3, "tri"), 0.002, 0.2), i * 0.07, 0.6)
        return fade(out)
    if kind == "coin":
        a = env(osc(1400, 0.06, "sine"), 0.001, 0.05)
        b = env(osc(2100, 0.12, "sine"), 0.01, 0.10)
        return fade(mix(a, b))
    if kind == "gem":
        out = Buf(0.5)
        for i, f in enumerate((1200, 1600, 2100)):
            out.add(env(osc(f, 0.25, "sine"), 0.002, 0.2), i * 0.05, 0.5)
        return fade(reverb(out, 0.25, 0.3))
    if kind == "hit":
        a = env(osc(1600, 0.05, "sine"), 0.001, 0.04)
        b = env(osc(2400, 0.04, "sine"), 0.001, 0.03)
        return fade(mix(a, b), 0.0005, 0.01)
    if kind == "headshot":
        out = Buf(0.3)
        out.add(env(osc(2200, 0.08, "sine"), 0.001, 0.06), 0.0, 0.7)
        out.add(env(osc(3000, 0.10, "sine"), 0.002, 0.08), 0.06, 0.6)
        return fade(out, 0.0005, 0.02)
    raise KeyError(kind)


def sfx_explosion(seed: int) -> Buf:
    dur = 1.6
    rumble = noise(dur, seed)
    lowpass(rumble, 220, resonance=0.6)
    expdecay(rumble, 0.35)
    crack = noise(0.25, seed + 2)
    sweep_filter(crack, 6000, 400, resonance=0.5)
    expdecay(crack, 0.06)
    sub = osc(52, 0.8, "sine")
    expdecay(sub, 0.22)
    out = mix(rumble, crack, sub)
    saturate(out, 1.3)
    return fade(reverb(out, mix=0.35, decay=0.6), 0.002, 0.2)


def sfx_whoosh(seed: int, dur: float = 0.45, up: bool = False) -> Buf:
    out = noise(dur, seed)
    if up:
        sweep_filter(out, 300, 2600, resonance=0.5)
    else:
        sweep_filter(out, 2600, 300, resonance=0.5)
    env(out, 0.05, dur * 0.5, sustain=0.25, release=dur * 0.45)
    return fade(out)


def sfx_jump() -> Buf:
    out = osc(300, 0.18, "sine", vibrato=0.4)
    for i in range(len(out)):
        out.data[i] *= math.exp(-3.0 * i / SR * 10)
    return fade(mix(out, env(noise(0.1, 12), 0.005, 0.09)), 0.001, 0.02)


def sfx_land() -> Buf:
    out = noise(0.16, 21)
    lowpass(out, 700, resonance=0.5)
    expdecay(out, 0.03)
    thud = osc(90, 0.16, "sine")
    expdecay(thud, 0.05)
    return fade(mix(out, thud))


def sfx_pickup() -> Buf:
    out = Buf(0.35)
    for i, f in enumerate((700, 1050, 1400)):
        out.add(env(osc(f, 0.18, "tri"), 0.002, 0.12), i * 0.045, 0.5)
    return fade(out)


def sfx_zone_warning() -> Buf:
    out = Buf(1.6)
    for i in range(2):
        pulse = env(osc(330, 0.6, "square", detune=0.02), 0.02, 0.35, sustain=0.3, release=0.2)
        out.add(pulse, i * 0.75, 0.5)
    lowpass(out, 1200, resonance=0.3)
    return fade(out, 0.01, 0.1)


def sfx_elimination() -> Buf:
    out = Buf(0.5)
    out.add(env(osc(880, 0.12, "sine"), 0.001, 0.1), 0.0, 0.6)
    out.add(env(osc(1320, 0.16, "sine"), 0.004, 0.14), 0.07, 0.5)
    return fade(out, 0.001, 0.05)


def jingle(notes: list[tuple[float, float]], bright: bool, seed: int) -> Buf:
    """Short musical phrase for victory / defeat screens."""
    out = Buf(0.0)
    for i, (freq, dur) in enumerate(notes):
        voice = osc(freq, dur, "tri", detune=0.006)
        env(voice, 0.01, dur * 0.4, sustain=0.5, release=dur * 0.5)
        pad = osc(freq * 2, dur, "sine")
        env(pad, 0.02, dur * 0.5, sustain=0.3, release=dur * 0.5)
        out.add(voice, sum(d for _f, d in notes[:i]) * 0.92, 0.7)
        out.add(pad, sum(d for _f, d in notes[:i]) * 0.92, 0.25)
    return fade(reverb(out, mix=0.22, decay=0.4, seed=seed), 0.005, 0.15)


def ambient_loop(seed: int, seconds: float = 16.0) -> Buf:
    """Loopable island atmosphere: soft wind bed plus distant birds."""
    wind = noise(seconds, seed)
    lowpass(wind, 420, resonance=0.2)
    for i in range(len(wind)):
        t = i / SR
        wind.data[i] *= 0.5 + 0.5 * math.sin(2 * math.pi * t / seconds)
    out = Buf(seconds)
    out.add(wind, 0.0, 0.5)
    rng = Rng(seed + 3)
    for _ in range(8):
        t = rng_next_positive(rng) * (seconds - 1.0)
        chirp = osc(1500 + rng_next_positive(rng) * 900, 0.18, "sine", vibrato=0.08)
        env(chirp, 0.01, 0.12, sustain=0.2, release=0.05)
        out.add(chirp, t, 0.16)
    lowpass(out, 4000)
    # make the loop seamless
    fade_len = int(0.4 * SR)
    for i in range(fade_len):
        k = i / fade_len
        out.data[i] = out.data[i] * k + out.data[len(out) - fade_len + i] * (1 - k)
    return out


def rng_next_positive(rng: Rng) -> float:
    return abs(rng.next())


# --------------------------------------------------------------------------- #
#  Music
# --------------------------------------------------------------------------- #
NOTE_OFFSETS = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7,
                "G#": 8, "A": 9, "A#": 10, "B": 11}


def note(name: str) -> float:
    """'A3' -> frequency in Hz."""
    pitch = name[:-1]
    octave = int(name[-1])
    semis = NOTE_OFFSETS[pitch] + (octave - 4) * 12 - 9
    return 440.0 * (2 ** (semis / 12.0))


def pluck(freq: float, dur: float, seed: int) -> Buf:
    saw = osc(freq, dur, "saw", detune=0.01)
    lowpass(saw, 2600, resonance=0.4)
    sin = osc(freq, dur, "sine")
    out = mix(saw, sin)
    env(out, 0.004, dur * 0.55, sustain=0.18, release=dur * 0.4, curve=1.6)
    return out


def pad(freq: float, dur: float, seed: int) -> Buf:
    a = osc(freq, dur, "sine", detune=0.004)
    b = osc(freq * 1.5, dur, "sine", detune=0.006)
    c = osc(freq * 2.0, dur, "sine")
    out = mix(a, b, c)
    lowpass(out, 1800, resonance=0.2)
    env(out, dur * 0.25, dur * 0.2, sustain=0.8, release=dur * 0.5)
    return out


def bass(freq: float, dur: float) -> Buf:
    out = osc(freq, dur, "square", detune=0.0)
    lowpass(out, 320, resonance=0.5)
    env(out, 0.008, dur * 0.3, sustain=0.55, release=dur * 0.4)
    return out


def kick() -> Buf:
    dur = 0.32
    out = osc(120, dur, "sine", vibrato=0.0)
    for i in range(len(out)):
        t = i / SR
        out.data[i] = math.sin(2 * math.pi * (120 * math.exp(-9 * t) + 45) * t)
    expdecay(out, 0.07)
    click = noise(0.01, 4)
    highpass(click, 3000)
    expdecay(click, 0.004)
    return mix(out, click)


def snare(seed: int) -> Buf:
    dur = 0.2
    out = noise(dur, seed)
    highpass(out, 900)
    expdecay(out, 0.05)
    body = osc(200, dur, "tri")
    expdecay(body, 0.05)
    return mix(out, body)


def hat(seed: int, open_hat: bool = False) -> Buf:
    dur = 0.12 if open_hat else 0.05
    out = noise(dur, seed)
    highpass(out, 7000)
    expdecay(out, dur * 0.35)
    return out


def build_music(progression: list[tuple[str, list[str]]], bpm: float, beats_per_chord: int,
                seed: int, style: str) -> Buf:
    beat = 60.0 / bpm
    chord_len = beat * beats_per_chord
    total = chord_len * len(progression)
    out = Buf(total + 0.5)
    rng = Rng(seed)
    for index, (root, chord) in enumerate(progression):
        start = index * chord_len
        # pad chord
        for voice in chord:
            out.add(pad(note(voice), chord_len * 1.05, seed + index), start, 0.20)
        if style == "menu":
            # arpeggio pluck
            for step in range(beats_per_chord * 2):
                t = start + step * beat * 0.5
                name = chord[step % len(chord)]
                octave_name = name
                out.add(pluck(note(octave_name), beat * 0.7, seed + step), t, 0.22)
            out.add(bass(note(root) / 2.0, chord_len * 0.9), start, 0.30)
        else:
            # driving battle groove: 8th-note bass, kick/snare/hat
            for step in range(beats_per_chord * 8 // 4):
                t = start + step * (beat * 0.5)
                name = chord[0] if step % 4 == 0 else chord[step % len(chord)]
                out.add(bass(note(name) / 1.0, beat * 0.45), t, 0.26)
            for beat_index in range(beats_per_chord):
                t = start + beat_index * beat
                if beat_index % 2 == 0:
                    out.add(kick(), t, 0.55)
                else:
                    out.add(snare(seed + beat_index), t, 0.30)
                out.add(hat(seed + beat_index * 7), t + beat * 0.5, 0.16)
            for step in range(beats_per_chord * 4):
                t = start + step * beat * 0.25
                out.add(pluck(note(chord[step % len(chord)]) * 2, beat * 0.4, seed + step), t, 0.10)
    # loop-friendly tail
    tail = int(0.45 * SR)
    for i in range(tail):
        k = i / tail
        idx = len(out) - tail + i
        out.data[idx] = out.data[idx] * (1 - k) + out.data[i % len(out)] * 0
    return fade(out, 0.02, 0.25)


# --------------------------------------------------------------------------- #
#  Registry
# --------------------------------------------------------------------------- #
def build_all(out_dir: str, only: list[str] | None = None) -> list[str]:
    table = {
        # weapons
        "fire_rifle": lambda: sfx_gun(0.22, 150, 2600, 0.5, 101),
        "fire_smg": lambda: sfx_gun(0.13, 190, 3200, 0.35, 102),
        "fire_sniper": lambda: sfx_gun(0.75, 95, 2100, 0.9, 103, tail=0.30),
        "fire_shotgun": lambda: sfx_gun(0.42, 78, 1500, 0.8, 104, tail=0.22),
        "fire_pistol": lambda: sfx_gun(0.16, 210, 2800, 0.4, 105),
        "fire_lmg": lambda: sfx_gun(0.18, 130, 2400, 0.5, 106),
        "reload": lambda: sfx_reload(201),
        "weapon_switch": lambda: sfx_whoosh(202, 0.20),
        "dry_fire": lambda: mix(env(noise(0.05, 203), 0.001, 0.03), env(osc(320, 0.05, "square"), 0.001, 0.03)),
        # impacts & feedback
        "impact_stone": lambda: sfx_impact("stone", 301),
        "impact_metal": lambda: sfx_impact("metal", 302),
        "impact_wood": lambda: sfx_impact("generic", 303),
        "hit_confirm": lambda: sfx_ui("hit"),
        "headshot_confirm": lambda: sfx_ui("headshot"),
        "elimination": lambda: sfx_elimination(),
        "damage_taken": lambda: fade(mix(env(noise(0.2, 305), 0.002, 0.15), env(osc(140, 0.2, "sine"), 0.002, 0.15))),
        # movement
        "footstep_grass": lambda: sfx_footstep("grass", 401),
        "footstep_stone": lambda: sfx_footstep("stone", 402),
        "footstep_wood": lambda: sfx_footstep("wood", 403),
        "footstep_water": lambda: sfx_footstep("water", 404),
        "footstep_snow": lambda: sfx_footstep("snow", 405),
        "jump": lambda: sfx_jump(),
        "land": lambda: sfx_land(),
        # throwables
        "grenade_throw": lambda: sfx_whoosh(501, 0.35),
        "explosion": lambda: sfx_explosion(502),
        # loot & ui
        "pickup": lambda: sfx_pickup(),
        "coin": lambda: sfx_ui("coin"),
        "gem": lambda: sfx_ui("gem"),
        "ui_click": lambda: sfx_ui("click"),
        "ui_back": lambda: sfx_ui("back"),
        "ui_confirm": lambda: sfx_ui("confirm"),
        "ui_error": lambda: sfx_ui("error"),
        "ui_purchase": lambda: sfx_ui("purchase"),
        # match flow
        "zone_warning": lambda: sfx_zone_warning(),
        "victory": lambda: jingle([(note("C5"), 0.22), (note("E5"), 0.22), (note("G5"), 0.24),
                                   (note("C6"), 0.5)], bright=True, seed=601),
        "defeat": lambda: jingle([(note("A4"), 0.28), (note("F4"), 0.30), (note("D4"), 0.55)],
                                 bright=False, seed=602),
        "match_start": lambda: jingle([(note("G4"), 0.16), (note("C5"), 0.16), (note("G5"), 0.34)],
                                      bright=True, seed=603),
        # ambience & music
        "ambient_island": lambda: ambient_loop(700, 16.0),
        "music_menu": lambda: build_music(
            [("A2", ["A3", "C4", "E4"]), ("F2", ["F3", "A3", "C4"]),
             ("C3", ["C4", "E4", "G4"]), ("G2", ["G3", "B3", "D4"])],
            bpm=84, beats_per_chord=4, seed=801, style="menu"),
        "music_match": lambda: build_music(
            [("D2", ["D3", "F3", "A3"]), ("A#2", ["A#2", "D3", "F3"]),
             ("F2", ["F3", "A3", "C4"]), ("C3", ["C3", "E3", "G3"])],
            bpm=112, beats_per_chord=4, seed=802, style="match"),
    }
    names = sorted(table) if not only else only
    written = []
    for name in names:
        if name not in table:
            raise SystemExit(f"unknown sound '{name}'")
        buf = table[name]()
        path = os.path.join(out_dir, f"{name}.wav")
        track(path, buf)
        written.append(path)
    return written


def verify(paths: list[str]) -> None:
    for path in paths:
        with wave.open(path, "rb") as fh:
            frames = fh.getnframes()
            assert fh.getnchannels() == 1 and fh.getsampwidth() == 2, path
            assert frames > 0, path
    print(f"verified {len(paths)} wav files")


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap = argparse.ArgumentParser(description="Generate BlockStrike Royale audio")
    ap.add_argument("--out", default=os.path.join(root, "blockstrike-royale", "assets", "audio"))
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    if args.list:
        for name in sorted(build_all.__doc__ or ""):
            pass
        return 0
    written = build_all(args.out, args.only)
    total = sum(os.path.getsize(p) for p in written)
    print(f"wrote {len(written)} sounds to {args.out} ({total/1e6:.2f} MB)")
    verify(written)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
