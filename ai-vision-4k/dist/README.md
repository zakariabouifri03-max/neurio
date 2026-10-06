# AI Vision 4K — built APKs

| file | what it is |
| --- | --- |
| `AIVision4K-debug.apk` | debug build, package `com.aivision4k.debug`, debuggable, unminified. The build to install. |
| `AIVision4K-release-unsigned-key.apk` | minified (R8) build, package `com.aivision4k`. Signed with the **debug key**, which is why the file name says so: a real release keystore must never live in a public repository. Not suitable for distribution. |
| `SHA256SUMS.txt` | `sha256sum` output; verify with `sha256sum -c SHA256SUMS.txt` **from inside this directory**. |

Both files are produced by `.github/workflows/ai-vision-4k-apk.yml` and committed back to the
branch by that workflow, because the artifact download hosts are not reachable from every
development environment. Nothing here is hand-edited.

## Installing

```bash
adb install -r AIVision4K-debug.apk
```

Or copy it to the device and open it (Android will ask you to allow installing from this source).

Requirements: **Android 8.0 (API 26) or newer**, a **64-bit** device (`arm64-v8a`, plus `x86_64`
for emulators — there is no 32-bit build on purpose, see `docs/LIMITATIONS.md`). Vulkan is
recommended but not required: the app installs either way, probes the device and explains what
each missing capability rules out. Two permissions are special: the metrics overlay asks for
"display over other apps" (it can only *display* numbers; it cannot touch another app's
rendering), and the monitoring service asks for notifications on Android 13+ so it can tell you
it is running. Both are optional and the app degrades instead of insisting.

## What is verified, and what is not

Checked in CI on every build: the native core suite (21 867 assertions), the Kotlin static checks,
the JNI binding check (every external function against the native table, name by name), the CMake
host build, the compile of every native source with the Vulkan backend enabled — including the
demo renderer and its JNI bridge, which no other configuration would compile — the SPIR-V
push-constant mirrors, the calibration models, and that both APKs assemble.

Checked here, on the built files themselves: zip integrity, the ELF/ABI of each `libaivision4k.so`,
the JNI entry points and embedded shader table inside the `.so`, the merged manifest (components,
permissions, min/target SDK), the dex classes, the v2 signature block, and that the two
`.v4kmodel` calibration models inside the APK are byte-identical to the verified assets.

**Not verified: anything that needs a device.** No one has run this on a phone in this project
yet. The GPU kernels, the overlay permission flow, the thermal governor's behaviour under real
heat and the frame timings have never been observed on hardware — the app says so where it
matters instead of showing a number it did not measure. Two specific consequences:

* The neural stage needs a `.v4kmodel`. What ships are two **calibration** models (linear graphs
  that must reproduce bilinear/bicubic upscaling exactly); they are a pipeline check, not a
  quality model, and the AI Engine screen labels them that way. No trained model ships.
* The Vulkan demo scene **is** in this build (dashboard → "Open the demo scene"), and this is its
  first build: a rendered scene with terrain, buildings, moving objects, a GPU particle system and
  shadows, a live Native ↔ AI-upscaling switch, a split view with a magnifier, and an A/B
  benchmark. It has been built and statically verified, but no frame of it has ever been drawn on
  a real GPU. Treat your first run as the test, and read the panel: it reports what it measured
  and says "unavailable" for what it could not.

## Rebuilding

```bash
# The host checks first (seconds, no Android SDK):
tools/run-native-tests.sh
tools/checks/kotlin-imports.py
tools/checks/jni-bindings.py
tools/model/generate-calibration-models.sh --check

# Everything at once, including the Vulkan/JNI/demo syntax check (needs the
# Vulkan headers and a JDK's jni.h + jni_md.h):
V4K_VULKAN_INCLUDE=/path/to/Vulkan-Headers/include \
V4K_JNI_INCLUDE=/path/to/jdk/include:/path/to/jdk/include/linux \
tools/verify.sh

# Then the real build, with the Android SDK + NDK 27.3.13750724 installed:
gradle :app:assembleDebug        #  or open the project in Android Studio
```

There is no committed Gradle wrapper (no `gradlew`/`gradle-wrapper.jar`); use a Gradle 8.9
installation or Android Studio's bundled Gradle. CI uses `gradle/actions/setup-gradle` with
`gradle-version: '8.9'` for the same reason.
