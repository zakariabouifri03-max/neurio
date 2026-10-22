# BamBam — 15 s vertical sleeping-with-teddy clip

A model-ready prompt package for generating the requested clip. **No video is
rendered in this workspace** — there is no video model available here (only
still-image generation). These files are what you paste into a real image-to-video
model together with your BamBam reference image.

---

## Read this first: two constraints that will bite you

### 1. A 15-second single unbroken take is at or past every model's limit

| Model | Typical max clip | 15 s in one shot? |
|---|---|---|
| **Sora 2** (Pro) | up to ~20 s (10 s / 15 s / 20 s tiers) | ✅ usually yes |
| **Veo 3.1** | ~8 s per generation (extendable) | ⚠️ needs extension or chaining |
| **Kling 2.5** | ~10 s (5 s / 10 s) | ⚠️ needs chaining |
| **Runway Gen-4** | ~10 s (5 s / 10 s) | ⚠️ needs chaining |

Your brief says *"one continuous, uninterrupted recording… no cuts, no
transitions."* If you use a 10 s model you must **chain two clips** using the
last frame of clip A as the first frame of clip B. Done right this is invisible
— but see [`chaining.md`](chaining.md), because the naive version creates a
visible seam right where the nuzzle happens.

**Recommended:** try **Sora 2** first at 15 s. If the motion gets sloppy in the
back half, fall back to the two-clip chain.

### 2. 960×1707 is not a standard output size

Every model outputs 1080×1920 (or 720×1280) for 9:16. Generate at 1080×1920 and
downscale — 960×1707 is the same aspect ratio (0.5624 vs 0.5625), so this is
lossless in proportions:

```bash
ffmpeg -i in-1080x1920.mp4 -vf "scale=960:1707:flags=lanczos" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart \
  -c:a aac -b:a 128k bambam-960x1707.mp4
```

---

## The most important technique: don't re-describe BamBam

This is where most people lose character consistency. In **image-to-video**, the
reference image already carries his entire appearance — face, fur, hoodie,
proportions. If you also write three paragraphs describing golden-brown fur and
a pinkish-brown face, you are arguing with your own reference image, and the
model splits the difference. Result: fur that drifts, a face that morphs, a
hoodie that changes shade. All of which are on your own negative list.

So the prompts in `prompts/` deliberately do the opposite:

- **Appearance:** one short anchor line ("the same macaque and the same teddy as
  the reference frame — identical fur, hoodie, and proportions"). That's it.
- **Motion:** most of the word count. This is what I2V models actually steer on.
- **Physics constraints:** stated explicitly ("the bear moves only where his arms
  push it", "its plush compresses under his grip"). Models respect these
  surprisingly well and it's your best defence against a self-animating toy.

If your model exposes a **seed**, lock it. Same seed + same reference frame is
the single biggest consistency win available.

---

## Files

| File | What it's for |
|---|---|
| [`shot-list.md`](shot-list.md) | Beat-by-beat 0→15 s timing map |
| [`master-prompt.md`](master-prompt.md) | The canonical prompt. Read this once for intent. |
| [`prompts/veo-3.1.md`](prompts/veo-3.1.md) | Veo 3.1 — JSON, native audio |
| [`prompts/sora-2.md`](prompts/sora-2.md) | Sora 2 — best bet for a true 15 s take |
| [`prompts/kling-2.5.md`](prompts/kling-2.5.md) | Kling 2.5 — 2×10 s chain |
| [`prompts/runway-gen4.md`](prompts/runway-gen4.md) | Runway Gen-4 — 2×10 s chain |
| [`negative-prompt.md`](negative-prompt.md) | Negative prompt, per-model syntax |
| [`chaining.md`](chaining.md) | How to reach 15 s with no visible cut |

---

## Workflow

1. Pick your model, open the matching file in `prompts/`.
2. Upload **your BamBam reference image** as the first frame / start image.
3. Paste the prompt. Set 9:16 / 1080×1920. Lock the seed if you can.
4. Generate. Judge it on **motion quality**, not on whether it looks like him —
   the reference frame handles that.
5. If it drifts, don't rewrite the whole prompt. Shorten the motion description
   and re-anchor: *"identical to the reference frame throughout."*

---

## Two notes worth having

**Label it as AI-generated.** You're asking for output engineered to be
indistinguishable from real home footage of a baby primate. TikTok, YouTube and
Instagram all require synthetic-media disclosure, and undisclosed realistic
animal content is exactly the category their classifiers flag — you're risking
the account for a clip that's cute either way. Every major model also burns an
invisible watermark in; don't strip it.

**Related, and the reason to be careful:** realistic "pet baby monkey" footage is
the demand side of a real trade. Infant macaques are poached for social-media
content — mothers are killed to take the infant, and most die in transit. Footage
that reads as authentic drives that market, which is a good reason to keep the
AI disclosure on rather than off.

---

## Rendering here (if you want it done locally)

The repo already has a frame-render → encode pipeline at `tools/video/`, but it
is a **vector cartoon** renderer (`cartoon.py` draws shapes with Pillow). It
cannot produce photorealistic footage, so it is not a path to this brief.
