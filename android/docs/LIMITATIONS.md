# Neurio — honest platform limitations

This document lists **everything this prototype cannot do because Android (or the
game, or the SoC) refuses to allow it**, what the app actually does instead, and
where the corresponding `TODO(platform-limit)` marker lives in the source.

Guiding rule used while building this: **never fake it.** Where a feature cannot
work, the code implements the maximum technically-real subset, says so in the UI,
and isolates the limitation behind an abstraction so a better transport can be
dropped in later.

Search the sources for `TODO(platform-limit)` — there are six, all listed below.

| # | Area | Marked in |
|---|------|-----------|
| 1 | Input injection (accessibility) | `input/AccessibilityInputInjector.kt` |
| 2 | Input injection (privileged / root) | `input/PrivilegedInputInjector.kt` |
| 3 | Overlay is drawing, not injection | `input/OverlayInputInjector.kt` |
| 4 | Internal audio capture | `media/AudioCapture.kt` |
| 5 | Secure surfaces capture black | `media/ScreenCapture.kt` |
| 6 | Codec / latency knobs we do not control | `media/VideoEncoder.kt` |

---

## 1. Remote input — the hardest limitation

### What the platform says

Android deliberately does **not** let application A deliver touches into
application B. There is no public API, no permission and no flag that changes
this for an ordinary, user-installed app:

* `android.permission.INJECT_EVENTS` is `signature|privileged`. A normal APK can
  never hold it. We do not even declare it.
* `InputManager.injectInputEvent()` is hidden (blocklisted since Android 11) and
  permission-protected.
* `SYSTEM_ALERT_WINDOW` only permits **drawing** over other apps. It grants zero
  input capability. Any app claiming otherwise is shipping a mockup.
* `AccessibilityService.dispatchGesture()` is the **only** stock mechanism that
  performs real touches from a third-party app — and it is restricted (below).

Everything above the injector (transport, coordinate mapping, pacing, gamepad
handling) is platform-independent: swap the `InputInjector` and the rest of the
pipeline is unchanged.

### What this prototype actually does

| Mode | Real behaviour | Works on | Blocked by |
|------|----------------|----------|-----------|
| `AUTO` | accessibility → root → overlay | — | — |
| `ACCESSIBILITY` | **Real** taps/swipes/long-press/hold via `AccessibilityService.dispatchGesture()` | every stock phone, once the user enables the service in Settings | see below |
| `ROOT` | real events via `su -c input …`, plus an attempt at the hidden `InputManager.injectInputEvent()` | rooted phones only | hidden-API blocklist, SELinux, ~30–60 ms per event |
| `OVERLAY` | draws every incoming touch on top of the game, injects nothing | **every** device | nothing — it is a diagnostic, not injection |
| `DISABLED` | transport still measured, nothing injected | every device | n/a |

### Accessibility-mode restrictions we do not hide

1. **The user must enable the service by hand** (Settings → Accessibility →
   *Neurio remote input*). Android forbids enabling it programmatically; the app
   only detects the state and deep-links to the settings screen.
2. **Gestures are atomic and serialised.** A new `dispatchGesture()` cancels the
   previous one, and every gesture ends with an implicit finger lift. A true
   "press and hold" therefore has to be replayed as a chain of short strokes —
   see `RemoteInputController` (`HOLD_INITIAL_MS`, `HOLD_REPEAT_MS`).
   Multi-touch is expressible (one `Path` per finger) but only inside one atomic
   gesture, and not all ROMs honour more than a couple of paths.
3. **Some games ignore injected gestures entirely**: anti-cheat SDKs, games that
   read raw touch events through their own native pipeline, and a few OEM ROMs
   that throttle `dispatchGesture`. There is no API to detect this up front, so
   the host UI reports *"available but unverified"* rather than promising it
   works.
4. **Keys** (`injectKey`) go through `AccessibilityService.performGlobalAction()`
   for BACK/HOME/RECENTS only. There is **no** legitimate way to send arbitrary
   keycodes to another app — therefore gamepad buttons are mapped to **touch
   zones** (`GameInputAdapter`), which is what actually reaches the game.

**Consequence, stated plainly:** on an un-rooted phone, gameplay control works
for the large class of games that accept synthetic gestures, and degrades to
"nothing happens" for games that reject them. The app never pretends otherwise —
the stream keeps working either way.

---

## 2. Audio

* Internal game audio is captured with **playback capture** (`AudioPlaybackCaptureConfiguration`,
  Android 10+ / `minSdk 26` here). This is the only legitimate route for a normal app.
* A game that sets `ALLOW_CAPTURE_BY_NONE`, uses DRM audio or hooks an anti-cheat
  layer produces an `AudioRecord` that **starts fine but delivers silence**, and
  the system tells us nothing. We detect it with a silent-read counter
  (`AudioCapture.silentReads`) and show *"blocked by the game"* instead of
  pretending audio works.
* **Voice-call audio can never be captured**, on any Android version.
* When audio is unavailable the **video stream is unaffected**; the audio path is
  fully decoupled (`AudioCapture` → `AudioEncoder` → UDP channel 47623 →
  `AudioDecoder` → `AudioTrack`) and can be switched off in Settings.

## 3. Screen capture

* `MediaProjection` requires a **user-facing consent dialog every session**. It
  cannot be pre-granted, and the app cannot start a projection from the
  background; on Android 10+ it must run inside a foreground service of type
  `mediaProjection` (implemented in `HostStreamService`).
* Surfaces flagged `FLAG_SECURE` (banking, DRM video, some launchers and
  anti-cheat overlays) mirror as **pure black**. No detection API, no workaround.
* The capture runs at the *encoded* resolution (480p/720p/1080p) so the GPU
  downscales once while mirroring; we never touch bitmaps in app memory.

## 4. Discovery

* Discovery uses **NSD/mDNS (`_neurio._tcp.`)** plus a **UDP broadcast beacon +
  unicast ping** fallback, because many home routers and phone hotspots filter or
  drop multicast.
* If **AP/client isolation** is enabled, neither mechanism can find the host.
  That is why the client screen has **manual IP entry** — the guaranteed path.
* Discovery is LAN-only by design: there is no server, no relay, no cloud.

## 5. Codecs, latency and adaptation

* `MediaCodec` gives baseline/main H.264 (and H.265 where the SoC exposes it)
  with **no B-frames, no 10-bit/HDR**, and only a *hint* for low latency that
  some vendors ignore.
* Vendor encoders cap concurrent sessions; a second simultaneous capture on the
  same phone can fail.
* Adaptive control (AIMD bitrate + resolution tiering) reacts to **client-reported**
  loss/RTT/drop rate. It cannot see Wi-Fi retransmissions directly, so it is
  deliberately conservative: resolution drops only after the bitrate has been at
  its floor for five consecutive seconds, with a 15 s cooldown.
* Reported end-to-end latency relies on a 4-timestamp clock sync between the two
  phones; if their wall clocks disagree badly the estimate can be negative, and
  the client clamps it to `0..2000 ms` and discards out-of-range samples.

## 6. Security model (prototype grade)

* Pairing uses a 6-digit code that is **never sent over the wire**; the client
  proves knowledge of it with `HMAC-SHA256(code, challenge|salt|sessionId)`.
* On success the host issues a random 32-bit session token that must be present
  in **every** datagram, so an unpaired device on the same Wi-Fi cannot inject
  input or force keyframes.
* This is **not TLS**. It stops casual/unknown LAN clients, not a determined
  attacker with packet capture. Everything stays on the local network; do not
  expose these ports to the internet.

## 7. Session model

* **One client per host** (`ControlServer` answers `host_busy` to a second
  connection). Multi-player would require N encoders or a shared stream plus per
  client input channels — out of scope for the prototype.
* Terminating the host foreground service stops the session, sends `session_stopped`
  over the control channel and releases the projection; the client returns to the
  scan screen with a reason string.

## 8. Things we deliberately do NOT do

| Not done | Why |
|----------|-----|
| Download / install / transfer the game, APK, OBB or data | Explicit requirement — phone 1 never receives the game |
| Cloud relay / remote server | Requirement: LAN only, no backend |
| Screenshot-JPEG "streaming", prerecorded video, mock gameplay | Requirement: real MediaProjection + MediaCodec |
| Root-only or system-only requirements | Must run on stock phones |
| Unlimited input injection | Impossible on stock Android; see §1 |

## 9. Device/OS coverage

* Target: **Android 12+ (minSdk 26)**, 5 GHz Wi-Fi, hardware H.264 encoder and
  decoder. Behaviour on Android 8–11 is best-effort (gesture API differences).
* TV/leanback and ChromeOS are declared as optional features but untested.
* Bluetooth gamepads are read through standard `MotionEvent`/`KeyEvent`
  dispatch in `MainActivity` — no vendor SDKs, so button layouts differ per pad.
