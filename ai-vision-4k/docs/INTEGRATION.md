# Integrating the AIUpscaler SDK into a game

The SDK is one module and one public object. A game that already has a Vulkan
renderer adds a dependency and a handful of calls — and gets real in-pipeline
upscaling, because it hands the engine a device the engine is allowed to use.

```kotlin
dependencies {
    implementation(project(":aiupscaler-sdk"))   // or the published .aar
}
```

## The contract in one page

```kotlin
// 1. once, during startup
val error = AIUpscaler.initialize(context, IntegrationKind.SdkIntegrated)
if (error != null) { /* show it, and fall back to your native resolution */ }

// 2. pick a profile (or set the fields you care about)
AIUpscaler.setOutputResolution(3840, 2160)   // what the player sees
AIUpscaler.setInputResolution(1920, 1080)    // what your renderer draws
AIUpscaler.setQuality(UpscalingQuality.High)
AIUpscaler.setSharpening(20)                 // percent, 0..100
AIUpscaler.setTargetFps(60)

// 3. start the session on YOUR device
AIUpscaler.startSession(
    VulkanDeviceInfo(
        instance = vkInstance, physicalDevice = vkPhysicalDevice, device = vkDevice,
        computeQueueFamily = computeFamily, graphicsQueueFamily = graphicsFamily,
        computeQueue = computeQueue, graphicsQueue = graphicsQueue,
    ),
)

// 4. every frame, on the thread that records your command buffer
val result = AIUpscaler.processFrame(
    lowResImage = lowResImage, lowResView = lowResView,     // your scene, rendered low
    outputImage = outputImage, outputView = outputView,     // where the result lands
    deltaSeconds = frameDelta,
    resetHistory = resized || sceneCut,                     // never blend unrelated frames
)
if (!result.submitted) {
    // The engine declined this frame (no model, thermal emergency, unsupported
    // queue). Use your own path; `result.error` says which.
}

// 5. when the surface is destroyed
AIUpscaler.stopSession()
```

## Ownership and threading

* **The engine never creates, destroys or reconfigures an object it was given.**
  Your instance, device, queues, images and image views stay yours. The engine
  creates only its own pipelines, descriptor sets and command pool.
* **One frame in flight.** The engine records its compute passes into its own
  command buffer and submits on the compute queue you provided, waiting on its own
  fence before the next frame. That is the latency guarantee.
* **Single-threaded by contract.** Every `AIUpscaler` method is synchronised, but
  the frame path is meant to run on the render thread — which is also what keeps
  `processFrame` free of allocation.
* **Call `updateThermal(context)` about once a second.** It reads the battery and
  the platform thermal status and feeds the governor. Skipping it does not break
  rendering, but the thermal protection stops adapting.
* **Feed the monitor** with `AIUpscaler.onFrameRendered(frameTimeMs, upscalerMs)` so
  the engine can report real frame statistics to the player.

## Image requirements

| Image | Format | Usage |
|---|---|---|
| Low-resolution input | `VK_FORMAT_R8G8B8A8_UNORM` (or `_SRGB` with a matching sampler) | Sampled; must be in `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL` when the engine runs. |
| Motion vectors (optional) | `VK_FORMAT_R16G16_SFLOAT` | Sampled; in half-resolution luma texels, pointing at the previous frame. |
| Output | `VK_FORMAT_R8G8B8A8_UNORM` | Written as a storage image; needs `VK_IMAGE_USAGE_STORAGE_BIT`. |

The engine queries the device for the formats, compute-queue families and the
memory budget *before* the first frame and refuses the session with a readable
message instead of failing deep inside a dispatch.

## Error handling

Nothing throws across the boundary. Every call that can fail returns `String?`
(`null` = success) with a message meant for a log or a UI banner, and the frame path
returns a `FrameResult` with `submitted`, `mode`, `upscalerMs` and `error`. `mode`
is the ground truth of what happened to that frame — `DISABLED`, `ANALYTICAL` or
`NEURAL` — so a game can show an honest indicator instead of assuming the AI ran.

If the model file is missing the engine degrades to analytical upscaling and says so
through `mode`; if the device is thermally critical it suspends the AI stage and
`sessionsJson()`/`statusJson()` explain why.

## Shipping

* Keep `consumer-rules.pro` in mind: the R8 rules that keep the JNI bridge alive
  travel with the module, so a minified game still finds `NativeBridge`.
* The `.so` is self-contained (`c++_static`) and built for `arm64-v8a` and
  `x86_64`. A 32-bit-only device is reported as unsupported on purpose: the
  working set does not fit a 32-bit address space.
* The engine loads its shaders from embedded SPIR-V — nothing to unpack at runtime,
  nothing to keep in sync with the APK's assets.
