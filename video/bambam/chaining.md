# Reaching 15 s with no visible cut

Only Sora 2 does 15 s in one pass. Everyone else needs two clips. Here's how to
make the join invisible.

## The rule

> **Clip B's start image must be the exact last frame of clip A.**

Not the original reference. Not a re-generation. The literal final frame,
exported as a PNG.

This is the whole trick. It gives clip B the identical framing, lighting, grain,
fur state and teddy position that clip A ended on, so the model continues rather
than restarts. Feed it the original reference and you get a hard visual snap —
BamBam teleports back to his opening position.

## Where to split

**Split at 10 s, not at 9 s or 12 s.** Your beat map is:

```
0─────────3─────────6─────────9─────────12─────────15
  sleep    adjust     pull     nuzzle    stillness
```

Splitting at 9 s puts the seam exactly on the nuzzle — you'd be asking clip B to
start cold on the single most delicate motion in the brief, with no runway.
Splitting at 12 s asks clip A to carry the nuzzle *and* the pull, which is where
10 s models start to degrade.

**10 s is the sweet spot:** clip A ends mid-pull, in continuous motion. Motion is
far easier to continue across a seam than stillness is — a moving frame gives the
model momentum to pick up.

## Procedure

1. Generate clip A (10 s). Check the last frame is mid-pull and BamBam still
   looks like BamBam.
2. Export the last frame:
   ```bash
   ffmpeg -sseof -0.04 -i a.mp4 -frames:v 1 -q:v 1 lastframe.png
   ```
   (`-sseof -0.04` seeks to just before the true end — safer than `-i` + seek,
   which can land past the last frame on some containers.)
3. Generate clip B (5 s) with `lastframe.png` as the start image and the clip-B
   prompt from your model's file.
4. Concatenate:
   ```bash
   ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
     "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" \
     -c:v libx264 -crf 20 -pix_fmt yuv420p -movflags +faststart raw15.mp4
   ```
5. Downscale to your target:
   ```bash
   ffmpeg -i raw15.mp4 -vf "scale=960:1707:flags=lanczos" \
     -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart \
     -c:a aac -b:a 128k bambam-960x1707.mp4
   ```

## Fixing a seam

If there's still a visible snap:

- **Brightness jump** — normalise before concat:
  `-vf "eq=brightness=0.01:saturation=1.02"` on whichever clip is off.
- **Position jump** — clip B restarted the motion. Re-run B with the prompt
  reduced to just *"continue the same motion, he finishes drawing the teddy to
  his cheek."* Fewer words, less chance to reinterpret.
- **Grain jump** — add matching grain across the whole thing as a final pass.
  This is the most reliable seam-hider there is:
  ```bash
  ffmpeg -i raw15.mp4 -vf "noise=alls=6:allf=t+u" -c:v libx264 -crf 20 \
    -pix_fmt yuv420p -movflags +faststart bambam-960x1707.mp4
  ```
  Tune `alls` between 4 and 10 — enough to unify texture, not enough to read as
  noise.

## Audio

Veo 3.1 and Sora 2 generate native audio; use theirs, it's synced.

Kling and Runway Gen-4 output silent. Record the bed yourself — it's better than
any library. Phone voice-memo, 20 s, in a quiet bedroom:

```bash
# light clean-up, then loop to length
ffmpeg -i roomtone.m4a -af "highpass=f=80,lowpass=f=8000,volume=0.9" \
  -t 15 bed.wav
ffmpeg -i raw15.mp4 -i bed.wav -c:v copy -map 0:v -map 1:a \
  -c:a aac -b:a 128k -shortest bambam-960x1707.mp4
```

Rustle the duvet with your hand a couple of times during the recording — that
gives you the hoodie-and-sheet texture your brief asks for, with real timing.

**No music.** Your brief is explicit, and it's the right call: music over footage
this quiet turns it into a commercial and kills the "spontaneous at home" feel.
