# Neurio — LAN Game Streaming (Android)

A real, working Android prototype for **remote game execution + LAN streaming**:

- **Phone 2 (HOST)** runs the actual game (e.g. eFootball — detected from installed apps), captures the live display with `MediaProjection`, encodes it with the **hardware video encoder** and sends it over the local Wi-Fi.
- **Phone 1 (CLIENT)** does **not** install, download or receive any game files. It discovers the host, pairs with a code, **hardware-decodes** the live video fullscreen and sends touch / virtual-controller / physical-gamepad input back.

> Only **video, audio, input and session data** ever cross the network. No cloud servers. No APK/OBB/asset transfer. The unsupported phone is purely a streaming client; all game execution (CPU/GPU/memory/networking) stays on the host.

## Building

Open `android/` in Android Studio (Hedgehog or newer) and build, or:

```bash
cd android
./gradlew assembleDebug     # APK
./gradlew test              # JVM unit tests for protocol/adaptation/stats
```

Requirements: JDK 17, Android SDK 34. Install on **two devices** on the same 5 GHz Wi-Fi (or host phone hotspot).

## The exact example scenario

1. **Phone 2** (eFootball installed) → *HOST GAME* → the Game Library lists installed games (eFootball is flagged as a known title) → select it → *START GAME STREAM* → Android's screen-capture consent appears → the game launches and keeps running → a **6-digit pairing code** is shown.
2. **Phone 1** (eFootball unsupported/not installed) → *JOIN GAME* → Phone 2 appears with ping + link quality → tap *CONNECT* → enter the pairing code → *PLAY*: fullscreen live eFootball with virtual joystick/buttons. Touches and controls travel back to Phone 2.

## Architecture

```
app/src/main/java/com/neurio/
├── common/      Protocol (UDP packet format, HMAC auth), SessionSecurity,
│                StreamConfiguration (quality ladder), NetworkStats, PerfBus
├── network/     DiscoveryService (NSD/mDNS), PairingService (TCP handshake),
│                SessionManager, ControlChannel, UdpTransport,
│                VideoTransport / AudioTransport / InputTransport
├── host/        HostActivity, GameDetector, GameLauncher, ScreenCapture,
│                VideoEncoder (MediaCodec HW), AudioCapture, StreamServer,
│                AdaptationController, InputReceiver, GameInputAdapter
│                (+ AccessibilityService injector), HostStreamService (FGS)
└── client/      ClientActivity, HostDiscovery, StreamClient,
                 VideoDecoder (MediaCodec HW → Surface), AudioPlayer,
                 VirtualController/Joystick/Dpad/ButtonCluster,
                 InputSender, PhysicalControllerHandler, StreamViewActivity
```

### Video pipeline (low-latency by design)

```
Game → Android display → MediaProjection → VirtualDisplay → encoder Surface
→ MediaCodec H.264/H.265 (HW, CBR, low-latency keys, realtime priority)
→ fragment into ≤1400 B authenticated UDP datagrams → LAN
→ reassembly (frameId/fragment index, 150 ms timeout, IDR request on loss)
→ MediaCodec HW decoder (KEY_LOW_LATENCY, newest-frame rendering)
→ SurfaceView
```

No screenshots, no frame copies into the encoder: the VirtualDisplay renders
directly into the encoder's input surface.

### Audio pipeline + honest limits

`AudioPlaybackCapture` (Android 10+) is attempted first. **Most games —
including eFootball — do not opt in**, so Neurio measures RMS, detects
silence, says so in the UI, and can fall back to the microphone (ambient
quality) or run video-only. Nothing is faked.

### Input architecture + honest limits

```
CLIENT touch/joystick/buttons/gamepad → InputEncoder → UDP →
HOST InputReceiver → GameInputAdapter → Android mechanism
```

Stock Android has **no public API to inject touches into another app**. The
legitimate mechanism is `AccessibilityService.dispatchGesture`, which requires
the user to enable *Neurio Input Service* in accessibility settings. Neurio
uses exactly that (normalized client coordinates map 1:1 onto the mirrored
host display). Games that require a physical controller or block injected
gestures won't respond — the UI reports adapter state instead of pretending.

### Adaptive streaming

The client sends a quality report (RTT, loss, jitter, decode ms, rendered FPS)
every second. The host's `AdaptationController` reacts:

| Condition            | Action                            |
|----------------------|-----------------------------------|
| loss ≥ 6% / rtt ≥ 150 ms | drop tier (1080p60 → 720p60 → 720p30 → 480p30) |
| mild degradation     | −20% bitrate (down to 50% floor)  |
| 4 consecutive good reports + cooldown | upgrade tier     |

Bitrate changes are seamless (`setParameters`); tier changes restart the
encoder/virtual display (brief pause) and the client re-syncs on the next
CONFIG + keyframe.

### Security

- 6-digit pairing code shown on the host; one attempt per TCP connection.
- Random 32-bit session id + 32-byte token per session.
- Every UDP datagram carries an 8-byte truncated HMAC-SHA256 (session token).
- Nothing binds or routes outside the LAN.

## Known prototype limits (documented, not hidden)

- Single client per host.
- Accessibility-based input = single synthesized pointer per control, no
  true multi-touch combos; enable via Settings → Accessibility.
- Internal audio capture depends on the game opting in.
- HEVC encode is available but AUTO keeps H.264 for decoder compatibility.
- Temperature shown is battery temperature (Android exposes no CPU thermal
  API to regular apps).

See `app/src/main/java/com/neurio/**` for the real implementations and the
in-code comments that explain each Android constraint.
