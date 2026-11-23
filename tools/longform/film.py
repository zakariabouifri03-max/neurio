"""The storyboard: maps aligned sentences onto shots, renders frames in
parallel, encodes with ffmpeg, then builds the music bed + SFX and muxes.

  python3 tools/longform/film.py projects/cute-camera --stills   # contact sheet
  python3 tools/longform/film.py projects/cute-camera            # full render

Sentence numbers refer to timing.json (1-based), produced by align.py.
"""
import argparse
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import kit
import shots as S
from kit import H, W

FF = os.environ.get("FFMPEG") or __import__("imageio_ffmpeg").get_ffmpeg_exe()
FPS = 30

# storyboard + timeline live in plan.py (shared by picture and sound)
from plan import build_plan


def make_shot(kind, t0, t1, kw):
    return kind(t0, t1, **kw)


# --------------------------------------------------------------- rendering
def _frame_job(args):
    kind_name, t0, t1, kw, t, out = args
    import shots as SS
    cls = getattr(SS, kind_name)
    sh = cls(t0, t1, **kw)
    sh.build()
    img = sh.frame(t)
    img.save(out, quality=92)
    return out


def render_video(P, plan, total, out_path, workers=2):
    tmp = os.path.join(P, "work", "frames")
    os.makedirs(tmp, exist_ok=True)
    jobs = []
    idx = 0
    # serialise kwargs (drop cached sprites, which are not picklable-safe)
    plans = []
    for (kind, t0, t1, kw) in plan:
        kw2 = {k: v for k, v in kw.items() if k != "sprite"}
        kw2.pop("_sprites", None)
        plans.append((kind.__name__, t0, t1, kw2))
    segs = []
    for si, (name, t0, t1, kw) in enumerate(plans):
        n = max(1, int(round((t1 - t0) * FPS)))
        seg = os.path.join(P, "work", f"seg_{si:03d}.mp4")
        segs.append((seg, t0, t1, n, name, kw))
    return segs, plans


def render_all(P, plan, total, out_path, workers=2):
    work = os.path.join(P, "work")
    os.makedirs(work, exist_ok=True)
    segs = []
    plans = [(k.__name__, t0, t1, {kk: vv for kk, vv in kw.items() if kk != "sprite"} | {"_sprites": None})
             for (k, t0, t1, kw) in plan]
    for si, (name, t0, t1, kw) in enumerate(plans):
        kw = {k: v for k, v in kw.items() if not k.startswith("_")}
        seg = os.path.join(work, f"seg_{si:03d}.mp4")
        frames = int(round((t1 - t0) * FPS))
        if os.path.exists(seg) and os.path.getsize(seg) > 2000:
            segs.append(seg)
            print(f"[cached] {si:02d} {name} {t1-t0:.2f}s", flush=True)
            continue
        fdir = os.path.join(work, f"f_{si:03d}")
        os.makedirs(fdir, exist_ok=True)
        # build the shot once per worker via chunked pool
        args = [(name, t0, t1, kw, t0 + i / FPS, os.path.join(fdir, f"{i:05d}.jpg")) for i in range(frames)]
        with ProcessPoolExecutor(max_workers=workers, initializer=_init) as ex:
            list(ex.map(_frame_job_chunk, _chunks(args, max(1, frames // (workers * 3)))))
        subprocess.run([FF, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i",
                        os.path.join(fdir, "%05d.jpg"), "-c:v", "libx264", "-preset", "veryfast",
                        "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS), seg], check=True)
        segs.append(seg)
        # free disk
        for f in os.listdir(fdir):
            os.remove(os.path.join(fdir, f))
        os.rmdir(fdir)
        print(f"[{si+1:02d}/{len(plans)}] {name} {t1-t0:.2f}s ETA {(len(plans)-si-1)*0.0:.0f}", flush=True)
    # concat
    lst = os.path.join(work, "segs.txt")
    open(lst, "w").write("".join(f"file '{os.path.abspath(s)}'\n" for s in segs))
    subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                    "-c", "copy", out_path], check=True)
    return out_path


def _init():
    pass


_CACHE = {}


def _frame_job_chunk(chunk):
    out = []
    for (name, t0, t1, kw, t, path) in chunk:
        import shots as SS
        key = (name, t0, t1, id(kw))
        sh = _CACHE.get(key)
        if sh is None:
            cls = getattr(SS, name)
            sh = cls(t0, t1, **kw)
            sh.build()
            _CACHE[key] = sh
        img = sh.frame(t)
        img.save(path, quality=92)
        out.append(path)
    return out


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# --------------------------------------------------------------- stills
def stills(P, plan, total, which=None, frac=0.55):
    out = os.path.join(P, "work", "sheet")
    os.makedirs(out, exist_ok=True)
    picks = []
    for si, (kind, t0, t1, kw) in enumerate(plan):
        if which and si not in which:
            continue
        picks.append((si, kind, t0, t1, kw))
    thumbs = []
    for si, kind, t0, t1, kw in picks:
        sh = make_shot(kind, t0, t1, kw)
        sh.build()
        img = sh.frame(t0 + (t1 - t0) * frac)
        img = img.resize((640, 360), Image.LANCZOS)
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, 640, 30), fill=(0, 0, 0))
        d.text((8, 6), f"{si:02d} {kind.__name__}", font=kit.font("kalam_b", 22), fill=(240, 240, 120))
        thumbs.append(img)
    cols = 4
    rows = math.ceil(len(thumbs) / cols)
    sheet = Image.new("RGB", (cols * 640, rows * 360), (12, 12, 16))
    for i, th in enumerate(thumbs):
        sheet.paste(th, ((i % cols) * 640, (i // cols) * 360))
        if i % 12 == 11 or i == len(thumbs) - 1:
            n = i // 12
            sheet.crop((0, n * 3 * 360, cols * 640, min(sheet.height, (n * 3 + 3) * 360))).save(
                os.path.join(out, f"sheet_{n}.jpg"), quality=90)
    print("sheets ->", out, len(thumbs), "shots")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("P")
    ap.add_argument("--stills", action="store_true")
    ap.add_argument("--shots", default="")
    ap.add_argument("--frac", type=float, default=0.55)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    shots, cards, total, audio_end = build_plan(a.P)
    plan = [(sh["kind"], sh["s0"], sh["s1"], dict(sh["kw"], sents=sh["sents"])) for sh in shots]
    print(f"{len(plan)} shots, {total:.2f}s")
    for si, (kind, t0, t1, kw) in enumerate(plan):
        print(f"{si:02d} {kind.__name__:14s} {t0:7.2f}-{t1:7.2f} ({t1-t0:5.2f}s) sents="
              f"{[s['i'] for s in kw.get('sents', [])]}")
    if a.stills:
        which = {int(x) for x in a.shots.split(",") if x.strip()} if a.shots else None
        stills(a.P, plan, total, which, a.frac)
        return
    out = a.out or os.path.join(a.P, "out", "picture.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    render_all(a.P, plan, total, out, a.workers)
    print("picture ->", out)


if __name__ == "__main__":
    main()
