# Neurio — LAN game streaming (Android prototype)

**What it is:** two phones, one app, two modes.

* **Phone 2 = HOST** runs an already-installed game locally, captures its screen
  (`MediaProjection`), encodes it with the **hardware** H.264/H.265 encoder
  (`MediaCodec`) and pushes it over Wi-Fi.
* **Phone 1 = CLIENT** — **where the game is NOT installed and never will be** —
  receives the live stream, decodes it with the **hardware** decoder, renders it
  full screen and sends touch / virtual-gamepad / Bluetooth-gamepad input back.

No cloud, no server, no relay, no file transfer, no APK or OBB copy, no
prerecorded video, no mockups. Same APK on both phones.

> **Honesty first:** Android does not allow an ordinary app to inject touches
> into another app. This project ships the *best legitimate* mechanism
> (`AccessibilityService.dispatchGesture()`), a root fallback, and an overlay
> visualiser — and it tells you in the UI which one is actually working.
> See **[docs/LIMITATIONS.md](docs/LIMITATIONS.md)**.

---

## 1. Requirements

| | |
|---|---|
| Android Studio | Koala (2024.1.1) or newer |
| JDK | 17 |
| AGP / Gradle / Kotlin | 8.5.2 / 8.7 / 2.0.21 |
| Devices | Android 8.0+ (`minSdk 26`), **tested target Android 12+** |
| Network | both phones on the same LAN, 5 GHz recommended |

## 2. Build & install

```bash
cd android                      # open THIS folder in Android Studio
# if Studio reports a missing wrapper jar:
#   ./gradlew wrapper --gradle-version 8.7
./gradlew :app:assembleDebug    # or Build ▸ Make Project
./gradlew :app:installDebug     # repeat for the second phone
```

The Gradle wrapper **properties** are committed; the wrapper **jar** is not
(binary), so let Studio or `gradle wrapper` fetch it once.

## 3. First session (two phones)

**On the HOST phone**

1. One-time: `Settings → Accessibility → Neurio remote input → On`
   (required for real gameplay input; nothing in the app can enable it for you).
2. Open Neurio → **HOST GAME**.
3. Pick a game from the library (installed launchable apps, real icons).
4. Grant the **screen-capture** consent dialog. The game launches and the panel
   shows the device name, local IP, **6-digit pairing code**, latency, FPS and
   bitrate.

**On the CLIENT phone** (game not installed)

1. Open Neurio → **JOIN GAME** → the host appears automatically (mDNS + UDP
   beacon), or type its IP manually.
2. Enter the 6-digit code → **CONNECT**.
3. Play. Stats overlay shows fps / ping / Mbps / lag / drops; tap the screen to
   toggle the virtual gamepad.

**Stop** on either side ends the session cleanly for both.

## 4. Features

* 480p / 720p / 1080p, 30 / 60 fps, Low / Medium / High / Custom bitrate (1–40 Mbps).
* Adaptive bitrate (AIMD) + resolution tiering driven by client-reported loss,
  RTT and drop rate.
* Low-latency decoding path, minimal buffering, keyframe-on-demand, resync.
* Virtual joystick, D-pad, A/B/X/Y, shoulders, triggers, Start/Select — layout
  editable per control (position + size, sent to the host as touch coordinates).
* Bluetooth/USB gamepad passthrough (standard `MotionEvent`/`KeyEvent`).
* Real-time stats: FPS, encode time, bitrate, ping, packet loss, dropped frames,
  end-to-end latency (4-timestamp clock sync), input events/s.
* Audio streaming where Android permits it, with an explicit status when it does not.
* Pairing: 6-digit code + HMAC-SHA256 challenge/response + random session token in
  every datagram; unknown senders are dropped at the socket layer. One client per host.
* Diagnostics screen: device, network, codec capability probe, permissions, copyable report.
* English + Arabic UI.

## 5. Architecture

```
core/       Log, Settings(+DataStore), Stats(FpsMeter/BitrateMeter/LossTracker/
            ClockSync/Ema), PairingService(HMAC), SessionManager, SessionBus(state),
            NetworkInfo
discovery/  HostEndpoint, NsdDiscovery (mDNS _neurio._tcp.), UdpBeacon (broadcast +
            unicast ping), DiscoveryManager (merges both, exposes StateFlow)
net/        Protocol (44-byte datagram header), Framer/Fragmenter/FrameAssembler,
            Udp(UdpReceiver/MediaSender), ControlServer/ControlSession (TCP JSON),
            ControlClient, ControlMessages, StreamServer(host), StreamClient(client)
media/      StreamProfile, CodecCapabilities, ScreenCapture(VirtualDisplay),
            VideoEncoder(Surface→H264/H265), AudioCapture(playback capture),
            AudioEncoder(AAC), VideoDecoder, AudioDecoder, AnnexB, AdaptiveController,
            HostPipeline (owns capture+encode+audio)
input/      InputEvent, InputWire(binary), InputTransport, InputInjector{accessibility,
            root, overlay, null}, RemoteInputController(pacing), GameInputAdapter
            (gamepad→touch zones), PadLayout, GamepadReader
games/      GameLibrary (launchable apps via PackageManager + normal intents)
platform/   NeurioApp, MainActivity, HostStreamService, ClientSessionService,
            Controllers (UiActions bridge), Notifications, Permissions,
            NeurioAccessibilityService
ui/         NeurioRoot + 8 Compose screens, theme, components (GameSurface,
            VirtualGamepad, chips…)
```

**Transport is replaceable.** Video/audio/input go through UDP with the shared
header; control goes through TCP with length-prefixed JSON. Swapping in WebRTC or
a different transport means reimplementing `net/` only — `media/`, `input/` and
`ui/` are untouched.

### Wire protocol (summary)

| Channel | Port | Payload |
|---------|------|---------|
| Control | TCP 47621 | length-prefixed JSON: welcome / auth / auth_ok / ready / video_config / stats / ping / bye … |
| Video | UDP 47622 | fragmented H.264/H.265 access units |
| Audio | UDP 47623 | AAC access units |
| Input | UDP 47624 | touch / key / gamepad + ping-pong |
| Discovery | UDP 47620 | beacon + ping |

Every datagram: `int32 "NUR1" | u8 ver | u8 channel | u8 flags | u8 codec | int32
sessionId | int32 token | int32 seq | int32 frameId | int64 ptsUs | int64
captureWallMs | u16 fragIndex | u16 fragCount` (44 bytes), payload capped at 1150
bytes so a frame stays inside one MTU-sized datagram. Flags: `FIRST 0x01`,
`LAST 0x02`, `CONFIG 0x04`, `KEYFRAME 0x08`.

**Why not RTP?** RTP's 12-byte header plus RTCP would add per-packet overhead and
a second channel to carry information our header already has (sequence,
timestamp, marker bit, payload type). Latency was the priority, so the media path
is a thin, documented framing over UDP instead. The transport is isolated in
`net/` — replacing it with RTP/WebRTC touches that package only.

## 6. Static verification (no device needed)

```bash
cd android
python3 tools/static_check.py    # bracket balance, symbol resolution, R.* vs res/, XML, manifest
python3 tools/calls_check.py     # best-effort call-site vs declaration check
```

Both currently report clean. They are **not** a substitute for `kotlinc`: build in
Android Studio before trusting anything.

## 7. Docs

* **[docs/LIMITATIONS.md](docs/LIMITATIONS.md)** — what Android forbids, what we do instead, and where each `TODO(platform-limit)` lives.
* **[docs/TEST_PLAN.md](docs/TEST_PLAN.md)** — 12-phase verification and the two-phone acceptance + robustness matrix.

## 8. Disclaimer

Prototype-quality code aimed at learning and demonstration. The pairing scheme is
LAN-grade, not TLS. Do not expose the ports to the internet. Respect the terms of
service of any game you stream, and only stream games you own.
