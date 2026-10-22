# Runway Gen-4

**Best for:** strong reference-image adherence — often the most faithful to the
character in the start frame. Respects motion exclusions well.

**Limitation:** 10 s max per generation. Chain 10 s + 5 s.

## Settings

| | |
|---|---|
| Mode | Image-to-video (start image = BamBam reference) |
| Aspect | 9:16 → 1080×1920 |
| Duration | 10 s (A), then 5 s (B) |
| Motion | **Low.** Your brief is almost entirely stillness; a high motion
slider will overshoot into jerky movement. |

---

## Clip A — 0 → 10 s (10 s)

```
Prompt (paste as one line):
A locked-off hand-held smartphone shot from slightly above the bed, no camera
movement, no zoom, no cuts. The same baby macaque and the same honey-brown plush
teddy bear as the reference image — identical fur, face, charcoal-gray hoodie,
proportions and lighting — asleep on his side on cream sheets, hugging the teddy.
His chest rises and falls with slow shallow sleep breathing, then his fingers
flex and curl into the teddy's plush fabric and one forearm draws the toy a few
centimetres toward his chest. Then both arms bend at the elbow and slowly,
slightly clumsily, drag the teddy across the sheet against the fabric friction
toward his face. His eyes stay closed the entire time and he does not wake. The
teddy is an inanimate toy that moves only where his arms pull it, and its plush
compresses under his grip. Photorealistic home video, soft natural window light,
authentic fur and fabric detail, shallow phone-sensor depth of field.

Avoid:
open eyes, waking up, looking at camera, standing up, sudden jerks, exaggerated
gestures, human-like kissing, extra fingers, duplicated limbs, morphing,
flickering, clothing change, fur colour change, teddy design change, floating
teddy, self-moving toy, camera movement, pan, zoom, scene cut, cartoon, 3D
render, CGI look, cinematic lighting, music, narration, sound effects, text,
subtitles, watermark
```

## Clip B — 10 → 15 s (5 s)

**Start image = the exact last frame of clip A.**

```
Prompt (paste as one line):
A locked-off hand-held smartphone shot, identical framing, lighting and
character to the start frame, no camera movement. Continuing the same sleeping
baby macaque: he brings the teddy's head the last few centimetres to his cheek,
makes one small sleepy nuzzle — a brief rub of his cheek against the plush head —
then his fingers relax and he goes still, one arm draped over the bear and the
other hand resting softly on its body, cheek still nestled against the toy,
breathing slowly. His eyes stay closed. The bedding settles after the movement.
Photorealistic home video, soft natural window light, authentic fur and fabric
detail.

Avoid: [same list as clip A]
```

---

## Notes

- Gen-4's reference adherence is its strength — lean on it. Keep the appearance
  text short and let the image do the work.
- If clip B drifts from clip A's look, re-run B with **only** the last frame of
  A as the image input and drop the appearance sentence entirely.
- Gen-4 outputs silent. Add the ambience bed in post — see `chaining.md`.
