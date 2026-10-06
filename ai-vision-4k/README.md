# AI Vision 4K

Real-time AI graphics upscaling for Android games — *for games that opt in*, plus a
truthful measurement app for everything else.

This repository contains a complete Android project: a reusable SDK module
(`aiupscaler-sdk`) that owns all the native code (C++17, Vulkan compute, NNAPI, JNI)
and an end-user application (`app`) built with Kotlin + Jetpack Compose.

---

## Read this first: what this can and cannot do

**Android does not let one application replace another application's rendering
pipeline.** There is no supported, non-root API to inject a shader into a game you
do not own, to change its internal render resolution, or to read its frame rate.
Any product claiming otherwise is rooted, is re-scaling a screenshot in an overlay
and calling it "AI", or is inventing its numbers.

So this project does two honest things instead:

1. **For a game that links the SDK** — the supported integration path — the engine
   genuinely replaces the render resolution. The game hands over its own Vulkan
   device, queues and images; the engine records its compute passes into the game's
   command buffer and writes the reconstructed frame into an image the game already
   owns. This is the same contract DLSS/FSR-style upscalers use on desktop, applied
   to Vulkan on Android.
2. **For every other game** — the app measures the device for real, stores a
   per-game graphics profile, keeps the thermal guard running, and shows you live
   CPU/RAM/thermal data. It tells you, per game, *why* in-pipeline upscaling is not
   available and links you to the SDK for a developer who can enable it.

Nothing in this project fabricates a frame rate, an inference time or a benchmark
result. Every measurement shown to the user comes from the device it is running on,
and values the platform refuses to report (SoC temperature, NPU utilisation, another
app's FPS) are displayed as `—`, never as a plausible-looking number.

---

## Status

| Component | State |
|---|---|
| Native engine (C++17): device probe, compatibility rules, profiles, thermal governor, metrics, image pipeline, model container + CPU reference interpreter, GPU execution planner, Vulkan compute backend, shader registry (25 embedded SPIR-V blobs) | Implemented, host-tested |
| JNI bridge (`jni/v4k_jni.cpp`) — one static engine, JSON in/out, allocation-free frame path | Implemented |
| Kotlin SDK (`AIUpscaler`, typed models, Android caps collector, GLES probe) | Implemented |
| App: dashboard, supported games, profiles, live monitor, thermal safety, AI engine / model manager, benchmark, settings, honest sandbox explanation | Implemented (this APK) |
| Per-game profiles, preset ladder, compatibility tiers, battery-saver behaviour | Implemented |
| Vulkan demo host (`cpp/demo`) with a live Native ↔ AI comparison | **Not in this build** — planned; the app says so on the benchmark screen instead of estimating |
| Bundled/downloadable `.v4kmodel` files | **Not in this build** — the model manager imports a file you generate with `tools/model/export_v4kmodel.py` |
| MediaProjection `ScreenEnhance` mode | Experimental, documented, not enabled by default |
| On-device instrumentation tests for the Vulkan path | Not written yet |

The APK built by CI is a **debug-signed test build** — install it with
"unknown sources" enabled and expect it to be replaced by a properly signed build
later.

---

## Architecture

```
ai-vision-4k/
├── app/                                  # the end-user application (Compose)
│   └── src/main/java/com/aivision4k/app/
│       ├── AiVision4KApp.kt              # Application: engine bring-up
│       ├── MainActivity.kt               # Compose host, navigation, permissions
│       ├── AppViewModel.kt               # one UiState, one refresh tick per second
│       ├── benchmark/FrameCadenceProbe.kt# real Choreographer frame-cadence probe
│       ├── games/                        # installed-app scan + supported-game catalog
│       ├── monitor/                      # foreground monitoring service + system overlay
│       ├── settings/AppSettings.kt       # per-game profile library (persisted)
│       └── ui/                           # theme, components, screens
├── aiupscaler-sdk/                       # the reusable engine + developer API
│   └── src/main/
│       ├── cpp/
│       │   ├── core/                     # json, log, sha256, image, profiles,
│       │   │                             # thermal governor, metrics, compatibility
│       │   ├── ai/                       # model container, model catalog,
│       │   │                             # CPU reference interpreter, GPU plan builder
│       │   ├── vulkan/                   # instance/device probe, allocator, images,
│       │   │                             # pipelines, swapchain, shader registry
│       │   ├── sdk/v4k_engine.{h,cpp}    # the façade the JNI layer owns
│       │   ├── jni/v4k_jni.cpp           # the whole Kotlin ↔ C++ boundary
│       │   ├── shaders/                  # 25 GLSL 450 sources + checked-in SPIR-V
│       │   └── tests/                    # host test suite (no device needed)
│       └── java/com/aivision4k/sdk/      # AIUpscaler, EngineTypes, caps collector
├── docs/                                 # BUILD / INTEGRATION / LIMITATIONS
└── tools/                                # native test runner, verify gate, shader builder
```

### The upscaling pipeline

```
low-resolution frame
   ↓  preprocess_luma        luma + colour conversion, planar packing
   ↓  motion_estimate        block matching, when the renderer supplies no vectors
   ↓  sr_conv / elementwise / pixel_shuffle / prelu / downsample   ← the neural stage
   ↓  temporal_accum         motion-aware history accumulation (rejects stale frames)
   ↓  edge_reconstruct       edge/detail reconstruction + denoise
   ↓  aa_resolve             anti-aliasing resolve
   ↓  sharpen                adaptive sharpening (0–100 %)
   ↓  quality_metrics        PSNR / SSIM against a reference, for the benchmark
   ↓  output image (1080p / 1440p / 4K)
```

Backends: **Vulkan compute** (primary), **NNAPI** (for operators the device
accelerates), **CPU reference interpreter** (`ai/v4k_cpu_infer.cpp` — exact, slow,
used for the golden tests). The compatibility engine reports which one is actually
in use; it never assumes.

Low latency is an explicit design constraint: the engine keeps **one frame in
flight**, records into the caller's command buffer, and every stage runs at the
lowest resolution that preserves the result (motion estimation at half resolution,
history at output resolution, and so on).

---

## Compatibility tiers

| Tier | Meaning |
|---|---|
| `SUPPORTED` | A game that links the SDK on a device that passes every probe: Vulkan compute queue, adequate memory budget, sane driver. |
| `PARTIALLY_SUPPORTED` | Works, with a documented reduction — e.g. no FP16 storage, no GPU timestamps, low memory budget. |
| `EXPERIMENTAL` | Demo/scene mode, MediaProjection frame enhancement, or a driver known to be buggy. Never silently enabled. |
| `UNSUPPORTED` | Software renderer (SwiftShader/llvmpipe), unusable Vulkan, missing model *and* no analytical fallback, or an API level below the minimum. The app explains which rule fired. |

The `Why?` panel on the dashboard lists **every** rule that influenced the verdict,
with the blocking ones first — that is the whole point of the tier system.

---

## Thermal safety

The governor reads battery temperature, the platform thermal status, the frame-time
history and (where available) the display refresh rate. It steps quality down
*before* the device throttles:

* SoC thresholds 68/73/78/83/88/93 °C, battery thresholds 38/41/43/45/47/49 °C,
* Ultra → High → Medium, 4K → 1440p → 1080p, 100 % → 83 % → 75 % → 67 % → 60 % → 50 %,
* one step at a time, 4 °C hysteresis and a 20 s cooldown so it cannot oscillate,
* the AI stage is suspended entirely at `EMERGENCY`, and the app stops monitoring
  before the OS would have to kill something.

The app never tries to make a device hotter than the user asked for: there is no
"sustained stress" mode, and the benchmark refuses to run when the governor is
already at `CRITICAL`.

---

## Verification

```bash
# 1. The platform-independent core: profiles, thermal, compatibility, metrics,
#    image quality, SHA-256, model container, CPU interpreter, GPU plan.
tools/run-native-tests.sh                 # 15 931 checks, 106 cases, 0 failures

# 2. The full gate (needs a C++17 compiler; optionally the Vulkan headers and a
#    JDK's jni.h to syntax-check the Vulkan and JNI layers too).
V4K_VULKAN_INCLUDE=/path/to/Vulkan-Headers/include \
V4K_JNI_INCLUDE=/path/to/jdk/include \
tools/verify.sh                           # 6 steps: shaders, embedding, tests, syntax
```

The Android build itself (Gradle + NDK + R8) runs in CI
(`.github/workflows/ai-vision-4k-apk.yml`), which is also where the APK is produced.

---

## Building

See **[docs/BUILD.md](docs/BUILD.md)** for the full instructions (Android Studio and
command line, the exact NDK/CMake versions, and what to do when a device is not
supported). Short version:

```bash
# Android Studio: open the ai-vision-4k folder, let it sync, Run.
# Or with a local Gradle 8.9+ and JDK 17:
gradle :app:assembleDebug
```

Requirements: JDK 17, Gradle 8.9+, Android SDK 35, NDK 27.3.13750724, CMake 3.22.1,
`minSdk 26`, ABIs `arm64-v8a` and `x86_64`.

### Permissions

| Permission | Why |
|---|---|
| `POST_NOTIFICATIONS` | The monitoring foreground service shows one notification. Refusing it only means the readings stay inside the app. |
| `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_SPECIAL_USE` | Keeps the thermal guard and the readings alive while a game is in front. |
| `SYSTEM_ALERT_WINDOW` | The metrics overlay. It can *display* only; it cannot touch another app's rendering. |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Reserved for model downloads. No endpoint is configured in this build, and the app talks to no server. |

There is no `QUERY_ALL_PACKAGES`: the `<queries>` block asks only for launcher
activities, which is all the supported-games list needs.

---

## Integrating the SDK into a game

```kotlin
AIUpscaler.initialize(context, IntegrationKind.SdkIntegrated)
AIUpscaler.setOutputResolution(3840, 2160)
AIUpscaler.setQuality(UpscalingQuality.High)
AIUpscaler.startSession(VulkanDeviceInfo(instance, physicalDevice, device,
    computeFamily, graphicsFamily, computeQueue, graphicsQueue))

// per frame, on the render thread:
AIUpscaler.processFrame(lowResImage, lowResView, outputImage, outputView, deltaSeconds)
```

The engine never destroys an object it was given, and it waits on its own fence, so
the game keeps full control of its device. Full walkthrough, threading rules and
error handling: **[docs/INTEGRATION.md](docs/INTEGRATION.md)**.

What Android will not let any app do — and what this app therefore refuses to
pretend — is in **[docs/LIMITATIONS.md](docs/LIMITATIONS.md)**. The same text is in
the app, in plain language, on the dashboard and in settings.
