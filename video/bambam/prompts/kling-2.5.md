# Kling 2.5

**Best for:** excellent physics and fabric deformation; honours negative prompts
very well, including camera-movement exclusions.

**Limitation:** 10 s max. Chain 10 s + 5 s to reach 15 s.

## Settings

| | |
|---|---|
| Mode | Image-to-video (start image = BamBam reference) |
| Aspect | 9:16 |
| Duration | 10 s (clip A), then 5 s (clip B) |
| Creativity | **Low–medium.** High creativity = drifting fur and hoodie. |
| cfg_scale | ~0.4–0.5 |

---

## Clip A — 0 → 10 s (10 s)

Ends mid-pull, just before the nuzzle.

```
prompt (paste as one line):
Locked-off hand-held smartphone shot from slightly above the bed, no camera
movement, no zoom, no cuts. The same baby macaque and honey-brown plush teddy as
the reference image, identical fur, hoodie and proportions, asleep on his side on
cream sheets. His chest rises and falls with slow sleep breathing. His fingers
flex and curl into the teddy's plush fabric, one forearm draws the toy a few
centimetres toward his chest, then both arms bend at the elbow and slowly,
slightly clumsily, drag the teddy across the sheet against the fabric friction
toward his face. His eyes stay closed the entire time, he does not wake. The
teddy is an inanimate toy and moves only where his arms pull it. Photorealistic
home video, soft natural window light, authentic fur and fabric detail, shallow
phone depth of field.

negative_prompt:
open eyes, waking up, looking at camera, standing up, sudden jerks, exaggerated
gestures, extra fingers, duplicated limbs, morphing, flickering, clothing change,
fur colour change, teddy design change, floating teddy, self-moving toy, camera
movement, pan, zoom, scene cut, cartoon, CGI look, cinematic lighting, music,
narration, text, subtitles, watermark
```

## Clip B — 10 → 15 s (5 s)

**Start image = the exact last frame of clip A.** Do not re-upload the original
reference — that's what creates a visible seam.

```
prompt (paste as one line):
Locked-off hand-held smartphone shot, identical framing and lighting to the
start frame, no camera movement. Continuing the same sleeping baby macaque: he
draws the teddy's head the last few centimetres to his cheek, makes one small
sleepy nuzzle, a brief rub of his cheek against the plush head, then his fingers
relax and he goes still, one arm draped over the bear and the other hand resting
on its body, breathing slowly against it. His eyes stay closed. The bedding
settles after the movement. Photorealistic home video, soft natural window
light, authentic fur and fabric detail.

negative_prompt: [same block as clip A]
```

---

## Stitching

```bash
# trim clip A's last frame out if it duplicates clip B's first
ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
  "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 20 \
  -pix_fmt yuv420p kling-15s.mp4
```

Then downscale to 960×1707 — command in the README.

For the audio bed, see `chaining.md`.
