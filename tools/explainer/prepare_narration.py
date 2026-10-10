#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Trim silence + apply a light per-chunk atempo to the narration takes, then build
tools/explainer/timeline.json with the real on-screen start/end of every line.

  python3 tools/explainer/prepare_narration.py \
      --narr narr --out-dir narr/proc --timeline tools/explainer/timeline.json
"""
import argparse
import json
import os
import subprocess
import sys

import imageio_ffmpeg as ffp

HERE = os.path.dirname(os.path.abspath(__file__))
FF = ffp.get_ffmpeg_exe()

# relative pacing weight per chunk (punchy lines <1, exposition >1); multiplied by
# a uniform scale that fits the total to --target
TEMPO = {1: 0.93, 2: 1.05, 3: 0.95, 4: 1.00, 5: 1.05, 6: 1.00,
         7: 1.00, 8: 1.00, 9: 0.95, 10: 0.85}
# gap after each chunk, before the next line starts
GAP = {1: 0.28, 2: 0.24, 3: 0.28, 4: 0.24, 5: 0.28, 6: 0.24,
       7: 0.24, 8: 0.28, 9: 0.24, 10: 0.0}
LEAD = 0.35


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)


def probe(path):
    out = subprocess.run([FF, "-i", path], capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "Duration" in line:
            t = line.split("Duration:")[1].split(",")[0].strip()
            h, m, s = t.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError("no duration " + path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--narr", default=os.path.join(HERE, "..", "..", "narr"))
    ap.add_argument("--out-dir", default=os.path.join(HERE, "narr_proc"))
    ap.add_argument("--timeline", default=os.path.join(HERE, "timeline.json"))
    ap.add_argument("--target", type=float, default=56.0,
                    help="target total speech seconds before gaps/lead")
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    # 1) trim silence
    trimmed = {}
    for i in range(1, 11):
        src = os.path.join(args.narr, f"{i:02d}.wav")
        tmp = os.path.join(args.out_dir, f"{i:02d}.trim.wav")
        run([FF, "-y", "-loglevel", "error", "-i", src,
             "-af", ("silenceremove=start_periods=1:start_threshold=-45dB:"
                     "start_duration=0.05,areverse,silenceremove=start_periods=1:"
                     "start_threshold=-45dB:start_duration=0.05,areverse"),
             "-ar", "48000", tmp])
        trimmed[i] = probe(tmp)

    tot = sum(trimmed.values())
    scale = tot / args.target if tot > args.target else 1.0
    chunks = []
    cur = LEAD
    for i in range(1, 11):
        tempo = TEMPO[i] * (scale if scale > 1 else 1.0)
        out = os.path.join(args.out_dir, f"{i:02d}.wav")
        run([FF, "-y", "-loglevel", "error", "-i",
             os.path.join(args.out_dir, f"{i:02d}.trim.wav"),
             "-af", f"atempo={tempo:.3f}", out])
        dur = probe(out)
        chunks.append({"i": i, "start": round(cur, 3),
                       "end": round(cur + dur, 3), "dur": round(dur, 3),
                       "file": out})
        cur += dur + GAP[i]

    total = max(60.0, cur)
    tl = {"total": round(total, 3), "lead": LEAD, "chunks": chunks,
          "narrdir": args.out_dir}
    json.dump(tl, open(args.timeline, "w"), indent=2)
    for c in chunks:
        print(f"{c['i']:>2}  start {c['start']:>6.2f}  dur {c['dur']:>5.2f}")
    print("speech ends", round(chunks[-1]['end'], 2), " total", total)


if __name__ == "__main__":
    main()
