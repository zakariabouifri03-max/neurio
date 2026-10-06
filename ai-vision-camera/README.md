# AI Vision Camera

A real, working Android camera app. It opens the phone's camera through **Camera2**, captures real
bursts, runs an **on-device computational photography engine** over them, and writes the result to the
normal system gallery. There is no simulator, no fake preview, no placeholder image, and no network
call anywhere in the app: every pixel that reaches the screen or a file comes from the camera sensor
and the phone's own CPU.

* Package: `com.aivision.camera` · minSdk 24 · targetSdk/compileSdk 34 · Java 8 bytecode
* APK: `out/AIVisionCamera.apk` (signed, v1 + v2), built by `tools/build-apk.sh`
* Zero third-party dependencies: framework Camera2 + a pure-Java image engine shipped in this repo

---

## What it actually does

### Camera
* Camera2 session with JPEG + RAW + YUV analysis streams, chosen from the device's real
  `StreamConfigurationMap` and capped to what the device can do.
* Burst capture with an AE/AF pre-capture trigger, alternating ±0.4 EV frames to widen dynamic range,
  and per-frame progress feedback.
* Zoom: optical lens switching through the physical camera ids of a logical multi-camera, plus
  digital zoom up to the device's honest ceiling (100x only when the hardware reports it), with the
  AI pipeline switching on automatically in the digital zone.
* Tap to focus (with metering regions mapped into sensor coordinates), long-press AE/AF/AWB lock,
  exposure compensation by vertical swipe.
* Front/back switching, timer, flash/torch, grid, level, live histogram, volume-key shutter.
* Video: `MediaRecorder` at 1080p/2K/4K (only the modes the device lists), HEVC or H.264, EIS/OIS
  requests, orientation hints, and constrained high-speed capture for slow motion when the device
  exposes a high-speed size. Time-lapse through `setCaptureRate`.
* RAW/DNG capture through `DngCreator` with the real `TotalCaptureResult` of the frame.

### The AI engine (`app/src/com/aivision/camera/ai/core`, pure Java, no Android APIs)
1. **Scene analysis** - tone, noise, sharpness, colourfulness, skin ratio, text likelihood; a scene
   classifier with confidence and a per-scene profile.
2. **Multi-frame alignment** - pyramid translation search, sub-pixel refinement, per-quadrant
   similarity fit, tile displacement field, and a final `Lucas-Kanade` refinement.
3. **Stacking / HDR fusion** - per-pixel weighted merge by local variance and saturation, optional
   exposure fusion for highlights, plus a detail band transfer.
4. **Denoise** - guided-filter luma noise reduction gated by the structure map, stronger chroma
   denoise, all strength-controlled by the measured noise level.
5. **White balance / tone** - gray-world correction, base/detail tone mapping, shadow lift, filmic
   highlight shoulder, scene-contrast S-curve, black/white point.
6. **Detail** - structure-gated unsharp masking with local envelope clamping so halos and fake
   micro-contrast cannot appear, plus a texture boost for text/documents.
7. **Colour** - saturation and vibrance with skin protection and highlight desaturation.
8. **Portrait** - subject mask from real face detection plus colour region growing, disc-kernel
   background defocus (real bokeh), frequency-separation skin smoothing.
9. **Super resolution** - single-frame iterative back-projection and multi-frame SR, streamed in
   horizontal bands so a 12 MP upscale fits in a phone's memory.
10. **Documents** - page detection, homography, warp, scan look (optional binary output).
11. **Haze / glare** - a real dark-channel-prior dehaze stage for landscapes and documents.

The engine is band-parallel (`Parallel.rows`) and every stage reports its own measured duration, which
the app shows in the AI report.

### Smart device tiering
`DeviceProfiler` measures the real device: per-core CPU frequencies from sysfs (big/little split),
total and available RAM, the GPU renderer/vendor/version from an offscreen EGL probe, power-save state
and thermal status. That produces a tier (LOW / MID / HIGH / FLAGSHIP) which sets the working
resolution, the maximum burst length, the maximum AI Ultra scale and the thread budget that the engine
is allowed to use - so a low-end phone degrades gracefully instead of dying, and a flagship uses
everything it has.

### Honesty rules built into the code
* A resolution is only called **4K** if the sensor can deliver it; anything upscaled is labelled
  **"AI Enhanced 4K (upscaled from 1080p)"** (or the real source resolution) in the UI, in the saved
  report and on the result sheet.
* `Capabilities` is the single source of truth for every claim in the UI: zoom ceiling, manual
  controls, RAW, slow motion, video modes, flash, stabilisation.
* If the engine cannot finish (memory, cancel, encoder refusal), the untouched capture is saved
  instead and the app says why. A photo or video is never lost or replaced by a broken file.
* The **Before/After** viewer reads the original frame from private storage, so the comparison is
  always a real comparison.

---

## Screens and controls

| Screen | What is on it |
| --- | --- |
| `ui.CameraActivity` | Full-screen preview, viewfinder HUD, mode bar **PHOTO · VIDEO · PRO · NIGHT · AI**, **AI ENHANCE** and **AI ULTRA** buttons, RAW button, lens pills (0.5x/1x/5x...), zoom scale with the digital/AI zone marked, shutter, thumbnails, top bar (flash, torch, HDR, timer, grid, output target, capabilities, settings). AI sheet with **Portrait · Document · Panorama · Macro**. |
| `ui.ProPanel` | Real manual controls: ISO, shutter speed, focus distance, white balance (Kelvin), exposure compensation, AE/AF/AWB locks, RAW toggle, and a live readout of the ISO/shutter/focus the sensor is actually using. |
| `ui.ResultView` | The result sheet: draggable before/after comparison, the measured AI report (scene, frames, noise, detail, DR, stage timings, warnings), save, share, discard, and re-run as AI ULTRA. |
| `ui.ProgressOverlay` | Real stage names and elapsed time while the engine runs, with a cancel that actually cancels. |
| `gallery.GalleryActivity` | MediaStore-backed grid of everything the app saved, AI badges, photo/video filter, multi-select share and delete. |
| `gallery.ViewerActivity` | Pinch-zoom viewer, before/after slider, AI report, share, delete, inline video playback. |

UI is drawn with a small vector icon set (`ui/Icons`) and programmatic layouts, so the APK stays
around 165 KB and there are no image assets to get stale.

---

## Build

```bash
bash tools/setup-toolchain.sh     # idempotent: JDK 17 + build-tools 34.0.0 + platform-34 into /opt
bash tools/build-apk.sh           # -> out/AIVisionCamera.apk (signed, verified)
adb install -r out/AIVisionCamera.apk
```

The build is deliberately Gradle-free (offline environments, no Google Maven): `aapt2 compile` ->
`aapt2 link` -> `javac -bootclasspath android.jar` -> `d8` -> `zipalign` -> `apksigner`.
`tools/build-apk.sh --install` also installs over adb. Use `JAVA_HOME`/`ANDROID_SDK_ROOT` to override
tool locations.

## Tests

The image engine has no Android dependencies, so it is tested on the host JVM:

```bash
mkdir -p build/engine-classes build/test-classes
javac -encoding UTF-8 -source 8 -target 8 -d build/engine-classes \
  $(find app/src/com/aivision/camera/ai/core -name '*.java') app/src/com/aivision/camera/ai/Panorama.java
javac -encoding UTF-8 -cp build/engine-classes -d build/test-classes $(find tests -name '*.java')
java -Xmx4g -cp build/engine-classes:build/test-classes com.aivision.camera.ai.test.EngineTest
java -Xmx4g -cp build/engine-classes:build/test-classes com.aivision.camera.ai.test.PanoramaTest
```

* `EngineTest` - 12 checks: alignment accuracy on known shifts, burst motion, multi-frame noise
  reduction, super-resolution gain, HDR fusion and clipping, document page detection, the full
  pipeline end to end, and tier scaling. It prints the measured numbers for every claim.
* `PanoramaTest` - stitches a synthetic panorama sweep and verifies the result against the original
  scene (1 px width accuracy, sub-1/255 luma error).

## Repository layout

```
app/AndroidManifest.xml            permissions, features, activities, launcher icon
app/res/                           dark theme values + vector launcher icon
app/src/com/aivision/camera/
  App.java                         application, prefs, AI executor, profiler bootstrap
  device/DeviceProfiler.java       real CPU/RAM/GPU measurement -> tier and thread budget
  camera/Capabilities.java         honest device capability model (resolution, zoom, RAW, video)
  camera/CameraController.java     Camera2 engine: sessions, zoom, manual, burst, RAW, video
  ai/core/                         the computational photography engine (pure Java)
  ai/EngineBridge.java             bitmap <-> engine bridge, face detection, report JSON
  ai/Panorama.java                 panorama alignment + feathered compositing
  media/MediaLibrary.java          gallery storage, AI report index, thumbnails
  media/VideoEnhancer.java         decode -> AI per frame -> re-encode video pass
  ui/                              camera UI, pro panel, result sheet, icons, comparison view
  gallery/                         grid and viewer
tests/                             host-JVM engine tests
tools/                             offline toolchain setup + APK build
```

## Honest limitations

* AI Ultra multiplies real resolution through multi-frame super resolution, capped per device tier
  (see `Tier`); it is not an unlimited "100 MP" claim.
* Background defocus is computed from face detection and colour segmentation, not a depth sensor; it
  is labelled as portrait separation, not as a depth map.
* Video enhancement is a post-process pass over the recorded clip (decode, enhance each frame,
  re-encode); long clips take proportionally long, and the app tells you the source resolution when
  the output is upscaled.
* Slow motion, 4K and 100x zoom exist only where the hardware reports them; elsewhere the app says so
  instead of pretending.
