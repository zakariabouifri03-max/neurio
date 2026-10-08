# SwiftLoad — architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ src/  (TypeScript, no framework)                                         │
│   main.ts            shell: sidebar, status bar, shortcuts, event fan-out │
│   views/*            Dashboard · Downloads · Completed · Failed · Settings│
│   components/*       cards, card list, dialogs, context menu, toasts      │
│   lib/api.ts         the only place that calls `invoke`                   │
│   lib/store.ts       state + topic subscriptions (no polling)             │
│   lib/events.ts      engine → UI event bridge                             │
└───────────────────────────▲──────────────────────────────────────────────┘
                            │ commands (request/response)
                            │ events  (push, engine → UI)
┌───────────────────────────┴──────────────────────────────────────────────┐
│ src-tauri/src/  (Rust)                                                   │
│   commands/*   thin adapters: validate input, call the engine, map errors │
│   engine/mod   Engine: queue, dispatcher, supervision, statistics         │
│   engine/*     speed · limiter · retry · files · resume · worker ·        │
│                adaptive · download                                        │
│   net.rs       HTTP client: probe, ranges, TLS, proxy, redirects          │
│   db/*         SQLite (WAL): downloads · history · settings               │
│   platform.rs  Explorer, dialogs, notifications, autostart, HKCU handler  │
│   settings.rs  typed settings + clamping                                  │
│   paths.rs     %LOCALAPPDATA%\SwiftLoad, temp layout, name collisions     │
└──────────────────────────────────────────────────────────────────────────┘
```

## Data flow of one download

1. **`download_probe`** — `net::HttpClient` issues a request with
   `Range: bytes=0-0`. Only a `206` with a well-formed `Content-Range` proves the
   server can serve ranges; a lying `Accept-Ranges` header is caught by a second
   mid-file request before segmentation is trusted. The probe also reports the
   real filename (Content-Disposition), size, content type and validators.
2. **`download_add`** — `Engine::add` stores a record (SQLite) plus an
   `AddDownloadArgs`-derived plan. Conflicts with an existing file are resolved
   by the user's choice: replace, rename, or cancel. Nothing is overwritten
   silently.
3. **Queue** — the dispatcher wakes on `Notify` (no polling), picks the lowest
   `position` in `Queued`/`Paused` state and starts it while
   `active < max_concurrent`.
4. **Plan** — the file is split into `connections` segments of equal size
   (minimum `min_segment_bytes`), written to `<dest>/.swiftload/<name>.part`.
   Without range support the plan collapses to one segment covering the file.
5. **Workers** — one task per segment. Each opens its own connection, sends
   `Range: bytes=start+downloaded-end` (with `If-Range` when a validator is
   known) and writes with positioned writes at the absolute offset. Bytes are
   counted **after** they reach the file, never before.
6. **Adaptive controller** — every two seconds it compares smoothed throughput
   and failure rate: it splits the largest active segment in half to add a
   connection, or ends a segment early (honouring `MIN_SPLIT_BYTES`) to remove
   one. It never exceeds the configured maximum, and it is disabled for
   downloads the server cannot fragment.
7. **Supervision** — a monitor task refreshes progress for the UI, checkpoints
   resumable state every `checkpoint_interval_ms`, and drives retries with
   exponential backoff (1s, 2s, 4s, 8s… capped, `Retry-After` honoured).
   Permanent failures (invalid URL, 401/403, 404) are never retried.
8. **Completion** — size check, all segments done, coverage equals the total,
   optional SHA-256, then `finalize()`: `sync_all` → atomic rename → size
   re-check. History row, notification, cleanup of `.part`/`.swlmeta`.

## Resume guarantees

* The `.swlmeta` sidecar stores, per segment, the last 32 bytes' hex digest and
  a version tag; it is written atomically. On resume the tail of every segment
  is re-read and compared. A mismatch (or a short file) discards the unverified
  tail and re-fetches that part instead of trusting corrupt data.
* Writes use absolute offsets, so a paused, restarted or crashed session never
  shifts bytes.
* The database stores the segment layout as JSON and is the source of truth for
  the queue order and per-download state; a live download found at startup is
  converted back to `paused` and can be resumed.

## Resource behaviour

* No polling loops: the dispatcher sleeps on a `Notify` (250 ms while a download
  is active, 20 s when idle). The UI repaints only when the engine pushes.
* The clipboard is read when the user asks (Ctrl+V, “Paste link”) or when the
  window regains focus — never on a timer.
* Sparse preallocation keeps the disk usage honest: the file grows with real
  bytes instead of reserving the whole size up front.

## Security & privacy

* TLS verification is never disabled; the client uses rustls with the Windows
  certificate store (`rustls-tls-native-roots`).
* No component ever executes a downloaded file; “Open file” hands the path to
  Windows exactly like a double-click in Explorer.
* The webview talks only to SwiftLoad's own commands; filesystem, registry,
  clipboard and notification access live in Rust.
* The app makes no network request of its own — no update check, no telemetry,
  no account. Only the URLs you ask for are contacted.
* `swiftload:` links are registered under `HKCU\Software\Classes\swiftload`
  (optional, user-scoped, removable from the About tab); no browser extension is
  installed and no other application is modified.
