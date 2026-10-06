# Model tooling

Everything in this directory is about the `.v4kmodel` container: writing it,
checking it, and knowing what the file you are shipping actually does.

```
tools/model/
  export_v4kmodel.cpp              container writer + calibration checker
  generate-calibration-models.sh   builds it and regenerates the committed assets
  README.md                        this file
```

```bash
# Regenerate the models that ship in aiupscaler-sdk/src/main/assets/models/
tools/model/generate-calibration-models.sh

# CI: rebuild into a temp dir and fail if a committed asset is stale
tools/model/generate-calibration-models.sh --check
```

## There is no trained model in this repository

`aiupscaler-sdk/src/main/assets/models/` contains two **calibration models**.
They are not a super-resolution network and they do not improve picture quality.
Both are deliberately *linear*:

| file | graph | output must equal |
| --- | --- | --- |
| `reference_sr_x2_subpixel.v4kmodel` | conv 3→3 → conv 3→3 → conv 3→12 → PixelShuffle | `resizeBilinear()` of the input |
| `reference_sr_x2_residual.v4kmodel` | conv 3→12 (zero weights) → PixelShuffle, `kModelFlagGlobalResidual` | `resizeBicubic()` of the input |

They exist because "we have no model" and "our pipeline is numerically correct"
are different statements, and only the second one can be checked without a
trained network. A calibration model exercises the whole path — header, op table,
weight blob, SHA-256 digests, the GPU plan and its memory budget, the conv and
pixel-shuffle kernels, the residual add, the final clamp — and then reports a
number that has a right answer. On a device, `--verify`-style checks against
these files are the strongest evidence that the AI stage is not fake: if the
kernels are wrong, the images do not match and the check fails loudly.

What they cannot tell you is whether the upscaling looks good, because there is
nothing learned in them. Bilinear and bicubic quality is exactly what they
produce. Any screen that shows them says so.

## Exporting a real model

The container is the contract; a trained network has to be written into it. The
supported path is this tool:

1. **Train** a small SR network whose operations are the ones the engine
   implements (`Conv2d`, `DepthwiseConv2d`, `PReLU`, `Add`, `ConcatInput`,
   `PixelShuffle` — see `ai/v4k_model.h`).
2. **Write the graph** with `v4k::Model` + `v4k::writeModel()` — the same writer
   this tool calls, so the file cannot drift from the loader. Weights are laid
   out `[outputChannels][inputChannels][kernel][kernel]`, biases
   `[outputChannels]`, and the body digest is a SHA-256 over the op table plus
   the weight blob computed for you.
3. **Verify numerically** with `v4k::CpuInference` (the reference interpreter).
   For a trained model the check is "the interpreter agrees with your training
   framework on a fixed input", not "the output equals bilinear".
4. **Pre-flight the planner** with `--plan-check`. A model that needs more
   activation memory than the session budget is rejected on device; catching it
   here costs seconds.
5. **Measure on a device.** Inference time, thermal behaviour and how it looks at
   720p→1440p are device facts. Nothing in this repository may quote them until
   they have been measured.

`--tier`, `--scale` and `--fp16` exist because the container supports them
(low/medium/high quality tiers, x2/x4, FP32/FP16/INT8 weights); they are not
quality settings for the calibration graphs.

## What the calibration check catches

It is not a formality. Writing this tool immediately found two real defects in
code that had passed every existing test:

* `CpuInference::upsampleInput()` wrapped a **planar** (CHW) tensor in a
  `struct Image`, which is **interleaved** (HWC). Channels were silently
  scrambled and the global-residual path was 0.65 (of 1.0) away from bicubic.
  Fixed in `ai/v4k_cpu_infer.cpp`, with a regression test.
* The sub-pixel phase table has to be exactly "0.75 on the centre tap, 0.25 on
  the neighbour that lies in the direction of the half-pixel offset". A table
  that is off by one tap shifts the image by half an output pixel and lands
  around 13 dB against bilinear, which is easy to mistake for "AI quality".

The interleaved/planar confusion is now impossible to repeat by accident:
`core/v4k_image.h` exposes `imageToPlanar()` / `imageFromPlanar()` and says why.

## Honesty rules for anything built on this

* A calibration model's PSNR against bilinear/bicubic is a *pipeline* result, not
  a quality claim. Never put it on a screen as an AI quality figure.
* `--init untrained` produces noise on purpose (useful for shaking out kernels
  with non-saturating values). It must never be shipped or benchmarked.
* Timing printed by this tool is a single-threaded host CPU figure. It says
  nothing about a phone GPU.
* The session activation budget is a policy
  (`v4k::defaultWorkingSetBudget()`), not a measurement of any particular
  device's allocator.
