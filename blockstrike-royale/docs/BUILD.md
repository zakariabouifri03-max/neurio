# Building BlockStrike Royale

## Desktop (development)

1. Install **Godot 4.4.x** (standard build) from <https://godotengine.org/download>.
2. Open the project folder in the editor: `godot --path . --editor`.
   The first open imports the textures and sounds (about ten seconds).
3. Press **F5** to run `scenes/app.tscn`, or run a specific screen with
   `godot --path . res://scenes/app.tscn`.

Command line only (no editor UI):

```bash
godot --headless --path . --import      # import assets once
godot --path . res://scenes/app.tscn    # play
```

## Tests

```bash
tests/run_tests.sh /path/to/godot
# or
godot --headless --path . res://tests/tests.tscn
```

Exit code `0` means all suites passed. The suites check data tables, the voxel
pipeline, combat maths, economy/save rules and the touch-control layout.

## Android

### Prerequisites

* Android SDK with build-tools 34+, platform-tools, and a JDK 17
  (`sdkmanager "platform-tools" "build-tools;34.0.0" "platforms;android-34"`).
* Godot 4.4.x **export templates** (Editor > Manage Export Templates > Download).
* In the editor: Editor Settings > Export > Android -> set the Android SDK path
  and the debug keystore path (`~/.android/debug.keystore`, generated on first
  build if missing).
* Enable **Developer Options** and **USB debugging** on the phone, then
  `adb devices` should list it.

### Debug APK (no credentials required)

```bash
# from the project root, after the editor has imported the project once
godot --headless --path . --export-debug "Android Debug" build/blockstrike-royale-debug.apk
adb install -r build/blockstrike-royale-debug.apk
```

Debug builds are signed with the standard Android debug keystore, so nothing
secret is needed and nothing secret is stored in this repository.

### Release APK (signing stays local)

```bash
keytool -genkeypair -v -keystore ~/blockstrike-release.keystore \
  -alias blockstrike -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype JKS
```

Then either

* open the project in the Godot editor and set the keystore path/user/password in
  **Project > Export > Android Release** (Godot stores those values in its own
  editor settings and, if you let it, in `export_presets.cfg` - **do not commit
  them**), or
* pass them through the environment for CI runs that hold the keystore as a
  secret. `export_presets.cfg` deliberately ships with empty keystore fields.

```bash
godot --headless --path . --export-release "Android Release" build/blockstrike-royale-release.apk
```

`build/` is git-ignored, and so are `*.apk`, `*.aab` and `*.keystore`.

### Device notes

* Rendering method is **Mobile** with ETC2/ASTC texture compression; keep the
  Low preset for 2 GB devices (render scale 0.72, no shadows, 30 FPS target).
* The game requests: internet, network state, Wi-Fi state, vibrate, wake lock.
  No location, storage or camera permissions are requested.
* Landscape is forced; immersive mode is on and the app is a launcher icon
  ("BlockStrike Royale") with adaptive icons generated in `assets/icons/`.

## Dedicated server (later phase)

`server/server_main.gd` is the entry point for headless hosting; networking is
completed in the multiplayer phases (see `docs/DEVELOPMENT_STATUS.md`).
