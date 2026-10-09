# TurboCast 60 — Android project

TurboCast 60 is a native Kotlin/Jetpack Compose screen-mirroring sender with an Android companion receiver mode. It is designed for a supported local-network receiver; it does **not** make an ordinary television mirror-capable by itself.

## Receiver requirements

Choose one of these paths:

1. **Google Cast / Chromecast:** a Cast-enabled receiver on the same local Wi-Fi network. The sender uses the official Google Cast Android SDK and its Default Media Receiver to load a live HLS playlist served from the phone. Receiver support for live HLS varies; the TV must actually support Google Cast. This is not AirPlay, Miracast, or generic DLNA.
2. **TurboCast TV companion:** install this same application on a compatible Android TV / Google TV (or another Android device), open **Receiver Mode**, then select it from the phone's TurboCast receiver list and enter the six-digit code shown on that screen. The companion uses local DNS-SD discovery and an authenticated, encrypted control/video session.

Both devices need IP reachability on the same LAN. Guest networks, VPN routing, and Wi-Fi client isolation can prevent discovery or streaming. Bluetooth is not used for screen video.

## Architecture

- **Capture:** user-initiated `MediaProjection` permission, registered projection callbacks, a `mediaProjection` foreground service and persistent stop notification. The stream ends when the user stops it, Android revokes capture, or the connection terminates. Secure/protected content is left to Android's system restrictions.
- **Encode:** surface-input `MediaCodec` AVC/H.264. The encoder selection checks advertised size/rate support, prefers hardware codecs, tries lower resolution/FPS when needed, and reports the selected codec name, hardware-acceleration status (a codec-name heuristic on Android versions before the platform flag exists), output dimensions, and measured local encoder FPS. Pixels are rendered into the codec input surface rather than copied through application bitmaps.
- **TurboCast companion transport:** IPv4 TCP for an ephemeral P-256 ECDH pairing handshake and encrypted control; a six-digit code shown on the TV authenticates the exchange. AES-GCM protects control messages and RTP/H.264 datagrams. RTP sequence gaps drop damaged access units and request an IDR; receiver-reported loss/RTT drives Adaptive mode's bitrate and quality ladder. The decoder has a small bounded frame queue that discards stale frames instead of accumulating latency.
- **Google Cast transport:** an in-memory rolling MPEG-TS/HLS origin bound to the phone's LAN interface, loaded with the official Cast SDK. HLS/Chromecast buffering is receiver-controlled, so it can have more delay than the direct companion path. The Cast SDK does not expose the companion receiver's per-packet feedback; the UI labels such metrics unavailable and warns that Adaptive feedback is only available with TurboCast receivers. The HLS URL has a random per-session path and is never logged or persisted; media segments remain in memory.
- **Discovery:** Android NSD service `_turbocast._tcp.`. Devices are only listed as available when the app's companion receiver advertises itself. Cast devices are selected through the Cast route picker.
- **Privacy:** no analytics, cloud relay, browsing-history collection, screen recording, or disk video writes. Direct companion video/control are authenticated and encrypted. Google Cast video is delivered over local HTTP to the selected Cast receiver because the Default Media Receiver needs a fetchable HLS URL; use a trusted LAN.

## Open and build

Requirements: Android Studio, JDK 17, Android SDK Platform 35, and a network connection to Google's Maven repository and Maven Central for dependencies. The checked-in Gradle 8.10.2 wrapper downloads the matching Gradle distribution on first use.

1. Open the `android/` directory in Android Studio.
2. Allow Gradle sync and install the missing SDK/dependencies when prompted.
3. Select the `app` run configuration and install it on an Android 8.0+ phone. Install the same APK on an Android TV for the companion receiver path.
4. From a shell: `cd android && ./gradlew :app:testDebugUnitTest :app:assembleDebug`.
5. Debug APK output: `android/app/build/outputs/apk/debug/app-debug.apk`.

GitHub Actions also runs unit tests and assembles the debug APK when Android project changes are pushed to this session's branch. A successful run exposes a downloadable `turbocast60-debug-apk` artifact for 30 days; this is a debug build, not a hardware-verified release.

The debug package ID is `com.turbocast60.debug`; the release package ID is `com.turbocast60`.

### Signed release APK

In Android Studio choose **Build → Generate Signed Bundle / APK → APK → Create new** (or select an existing private keystore), choose the `release` variant, and build. Keep the keystore and passwords outside source control. Release is minified; `app/proguard-rules.pro` keeps the Cast provider and receiver entry point. For repeatable CI signing, configure a local, ignored Gradle properties file and add a Gradle `signingConfig`; do not commit signing credentials. The project's release variant intentionally does not contain a sample signing key.

## Quality profiles and measurement

- **Performance:** 720p target, up to 60 FPS.
- **Balanced:** 1080p target, up to 30 FPS.
- **High Quality:** 1080p target, up to 60 FPS when a device encoder advertises and starts that mode.
- **Adaptive:** on the companion path, starts with receiver feedback and adjusts bitrate; sustained loss can reconfigure resolution/FPS down, while sustained clean feedback can recover quality. On Google Cast, the user-selected target bitrate is used, but Cast does not provide the feedback needed for the app to claim adaptive congestion control.

The UI reports actual encoder FPS, dimensions, and bitrate where available. Companion **Network RTT** is measured by local ping/pong and is not end-to-end screen latency. Packet loss comes from RTP sequence gaps; RSSI is shown only if Android exposes it. Cast playback status is read from the Cast media session when available. TurboCast intentionally does not invent end-to-end latency values.

## Verification status and hardware limits

Automated unit tests cover resolution sizing/adaptation, H.264/RTP fragmentation and reassembly, and MPEG-TS/HLS segment generation. GitHub Actions run [37911393106](https://github.com/zakariabouifri03-max/neurio/actions/runs/37911393106) passed these JVM tests and assembled the debug APK with JDK 17 and SDK 35. The checked-out agent environment itself has no JDK, Gradle installation, or Android SDK, and **no phone/TV device test, receiver interoperability test, or measured end-to-end performance result exists**. Do not treat the debug build as a hardware-verified release.

Use [TESTING.md](TESTING.md) for the required device/network test matrix. Results should be recorded from real devices, not estimated. Encoder throughput, thermals, 60 FPS, Cast compatibility, and HLS buffering vary by model and Wi-Fi topology.
