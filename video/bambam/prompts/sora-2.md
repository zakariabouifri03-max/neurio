# Sora 2 — recommended first attempt

**Best for:** a genuine 15-second single take. Sora 2 is the only model here that
reliably reaches 15 s in one generation, which is exactly what your "no cuts,
no transitions" brief needs.

**Limitation:** no negative-prompt field. Constraints go *into* the prompt.

## Settings

| | |
|---|---|
| Mode | Image-to-video (start frame = your BamBam reference) |
| Aspect | 9:16 → 1080×1920 |
| Duration | **15 s** (if your tier caps at 10 s, see chaining.md) |
| Audio | On |

## Prompt

```
A single continuous locked-off smartphone shot, recorded from slightly above and
to the side of a bed, hand-held with only the faint micro-drift of a real phone.
The same tiny baby macaque and the same honey-brown plush teddy bear as the
reference frame — identical fur, face, charcoal-gray hoodie, proportions and
lighting. He is asleep on his side on cream sheets, hugging the teddy to his
chest, and he does not wake at any point.

Over fifteen seconds: his chest rises and falls with slow shallow sleep
breathing. Around four seconds his fingers flex and curl into the teddy's plush
fabric and one forearm draws the toy a few centimetres toward his chest. Through
the middle seconds both arms bend at the elbow and slowly, slightly clumsily,
drag the teddy across the sheet against the fabric friction until the bear's head
comes to rest against his cheek. He makes one small sleepy nuzzle — a brief rub
of his cheek against the plush head — then his fingers relax and he goes still,
one arm draped over the bear, other hand resting on its body, breathing slowly
against it.

Constraints: his eyes stay closed the entire time and he never wakes. The teddy
is an ordinary inanimate toy — it moves only where his arms push and pull it,
its plush compresses under his grip, and it drags against the sheet rather than
gliding. One unbroken take with no camera movement, no pan, no zoom, no cut, no
transition. No music, no voiceover, no narration, no sound effects, no text, no
subtitles, no watermark. Photorealistic home video, not animation or CGI: soft
natural window light, authentic fur and fabric texture, natural skin, shallow
phone-sensor depth of field, accurate muted colours.

Audio: quiet bedroom room tone, soft fabric rustle from the hoodie, pillow and
sheets, faint slow breathing.
```

## Notes

- The **Constraints** paragraph is doing the work the negative prompt does on
  other models. Don't cut it for length.
- Sora 2 tends to add gentle camera drift on its own. That's fine and arguably
  desirable here — you asked for hand-held. But if it starts to *push in*, add
  "the camera does not move closer at any point."
- If the 15 s version goes soft or wobbly in the last third, drop to 10 s and
  chain a 5 s settling clip (see `chaining.md`). The chain is more reliable than
  fighting a degraded 15 s generation.
