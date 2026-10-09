# TurboLoad Pro

TurboLoad Pro is a native Windows x64 direct-download manager. The source project is organized into a WPF desktop client, a reusable .NET transfer core, SQLite persistence, and local-network integration tests. It accepts **direct HTTP/HTTPS file URLs**; it does not scrape sites, bypass authentication or paywalls, handle DRM, or download from streaming platforms.

## Architecture

```text
WPF UI (MVVM-style observable rows)
  ├─ URL entry, explicit clipboard prompt, .url/text drag-and-drop, filters and settings
  ├─ per-download pause/resume/retry/restart/cancel/open controls and priorities
  └─ opt-in Windows notifications and startup behavior
          │
          ▼
DownloadManager (queue, max simultaneous downloads, state machine)
  ├─ SQLite history/recovery checkpoints
  ├─ global bandwidth limiter and structured/redacted diagnostic logger
  └─ DownloadEngine
       ├─ SafeHttpClient (HTTP(S)-only, no cookies/credentials, bounded safe redirects)
       ├─ capability probe with Range: bytes=0-0
       ├─ disjoint ranged workers → RandomAccess writes into one .turbopart file
       ├─ adaptive connection gate, transient retries, Retry-After, SHA-256 and size checks
       └─ ordinary streaming fallback when ranges are unavailable or not safe to combine
```

Range workers never share byte offsets: a planner creates inclusive non-overlapping intervals, each interval has one worker, and retries continue at that interval's committed offset. Segmented transfer is used only when the response has a known size and a stable validator (strong ETag or Last-Modified); without one, the engine prefers a single stream to avoid assembling bytes from changing representations. A changed/missing validator on restart discards stale range state and starts safely again. The temporary file is flushed at checkpoints, size/range totals are checked, and the final file is moved without overwriting an existing file. Files are never launched automatically.

Automatic connection choice is conservative: very small/unknown files use one connection; larger range-capable files use 8, 16, or 32 based on size and probe latency. Explicit settings support 1, 8, 16, or 32. The per-file gate ramps up on successful range responses and backs off on HTTP 429/503. `Retry-After` is honored, and TLS certificate validation remains at the platform default.

## What is implemented

- **Transfer engine:** streaming asynchronous HTTP/HTTPS; manual redirect validation (maximum five, no HTTPS-to-HTTP downgrade); range capability detection; 8/16/32 planning; adaptive concurrency; disjoint asynchronous random-access disk writes; safe single-stream fallback.
- **Reliability:** bounded exponential retries with jitter for recoverable errors; `Retry-After`; pausing, resumable range state, cancellation, retry and restart; ETag/Last-Modified checks; Content-Range validation; announced/actual file-size validation; optional streamed SHA-256; atomic same-folder temporary output; no overwrite of an existing destination.
- **Scheduling:** priority queue (Low/Normal/High), adjustable simultaneous download count and global byte-rate cap.
- **State/recovery:** SQLite download history plus segment offsets; in-progress rows recover as queued or paused according to the setting. Explicitly paused downloads stay paused after restart.
- **UI:** dark/light theme; dashboard totals and actual aggregate throughput; active/queued/completed/failed views; per-file progress and segment bars, speed, size, ETA and controls; search and sort; configurable directory, connection count and buffers.
- **Integration:** clipboard monitoring is off by default and only offers a validated direct URL for the user to confirm; drag-and-drop accepts URL text or `.url` shortcuts. The optional Chromium extension asks only for `contextMenus`, acts only after a right-click selection, and stores nothing.
- **Security:** rejects non-HTTP(S) URLs and embedded URL credentials; validates every redirect; does not send cookies or credentials; sanitizes filenames; keeps raw URLs out of logs; does not auto-run downloaded files.

Signed query strings may be stored in the local SQLite database because they can be required to resume a direct link. They are not written to logs or shown in the list. Keep the Windows account and its app-data directory protected accordingly.

## Build a standalone `.exe` (Windows)

Requirements:

- Windows 10/11 x64
- .NET 10 SDK
- Optional: Inno Setup 6 for the installer

From PowerShell at the repository root:

```powershell
.\TurboLoadPro\build.ps1
```

The script restores packages, runs the tests, and publishes a self-contained single-file x64 app to:

```text
TurboLoadPro\artifacts\publish\win-x64\TurboLoadPro.exe
```

The publish includes the .NET runtime and SQLite native library (self-extracting at runtime); the target PC does not need .NET installed. No trimming is enabled. If Inno Setup's `ISCC.exe` is on `PATH`, the same script also builds `TurboLoadPro-Setup-x64.exe` using [`installer/TurboLoadPro.iss`](installer/TurboLoadPro.iss). The per-user installer registers the `turbload:` URL protocol and does not require administrator rights.

A GitHub Actions workflow at `.github/workflows/turboloadpro-windows.yml` runs the tests on Windows and publishes the standalone executable as a workflow artifact. CI can be started manually from **Actions → TurboLoad Pro — Windows x64 → Run workflow**.

## Automated tests

`tests/TurboLoadPro.Core.Tests` uses an in-process loopback TCP HTTP server (no public download URLs). It covers:

- range planning and segmented byte-for-byte output (including SHA-256)
- a server that ignores Range and the single-stream fallback
- a mid-response connection interruption and safe retry from the committed offset
- pause/resume from persisted segment offsets
- incorrect Content-Range rejection, and expired/forbidden links
- disk path/write failure behavior
- a 48 MiB streaming/hash case
- SQLite restart recovery of a partially downloaded segmented file

Run manually on Windows:

```powershell
cd TurboLoadPro
dotnet test .\TurboLoadPro.sln -c Release
```

## Browser / clipboard integration

See [`integration/README.md`](integration/README.md). The app can be launched by a helper with `TurboLoadPro.exe --url "https://host/file.zip"`, or by the installed `turbload://add?url=<percent-encoded-direct-url>` protocol. The sample extension has no history, cookies, password, host or content-script permissions. It forwards only the link the user explicitly selects.

Clipboard monitoring can be enabled in Settings. When enabled, the app checks for an HTTP(S) URL and displays an **Import link** prompt; it does not silently add the download. It never scans clipboard contents for credentials or collects clipboard history.

## Data, logs and troubleshooting

App settings, SQLite state and redacted diagnostics are stored under:

```text
%LOCALAPPDATA%\TurboLoadPro\
```

- `settings.json` — user-selected settings
- `history.sqlite3` — queue, history, direct URLs and recovery offsets
- `logs\turboload.log` — timestamps, event names, item IDs, exception type and HTTP status only; no URL/query, response body or credentials

Common cases:

- **The server says 401/403/404/410:** verify the direct link is still valid. TurboLoad Pro does not sign in or bypass access restrictions.
- **No speed improvement with more connections:** the server may not support byte ranges or may cap throughput; the app falls back/backs off rather than claiming extra speed.
- **Resume restarts from zero:** safe behavior when ranges are unsupported, the validator changed, or a stable file validator was unavailable.
- **Disk-full/permission errors:** select a writable destination with enough free space. The `.turbopart` file is not published as a completed file.
- **SQLite startup error:** back up `%LOCALAPPDATA%\TurboLoadPro\history.sqlite3` before repair. Do not remove the app data folder if you want recovery/history.

## Source layout

```text
TurboLoadPro/
├── TurboLoadPro.sln
├── build.ps1
├── src/
│   ├── TurboLoadPro.Core/      # engine, safe HTTP, scheduler, SQLite and models
│   └── TurboLoadPro.App/       # native WPF UI, settings, startup and notifications
├── tests/TurboLoadPro.Core.Tests/
├── integration/                # explicit link handoff + minimal Chromium helper
└── installer/TurboLoadPro.iss
```
