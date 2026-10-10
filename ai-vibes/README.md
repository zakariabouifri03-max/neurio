# 🎧 AI VIBES

**Premium Android headphone audio enhancement — with real DSP, honest claims.**

AI VIBES transforms the music played inside the app with a complete, professional
signal chain: Bass Studio, a 10-band graphic equaliser, clarity & tonal-balance
controls, simulated spatial processing, dynamic range control, a safety limiter
and a live, beat-responsive visualizer — all computed on the device in Kotlin,
on the audio you actually play.

* **Kotlin + Jetpack Compose + Media3** (ExoPlayer / MediaSessionService)
* **Deep-black neon UI** — purple / electric blue / cyan, animated waveforms
* **Zero network permissions** — no analytics, no accounts, no cloud
* **Honest by design** — the in-app “What AI VIBES can (and cannot) do” card
  states Android's real limits (see below)

---

## Download / install

**Build status: ✅ green** — DSP unit tests pass and both APKs compile in CI
(`AI VIBES APK` workflow, run 38056817471).

The CI pipeline builds an installable APK on every push:

* **Latest release APK (fixed URL):**
  `https://github.com/zakariabouifri03-max/neurio/releases/latest/download/AI-VIBES.apk`
  (also `AI-VIBES-debug.apk` + `SHA256SUMS.txt` on the release page)
* Workflow artifacts: repository → Actions → *AI VIBES APK* → latest run.

Install with `adb install AI-VIBES.apk` or by opening the file on the phone
("Install unknown apps" may need enabling for your file manager). The release
build is signed with the CI debug key so it installs directly — for Play Store
distribution, add your own keystore (see below).

## Build it yourself

Requirements: **JDK 17** and **Android Studio** (or an Android SDK with
`platforms;android-34` + `build-tools;34.0.0`).

```bash
cd ai-vibes
./gradlew :app:assembleDebug      # debug APK
./gradlew :app:assembleRelease    # release APK (debug-key signed by default)
./gradlew :app:testDebugUnitTest  # DSP unit tests
```

APKs land in `app/build/outputs/apk/{debug,release}/`. Android Studio:
*File → Open* → select this `ai-vibes/` folder and press Run.

> `gradlew` bootstraps the pinned Gradle 8.9 distribution itself (with SHA-256
> verification) — no wrapper jar is committed. If Studio asks for
> `gradle-wrapper.jar`, run `./gradlew wrapper --gradle-version 8.9` once.

**Signing a production build:** pass `-PAIVIBES_KEYSTORE_FILE=/path/to.jks`
plus `AIVIBES_KEYSTORE_PASSWORD`, `AIVIBES_KEY_ALIAS`, `AIVIBES_KEY_PASSWORD`
(properties or env vars). Without them the release build is debug-key signed.

## What's actually implemented

| Feature | How it works |
|---|---|
| Bass Studio | RBJ low-shelf + 38 Hz sub-bass peak, 0–100 %, corner 40–180 Hz |
| 10-band EQ | Peaking biquads, ±12 dB, 11 factory presets incl. Phonk/EDM/Gaming, custom saved |
| Clarity & tilt | High-shelf presence + warm/bright tilt |
| Spatial | Mid/side stereo width + headphone crossfeed — **labelled simulated**, not hardware 3D |
| Dynamics | RMS compressor, slow loudness balance (→ −18 dBFS), peak limiter at −1 dBFS with soft-clip |
| Visualizer | Real FFT of the post-DSP stream: spectrum bars, bass-reactive circular waves, beat-detect neon pulse; sensitivity + battery saver |
| AI Sound | Smart Match: live spectrum analysis → tonal-balance measurement → closest profile + bounded ±3 dB correction (on-device statistics, **not** a neural network — stated in-app) |
| Music player | MediaStore library, playlists, Media3 background service, notification + lock-screen controls, audio focus, auto-pause on headphone unplug |
| Headphones | Wired/USB/Bluetooth detection via `AudioDeviceCallback`; battery **only when the system reports it**; per-device auto presets |
| Persistence | DataStore — every parameter restored on restart; reset-to-default |

Processing order: `pre-amp → EQ → bass → clarity/tilt → spatial → dynamics → limiter`.

### Honest limitations (also shown in-app)

* Android does **not** allow an ordinary app to process other apps' audio
  (Spotify, YouTube, games). AudioPlaybackCapture exists but is restricted and
  app-controlled — AI VIBES processes **its own player** and says so.
* No app can increase Bluetooth bandwidth or exceed headphone hardware.
* Spatial width is real stereo processing; object-based spatial audio is a
  system/hardware feature.
* Bluetooth battery shows “not reported” unless the headset actually
  broadcasts a level.

## Project layout

```
ai-vibes/
├── app/src/main/kotlin/com/neurio/aivibes/
│   ├── dsp/          Pure-Kotlin DSP core (biquads, FFT, chain, spectrum) — unit-tested
│   ├── audio/        Media3 AudioProcessor wrapper, renderers factory, system-effects bridge
│   ├── playback/     MediaSessionService, MediaController repo, MediaStore library, playlists
│   ├── headphones/   AudioDeviceCallback monitor + battery broadcasts
│   ├── settings/     DataStore persistence + factory presets
│   ├── ai/           Smart Sound analysis (signal statistics, documented honestly)
│   └── ui/           Compose screens, neon theme, custom faders, visualizer canvas
├── app/src/test/     JVM DSP tests (run in CI with `gradlew test`)
├── tools/            static_check.py, compile-check/ (stub-based local type-check), dsp-selfcheck/
└── docs/             LIMITATIONS.md, TEST_PLAN.md
```

### Local verification tooling

* `python3 tools/static_check.py` — bracket balance, project imports, R refs, XML
* `tools/compile-check/run.sh` — type-checks the engine layer against verified
  API stubs + `android.jar` without the Android SDK
* `tools/dsp-selfcheck/` — numeric filter/FFT/limiter self-check (also covered
  by the CI unit tests)

## Tech stack

Kotlin 2.0.21 · Jetpack Compose 1.6.7 / Material 3 · AndroidX Media3 1.4.1 ·
DataStore · Navigation-Compose · minSdk 26 / targetSdk 34 · AGP 8.5.2 / Gradle 8.9
