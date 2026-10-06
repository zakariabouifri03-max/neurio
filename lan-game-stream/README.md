# LAN Game Stream — remote game execution over local Wi-Fi

Two Android phones, one Wi-Fi network, no cloud:

```
  ┌─────────────────────────── Phone 2 (HOST) ───────────────────────────┐
  │  the game runs normally, on screen, untouched                        │
  │                                                                     │
  │  MediaProjection ─► ScreenCapture ─► VideoEncoder (MediaCodec HW)   │
  │  AudioPlaybackCapture / mic ──────► AudioEncoder (AAC)              │
  │        │                                  │                         │
  │        └────────────► StreamServer ───────┴──► VideoTransport (UDP) │
  │                            ▲                    AudioTransport (UDP)│
  │                            │                        │               │
  │  InputReceiver ◄── InputTransport (UDP) ◄───────────┼───────────────┤
  │        │                                            │               │
  │        └─► GameInputAdapter (accessibility / root)   │               │
  └──────────────────────────────────────────────────────┼──────────────┘
                                                         │
                        Wi-Fi (5 GHz / hotspot / Wi-Fi Direct)
                                                         │
  ┌─────────────────────────── Phone 1 (CLIENT) ─────────┼──────────────┐
  │  SessionManager-style handshake over TCP (47777)  ◄──┘              │
  │  VideoTransport.Receiver ─► VideoDecoder ─► SurfaceView             │
  │  AudioTransport.Receiver ─► AudioPlayer (AudioTrack)                │
  │  VirtualController ─► InputSender ─► InputTransport (UDP, ×3 copies)│
  └─────────────────────────────────────────────────────────────────────┘
```

**What this is** — the game actually executes on the host phone. The client phone
receives *video, audio and session data only* and sends input back. It never
receives the APK, OBB, game data or any install package, and nothing is downloaded
to it. That is the whole point: a phone that the Play Store considers unsupported
can still play, because all the game work happens on the phone that *is*
supported.

**What this is not** — it is not a compatibility bypass, not an emulator, not a
cloud service, and not a cheat. Nothing leaves the local network, and Play policy
is respected: no `QUERY_ALL_PACKAGES` (the library comes from a LAUNCHER
`<queries>` block), no overlay abuse, and remote input is opt-in and user-enabled.

---

## Build

Requirements: Android Studio (Koala or newer) **or** a plain JDK 17 + Android SDK
with `platforms;android-35` and `build-tools;35.0.0`.

```bash
cd lan-game-stream
./gradlew :app:assembleDebug      # debug APK   → app/build/outputs/apk/debug/
./gradlew :app:assembleRelease    # release APK → app/build/outputs/apk/release/
```

Open the `lan-game-stream` folder directly in Android Studio and press Run — the
project is a normal Gradle/AGP project (AGP 8.7.3, Gradle 8.11.1, Java 17,
minSdk 26, targetSdk 35). There are **no third-party dependencies**: everything is
built on framework APIs and `java.*`, so the build works offline once the SDK and
AGP are cached.

## Run it

On **Phone 2** (host, has the game):

1. `HOST GAME` → pick the game from the installed-app list.
2. `LAUNCH GAME` (optional but recommended) so the game is in the foreground.
3. Grant notifications + microphone, then accept the **screen-capture consent**
   dialog. A foreground service notification appears — that is the streaming
   engine, and it must stay visible (Android requires it).
4. `START STREAM`. A 6-digit pairing code is shown; regenerate it any time.
5. Optional: enable **LAN Game remote input** in Settings → Accessibility so the
   client's touches can be injected into the game. Without it, the client still
   gets video + audio (spectator mode).

On **Phone 1** (client):

1. `JOIN GAME` → the host appears in the list with its name, IP, ping, the game
   name and — while streaming — the resolution/frame rate it is sending.
2. Type the pairing code (or pick the host that asked for one) and `CONNECT`.
3. `PLAY` takes you to the fullscreen stream. Controls: drag for the analogue
   stick, tap/drag anywhere for touch zones, `Layout` to switch presets,
   `Edit` to move and resize the controls over the game's own on-screen buttons,
   `Performance` for live numbers, `Disconnect` to stop.

Everything is on the local network: no server, no account, no internet exposure.
Discovery is NSD/mDNS with a UDP beacon fallback and manual IP entry; the client
refuses public addresses outright.

## Screens

| Screen | Purpose |
| --- | --- |
| `LAN GAME` (main) | Host / Join / Settings / Performance, Wi-Fi status |
| `HOST GAME` | game library, pairing code, live FPS / bitrate / ping, start-stop, input + audio status |
| `JOIN GAME` | discovered hosts (name, IP, ping, quality, game, resolution/fps), manual IP, pairing code |
| Stream | fullscreen video, virtual controller, HUD, show/hide controls, layout switch, edit mode |
| `Settings` | codec, resolution cap, FPS, bitrate cap, adaptive streaming, audio, input adapter, haptics |
| `Performance` | FPS, encoder/decoder latency, RTT, jitter, loss, bitrate, resolution, thermal, CPU, dropped frames, decoder queue, session log |

## Honest limitations (short version)

* **Remote input is not universally possible on stock Android.** The only
  supported mechanism is an AccessibilityService replaying gesture strokes; some
  games and most anti-cheat SDKs ignore injected touches. A rooted device can use
  a `su -c input` adapter instead (higher latency, no analogue sticks).
  See [docs/INPUT_INJECTION.md](docs/INPUT_INJECTION.md).
* **Internal game audio may be refused.** `AudioPlaybackCapture` (Android 10+)
  only captures apps that allow it; the host then falls back to the microphone or
  streams video without sound, and says so in the UI.
* **Protected/secure surfaces cannot be captured** (some streaming apps, DRM
  content, and Android 14's per-app capture consent dialog can block specific
  apps).
* **Nothing is transmitted except the stream**: no game files, no install
  packages, no game state. If a game requires a file the client does not have,
  that is by design — the client never needs one.
* Numbers on the Performance screen are measured, never invented. Where a value
  genuinely cannot be read on a device (e.g. CPU core temperature), the row says
  so instead of showing a guess.

The full list, with reasons and future paths, is in
[docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Documentation

| File | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | modules, data flow, threading, lifecycle |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | ports, packet layouts, handshake, security, adaptation |
| [docs/INPUT_INJECTION.md](docs/INPUT_INJECTION.md) | the input abstraction, adapters, anti-cheat, future paths |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | every restriction and how the app behaves honestly around it |
| [docs/ROADMAP.md](docs/ROADMAP.md) | what a production build would add next |
