# SwiftLoad

A lightweight, professional download manager for Windows. Rust engine, Tauri
shell, plain TypeScript interface, SQLite for state — and nothing else: no
account, no cloud, no telemetry, no background service.

```
 ┌─────────────┬───────────────────────────────────────────────┐
 │ Dashboard   │ active downloads · queue · throughput · totals│
 │ Downloads   │ queue order, live per-connection segments     │
 │ Completed   │ finished files + searchable SQLite history    │
 │ Failed      │ reason for every stop, one-click retry        │
 │ Settings    │ 30+ real options, all applied to the engine   │
 └─────────────┴───────────────────────────────────────────────┘
```

## What it actually does

**Transfers**

* HTTP/HTTPS downloads with certificate verification always on.
* Real pause / resume / cancel: the partial file, its byte offsets and its
  integrity markers survive restarts, crashes and network outages.
* Segmented downloading **when the server supports it** — the capability is
  proven with a `Range: bytes=0-0` probe and, when a server advertises ranges but
  ignores them, confirmed with a second request before segmentation is trusted.
  Servers without range support are downloaded in a single stream, automatically.
* Adaptive connection control: connections are added (by splitting the largest
  segment) or removed (by ending a segment early) based on measured throughput,
  failure rate and per-connection speed, within the maximum you configure.
* Queue with a configurable concurrency limit (1–16), move up/down and drag &
  drop reordering, start all / pause all, remove finished.
* Automatic retries with exponential backoff (1s, 2s, 4s, 8s … capped) that
  respect `Retry-After`; invalid URLs, 401/403 and 404 are never retried.
* Bandwidth limiting that genuinely shapes the stream: Unlimited, 100 KB/s,
  500 KB/s, 1 MB/s, 5 MB/s, 10 MB/s or a custom value — globally or per download.

**Integrity & safety**

* Size verification, full segment coverage check, safe finalisation
  (`sync_all` → atomic rename → re-check) and an optional SHA-256.
* `.part` + `.swlmeta` sidecars: per-segment tail digests are re-validated on
  resume, and an unverified tail is discarded instead of trusted.
* An existing file is never overwritten silently: Replace / Keep both / Cancel.
* Path sanitising (reserved names, illegal characters, length limits) and
  containment checks so a download can only ever write inside its target folder.

**Interface**

* Dashboard, Downloads, Completed, Failed and a full Settings screen; dark and
  light theme plus a follow-Windows mode; compact layout.
* Download cards with progress, downloaded/total, current speed, average speed,
  ETA, live connection pills and per-segment byte ranges.
* Context menu (⋮ or right-click): pause, resume, cancel, retry, open file, open
  folder, copy URL, speed limit, details, remove, delete file.
* Clipboard link detection on focus (no timers), `swiftload:` link handling that
  you can switch on or off, and a local log with an “open log folder” action.

**Honest numbers only.** Speed, progress, ETA and connection counts come from
bytes that reached the filesystem. If a server sends no `Content-Length`, the
interface says the size is unknown instead of inventing a percentage, and
segmentation is never advertised as a guaranteed speed-up — it is used when the
server supports it and the measurements say it helps.

## Download & install

Grab `SwiftLoad-Setup.exe` and run it. It installs for the current user only (no
administrator prompt), creates a Start Menu entry, offers an optional desktop
shortcut and registers a standard uninstaller. Windows 10/11 with WebView2
(pre-installed on current systems; the installer bootstraps it otherwise).

## Build from source

```powershell
npm install
npm run tauri dev          # development
.\tools\build-installer.ps1  # tests + release build + SwiftLoad-Setup.exe
```

See [docs/BUILD.md](docs/BUILD.md) for requirements, signing and troubleshooting.

## Where things go

| What | Where |
|------|-------|
| Program | `%LOCALAPPDATA%\Programs\SwiftLoad` (per-user install) |
| Database, settings, logs | `%LOCALAPPDATA%\SwiftLoad` (`swiftload.db`, `logs\`) |
| Partial download | `<target folder>\.swiftload\<name>.part` + `.swlmeta`, or the temporary folder you configure |
| Your files | exactly where you told it to save them |

Removing a download deletes its partial data; deleting a finished file always
asks first and never touches anything except that file.

## Privacy

SwiftLoad contacts only the addresses you download. There is no update check, no
telemetry, no account and no cloud storage. The archive protocol for
`swiftload:` links is written to `HKCU\Software\Classes\swiftload` in your own
user hive and removed by the uninstaller or by the About tab.

## Project layout

```
swiftload/
├── src/                 TypeScript interface (no framework, ~77 KB gzipped bundle)
│   ├── views/           dashboard · downloads · completed · failed · settings
│   ├── components/      cards, dialogs, context menu, toasts
│   └── lib/             api · store · events · format · dom · errors · actions
├── src-tauri/           Rust backend (Tauri 2)
│   ├── src/engine/      queue, workers, resume, retry, adaptive, limiter, files
│   ├── src/db/          SQLite: downloads · history · settings
│   ├── src/net.rs       HTTP client (reqwest + rustls, native roots)
│   ├── src/commands/    the IPC surface the UI is allowed to use
│   ├── tests/engine.rs  end-to-end tests against a local HTTP server
│   └── installer/       NSIS hooks (desktop shortcut prompt)
├── docs/                ARCHITECTURE.md · TESTING.md · BUILD.md
└── tools/               build-installer.ps1 · dev preview server
```

## Tests

```powershell
cd src-tauri
cargo test                 # unit tests + engine integration suite
cargo test --test engine   # only the end-to-end scenarios
```

In an environment without a Rust toolchain, `bash scripts/check_all.sh` runs the
type-check, the frontend build, a tree-sitter parse of every Rust file, the
crate-path/associated-item resolver and a cross-language contract check
(commands registered, API calls resolvable, event names identical on both sides).

The integration suite starts its own HTTP server on loopback and covers
segmented reconstruction (byte-for-byte SHA-256), the no-range fallback, pause
and resume across an engine restart, interruption and retry, permanent 404/401
handling, existing-file conflicts, the bandwidth limiter (timed) and cancelling.
The manual acceptance checklist lives in [docs/TESTING.md](docs/TESTING.md).

## Known limits

* Windows only (the UI and installer target Windows; the engine itself is
  portable and compiles elsewhere).
* A server that reports ranges but serves wrong byte offsets cannot be segmented;
  SwiftLoad detects the mismatch and fails the download with a size/coverage
  error instead of delivering a corrupt file.
* Fewer connections than requested are used when the file is small
  (`min_segment_bytes`) or the server cannot be fragmented — that is intentional,
  never a hidden failure.
* The preview server (`dev/preview-server.mjs`) shows the interface without an
  engine; it is a layout tool, not a simulator.
