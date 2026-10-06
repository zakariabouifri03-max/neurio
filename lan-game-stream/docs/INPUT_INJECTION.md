# Remote input: what is possible, what is not, and how this app abstracts it

## The problem

The client plays a game that runs on *another* phone. Its touches therefore have to
become touches on the host's screen. On stock Android there is **no supported API
for a third-party app to do that**:

| Mechanism | Available to an ordinary APK? | Notes |
| --- | --- | --- |
| `InputManager.injectInputEvent` | ✗ | needs `INJECT_EVENTS` (signature permission) |
| `Instrumentation.sendPointerSync` | ✗ | only for the app under test, same process family |
| AccessibilityService `dispatchGesture` | ✓ (user enables the service) | real system-level touch injection, async, no key events |
| `su -c input …` | ✓ only on rooted devices | spawns a process per command; high latency |
| `adb shell input` | ✗ | requires adb from a computer |
| Bluetooth HID device profile | ✗ on stock | `BluetoothHidDevice` is a system API |
| `/dev/uinput` | ✗ on stock | needs root or a custom ROM |

Everything else people suggest (overlays, "auto clickers", floating windows) either
cannot reach other apps at all, or is exactly the accessibility path with extra
steps.

## How this app handles it

```
InputTransport (UDP) ─► InputReceiver ─► GameInputAdapter (interface)
                                              ├── AccessibilityInputAdapter
                                              ├── RootShellInputAdapter
                                              ├── LocalSelfTestAdapter (protocol test)
                                              └── Disabled (video only)
```

* `GameInputAdapter` is the only place that knows how events reach the system.
* `InputReceiver` translates the client's normalised coordinates into display
  pixels **at dispatch time**, so rotating the host phone needs no renegotiation
  and always taps the right place.
* `AccessibilityInputAdapter` drives a 24 ms tick: all currently held pointers ride
  in **one** `GestureDescription` per tick with `continueStroke` chains (concurrent
  independent gestures cancel each other), and sub-tick taps are emitted as short
  strokes so a quick tap is not lost.
* `RootShellInputAdapter` probes for `su` (`su -c id` → uid=0), then runs
  `input tap/swipe/keyevent` on a single worker thread, collapsing quick
  down/up pairs into taps.
* Both adapters report whether they are available *before* the stream starts, and
  `InputAdapterFactory.explainFailure()` turns "not available" into a sentence the
  user can act on.

Protocol-level honesty: the host screen always states which adapter is active (or
why none is), and counts applied versus dropped events. The client's Performance
screen reports how many events it sent, so a mismatch is visible at both ends
rather than events silently disappearing into the void.

## Games that ignore injected input

Injected gestures look like real touches to the *system*, but an app can still
notice and ignore them:

* **Anti-cheat SDKs** commonly validate touch streams (timing distributions, source
  device ids, pointer properties) and drop synthetic input.
* **`FLAG_SECURE` windows** and secure input paths reject injection outright.
* **Some competitive titles** refuse to run when an accessibility service is
  enabled at all — the honest answer is to turn the service off and accept
  spectator mode.
* Games that use a **custom input stack** (raw `/dev/input` reads, native engines)
  may never see accessibility gestures.

This prototype does not attempt to defeat any of those checks. It documents them,
exposes the failure to the player, and leaves the video stream working.

## Latency reality

| Path | Typical added latency |
| --- | --- |
| Accessibility gesture tick | 24 ms quantisation + system dispatch (≈10–30 ms) |
| Root shell `input` | 50–300 ms (process spawn dominates) |
| Client → host UDP (same LAN, 5 GHz) | 2–8 ms |

For a game stream the *visual* loop matters more: the app measures the full budget
(host encode + network RTT/2 + client decode/render) and shows it on the
Performance screen as "estimated glass-to-glass". It is an estimate, computed from
real measurements, and labelled as such.

## Testing input without a game

`Configuration.InputMode.LOCAL_SELFTEST` routes events to an on-screen test
surface in the host app, which is enough to verify the whole chain (client touch →
protocol → receiver → adapter interface) without touching another app.
