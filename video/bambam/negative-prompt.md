# Negative prompt

## Universal block (all models)

Paste this as-is unless your model's docs say otherwise.

```
waking up, opening eyes, eyes open, blinking, looking at camera, eye contact,
speaking, talking, mouth moving, vocalising, standing up, sitting up, leaving
the bed, sudden jerks, sudden movement, fast motion, exaggerated gestures,
human-like kissing, lip puckering, smiling, unnatural facial expression,
human-like hand gestures, waving,
extra fingers, extra thumbs, missing fingers, duplicated limbs, extra arms,
extra legs, deformed hands, morphing, warping, flickering, melting,
shape-shifting, identity drift,
changing clothes, clothing change, hoodie changing colour, fur colour change,
fur texture change, teddy bear design change, teddy changing appearance,
floating objects, teddy floating, teddy moving by itself, self-animating toy,
teddy stretching, teddy changing size,
camera movement, camera pan, camera tilt, camera push in, zoom, dolly,
orbit, dramatic angle change,
scene cut, shot change, transition, crossfade, cut to,
cartoon, anime, 3D render, CGI look, plastic skin, uncanny valley,
illustration, painting, stylised, airbrushed,
cinematic lighting, rim light, dramatic shadows, colour grading, HDR,
bokeh, lens flare, slow motion, speed ramp,
music, soundtrack, narration, voiceover, dialogue, speech,
artificial sound effects, cartoon sound effects, whoosh, sparkle,
text, subtitles, captions, title card, watermark, logo, overlay, UI
```

## Per-model syntax

### Veo 3.1 — JSON field

Veo rejects the strongest terms and **ignores negation of things it wasn't going
to do anyway**. Keep it to the real risks:

```json
"negativePrompt": "open eyes, waking up, looking at camera, standing up,
  sudden jerks, exaggerated gestures, extra fingers, duplicated limbs, morphing,
  flickering, clothing change, fur colour change, teddy design change, floating
  teddy, self-moving toy, camera movement, zoom, scene cut, cartoon, CGI look,
  cinematic lighting, music, narration, sound effects, text, subtitles, watermark"
```

### Sora 2 — no negative field

Sora 2 has **no negative prompt parameter**. Instead, put the constraint in the
positive prompt as a closing line. It responds to this well:

> Constrain: eyes stay closed the entire time; he never wakes; the teddy is
> inanimate and moves only when his arms move it; a single locked-off shot with
> no camera movement; no text, watermark, music, or voiceover anywhere in frame.

### Kling 2.5 — `negative_prompt`

Pass the universal block directly. Kling honours negatives well, including
`no camera movement` and `no scene cut`.

### Runway Gen-4 — `negative_prompt` / "Avoid" box

Pass the universal block. Runway is notably good at respecting
`sudden jerks` and `camera movement` exclusions.

---

## On "no CGI appearance"

You can't actually negative-prompt your way out of this one — every model here
outputs synthetic video, so "no CGI look" is asking the tool not to look like
itself. What the phrase usefully does is push the model away from *stylised* CGI
(plastic skin, smooth render, 3D-toon shading) and toward photographic texture.

If the result still reads as render, the fix isn't in the prompt. It's in the
**reference image**: feed it a photo with real grain, real sensor noise, slightly
blown highlights, and natural motion blur. The video inherits texture from the
start frame far more than it invents it.
