# Roadmap — what a production build would add

Ordered by value per unit of risk. Everything here is a *real* improvement path;
nothing is a promise that the platform would allow it without the stated
prerequisite.

## Input (highest value)

1. **`uinput` device node adapter** (rooted/custom ROM). Creates a virtual gamepad
   with real analogue axes and proper `EV_KEY` events, so games see a *controller*
   instead of synthetic touches. Prerequisite: root or a privileged helper.
2. **Bluetooth HID device profile.** `BluetoothHidDevice` exists in the framework
   but is a system API; a device-owner/privileged build could pair the client as a
   real controller. Prerequisite: platform signature or OEM partnership.
3. **Host-authored per-game layouts.** The client already stores a layout per game
   name, so switching games restores the right controls; the next step is letting the
   host author one (its own zone mapper), persist it per package, and send it to the
   client in the handshake or a control message.
4. **Input latency instrumentation in the game loop.** Compare the client's event
   timestamps with the host's applied timestamps and the encoder's PTS to report a
   true input-to-photon number instead of a budget estimate.

## Video / audio

1. **Encoder tuning per vendor**: `KEY_LOW_LATENCY`, slice-based encoding, and
   `setParameters` bitrate ramps tuned for each SoC family (the hooks are already in
   `VideoEncoder`).
2. **HEVC Main10 / HDR pass-through** where the display and encoder support it.
3. **Stereo audio capture from a specific app** with user-selected allow-listing,
   plus optional Opus instead of AAC for lower latency at the same quality.
4. **Wi-Fi Aware (NAN) / Wi-Fi Direct transport** for hotspot-less, router-less
   links with lower jitter than infrastructure Wi-Fi.
5. **Multi-client spectators** (fan-out of one encoded stream) — the current session
   model is deliberately single-client to keep latency and bandwidth predictable.

## Robustness

1. **QUIC-style loss recovery** (per-packet pacing + FEC) on top of the existing
   NACK path, measured against the current implementation on a lossy test network.
2. **Session resumption** so a brief Wi-Fi drop reconnects without re-pairing.
3. **Foreground host UI survival**: a compact host overlay/quick-settings tile that
   shows FPS/ping without leaving the game (the numbers already exist).
4. **Client-side frame pacing** to smooth decode jitter without adding latency.

## Quality

1. Automated instrumentation tests: a `LOCAL_SELFTEST`-style loop over loopback for
   the whole protocol, plus screenshot-free layout verification of the controller
   overlay.
2. A "link doctor" that explains *why* quality dropped (channel congestion, 2.4 GHz,
   thermal throttling, encoder saturation) instead of only showing the numbers.
3. Localisation-ready resources (all strings are already in `strings.xml`).

## Explicitly out of scope, forever

* Transferring game files, APKs, OBBs or data to the client.
* Any cloud relay, account system, or internet exposure of a stream.
* Anything that defeats anti-cheat, input validation, DRM or Play policy.
