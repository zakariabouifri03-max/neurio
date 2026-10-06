# Neurio LAN Stream (native Android prototype)

This is a separate Android Studio app alongside the repository's existing browser game. It implements a direct **Phone 2 host → Phone 1 player** streaming path. The game stays installed and runs on Phone 2; the LAN protocol contains compressed live media and control messages only. There is no APK/OBB/data transfer path, cloud backend, or client-side game installation.

## Open and build

1. Install Android Studio with Android SDK Platform 35 and JDK 17.
2. Open this `android/` directory as an existing Gradle project and allow Android Studio to sync/download the Android Gradle Plugin and Kotlin plugin. The included `gradlew`/`gradlew.bat` bootstrap the pinned Gradle 8.9 distribution.
3. Build with `./gradlew :app:assembleDebug` (Windows: `gradlew.bat :app:assembleDebug`) and install `app/build/outputs/apk/debug/app-debug.apk` on two Android phones (Android 12+ recommended).
4. The GitHub Actions workflow **Android debug APK** builds this branch, uploads a 90-day artifact, and publishes a versioned GitHub prerelease with a direct `Neurio-LAN-Stream-debug.apk` asset and SHA-256 file. Use the latest **Neurio LAN Stream debug APK** entry under GitHub Releases, or download the artifact ZIP from the workflow run. This is debug-signed, not release-signed. CI compilation does not replace the required two-device hardware test.

Application ID: `com.neurio.lanstream` (`.debug` suffix for Android Studio's debug variant). Minimum SDK 26. Target SDK 35.

## Two-phone run-through

1. Connect both phones to the same 5 GHz Wi-Fi, or connect Phone 1 to Phone 2's hotspot. Avoid guest Wi-Fi/AP isolation.
2. Install the same debug APK on both.
3. **Phone 2:** open **HOST GAME**, choose a launchable app installed on Phone 2, choose resolution/FPS/bitrate, and tap **START STREAM**.
4. Approve Android's MediaProjection screen-capture prompt. Audio permission is optional. Neurio starts its foreground capture service and launches the selected app normally.
5. Return to Neurio on Phone 2 (the app remains underneath the game or tap its foreground notification). Share the six-digit pairing code with Phone 1. Do not share it with an untrusted person on the LAN.
6. **Phone 1:** open **JOIN GAME**, select the discovered host, enter the code, and wait for the live decoded view. Use the overlay, direct touch-through, or a Bluetooth controller paired with Phone 1.
7. Stop from the host page or its ongoing notification. The client disconnects when it exits the live view.

The discovery/control/video UDP/TCP ports are `47621`, `47620`, and `47622` respectively. This project currently targets API 35 and uses the standard `INTERNET` permission for local sockets; no internet service is contacted by the streaming implementation. Before raising the target to Android 17's API 37 enforcement level, add and request Android's [`ACCESS_LOCAL_NETWORK` runtime permission](https://developer.android.com/privacy-and-security/local-network-permission).

## What is implemented

- Host game library based on Android's launchable-app intents; icons and app labels are loaded locally, and the chosen app is launched through Android's normal launcher intent.
- Foreground-service MediaProjection capture with a continuous surface-input H.264 `MediaCodec` encoder. It prefers a size/rate-compatible hardware codec and falls back to Android's AVC encoder selection.
- UDP delivery of independently AES-GCM-authenticated fragments (maximum 1200-byte datagrams) for H.264 and optional AAC. A bounded jitter/reassembly path and short decoder queues prioritize low latency over retransmission.
- Client MediaCodec AVC decoder rendered to a `SurfaceView`, plus AAC decoding/`AudioTrack` when the host can capture playback audio.
- UDP LAN advertisements and ping probes, one-player host session, a six-digit pairing challenge, ephemeral P-256 ECDH keys, directional AES-GCM control channels, a random session token, constant-time proof checks, and failed-code lockout.
- Timestamped pointer/key/axis input transport; client and host FPS/bitrate/ping/loss diagnostics; encoder bitrate adaptation based on client loss/RTT; selectable 480p/720p/1080p, 30/60 FPS, and Low/Medium/High/Custom bitrate.
- Virtual joystick, D-pad, A/B/X/Y, L1/R1/L2/R2, Start/Select, touch-through, left-handed layout, and size presets; Android gamepad key/joystick events are also forwarded.

## Platform limits (not hidden by the prototype)

- **Screen capture:** the host must approve MediaProjection. Secure/protected surfaces can be blanked by Android or by a game. Android 14+ enforces one-time projection consent and a foreground service; the service is declared with the media-projection type.
- **Remote touch:** ordinary Android apps cannot freely inject touch into arbitrary third-party apps. The host includes an optional `AccessibilityService` adapter; the user must enable it manually in Android Accessibility settings. It uses public accessibility gestures, not root/shell privileges. Some games, protected windows, and anti-cheat systems reject these gestures. Without this service, video still works and input transport reports the limitation rather than claiming injection succeeded. Use only where the game and device policy permit it.
- **Audio:** internal playback capture is attempted only on Android 10+ after `RECORD_AUDIO` grant. A game's capture policy, usage attributes, anti-capture policy, or vendor behavior can prevent audio. The host reports this and continues video-only; microphone audio is not substituted.
- **Network:** discovery needs local broadcast traffic; some routers/hotspots block client-to-client communication. Video uses UDP without retransmission, so Wi-Fi loss can drop frames. The client requests keyframes and reports packet loss; the host reduces bitrate automatically. Resolution and FPS are selected before the session and are not renegotiated live in this prototype.
- **Codec/device variation:** not every phone has an AVC encoder/decoder supporting every selected size/rate. Choose a lower resolution/FPS if the hardware or Wi-Fi cannot sustain 720p60/1080p.
- **Security scope:** media/control packets are encrypted and authenticated after ephemeral ECDH pairing. The six-digit pairing code is short-lived and the host rate-limits failed attempts; still use a trusted private LAN. This is a prototype, not a security-audited product.

## Source map

```text
app/src/main/java/com/neurio/lanstream/
├── MainActivity.kt                 # host/client/settings/about screens and permission flow
├── client/                         # discovery handoff, UDP reassembly, MediaCodec/AAC playback, controls
├── core/                           # LAN discovery and network counters
├── host/                           # game library, MediaProjection/encoders, foreground service/server
├── input/                          # input transport and optional Accessibility gesture adapter
├── model/                          # session/settings models
├── protocol/                       # pairing, ECDH/HKDF, AES-GCM, control/media framing
└── ui/                             # native dark gaming UI helpers
```

There is no fake/prerecorded gameplay path: until Phone 2 grants MediaProjection and the live H.264 encoder supplies decoder configuration, Phone 1 displays a waiting state rather than fabricated video.
