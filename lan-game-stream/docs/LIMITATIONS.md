# Limitations — and exactly how the app behaves around them

This file is deliberately blunt. Every item below is a real restriction of stock
Android (or of physics), what the app does about it, and what a future version
could do better. Nothing here is hidden behind marketing language, and nothing is
simulated: where a capability does not exist, the feature is either absent or
clearly marked in the UI.

---

## 1. Input injection

**Restriction.** Android has no public API that lets a normal app inject input into
*another* app. `InputManager.injectInputEvent` requires `INJECT_EVENTS`, a
signature-level permission only system apps hold. `MotionEvent` replay, overlays
that "tap for you" and accessibility services are the only routes available to an
ordinary APK.

**What the app does.** All injection goes through one interface
(`GameInputAdapter`) with three implementations:

| Adapter | Availability | Latency | Good for | Weak at |
| --- | --- | --- | --- | --- |
| `AccessibilityInputAdapter` | any device, service enabled by the user | tens of ms | taps, swipes, drags, held pointers | games that ignore synthetic gestures |
| `RootShellInputAdapter` | rooted device / adb shell daemon | 50–300 ms | D-pad, menus, turn-based | analogue sticks, action games |
| `LOCAL_SELFTEST` | always | local | protocol verification | controlling games (it cannot) |

The host UI always shows which adapter is active, and when none is usable it says
so instead of pretending: *"No input adapter is active. Video works, but the game
will only receive input if you enable the LAN Game accessibility service or run on
a rooted device."*

**Games that block remote input.** Any app can ignore injected gestures — this is
usually deliberate (anti-cheat, competitive fairness, or banking-grade input
hardening). Known behaviour:

* Most casual/sports titles accept accessibility gesture strokes.
* Competitive online shooters with kernel-level or user-space anti-cheat (and many
  mobile MOBA/BR titles) commonly drop injected events; some detect the
  accessibility service being enabled and refuse to launch.
* Secure surfaces (payment sheets, DRM video, `FLAG_SECURE` windows) never accept
  synthetic touches.

The app never claims otherwise, and never bypasses these checks.

**Future paths** (see ROADMAP): a Bluetooth HID device profile
(`BluetoothHidDevice` — system-app only today), a `uinput`-based device node on
rooted/custom ROMs for true analogue input, and vendor game-mode APIs.

## 2. Audio capture

**Restriction.** `AudioPlaybackCapture` (Android 10+) captures *other* apps' audio
only if: the capturing app holds `RECORD_AUDIO`, the captured app's
`audioPlaybackCaptureAllowed` is true, the audio is not DRM-protected, and the
usage is `USAGE_MEDIA`/`USAGE_GAME`/`USAGE_UNKNOWN`. Many games opt out.

**What the app does.** It tries playback capture first. If the configuration is
refused (or the Android version is older than 10), it falls back to the microphone
— which picks up room noise and cannot work with headphones — or streams without
audio. The host screen states which of the three is in effect, and the client is
told `audioEnabled=false` in the handshake and shows a note instead of silence
that looks like a bug.

**Future paths.** Per-app capture allow-listing on rooted devices; capturing
through an audio HAL policy change (custom ROM); a stereo-mix device selector.

## 3. Screen capture

**Restriction.** `MediaProjection` requires explicit user consent per session, the
resulting `Intent` can only be used once, and a foreground service with type
`mediaProjection` must be running before `getMediaProjection()` is called. Android
14+ additionally shows a per-app capture picker and draws a persistent indicator;
some apps can request exclusion from capture.

**What the app does.** Consent is requested immediately before the stream starts,
the foreground service is started first, and the service stops itself when the
projection is revoked. Protected content simply is not captured — Android blacks it
out, and that is the correct behaviour.

## 4. Foreground service & battery

**Restriction.** Background apps get frozen; camera/mic/projection services must
be declared and visible.

**What the app does.** Streaming runs in a `mediaProjection` foreground service
with a persistent notification (with a Stop action), holds a partial wake lock and
a high-performance Wi-Fi lock while streaming, and releases both on stop. The
game itself keeps running normally — the host phone stays warm and busy, which is
expected for a device doing hardware encoding.

## 5. Encoding, thermals and the quality ladder

**Restriction.** Mobile SoCs throttle. Sustained 1080p60 at 20 Mbps is not
possible on every phone, and some encoders refuse certain resolutions (they must be
even, and often aligned to 16 pixels).

**What the app does.** Hardware encoders only (`MediaCodec` with a Surface input —
no screenshot-per-frame encoding anywhere). Capture size is derived from the real
display, aligned, and capped by the user's setting; the encoder is reconfigured for
the negotiated profile; `AdaptiveController` climbs down the ladder
(1080p60 → 720p60 → 720p30 → 480p30) on loss/jitter/decoder-queue pressure and
thermal headroom, and climbs back up when the link recovers. `PerformanceMonitor`
reports thermal status from `PowerManager` (a *status*, not a temperature) and the
host's own CPU time; if the platform will not provide a temperature, the UI says
"not available" rather than inventing one.

## 6. Wi-Fi

**Restriction.** 2.4 GHz links cannot sustain 1080p60; congested channels add
jitter; some routers isolate clients (AP isolation) so the two phones cannot see
each other at all.

**What the app does.** It reports the link (5 GHz/2.4 GHz, link speed, RSSI), uses
the 12 Mbps "weak LAN" variant of the top profile when the link is 2.4 GHz, asks
for a high-performance Wi-Fi lock, and keeps everything on the LAN. Diagnosis is
built in: RTT, jitter, packet loss, NACK counts, retransmissions and a session log
are all visible on the Performance screen. Manual IP entry exists for networks
where discovery is blocked; public addresses are refused.

## 7. What is intentionally *not* implemented

| Not implemented | Why |
| --- | --- |
| Installing/streaming the game APK, OBB or data to the client | That would be a distribution bypass. The client receives pixels only. |
| Any cloud relay or internet exposure | Out of scope by design: LAN only. |
| Frame-perfect gamepad emulation over Bluetooth HID | Needs a system app / privileged permission on stock Android. |
| Universal input injection | Impossible on stock Android; documented instead of faked. |
| Reading game memory, saving state, or scripting input | Cheating, and out of scope. |
| Screenshot-per-frame "streaming" | Latency would be unusable; the app always uses continuous hardware encoding. |

## 8. Known rough edges in this prototype

* Per-game controller layouts are stored per device, not per game; a host-side
  layout suggestion protocol is on the roadmap.
* The microphone fallback records from the phone's own mic, so it also picks up
  the game's speaker output (nothing isolates it in this prototype).
* `LOCAL_SELFTEST` exists purely to verify the input pipeline without touching
  other apps.
* HEVC support depends on the phone's hardware encoder; the setting is hidden when
  no encoder advertises support.
