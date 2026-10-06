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

Checked in CI on every build: the native core suite (16k+ assertions), the Kotlin static checks,
the CMake host build, the SPIR-V push-constant mirrors, the calibration models, and that both
APKs assemble.

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
* The Vulkan demo scene is **not** in this build: its native host (`cpp/demo`) does not exist yet,
  and the manifest documents that rather than declaring an activity that cannot render.

## Rebuilding

```bash
# The host checks first (seconds, no Android SDK):
tools/run-native-tests.sh
tools/checks/kotlin-imports.py
tools/model/generate-calibration-models.sh --check

# Then the real build, with the Android SDK + NDK 27.3.13750724 installed:
gradle :app:assembleDebug        #  or open the project in Android Studio
```

There is no committed Gradle wrapper (no `gradlew`/`gradle-wrapper.jar`); use a Gradle 8.9
installation or Android Studio's bundled Gradle. CI uses `gradle/actions/setup-gradle` with
`gradle-version: '8.9'` for the same reason.
