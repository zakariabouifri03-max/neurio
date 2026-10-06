# Neurio — build, phase and two-phone test plan

Everything here is meant to be executed in **Android Studio on a real machine**
with **two real Android 12+ phones**. The prototype was authored without a JVM or
the Android SDK in the loop, so the static checks (`tools/static_check.py`,
`tools/calls_check.py`) only prove self-consistency — this document is what turns
that into a working install.

---

## 0. Environment

| Item | Requirement |
|------|-------------|
| Host PC | Android Studio Koala+ (AGP 8.5.2 / Gradle 8.7 / JDK 17) |
| Phone 2 = **HOST** | Android 12+ (API 31+), game installed, H.264 hardware encoder |
| Phone 1 = **CLIENT** | Android 12+, **game NOT installed**, H.264 hardware decoder |
| Wi-Fi | 5 GHz, same subnet, **AP/client isolation OFF** |
| Ports | TCP 47621, UDP 47620/47622/47623/47624 (LAN only) |

### 0.1 First build (once)

1. **File → Open** → select the `android/` folder (not the repo root).
2. Let Studio sync. If it complains about a missing wrapper jar:
   `./gradlew wrapper --gradle-version 8.7` (or *File → Sync Project with Gradle
   Files*, which regenerates it). `gradle/wrapper/gradle-wrapper.properties` is
   already correct.
3. **Build → Make Project**, then run on both phones (USB or Wi-Fi debugging).
4. Install the **release** variant on the host if you want the
   `com.neurio.lanstream` id (debug uses the `.debug` suffix — both work, keep
   them consistent so `<queries>` and the launcher list behave identically).

### 0.2 Enable input on the HOST (do this before the input tests)

`Settings → Accessibility → Neurio remote input → On`.
This is **required** for real gameplay control and cannot be done from code.
The HOST screen shows the current mode and whether it is usable;
`Diagnostics → copy report` includes the state.

---

## 1. Twelve build phases → how to verify each one

| # | Phase | Where | Expected result |
|---|-------|-------|-----------------|
| 1 | Project + UI shell | `ui/`, `platform/MainActivity` | app opens, dark theme, 4 cards (Host / Join / Settings / About) + diagnostics entry |
| 2 | LAN discovery | `discovery/` | HOST appears on the CLIENT scan screen within ~2 s with name, IP and (if set) game name; manual IP entry also works |
| 3 | Pairing + session auth | `core/PairingService`, `net/ControlServer` | wrong code → `auth_fail` + lockout after 5 tries; correct code → `auth_ok` with session id + token |
| 4 | MediaProjection capture | `media/ScreenCapture`, `platform/HostStreamService` | consent dialog appears; service starts as a `mediaProjection` foreground service; notification stays |
| 5 | MediaCodec encode | `media/VideoEncoder`, `HostPipeline` | Diagnostics shows a **hardware** H.264 encoder; host stats show non-zero FPS and bitrate |
| 6 | Send over LAN | `net/StreamServer`, `net/Framer` | Wireshark on the PC (mirrored port) shows ~1190-byte UDP datagrams to 47622 |
| 7 | Decode | `media/VideoDecoder` | client log: decoder configured, `video_ready` set |
| 8 | Render | `ui/components/GameSurface`, `ui/screens/StreamScreen` | full-screen, letterboxed, no tearing; survives rotation and background/foreground |
| 9 | Input | `input/*` | with the accessibility service on, taps reach the game; otherwise the overlay visualiser draws them and nothing is injected |
| 10 | Game launch | `games/GameLibrary` | host library lists installed launchable apps with icons; tapping launches the real game, then the stream follows |
| 11 | Audio | `media/AudioCapture`, `AudioDecoder` | either real game audio, or an explicit status (`blocked by the game`, `needs Android 10+`) — never silence pretending to work |
| 12 | Adaptive + stats | `media/AdaptiveController`, `core/Stats` | stats overlay updates fps/bitrate/ping/loss/dropped every second; bitrate visibly backs off under load |

---

## 2. Two-phone acceptance test

### 2.1 Light game (e.g. a 2D puzzle / endless runner)

1. HOST: **Host game** → pick the game → grant capture → the game launches.
2. HOST panel shows: device name, local IP, **6-digit code**, player name once
   connected, latency, FPS, bitrate.
3. CLIENT (**game not installed**): **Join game** → pick the host → enter the code
   → **Connect**.
4. Within ~1 s the stream appears. Play for 5 minutes.

**Pass criteria**

- [ ] The game is **never** downloaded or installed on phone 1 (verify in
      Settings → Apps: it is absent before *and* after).
- [ ] Video is continuous (no freezes > 500 ms) for 5 minutes.
- [ ] Input reaches the host wherever the gesture API is accepted; taps land
      within a few pixels of the pressed point.
- [ ] Stats: FPS within ±15 % of the configured target, ping < 30 ms on good
      5 GHz, packet loss < 1 %.
- [ ] Host **Stop** → client shows a reason and returns to the scan screen; client
      **Disconnect** → host returns to *waiting for a player* and re-advertises.

### 2.2 Medium game (e.g. a racing / action title, 500 MB–1.5 GB)

Repeat 2.1, then:

- [ ] Set 720p / 60 fps / High; record the numbers.
- [ ] Switch to 1080p / 60 fps; note whether the encoder keeps up (FPS drop is
      expected and acceptable; the adaptive controller should lower the bitrate,
      not the frame rate, first).
- [ ] Enable audio: confirm sound, or a clearly stated block reason.

### 2.3 Large game (e.g. a 2 GB+ open-world / shooter)

- [ ] Repeat at 720p / Medium.
- [ ] Watch for thermal throttling after 15 min; adaptive control should back off
      the bitrate and the UI should show it.
- [ ] If the game blocks gesture injection, the host UI must say so and the
      overlay mode must still show that input arrives (transport proven).

---

## 3. Robustness / failure matrix

| Test | Steps | Expected |
|------|-------|----------|
| Wrong pairing code | enter `000000` five times | `auth_fail`, then 30 s lockout with a visible countdown reason |
| Second client | connect phone 3 while phone 1 plays | `host_busy`, no disruption to phone 1 |
| Host stops | swipe the host notification / press Stop | client gets `session_stopped` and exits cleanly |
| Client backgrounded | press Home on phone 1 | foreground service keeps decoding; returning to the app re-attaches the Surface |
| Host backgrounded | press Home on phone 2 | capture continues (the game keeps rendering); notification stays |
| Rotation | rotate either phone | re-letterboxed, no restart, no keyframe storm |
| Wi-Fi fluctuation | walk to the edge of coverage / enable a 2.4 GHz SSID mid-session | bitrate backs off, no crash, recovery within a few seconds; heavy loss triggers a keyframe request |
| Host IP changes | renew DHCP mid-session | control socket drops → clean stop with `connection_lost` (re-connect is manual in this prototype) |
| Screen off on host | lock phone 2 | capture stops (expected: Android stops the display); client shows the last frame then a status message |
| Game crash on host | force-stop the game | stream keeps running and shows whatever is on screen (home screen) |
| Airplane mode on client | toggle during play | clean disconnect, no ANR |

---

## 4. Metrics to record

| Metric | Where | Target (good 5 GHz) |
|--------|-------|---------------------|
| End-to-end latency | client stats overlay (`LAG`) | 40–90 ms |
| Glass-to-glass check | film both phones with a third device, tap the host screen | ≤ 3 frames |
| FPS (host) / FPS (client) | host panel / client overlay | 55–60 at 720p60 |
| Bitrate | host panel | tracks the preset, adapts under loss |
| Packet loss | client overlay | < 1 % |
| Dropped frames | client overlay | < 1 /s |
| Encode time | host panel (`ENC`) | < 8 ms/frame at 720p |
| Input rate | host panel (`IN`) | matches the player's touch rate |

Record a run in `docs/TEST_RUNS.md` (create it when you test) using the copyable
report from **Diagnostics → copy report** on both phones.

---

## 5. What is *not* covered by this plan

* APK size / startup-time optimisation (prototype, debug-friendly logging on).
* Multi-client sessions — explicitly one player per host (see LIMITATIONS §7).
* Behaviour on Android 8–11 is best-effort only.
* Automated instrumentation tests: the repo ships JUnit scaffolding but **no
  device tests yet**, because every meaningful assertion (encoding, streaming,
  injection) needs two real devices.
