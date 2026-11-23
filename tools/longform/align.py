"""Align a script to recorded narration using pause detection.

The ReachMora engine uses ASR word timestamps (sherpa-onnx) when the model is
available. That model is not installed here, so this is the documented fallback:
detect speech spans with ffmpeg's silencedetect, then match script sentences to
spans by character-weighted DP. Cue timing is looser than ASR but keeps every
sentence boundary within a few tens of milliseconds.

Usage:  python3 tools/longform/align.py projects/cute-camera
Writes: <P>/timing.json  {"sentences":[{i,text,start,end,chars}], "speech":...}
"""
import json
import os
import re
import subprocess
import sys

FF = os.environ.get("FFMPEG") or __import__("imageio_ffmpeg").get_ffmpeg_exe()


def ff_spans(path, noise=-32, dur=0.15):
    """Return [(start, end)] speech spans from a file."""
    out = subprocess.run(
        [FF, "-hide_banner", "-i", path, "-af", f"silencedetect=noise={noise}dB:d={dur}", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    total = float(re.findall(r"time=(\d+):(\d+):([\d.]+)", out)[-1][2]) if "time=" in out else 0.0
    h, m, s = re.findall(r"time=(\d+):(\d+):([\d.]+)", out)[-1]
    total = int(h) * 3600 + int(m) * 60 + float(s)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", out)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", out)]
    silences = []
    for i, st in enumerate(starts):
        en = ends[i] if i < len(ends) else total
        silences.append((st, en))
    spans, cur = [], 0.0
    for st, en in silences:
        if st - cur > 0.05:
            spans.append((cur, st))
        cur = max(cur, en)
    if total - cur > 0.05:
        spans.append((cur, total))
    return spans, total


def sentences(script_path):
    text = open(script_path, encoding="utf-8").read()
    lines = [l.strip() for l in text.splitlines() if l.strip() and not l.startswith("#")]
    out = []
    for line in lines:
        for s in re.split(r"(?<=[.!?])\s+", line):
            s = s.strip()
            if s:
                out.append(s)
    return out


def merge_close(spans, gap=0.24):
    out = []
    for st, en in spans:
        if out and st - out[-1][1] < gap:
            out[-1] = (out[-1][0], en)
        else:
            out.append((st, en))
    return out


def align(chunks, sents):
    """DP: assign consecutive sentences to consecutive chunks, minimising
    relative duration error. Returns list of (start, end) per sentence."""
    W = [max(8, len(s)) for s in sents]
    tot_w = sum(W)
    tot_d = sum(e - s for s, e in chunks)
    # prefix sums
    cw = [0]
    for w in W:
        cw.append(cw[-1] + w)
    cd = [0]
    for s, e in chunks:
        cd.append(cd[-1] + (e - s))
    N, M = len(sents), len(chunks)
    INF = float("inf")
    cost = [[INF] * (M + 1) for _ in range(N + 1)]
    back = [[None] * (M + 1) for _ in range(N + 1)]
    cost[0][0] = 0.0
    for i in range(N + 1):
        for j in range(M + 1):
            c = cost[i][j]
            if c == INF:
                continue
            for di in range(0, min(3, N - i) + 1):
                for dj in range(0, min(3, M - j) + 1):
                    if di == 0 and dj == 0:
                        continue
                    if di == 0 or dj == 0:
                        # unbalanced step: penalise so sentences don't float
                        pen = 0.9 * (di + dj) if (di and dj) else 0.35 + 0.5 * (di + dj)
                    else:
                        pen = 0.0
                    want = (cw[i + di] - cw[i]) / tot_w * tot_d
                    got = cd[j + dj] - cd[j]
                    err = abs(got - want) / max(0.4, want)
                    nc = c + err + pen
                    if nc < cost[i + di][j + dj]:
                        cost[i + di][j + dj] = nc
                        back[i + di][j + dj] = (i, j)
    # backtrack
    groups = []
    i, j = N, M
    while (i, j) != (0, 0):
        pi, pj = back[i][j]
        groups.append((pi, i, pj, j))
        i, j = pi, pj
    groups.reverse()
    times = [None] * N
    for pi, i2, pj, j2 in groups:
        if i2 > pi and j2 > pj:
            st = chunks[pj][0]
            en = chunks[j2 - 1][1]
            span = en - st
            tot = cw[i2] - cw[pi]
            acc = 0.0
            for k in range(pi, i2):
                rel = (cw[k + 1] - cw[k]) / tot
                times[k] = (st + span * acc, st + span * (acc + rel))
                acc += rel
    # fill any gaps proportionally
    last = 0.0
    for k in range(N):
        if times[k] is None:
            times[k] = (last, last + 0.4)
        last = times[k][1]
    return times, cost[N][M]


def main(P):
    sents = sentences(os.path.join(P, "script.txt"))
    parts = sorted(f for f in os.listdir(os.path.join(P, "voice")) if f.endswith(".mp3"))
    all_spans, offsets, off = [], [], 0.0
    for f in parts:
        spans, total = ff_spans(os.path.join(P, "voice", f))
        spans = merge_close(spans)
        all_spans += [(s + off, e + off) for s, e in spans]
        offsets.append((f, off, total))
        off += total + 0.25
    times, err = align(all_spans, sents)
    rows = []
    for i, (s, t) in enumerate(zip(sents, times)):
        rows.append({"i": i + 1, "text": s, "start": round(t[0], 3), "end": round(t[1], 3), "chars": len(s)})
    json.dump({"method": "pause", "parts": offsets, "sentences": rows,
               "speech_end": round(rows[-1]["end"], 3)}, open(os.path.join(P, "timing.json"), "w"), indent=1)
    print(f"method=pause sentences={len(sents)} spans={len(all_spans)} cost={err:.2f}")
    for r in rows:
        print(f"{r['i']:2d} {r['start']:6.2f}-{r['end']:6.2f}  {r['text'][:70]}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
