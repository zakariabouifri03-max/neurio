# Wire protocol (v1)

Everything is hand-rolled on `java.net` + `javax.crypto`; there is no third-party
library. All multi-byte integers are **big-endian**.

## Channels and ports

| Port | Protocol | Direction | Purpose |
| --- | --- | --- | --- |
| 47777 | TCP | client → host after handshake | control: handshake, client reports, host stats, CSD, bye |
| 47778 | UDP | client → host | input batches (lowest latency, unreliable, ×3 redundancy) |
| 47779 | UDP | host → client | video fragments (unreliable + NACK repair) |
| 47780 | UDP | host → client | audio frames (unreliable) |
| 47781 | UDP | both | discovery beacons/probes (fallback when mDNS is blocked) |

mDNS/NSD service type: `_neurio-lgs._tcp.` with TXT attributes
`device`, `game`, `status`, `ver`, `profile`.
UDP discovery magic: `NEURIO-LGS`; video magic `LGV1`; audio `LGA1`; input `LGI1`;
control magic `LGC1`. Protocol version: **1** (checked in both handshakes).

## Control channel (TCP 47777)

Frame = 4-byte length + 14-byte header + body + 32-byte HMAC-SHA256 trailer, where
the header carries the message type and a monotonic counter, and the trailer is
computed over (header || body) with the session key. The first bit of the header
flags "authenticated", the second "ping/pong"; unauthenticated frames are only
accepted during pairing, and the host rejects unauthenticated frames with a bad
MAC (that is also how it detects a stranger poking the port).

Messages: `HELLO`, `HELLO_ACK`, `PAIR_REQUEST`, `PAIR_RESULT`, `SESSION_OFFER`,
`SESSION_ACCEPT`, `SESSION_START`, `CLIENT_REPORT`, `HOST_STATS`,
`QUALITY_COMMAND`, `KEYFRAME_REQUEST`, `CSD`, `BYE`, `PING`, `PONG`.

## Handshake

```
client                                   host
  │ HELLO(ver, name, device, decoder, wantsAudio, videoPort, audioPort, caps)
  ├────────────────────────────────────────────────────────────►
  │                                  HELLO_ACK(salt, nonce, uptime, hostName,…)
  ◄────────────────────────────────────────────────────────────┤
  │  (if the host requires a code)
  │ PAIR_REQUEST(proof = HMAC(PBKDF2(code, salt), nonces))
  ├────────────────────────────────────────────────────────────►
  │                                    PAIR_RESULT(ok, sessionNonce)
  ◄────────────────────────────────────────────────────────────┤
  │ SESSION_ACCEPT(proof over session nonces, chosen profile)
  ├────────────────────────────────────────────────────────────►
  │                                        SESSION_START(sessionTag)
  ◄────────────────────────────────────────────────────────────┘
```

* Pairing key: `PBKDF2-HMAC-SHA256(code, salt, 12 000)` — the 6-digit code never
  crosses the wire.
* Session key: HKDF-style HMAC over both nonces; a 16-bit `sessionTag` derived from
  it is stamped into every UDP packet, so datagrams from other sessions/apps on the
  same network are discarded without touching the crypto.
* `clockOffsetMs` lets the client timestamp input in the host's uptime clock, which
  is what makes a real end-to-end input latency measurable on the host side.
* Wrong codes are counted; after several attempts the session is dropped and the
  host regenerates the code.

## Video (UDP 47779)

32-byte header: magic, sessionTag, reserved, frameId, presentation timestamp (µs),
fragment index, fragment count, frame size, flags
(`KEYFRAME`, `HEVC`, `LAST_FRAGMENT`). Payload ≤ 1316 bytes (safe MTU for Wi-Fi).

* Frames are never split across more than the negotiated count; the receiver keeps
  a bitmap per frame and asks for missing fragments with a `NACK` (message 0x20,
  up to 96 fragment indices per datagram) after a 6 ms grace period.
* At most two retransmissions per fragment; if a frame cannot be completed within
  the frame-gap cap (120 frames), it is abandoned and reported as loss.
* The receiver may request a keyframe (`KEYFRAME_REQUEST`), which the host answers
  immediately; keyframes are also forced every 1.5 s so a late joiner converges.
* The client keeps at most 4 frames queued to the decoder — a skipped frame is
  better than a growing delay.

## Audio (UDP 47780)

24-byte header: magic, sessionTag, sequence, timestamp, payload size, flags
(`AFLAG_CODEC_CONFIG`), then either an ADTS AAC frame (48 kHz, stereo, 128 kbps) or
the `AudioSpecificConfig` for the decoder. The client strips the 7-byte ADTS header
when it already has a config, and plays through a small jitter buffer rather than
growing latency.

## Input (UDP 47778)

16-byte header: magic, sessionTag, sequence, clientSendMs (host-clock estimate),
event count, padding. Then N × 16-byte events: type, pointerId, code, x, y,
timeOffsetMs — with x/y **normalised 0..1** so the host can map them onto its real
display size at dispatch time (rotation-proof). Types: `DOWN`, `MOVE`, `UP`,
`KEY_DOWN`, `KEY_UP`, `AXIS`, `SWIPE_SEQUENCE`.

Every batch is sent three times for redundancy; the host keeps a 16-bit sequence
window and drops duplicates. Events older than 250 ms are discarded as stale, and
a watchdog releases any pointer that has been held for more than 8 s without a
follow-up (a dropped Wi-Fi link must never leave the game with a stuck finger).

## Adaptation

The client reports every 450 ms: frames received/decoded/dropped/lost, packets
received/lost, jitter, RTT, decoder queue depth, receive bitrate, its requested
size/fps, and a quality tier. The host replies with encoder stats every 400 ms and
moves along the quality ladder when the report says the link is struggling:

| Tier | Shape | Bitrate |
| --- | --- | --- |
| EXCELLENT | 1920×1080 @ 60 | 20 Mbps (12 Mbps on 2.4 GHz) |
| GOOD | 1280×720 @ 60 | 8 Mbps |
| WEAK | 1280×720 @ 30 | 4.5 Mbps |
| VERY_WEAK | 854×480 @ 30 | 2 Mbps |

Changes are rate-limited (no more than once every 4 s, at least 30 samples) and the
host re-sends `SESSION_OFFER` so the client can reconfigure its decoder without a
new handshake. Thermal pressure can force a step down regardless of the link.

## Security posture

* LAN only: the client refuses to connect to a public address, and the host never
  routes anything off-link.
* Pairing is required (a fresh 6-digit code per session, shown on the host and
  regenerable at any time) — an unpaired client cannot receive a single frame.
* Every control frame is MACed; every UDP packet is filtered by the session tag.
* The session key is never transmitted; regenerating the code invalidates the
  previous one immediately.
