# 🐒 Midnight Monkey Cuddle — 15 s vertical animatic

A **15-second, 1080×1920 (9:16), 30 fps** bedside piece built from five photoreal
keyframes of BamBam and his girlfriend, animated and graded in code, with a
fully synthesised quiet-bedroom ambience track.

**▶ Output:** [`../../media/monkey-cuddle/monkey-cuddle-15s.mp4`](../../media/monkey-cuddle/monkey-cuddle-15s.mp4)
(13.6 MB, H.264 + AAC, faststart) · poster [`poster.jpg`](../../media/monkey-cuddle/poster.jpg)
· beat sheet [`keyframes.jpg`](../../media/monkey-cuddle/keyframes.jpg)

> **Honest scope:** this environment has no image-to-video model, so no *new*
> motion was synthesised — the shot is driven by AI keyframes (one per beat,
> generated from your first frame) plus code-generated camera, breathing, grain
> and sound. For true in-between motion, feed the five PNGs in
> `media/monkey-cuddle/frames/` to an image-to-video model (Veo / Kling / Runway)
> as start-frame + reference frames; they share one camera space already.

---

## Timeline

| Beat | Time | Picture | Sound |
|------|------|---------|-------|
| 1 | 0–3 s | both asleep under the pink heart blanket, breathing | room tone, two out-of-phase breaths |
| 2 | 3–6 s | BamBam's head settles softly against her temple | fleece shift, distant coo |
| 3 | 6–9 s | she stirs, hand curling over her teddy's ear | fleece shift, breath deepens |
| 4 | 9–12 s | he looks at her sleepily, then settles | fleece shift, second coo |
| 5 | 12–15 s | both settled deep under the blanket | breaths + room tone only |

No dialogue, no music, no text, no watermark.

## How it is made

```bash
pip install pillow numpy imageio-ffmpeg

# 1. bedroom ambience (room tone, 2 breathers, 7 fleece shifts, 2 coos)
python3 tools/monkey-cuddle/audio.py --out /tmp/amb.wav

# 2. render 450 frames + mux (ffmpeg from $FFMPEG or imageio-ffmpeg)
python3 tools/monkey-cuddle/build.py --audio /tmp/amb.wav \
        --out media/monkey-cuddle/monkey-cuddle-15s.mp4

# stills only, for checking a transition
python3 tools/monkey-cuddle/build.py --preview 2.9,9.1
```

Pipeline in `build.py`:

1. **Shared camera space** — the `06:00` alarm clock is found in each keyframe by
   colour (bright blue on black); its digit-block *width* pins the zoom and its
   *centroid* pins the pan, so all five frames land in one 9:16 canvas. A small
   per-frame `--tune` multiplier splits the residual subject-size difference
   between subject and background.
2. **Reflect-extend + colour match** — each frame is mirrored outwards (no black
   band ever enters the crop) and mean/std matched to the original photo, so the
   dissolves don't shift colour.
3. **Camera** — a 3 % → 8.5 % push-in plus low-frequency hand-held drift
   (sum of sines, ±4 px, ±0.16° roll) and eased 1.1 s dissolves on the beats.
4. **Breathing** — a feathered vertical displacement of the blanket/chest band,
   0.24 Hz, ±3 px, so the fleece visibly rises and falls.
5. **Phone look** — warm grade, lifted warm blacks, vignette, ±0.4 % exposure
   breathing, per-frame sensor grain; all piped as rawvideo into libx264 (crf 19,
   yuv420p, 2 s GOP, `+faststart`) so it plays inline on a phone.

## Flags

| Flag | Default | What |
|------|---------|------|
| `--first` | `frames/kf0.png` | your original photo, used as beat 1 |
| `--keys` | `kf2 kf3 kf4b kf5` | the four generated beats |
| `--tune` | `1.0,0.95,1.0,0.93,1.0` | per-frame zoom multiplier vs the clock anchor |
| `--crf` | `19` | x264 quality |
| `--preview` | – | comma separated times → PNG stills, no encode |

Tweak the feel with `PUSH`, `XFADE`, `CANVAS_MARGIN` and `wobble()` / `breathe()`
at the top of `build.py`; the mix levels live at the bottom of `audio.py`.
