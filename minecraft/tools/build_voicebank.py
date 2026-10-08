#!/usr/bin/env python3
"""
build_voicebank.py — give the AI villagers a real voice
===============================================================================
Bedrock can only play sounds that are baked into the resource pack, so this tool
synthesises the whole dialogue corpus offline and writes:

  addon/resource_pack/sounds/neurio/*.ogg        the audio
  addon/resource_pack/sounds/sound_definitions.json
  addon/behavior_pack/scripts/voicemanifest.js   what the script uses to play them

Engines
-------
  murmur   (default) procedural "villagerese": voiced syllables, no internet,
           no API key. Animal-Crossing style — the pack ships with this.
  edge     Microsoft neural voices through `edge-tts` -> REAL Moroccan Darija
           (ar-MA-MounaNeural / ar-MA-JamalNeural). Needs internet.  <<< best
  piper    offline neural TTS (`pip install piper-tts` + a voice model)
  espeak   espeak-ng (robotic, offline, speaks Arabic)
  say      macOS `say`
  sapi     Windows SAPI (PowerShell, uses your installed voices)

Examples
--------
  python3 tools/build_voicebank.py                       # murmurs (offline, tiny)
  python3 tools/build_voicebank.py --engine edge         # real Darija voices
  python3 tools/build_voicebank.py --engine edge --words # + word-by-word speech
  python3 tools/build_voicebank.py --engine espeak --voice ar
  python3 tools/build_addon.py                           # then rebuild the .mcaddon

Needs: numpy + soundfile   (pip install numpy soundfile)
       edge-tts            (pip install edge-tts) for --engine edge
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import io
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "addon", "resource_pack")
BP = os.path.join(ROOT, "addon", "behavior_pack")
SOUND_DIR = os.path.join(RP, "sounds", "neurio")
CACHE_DIR = os.path.join(ROOT, "build", "tts_cache")
CORPUS_JSON = os.path.join(ROOT, "build", "corpus.json")
SR = 22050  # Bedrock is happy with 22.05 kHz mono, and the pack stays small

PUNCT_RE = re.compile(r"[.,!?;:\"'`’‘“”()\[\]{}<>|/\\+\-*=~^%$#@&_…،؛؟«»ـ]")


def norm_key(text: str) -> str:
    """Must match normKey() in behavior_pack/scripts/voice.js exactly."""
    s = PUNCT_RE.sub(" ", str(text or "").lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s[:140]


# --------------------------------------------------------------------------- #
# audio helpers
# --------------------------------------------------------------------------- #
def import_audio():
    try:
        import numpy as np
        import soundfile as sf
        return np, sf
    except Exception as e:  # pragma: no cover
        sys.exit(
            "This tool needs numpy + soundfile to write .ogg files:\n"
            "    pip install numpy soundfile\n"
            f"(error was: {e})"
        )


NP, SF = import_audio()


def to_mono_resample(data, sr_in, sr_out=SR):
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr_in != sr_out:
        n_out = int(round(len(data) * sr_out / sr_in))
        x_old = NP.linspace(0, 1, len(data), endpoint=False)
        x_new = NP.linspace(0, 1, n_out, endpoint=False)
        data = NP.interp(x_new, x_old, data)
    return data.astype("float32")


def normalize(data, peak=0.92):
    m = float(NP.max(NP.abs(data))) if len(data) else 0.0
    if m < 1e-6:
        return data
    return (data * (peak / m)).astype("float32")


def trim_silence(data, thresh=0.012, pad=int(0.02 * SR)):
    idx = NP.where(NP.abs(data) > thresh)[0]
    if not len(idx):
        return data
    a, b = max(0, idx[0] - pad), min(len(data), idx[-1] + pad)
    return data[a:b]


def write_ogg(path, data, sr=SR):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = normalize(NP.asarray(data, dtype="float32"))
    SF.write(path, data, sr, format="OGG", subtype="VORBIS")
    return len(data) / float(sr)


def read_audio(path):
    data, sr = SF.read(path, dtype="float32", always_2d=False)
    return to_mono_resample(NP.asarray(data), sr)


def sha(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:16]


# --------------------------------------------------------------------------- #
# 1) murmur engine — a small formant synthesiser (pure numpy, offline)
# --------------------------------------------------------------------------- #
MURMUR_VOICES = {
    "male":   dict(f0=112.0, jitter=0.014, formants=[(520, 90, 1.00), (1180, 110, 0.55), (2450, 170, 0.26)]),
    "female": dict(f0=196.0, jitter=0.011, formants=[(560, 85, 1.00), (1420, 100, 0.55), (2820, 160, 0.24)]),
    "old":    dict(f0=96.0,  jitter=0.035, formants=[(470, 130, 1.00), (1120, 150, 0.50), (2260, 210, 0.22)]),
    "kid":    dict(f0=288.0, jitter=0.018, formants=[(630, 80, 1.00), (1620, 95, 0.55), (3020, 150, 0.24)]),
}

# (duration, pitch multiplier, contour, formant shift, onset)
SYLLABLE_SHAPES = [
    (0.20, 1.00, +0.10, 1.00, "none"),
    (0.26, 0.94, -0.14, 0.92, "none"),
    (0.17, 1.08, +0.22, 1.10, "none"),
    (0.30, 0.90, +0.00, 0.86, "nasal"),
    (0.22, 1.03, -0.22, 1.06, "noise"),
    (0.24, 0.97, +0.16, 0.95, "stop"),
    (0.19, 1.12, -0.08, 1.16, "none"),
    (0.33, 0.88, +0.06, 0.80, "nasal"),
    (0.16, 1.18, +0.28, 1.22, "stop"),
    (0.28, 0.93, -0.18, 1.00, "noise"),
]


def resonator(x, sr, f, bw, gain):
    """Two-pole resonator (the classic formant filter), plain python loop."""
    r = math.exp(-math.pi * bw / sr)
    theta = 2 * math.pi * f / sr
    a1 = 2.0 * r * math.cos(theta)
    a2 = -(r * r)
    y1 = y2 = 0.0
    out = NP.zeros(len(x), dtype="float64")
    for i in range(len(x)):
        yi = a1 * y1 + a2 * y2 + gain * float(x[i])
        out[i] = yi
        y2, y1 = y1, yi
    return out.astype("float32")


def synth_syllable(voice, dur, f0mul, contour, fshift, onset, seed):
    rng = NP.random.default_rng(seed)
    n = max(64, int(SR * dur))
    v = MURMUR_VOICES[voice]
    f0 = NP.linspace(v["f0"] * f0mul * (1 - contour / 2), v["f0"] * f0mul * (1 + contour / 2), n)
    f0 = f0 * (1.0 + v["jitter"] * rng.standard_normal(n))
    phase = NP.cumsum(2 * math.pi * f0 / SR)
    p = (phase / (2 * math.pi)) % 1.0
    # glottal pulse: quick rise, exponential fall (Rosenberg-ish)
    src = NP.where(p < 0.5, 0.5 * (1 - NP.cos(2 * math.pi * p / 0.5)), NP.exp(-7.0 * (p - 0.5)))
    src = (src - src.mean()).astype("float32")
    src = src + (rng.standard_normal(n) * 0.05).astype("float32")  # aspiration

    out = NP.zeros(n, dtype="float32")
    for (f, bw, g) in v["formants"]:
        out = out + resonator(src, SR, max(120.0, f * fshift), bw, g) * g

    n_on = int(0.028 * SR)
    if onset == "noise" and n > n_on:
        out[:n_on] = out[:n_on] * 0.25 + rng.standard_normal(n_on).astype("float32") * 0.35
    elif onset == "stop" and n > n_on // 2:
        out[: n_on // 2] *= 0.04
    elif onset == "nasal" and n > n_on:
        out[:n_on] *= 0.45

    # envelope
    env = NP.ones(n, dtype="float32")
    att = max(4, int(0.014 * SR))
    rel = max(8, int(0.045 * SR))
    env[:att] = NP.linspace(0, 1, att)
    env[-rel:] = NP.linspace(1, 0, rel)
    env *= NP.linspace(1.0, 0.82, n).astype("float32")
    return (out * env).astype("float32")


def build_murmurs(limit=0):
    made = {}
    for voice in MURMUR_VOICES:
        clips = []
        for i, shape in enumerate(SYLLABLE_SHAPES):
            if limit and i >= limit:
                break
            name = f"murmur_{voice}_{i}"
            path = os.path.join(SOUND_DIR, name + ".ogg")
            sig = synth_syllable(voice, *shape, seed=hash((voice, i)) & 0xFFFF)
            d = write_ogg(path, sig)
            clips.append(dict(id=f"neurio.murmur.{voice}.{i}", file=f"sounds/neurio/{name}", d=round(d, 3),
                              p=round(float(shape[1]), 3)))
        made[voice] = clips
        print(f"  murmur/{voice}: {len(clips)} syllables")
    return made


# --------------------------------------------------------------------------- #
# 2) TTS engines
# --------------------------------------------------------------------------- #
DEFAULT_VOICES = {
    "edge":   {"female": "ar-MA-MounaNeural", "male": "ar-MA-JamalNeural"},
    "espeak": {"female": "ar+f3", "male": "ar"},
    "say":    {"female": "Laila", "male": "Maged"},
    "sapi":   {"female": "", "male": ""},
    "piper":  {"female": "", "male": ""},
}


def tts_edge(text, voice, out_path, rate="+0%", pitch="+0Hz"):
    import asyncio
    import edge_tts

    async def go():
        c = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        await c.save(out_path)

    asyncio.run(go())


def tts_espeak(text, voice, out_path, rate="+0%", pitch="+0Hz"):
    speed = 155
    try:
        speed = 155 + int(rate.replace("%", "").replace("+", "")) * 1.4
    except Exception:
        pass
    subprocess.run(["espeak-ng", "-v", voice or "ar", "-s", str(int(speed)), "-w", out_path, text],
                   check=True, capture_output=True)


def tts_say(text, voice, out_path, rate="+0%", pitch="+0Hz"):
    aiff = out_path + ".aiff"
    cmd = ["say", "-o", aiff, text]
    if voice:
        cmd = ["say", "-v", voice, "-o", aiff, text]
    subprocess.run(cmd, check=True, capture_output=True)
    data = read_audio(aiff)
    os.remove(aiff)
    write_ogg(out_path, data)


def tts_sapi(text, voice, out_path, rate="+0%", pitch="+0Hz"):
    wav = out_path + ".wav"
    ps = (
        "Add-Type -AssemblyName System.Speech;"
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        + (f"$s.SelectVoice('{voice}');" if voice else "")
        + f"$s.SetOutputToWaveFile('{wav}');$s.Speak([Console]::In.ReadToEnd());$s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], input=text.encode("utf-8"), check=True)
    data = read_audio(wav)
    os.remove(wav)
    write_ogg(out_path, data)


def tts_piper(text, voice, out_path, rate="+0%", pitch="+0Hz"):
    """voice = path to a piper .onnx model"""
    if not voice or not os.path.exists(voice):
        raise SystemExit("--engine piper needs --voice-male/--voice-female pointing at .onnx models")
    wav = out_path + ".wav"
    subprocess.run(["piper", "--model", voice, "--output_file", wav], input=text.encode("utf-8"), check=True)
    data = read_audio(wav)
    os.remove(wav)
    write_ogg(out_path, data)


ENGINES = {"edge": tts_edge, "espeak": tts_espeak, "say": tts_say, "sapi": tts_sapi, "piper": tts_piper}


def synth_line(engine, text, voice, dest_ogg, rate="+0%", pitch="+0Hz"):
    """Synthesise `text` with `engine`/`voice` into dest_ogg (cached)."""
    key = sha(f"{engine}|{voice}|{rate}|{pitch}|{text}")
    cached = os.path.join(CACHE_DIR, engine, key + ".ogg")
    if os.path.exists(cached) and os.path.getsize(cached) > 200:
        shutil.copyfile(cached, dest_ogg)
        return read_audio(dest_ogg), len(read_audio(dest_ogg)) / SR
    os.makedirs(os.path.dirname(cached), exist_ok=True)
    fn = ENGINES[engine]
    if engine == "edge":
        tmp = cached + ".mp3"
        fn(text, voice, tmp, rate, pitch)
        data = read_audio(tmp)
        os.remove(tmp)
        d = write_ogg(cached, trim_silence(data))
    else:
        fn(text, voice, cached, rate, pitch)
        data = read_audio(cached)
        d = write_ogg(cached, trim_silence(data))
    shutil.copyfile(cached, dest_ogg)
    return None, d


# --------------------------------------------------------------------------- #
# 3) build
# --------------------------------------------------------------------------- #
def load_corpus():
    if not os.path.exists(CORPUS_JSON):
        print("build/corpus.json missing -> running tools/export_corpus.mjs")
        node = shutil.which("node")
        if node:
            subprocess.run([node, os.path.join(ROOT, "tools", "export_corpus.mjs")], check=True)
    if not os.path.exists(CORPUS_JSON):
        raise SystemExit("could not build build/corpus.json (is node installed?)")
    with open(CORPUS_JSON, encoding="utf-8") as f:
        return json.load(f)


def sound_definitions(entries):
    """entries: list of (sound_id, relative_file)"""
    defs = {}
    for sid, f in entries:
        defs[sid] = {
            "category": "neutral",
            "sounds": [{"name": f, "volume": 1.0, "pitch": 1.0, "load_on_low_memory": False}],
            "max_distance": 40.0,
            "min_distance": 3.0,
        }
    return {"format_version": "1.14.0", "sound_definitions": defs}


def write_manifest(engine, murmurs, phrases, words, extra):
    js = (
        "/* AUTO-GENERATED by tools/build_voicebank.py — do not edit by hand.\n"
        f"   engine: {engine}   built: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"   phrases: {sum(len(v) for v in phrases.get('byVoice', {}).values()) if isinstance(phrases, dict) else 0}"
        f"   words: {sum(len(v) for v in words.get('byVoice', {}).values()) if isinstance(words, dict) else 0}\n"
        "   Rebuild with:  python3 tools/build_voicebank.py --engine edge      (real Darija voice)\n"
        "                  python3 tools/build_voicebank.py                     (offline murmurs) */\n"
        "export const VOICE_MANIFEST = "
        + json.dumps({"version": 2, "engine": engine, "sampleRate": SR,
                      "murmurs": murmurs, "phrases": phrases, "words": words, **extra},
                     ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    path = os.path.join(BP, "scripts", "voicemanifest.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write(js)
    print(f"wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path)/1024:.1f} kB)")


def main():
    ap = argparse.ArgumentParser(description="Build the villager voice bank")
    ap.add_argument("--engine", default="murmur", choices=["murmur", *ENGINES.keys()])
    ap.add_argument("--voice", default="", help="voice name/model for a single-voice engine")
    ap.add_argument("--voice-female", default="", help="female voice (default: ar-MA-MounaNeural for edge)")
    ap.add_argument("--voice-male", default="", help="male voice (default: ar-MA-JamalNeural for edge)")
    ap.add_argument("--rate", default="+0%", help="speech rate, e.g. +8%% (edge/espeak)")
    ap.add_argument("--pitch", default="+0Hz", help="pitch shift, e.g. +6Hz")
    ap.add_argument("--words", action="store_true", help="also synthesise single words (word-by-word speech)")
    ap.add_argument("--lang", default="ar", choices=["ar", "dz", "en"], help="which text to feed the TTS (ar = Arabic script, best for Darija voices)")
    ap.add_argument("--limit", type=int, default=0, help="only build the first N lines (testing)")
    ap.add_argument("--jobs", type=int, default=3, help="parallel TTS jobs")
    ap.add_argument("--keep-murmurs", action="store_true", default=True, help="always keep the murmur set as fallback")
    args = ap.parse_args()

    corpus = load_corpus()
    os.makedirs(SOUND_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)

    print(f"== voice bank: engine={args.engine} lang={args.lang} ==")
    murmurs = build_murmurs(limit=0 if args.engine == "murmur" else 4)
    entries = [(c["id"], c["file"]) for v in murmurs.values() for c in v]

    phrases: dict = {"byVoice": {}}
    words: dict = {"byVoice": {}}

    if args.engine != "murmur":
        dv = DEFAULT_VOICES.get(args.engine, {})
        voices = {
            "female": args.voice_female or args.voice or dv.get("female", ""),
            "male": args.voice_male or dv.get("male", ""),
            "old": args.voice_male or dv.get("male", ""),
            "kid": args.voice_female or dv.get("female", ""),
        }
        # For file size we build two real voices (female + male) and map old/kid onto them.
        build_voices = {"female": voices["female"], "male": voices["male"]}
        mapping = {"female": "female", "male": "male", "old": "male", "kid": "female"}

        lines = corpus["lines"]
        if args.limit:
            lines = lines[: args.limit]

        jobs = []
        for vk, vname in build_voices.items():
            if not vname:
                print(f"  ! no voice configured for {vk}, skipping")
                continue
            phrases["byVoice"][vk] = {}
            for i, ln in enumerate(lines):
                text = (ln.get(args.lang) or ln.get("ar") or ln.get("dz") or "").strip()
                if not text:
                    continue
                jobs.append((vk, vname, i, text, ln))

        print(f"  synthesising {len(jobs)} clips with {args.engine} ({args.jobs} parallel)...")
        done = 0
        t0 = time.time()

        def work(job):
            vk, vname, i, text, ln = job
            sid = f"neurio.tts.{vk}.{i:04d}"
            fname = f"tts_{vk}_{i:04d}"
            dest = os.path.join(SOUND_DIR, fname + ".ogg")
            try:
                _, dur = synth_line(args.engine, text, vname, dest, args.rate, args.pitch)
                return (vk, sid, fname, dur, text, ln, None)
            except Exception as e:
                return (vk, sid, fname, 0.0, text, ln, repr(e))

        with cf.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
            for res in ex.map(work, jobs):
                vk, sid, fname, dur, text, ln, err = res
                done += 1
                if err:
                    print(f"    ! {err[:160]}")
                    if done <= 2:
                        print("    (is the engine installed? pip install edge-tts / espeak-ng / piper-tts)")
                    continue
                entries.append((sid, f"sounds/neurio/{fname}"))
                d = round(dur, 3)
                for key in {norm_key(ln.get("ar") or ""), norm_key(ln.get("dz") or ""),
                            norm_key(ln.get("en") or "")} - {""}:
                    phrases["byVoice"][vk].setdefault(key, {"id": sid, "d": d})
                if done % 25 == 0:
                    print(f"    {done}/{len(jobs)}  ({time.time()-t0:.0f}s)")

        if args.words:
            wjobs = []
            for vk, vname in build_voices.items():
                if not vname:
                    continue
                words["byVoice"][vk] = {}
                for i, w in enumerate(corpus["words"]):
                    wjobs.append((vk, vname, i, w))
            print(f"  synthesising {len(wjobs)} single words...")

            def wwork(job):
                vk, vname, i, w = job
                sid = f"neurio.word.{vk}.{i:05d}"
                fname = f"word_{vk}_{i:05d}"
                dest = os.path.join(SOUND_DIR, fname + ".ogg")
                try:
                    _, dur = synth_line(args.engine, w, vname, dest, args.rate, args.pitch)
                    return (vk, sid, fname, dur, w, None)
                except Exception as e:
                    return (vk, sid, fname, 0.0, w, repr(e))

            with cf.ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
                for vk, sid, fname, dur, w, err in ex.map(wwork, wjobs):
                    if err or dur <= 0:
                        continue
                    entries.append((sid, f"sounds/neurio/{fname}"))
                    words["byVoice"][vk].setdefault(norm_key(w), {"id": sid, "d": round(dur, 3)})

        # old/kid reuse the two real voices (pitch is applied at play time)
        phrases["map"] = mapping
        words["map"] = mapping

    # ---- write sound_definitions.json + manifest ----
    sd = sound_definitions(entries)
    p = os.path.join(RP, "sounds", "sound_definitions.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(sd, f, indent=1, ensure_ascii=False)
    print(f"wrote {os.path.relpath(p, ROOT)} ({len(entries)} sounds)")

    total = sum(os.path.getsize(os.path.join(SOUND_DIR, f)) for f in os.listdir(SOUND_DIR) if f.endswith(".ogg"))
    write_manifest(args.engine, murmurs, phrases, words,
                   {"sizeBytes": total, "built": time.strftime("%Y-%m-%dT%H:%M:%S")})
    print(f"voice bank size: {total/1024/1024:.2f} MB  ({len(entries)} files)")
    print("next: python3 tools/build_addon.py   then import dist/Neurio-AI-Villagers.mcaddon")


if __name__ == "__main__":
    main()
