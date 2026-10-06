# Building AI Vision 4K

## Requirements

| Tool | Version | Notes |
|---|---|---|
| JDK | 17 | AGP 8.7.3 requires 17; a newer JDK works with `org.gradle.java.home`. |
| Gradle | 8.9 or newer (8.x) | A wrapper is not checked in; use Android Studio's Gradle or a local install. Gradle 9 is **not** supported by AGP 8.7.3. |
| Android SDK | Platform 35, Build-tools 35.0.0 | `compileSdk = 35`, `targetSdk = 35`, `minSdk = 26`. |
| NDK | 27.3.13750724 | Pinned in `aiupscaler-sdk/build.gradle.kts`. The SDK manager installs it on demand in Android Studio. |
| CMake | 3.22.1 | Pinned in `externalNativeBuild`. |
| C++ | clang from the NDK, C++17 | `-DANDROID_STL=c++_static`; the engine `.so` is self-contained. |

## Android Studio

1. `File → Open…` and pick the `ai-vision-4k` folder (not the repository root).
2. Let Gradle sync. The first sync downloads AGP/Kotlin/Compose and, if missing,
   the pinned NDK and CMake — accept the SDK licence prompts.
3. `Run ▶` with a device or emulator. `x86_64` and `arm64-v8a` are the only ABIs.

If the app starts and reports *"the native engine library is not loaded"*, the APK
was built for the wrong ABI (a 32-bit `armeabi-v7a` device): the compatibility
engine treats 32-bit-only devices as unsupported by design, because the working set
does not fit the address space.

## Command line

```bash
cd ai-vision-4k
gradle :app:assembleDebug            # app/build/outputs/apk/debug/app-debug.apk
gradle :app:installDebug             # adb install to a connected device
gradle :aiupscaler-sdk:assembleRelease   # the .aar a game would consume
```

`local.properties` (not committed) must point at your SDK:

```properties
sdk.dir=/path/to/Android/Sdk
```

## Native-only workflows (no Android toolchain needed)

```bash
tools/run-native-tests.sh          # host build + run of the core test suite
tools/run-native-tests.sh -v       # verbose per-case output
tools/verify.sh                    # the gate CI runs, in six steps

# Syntax-check the layers that need extra headers:
V4K_VULKAN_INCLUDE=$HOME/Vulkan-Headers/include \
V4K_JNI_INCLUDE=$JAVA_HOME/include \
tools/verify.sh
```

`tools/verify.sh` checks, in order: that no GLSL source is newer than its checked-in
SPIR-V, that the embedded shader header regenerates with the expected count, that
the SPIR-V interface blocks match the C++ push-constant mirrors, that the host test
suite passes, and that every C++ translation unit compiles (`-fsyntax-only`) in both
the Vulkan-on and Vulkan-off configurations.

## Regenerating the shaders

The SPIR-V blobs are committed, so a normal build needs no shader compiler. After
editing a `.comp`/`.vert`/`.frag`:

```bash
node tools/shaders/build-shaders.js       # 25/25 shaders → shaders/spirv/*.spv
node tools/shaders/build-shaders.js --check   # fails if a blob is stale
```

The CMake build embeds the blobs into `v4k_shaders_embedded.h` at configure time —
the engine never compiles GLSL at runtime, because driver GLSL front ends differ
enough that a runtime compile failure would break a title.

## CI

`.github/workflows/ai-vision-4k-apk.yml` builds the APK on Ubuntu with the real
Android toolchain, runs the native suite first, and commits the APKs plus
`SHA256SUMS.txt` back to the branch under `dist/`. It also uploads them as a normal
Actions artifact.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `NDK not configured` | Install NDK 27.3.13750724 (`sdkmanager "ndk;27.3.13750724"`) or change `ndkVersion`. |
| `CMake 3.22.1 not found` | `sdkmanager "cmake;3.22.1"`. |
| `libneuralnetworks not found` in the CMake log | The NDK in use ships no NNAPI stub: the engine builds without the NNAPI backend and reports it as absent. Vulkan is unaffected. |
| App installs but the engine never initialises | Read the red banner: it carries the engine's own message. A software renderer (emulator without GPU passthrough) is reported as unsupported rather than crashing. |
| `verify.sh` fails on the shader step | A `.spv` is older than its source: run the shader builder and commit the result. |
