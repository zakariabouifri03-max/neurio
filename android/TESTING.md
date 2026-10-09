# TurboCast 60 test plan and result sheet

## Current test result

No Android build or hardware result is claimed by this repository snapshot. The available coding environment has no Java/JDK, Gradle, Android SDK, emulator, Android phone, or Smart TV. Run the automated tests and the matrix below in Android Studio/on-device before any release claim.

## Automated tests

Run:

```sh
./gradlew :app:testDebugUnitTest
```

Included test coverage:

- Even output dimensions and portrait/landscape aspect-ratio fitting.
- Adaptive controller decisions from measured loss and RTT.
- Annex-B/length-prefixed H.264 parsing.
- RTP FU-A packetization, reassembly, marker, and sequence handling.
- MPEG-TS packet alignment and live HLS segment/playlist creation in memory.

## Required hardware matrix

Fill in a new row for each test. Include the phone/receiver model and Android version; do not combine results across devices.

| Test | Phone + Android | Receiver + software | Network/profile | Observed result |
|---|---|---|---|---|
| Projection allow / deny / revoke | | | | |
| Direct companion discovery + six-digit pairing | | | | |
| Wrong pairing code rejected | | | | |
| Encrypted direct 720p/60 | | | Performance | |
| Direct 1080p/30 | | | Balanced | |
| Direct 1080p/60 support/fallback | | | High Quality | |
| Adaptive response to measured loss/congestion | | | Adaptive | |
| Cast route + HLS playback | | Chromecast/Cast-enabled TV | Balanced | |
| Orientation change / resize | | | each profile | |
| Wi-Fi disconnect and reconnect | | | | |
| Incoming interruption / projection revocation | | | | |
| 30-minute thermal/battery soak | | | | |
| Secure/DRM-protected screen behavior | | | | |

## What to record

- Selected encoder name (record locally for QA only), actual width/height, target FPS, measured encoder FPS, configured bitrate, receiver-decoded FPS, measured RTP loss, measured ping/pong RTT, and RSSI if available.
- For actual end-to-end latency, use a repeatable external test (e.g. a high-speed camera observing a phone-side millisecond timer and the TV simultaneously). Report the measurement method, camera rate, sample count, and distribution. TurboCast's RTT value is not a substitute.
- Capture failures, encoder fallback, HLS load/player errors, thermal throttling, app battery use, and reconnection time.
- Congestion tests should be performed on one real shared Wi-Fi link. Do not aggregate multiple connections or infer extra capacity.

## Known constraints

- MediaProjection requires user consent and can show black for secure/protected surfaces. No DRM or `FLAG_SECURE` restriction is bypassed.
- Hardware encoding is device/vendor-specific. A 60 FPS preset is a request, not a guarantee; codecs may fall back to 30 FPS or lower resolution.
- Direct TurboCast receivers need this companion application and LAN peer reachability. UDP packet loss is handled by dropping damaged access units and requesting an IDR; it is not retransmitted as a high-latency reliable video queue.
- Google Cast's default receiver fetches live HLS over the local network. Cast devices may buffer significantly; the app has no Cast end-to-end latency measurement or congestion-feedback API in this implementation.
- Wi-Fi client isolation, VPNs, subnet routing/firewalls, and AP multicast filtering can block NSD or local HTTP/UDP traffic.
