# AI Vision Camera

A real, installable Android camera app that runs **100% on-device AI**. No cloud, no
accounts, no network permission — every enhancement is computed on the phone's own CPU
from the frames the camera sensor actually produced.

```
ai-vision-camera/
├── AI-Vision-Camera.apk          ← signed, installable build
├── app/
│   ├── AndroidManifest.xml
│   ├── res/                      ← icon + strings
│   └── src/com/aivision/camera/
│       ├── core/                 Util, Prefs, DeviceProfiler (tier detection)
│       ├── camera/               CameraCapabilities, CameraEngine (Camera2)
│       ├── gl/                   GlPreviewView — live AI preview shader
│       ├── ai/                   Planes, Imaging, SceneAnalyzer, MultiFrame,
│       │                         SuperResolution, SpecialModes, AiEngine
│       ├── capture/              PhotoSaver (JPEG/DNG + MediaStore), VideoController
│       ├── ui/                   Theme, Widgets, MainActivity (the camera screen)
│       └── gallery/              MediaRepo, GalleryActivity, ViewerActivity
└── keystore/aivision-debug.jks
```

## Install

```bash
adb install -r ai-vision-camera/AI-Vision-Camera.apk
```

Requires Android 8.0 (API 26) or newer. Camera + microphone permissions are requested on
first launch (microphone only for video sound).

## What it actually does

**Modes:** `PHOTO | VIDEO | PRO | NIGHT | AI`, with two always-visible action buttons —
**AI ENHANCE** (multi-frame denoise / detail / tone / colour) and **AI ULTRA**
(super-resolution reconstruction). In VIDEO mode the second button becomes **AI 4K**,
which arms the AI-Enhanced-4K pipeline for footage below 4K.

| Capability | How it is implemented |
| --- | --- |
| AI photo enhancement | Burst capture (1–24 frames, chosen from scene + motion) → per-frame alignment → multi-frame fusion → edge-aware denoise, detail restoration, local contrast, tone/vibrance finishing |
| AI Super Resolution | Multi-frame drizzle splat → unsharp acutance → iterative back-projection (simulate at sensor resolution, compare, re-inject) with an edge gate so detail stays real; finishes with microlocal contrast |
| AI Ultra Resolution | The same reconstruction at the maximum factor the device tier allows, capped by sensor resolution and RAM |
| Extreme zoom (up to 100×) | Optical/digital zoom up to the sensor's hardware maximum, then AI super-resolution for the digital range; the AI enhancement path auto-activates in the AI zoom zone and the zoom label marks it `… AI` |
| AI Night Mode | Long exposure (bounded by the sensor's real exposure range and frame rate) + N-frame stack with chroma denoise |
| AI HDR | Exposure-bracket capture + HDR fusion, with highlight roll-off that never clips to flat grey |
| Noise / blur reduction | Edge-preserving smoothing + noise-sigma-driven strength, chroma denoise, alignment-weighted stacking |
| Stabilisation | Optical/electronic stabilisation requested from the camera when the lens supports it, plus frame-alignment stacking to remove residual motion |
| Portrait | Depth map (when the device exposes one) or face-mask bokeh with guided-filter edge refinement, 2-scale disc blur and highlight bloom |
| Scene detection | Live luma analysis every preview frame: label, noise, edge density, motion, faces → drives enhancement strength |
| Auto exposure / focus / WB | Camera2 AE/AF/AWB with tap-to-focus, plus per-scene AF/AE hints |
| Face / text / object enhancement | Region-aware sharpening and tone, text regions get extra local contrast |
| RAW | DNG written with real sensor metadata when the sensor supports RAW_SENSOR |
| Pro mode | ISO, shutter time, focus distance, white balance, exposure compensation sliders with explicit AUTO pills; the sliders only offer values the sensor reports |
| Video | 1080p / 2K (1440p) / 4K chosen from the actual `CamcorderProfile` + stream-configuration support and validated against the recorder sizes the device exposes |
| AI Enhanced 4K | Recorded ≤1080p/2K footage is decoded, AI super-resolved per frame and re-encoded to 3840 px — always labelled **AI Enhanced 4K**, never presented as native 4K |
| Slow motion | High-speed capture sessions when the lens advertises high-speed sizes/fps (e.g. 120/240 fps) |
| Time-lapse | One frame per interval, encoded to MP4 with a real frame-rate conversion (never a sped-up fake) |
| Macro | Switches to the back lens that actually focuses closest, puts AF into close-range MACRO mode (when the lens advertises it) and reports the real working distance in cm |
| Panorama | Sequential capture with translation alignment and feathered blending on a growing canvas (16 MP / 8000 px caps) |
| Document scanner | Gradient-based quad detection, Gauss-Jordan homography rectify, edge-preserving clean-up, percentile levels and optional grayscale |
| Before / after | Every AI result can be stored next to the unprocessed frame, and the viewer shows a draggable divider comparison |
| Gallery | Grid (All / Photos / Videos / AI Ultra), video playback, delete, share, size + badge per item |

## Performance scaling

`core/DeviceProfiler.kt` reads SoC, core count and max frequency, RAM, GPU renderer, GLES
version, max texture size, ABI, Android release and the camera score, then classifies the
phone as **LOW / MID / FLAGSHIP**. That tier decides thread count, burst depth, upscale
cap, JPEG quality, whether Ultra is allowed at all, and how aggressive live preview
enhancement is. You can override the tier in the settings sheet (useful for testing).

## Honest labelling

* Native resolution always wins: if the sensor already resolves 4K (or the requested
  size), the app says so and does not upscale.
* Super-resolved output carries an `AI ULTRA • WxH` or `AI Enhanced 4K` label baked into
  the file description.
* 100× zoom is device-dependent; the dial shows the maximum the current lens can reach
  and marks the AI-assisted range.
* Nothing is claimed that the hardware refused: if a codec, high-speed profile or RAW
  stream is unavailable, the UI says so and falls back instead of faking.

## Building from source

The build is dependency-free: no Gradle, no AndroidX, no Play Services — just Kotlin
against the platform SDK, dexed with AOSP `dx`.

```bash
cd /home/user/neurio
python3 tools/android/toolchain.py            # downloads/verifies toolchain to /tmp/aivision-toolchain
python3 tools/android/build_apk.py            # → ai-vision-camera/AI-Vision-Camera.apk
```

Pipeline: `kotlinc` (`-jvm-target 1.8`, lambda/SAM class lowering) → `dx --min-sdk-version 26`
→ `aapt2 link` → pure-Python APK realign/package → `apksigner` v2+v3 (v1 off).
Current build: **229 classes, ~1.0 MB**, min SDK 26, target SDK 36, debug-signed with
`keystore/aivision-debug.jks` (alias `androiddebugkey`, password `android`).

## If the app closes by itself

Version 1.0.1 added a safety net, because a camera app that dies silently cannot
be fixed remotely:

* **Every startup step is traced.** A small `boot_trace.txt` records how far the
  launch got; it is deleted the moment the camera starts streaming. If a run dies
  before that, the next launch says *"Last run stopped unexpectedly"* and shows the
  last step reached, with **Copy report** / **Share** buttons.
* **No single failure can kill the process.** Exceptions on the camera thread, the
  GL thread, the worker pools, inside `onDraw`, or while creating the screen are
  caught, logged and reported in the UI instead of closing the app.
* **Crash reports are written twice:** in the app's private folder and in
  `Android/data/com.aivision.camera/files/` — the latter can be opened with a file
  manager even if the app refuses to start. `adb logcat -s AIVision AndroidRuntime`
  shows the same information live.
* **Memory is bounded before capture**, not after: the AI stream resolution and the
  burst length are derived from the device heap and tier (a 12-frame 24 MP stack
  would need ~1.7 GB of float planes). Single shots without AI still use the full
  sensor stream.

## Notes

* All image processing is hand-written Kotlin (planes, alignment, resampling, tone
  curves) — there is no ML model download, because the app has no network access and
  everything must work offline.
* Processing runs on a single serial worker so a photo never competes with the preview;
  long jobs report progress in the HUD.
* Photos and videos are written to `Pictures/AIVision` (and registered with MediaStore),
  so other apps can see them too.
