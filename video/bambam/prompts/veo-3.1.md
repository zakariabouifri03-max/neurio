# Veo 3.1

**Best for:** native audio, strong physics, great fabric and fur detail.
**Limitation:** ~8 s per generation. Use the extend feature, or chain
(see [`../chaining.md`](../chaining.md)).

## Settings

| | |
|---|---|
| Mode | Frames-to-video (first frame = your BamBam reference) |
| Aspect | 9:16 → 1080×1920 |
| Length | 8 s (then extend, or chain A+B) |
| Audio | **On** — Veo generates native audio from the prompt |
| Seed | Lock it if exposed |

## JSON

```json
{
  "aspectRatio": "9:16",
  "durationSeconds": 8,
  "resolution": "1080p",
  "generateAudio": true,
  "prompt": "A single continuous locked-off smartphone shot, recorded from slightly above and to the side of a bed, hand-held with only the faint micro-drift of a real phone. No camera movement, no pans, no zooms, no cuts. The same tiny baby macaque and the same honey-brown plush teddy bear as the reference frame — identical fur, face, charcoal-gray hoodie, proportions and lighting. He is asleep on his side on cream sheets, hugging the teddy to his chest, and he does not wake. His chest rises and falls with slow shallow sleep breathing. Then his fingers flex and curl into the teddy's plush fabric and one forearm draws the toy a few centimetres toward his chest. Then both arms bend at the elbow and slowly, slightly clumsily, drag the teddy across the sheet against the fabric friction until the bear's head rests against his cheek. He makes one small sleepy nuzzle, a brief rub of his cheek against the plush head, then his fingers relax and he goes still, one arm draped over the bear, breathing slowly against it. His eyes stay closed the entire time. The teddy is an ordinary inanimate toy: it moves only where his arms push and pull it, its plush compresses under his grip, and it drags against the sheet rather than gliding. Realistic home video, soft natural window light, authentic fur and fabric detail, shallow phone-sensor depth of field. Audio: quiet bedroom room tone, soft fabric rustle from the hoodie and sheets, faint slow breathing. No music, no speech.",
  "negativePrompt": "open eyes, waking up, looking at camera, standing up, sudden jerks, exaggerated gestures, human-like kissing, extra fingers, duplicated limbs, morphing, flickering, clothing change, fur colour change, teddy design change, floating teddy, self-moving toy, camera movement, zoom, scene cut, cartoon, CGI look, cinematic lighting, music, narration, sound effects, text, subtitles, watermark"
}
```

## Reaching 15 s

Veo's ~8 s cap means one of two routes:

1. **Extend** — generate 8 s, then use *Extend* twice more, re-prompting with
   only the next beat ("he drags the teddy to his cheek", then "he nuzzles once
   and settles"). Feed each new segment only the beat it covers; restating the
   whole 15 s arc makes Veo restart the motion.
2. **Chain** — see `chaining.md`.

Route 1 is usually cleaner with Veo, because its extend feature keeps camera and
grain consistent for you.
