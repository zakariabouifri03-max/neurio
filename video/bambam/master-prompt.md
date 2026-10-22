# Master prompt (canonical)

This is the reference version. Per-model files in `prompts/` adapt it — use those
directly, this file just documents the intent.

**Design note:** deliberately light on appearance. The reference image supplies
BamBam's look; the prompt spends its words on motion, camera and physics. See
README for why.

---

## Prompt

> A single continuous locked-off smartphone shot, recorded from slightly above
> and to the side of a bed, hand-held with only the faint micro-drift of a real
> phone. No camera movement, no pans, no zooms, no cuts.
>
> The same tiny baby macaque and the same honey-brown plush teddy bear as the
> reference frame — identical fur, face, charcoal-gray hoodie, proportions and
> lighting. He is asleep on his side on cream sheets, hugging the teddy to his
> chest, and he does not wake at any point.
>
> Over fifteen seconds: his chest rises and falls with slow, shallow sleep
> breathing. Around four seconds his fingers flex and curl into the teddy's
> plush fabric and one forearm draws the toy a few centimetres toward his chest.
> Through the middle seconds both arms bend at the elbow and slowly, slightly
> clumsily, drag the teddy across the sheet against the fabric friction, until
> the bear's head comes to rest against his cheek. He makes one small sleepy
> nuzzle — a brief rub of his cheek against the plush head — then his fingers
> relax and he goes still, one arm draped over the bear, other hand resting on
> its body, breathing slowly against it.
>
> His eyes stay closed the entire time. The teddy is an ordinary inanimate toy:
> it moves only where his arms push and pull it, its plush compresses under his
> grip, and it drags against the sheet rather than gliding.
>
> Realistic home video. Soft natural window light, gentle natural shadows,
> authentic fur and fabric detail, accurate colours, shallow phone-sensor depth
> of field. Sound: quiet bedroom room tone, soft fabric rustle from the hoodie
> and sheets, faint slow breathing. No music.

## Negative

See [`negative-prompt.md`](negative-prompt.md).

---

## Why it's written this way

**"Around four seconds" / "through the middle seconds"** — video models have
weak absolute time sense. Relative and ordinal cues ("then", "after", "around a
third of the way through") land far more reliably than a stopwatch.

**"Drag against the fabric friction"** — the single highest-value physics phrase
in the prompt. Without it the bear tends to glide or float. With it, you get
contact and resistance, which is what sells the whole clip.

**"One small sleepy nuzzle"** — the count matters. Say "nuzzles" and you get an
exaggerated repeated motion that reads staged.

**"Eyes stay closed the entire time"** — appears twice (once in the negative).
Worth the redundancy: waking up is the most common single failure on this brief,
because models treat eye-opening as the default way to show a subject is alive.

**"Breathing slowly against it"** in the final beat — gives the model something
tiny and continuous to animate during the still section. A near-static end beat
tends to freeze completely and go waxy; breathing keeps it alive without motion.
