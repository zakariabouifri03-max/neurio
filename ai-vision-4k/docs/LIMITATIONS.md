# What Android will not let this app do

This file exists because the alternative — a product page full of "turns any game
into 4K" — is the reason nobody trusts this category of app. Every claim here is
also shown inside the app, in the same words.

## 1. An app cannot touch another app's rendering pipeline

Android's application sandbox gives every process its own address space, its own
`SurfaceFlinger` layer and its own GPU context. There is no supported API to:

* inject a shader, a compute pass or a post-process into another application,
* change another application's internal render resolution,
* read another application's frame rate, frame time or GPU timings,
* enumerate or reserve another application's GPU memory.

Without root, the only way in is *the game itself* integrating an SDK — which is
exactly what `docs/INTEGRATION.md` describes, and what the `IntegrationKind` flag
exists to record. Anything else is either:

* an **overlay** that re-scales the composited output. It adds latency, cannot
  recover detail that was never rendered, and is honestly labelled
  `EXPERIMENTAL` / `ScreenEnhance` here, or
* a **root/Magisk hook**, which this project does not ship or support.

## 2. There is no public NPU enumeration

Android exposes **NNAPI presence** and, through it, whether a driver reports an
accelerator. It does not expose the NPU's name, throughput or occupancy to a normal
application. So the app reports NNAPI *presence* and the accelerator flag, and
leaves the accelerator list empty with a note explaining why — rather than printing
a vendor name it guessed from the SoC string.

## 3. There is no SoC temperature for applications

`PowerManager.getThermalHeadroom()` is advisory and only meaningful in the range
`0.0–1.0`; `HardwarePropertiesManager` (the real per-core and skin temperatures) is
reserved for system apps. Battery temperature is readable, and that is what the
governor uses, together with the platform thermal status. The app's "SoC
temperature" row therefore stays `—`. It does not copy the battery value into it.

## 4. No frame rate for anything other than our own process

`Choreographer` timestamps are delivered to the process that owns the window. The
app's monitor and benchmark measure **its own** frame cadence, and both screens say
so. A number that looks like a game's FPS is never printed unless the game itself
reports it (an SDK-integrated title can, through `onFrameRendered`).

## 5. Resolution is a per-surface negotiation, not a global setting

A Vulkan swapchain's resolution is chosen by the app that owns it, subject to
`SurfaceHolder`/`SurfaceControl` constraints. Even with the SDK integrated, the
game must ask for the lower render resolution — the engine replaces what is drawn
into the output image, it does not resize the game's window.

## 6. MediaProjection is a bad fit for competitive play, and is marked experimental

Frame enhancement over `MediaProjection` requires an explicit consent prompt per
session. Frames arrive with capture and composition latency, DRM-protected surfaces
are excluded by the platform, and the capture path is CPU/GPU expensive. It is
implemented as a documented, opt-in, experimental mode — never as the default and
never advertised as competitive-grade.

## 7. Battery, thermal and storage are shared resources

Upscaling costs energy. On a device that is already thermally limited, the honest
outcome is a lower output resolution, not a higher one: the governor will step
quality down, and at `EMERGENCY` it suspends the AI stage entirely. The app will not
offer to "max out" a device that cannot sustain it, and the benchmark refuses to run
when the device is already hot.

## 8. A model is a file, not magic

The neural stage needs a `.v4kmodel` container. This build ships two *calibration*
models (`aiupscaler-sdk/src/main/assets/models/`): linear graphs whose output must
equal bilinear (sub-pixel architecture) or bicubic (global-residual architecture)
upscaling of the input. They exist so the container, the planner, the kernels and the
interpreter can be checked numerically on a real device — not because they look good.
Their image quality *is* bilinear/bicubic quality, and no screen in the app presents
them as an AI improvement.

No trained model ships, and no download server is configured. A trained model has to
be written into the same container with `v4k::writeModel()` and placed in the assets
or imported at runtime; `tools/model/README.md` describes that path. Quality then
depends on the model that was actually loaded — the compatibility engine degrades to
analytical upscaling rather than pretending.
