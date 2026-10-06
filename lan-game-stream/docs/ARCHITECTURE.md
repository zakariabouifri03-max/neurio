# Architecture

```
com.neurio.langame
├── common/            shared, dependency-free building blocks
│   ├── Configuration      ports, timeouts, quality ladder, enums (Codec, InputMode, QualityTier)
│   ├── Protocol           every wire format + helpers (buffer pool, string codec, packet headers)
│   ├── Security           pairing codes, PBKDF2/HMAC keys, constant-time compare, fingerprints
│   ├── NetworkStats       RTT/jitter/loss/bitrate estimators + report serialisation
│   ├── DeviceInfo         model, codec discovery, thermal status (never invents a temperature)
│   ├── StreamProfile      one resolution/fps/bitrate shape + the presets
│   ├── AppSettings        SharedPreferences wrapper (codec, caps, audio, input mode, layouts)
│   ├── Logger             in-memory ring buffer + logcat (the Performance screen reads it)
│   └── Utils              threads, dp/sp, byte/bitrate formatting, quiet closes
│
├── network/           transport + discovery + session (no Android UI at all)
│   ├── ControlChannel     length-prefixed authenticated TCP framing, keepalive, RTT
│   ├── PairingService     handshake state machine for both roles, negotiate(), explainBye()
│   ├── SessionManager     host-side session owner: one client, stats loop, CSD, profile updates
│   ├── VideoTransport     fragmenting sender with NACK repair, reassembling receiver with pooling
│   ├── AudioTransport     AAC frames + codec config, ADTS helpers
│   ├── InputTransport     redundant batches, duplicate-suppressing receiver
│   ├── DiscoveryService   NSD/mDNS registration + discovery, UDP beacon/probe fallback, probeHost()
│   └── NetworkUtils       link inspection (5 GHz?, link speed, RSSI), address helpers
│
├── host/              everything that runs on the phone with the game
│   ├── ScreenCapture      MediaProjection → virtual display; size alignment helpers
│   ├── VideoEncoder       MediaCodec H.264/H.265 with a Surface input (no screenshot path)
│   ├── AudioCapture       AudioPlaybackCapture (API 29+) with an honest mic/none fallback
│   ├── AudioEncoder       AAC encoder, ADTS wrapping, AudioSpecificConfig export
│   ├── AdaptiveController quality ladder decisions from reports + thermals
│   ├── PerformanceMonitor /proc/self/stat CPU time + PowerManager thermal status
│   ├── StreamServer       the engine: session → pipeline → transport, stats, warnings
│   ├── HostStreamService  mediaProjection foreground service, notification, wake/Wi-Fi locks
│   ├── InputReceiver      normalised → pixel mapping, latency, stuck-pointer watchdog
│   ├── GameDetector       launcher-activity library (games first, icons cached)
│   ├── GameLauncher       real launch + honest "is it in the foreground?" check
│   └── input/             GameInputAdapter + accessibility / root / self-test adapters
│
├── client/            everything that runs on the phone without the game
│   ├── StreamClient       connect → pair → decode → play → report (one object, one thread)
│   ├── VideoDecoder       MediaCodec → Surface, zero-timeout queueing, render-latency tracking
│   ├── AudioPlayer        AAC → AudioTrack with a small jitter buffer
│   ├── InputSender        batching/coalescing, host-clock timestamps, key + touch events
│   ├── HostDiscovery      NSD + UDP results merged, live ping per host, TTL pruning
│   ├── ControllerLayout   editable layouts (serialise/deserialise, presets, mirroring)
│   ├── VirtualController  the touch overlay: analogue stick, D-pad, buttons, touch zones
│   ├── ClientStatsHolder  tiny pub/sub so the Performance screen can observe without leaking
│   ├── ClientActivity     host browser + manual IP + pairing code
│   └── StreamActivity     fullscreen player, HUD, edit mode, layout switching
│
└── ui/
    ├── main/…             main menu, settings, performance screens
    └── views/UiKit        programmatic styling kit (chips, list rows, palette)
```

## Data flow (host, after the client connects)

```
MediaProjection ─► ScreenCapture (virtual display, real size, aligned)
                        │  Surface
                        ▼
                   VideoEncoder (MediaCodec, HW, CBR, 1.5 s keyframe interval)
                        │  ByteBuffer + keyframe flag  (no copy: encoder output buffer is
                        │                               handed straight to the sender)
                        ▼
                   VideoTransport.Sender ── UDP 47779 ──► client
                        ▲
                        │ NACK / keyframe requests      (UDP feedback from the client)
                   SessionManager ◄── TCP 47777 ── CLIENT_REPORT (450 ms) / KEYFRAME_REQUEST
                        │
                        └─► AdaptiveController → encoder.setBitrate() or a full pipeline rebuild
                                                  (new profile announced with SESSION_OFFER)

AudioPlaybackCapture ─► AudioCapture ─► AudioEncoder (AAC) ─► AudioTransport.Sender ── UDP 47780
InputTransport.Receiver ─► InputReceiver ─► GameInputAdapter (accessibility / root / self-test)
```

## Threading

| Thread | Owns |
| --- | --- |
| `lgs-accept` / session threads | TCP accept, handshake, control reads, keepalive |
| `lgs-video-tx`, `lgs-audio-tx` | UDP senders (with their own retransmit timers) |
| `lgs-input-rx` | input datagrams → adapter dispatch |
| `lgs-stats` | host stats snapshot every 330 ms, forwarded to the UI + control channel |
| `lgs-decoder` (`URGENT_DISPLAY`) | client MediaCodec callbacks → Surface |
| `lgs-audio-out` (`AUDIO`) | client AAC decode → AudioTrack writes |
| main | UI only: every callback that touches a View is posted to the main looper |

Rule of thumb used throughout: transports never touch UI, UI never blocks on a
socket, and every listener callback that can fire from a network/codec thread is
marshalled to the main thread before it reaches a View.

## Lifecycle

* **Host**: the consent `Intent` → `HostStreamService.start()` (foreground service
  with `mediaProjection` type) → `StreamServer` → `SessionManager` waits for one
  client → pipeline is built on connect and torn down on disconnect, while the
  service keeps listening. Stopping the service releases capture, encoder, sockets,
  wake locks and the Wi-Fi lock, and stops advertising.
* **Client**: `StreamActivity` owns the `StreamClient`, hands it the `Surface` as
  soon as the `SurfaceView` exists, and disconnects in `onStop` so no socket
  outlives the screen. `ClientStatsHolder` lets the Performance screen observe
  while it is open.
* The host game is never touched, wrapped, or modified — it runs exactly as it
  would without this app.

## Error philosophy

Every failure path has three properties: it is *detected* (counters, watchdog,
timeouts), it is *explained* in the UI in plain language, and it *degrades instead
of lying*. Examples: no input adapter → video-only with a warning; audio capture
refused → note on both ends; encoder error → one automatic rebuild, then a clear
error state; client silence for 4 s → session closed and the host returns to
"waiting".
