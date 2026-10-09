# ADZAK DOWNLOAD PRO

A real, functional **Windows download manager** (C# / .NET 8 / WPF) with three download
modes, segmented downloading, resume, checksum verification and **honest, measured**
performance reporting. This is not a visual mockup: every number shown comes from bytes
that actually moved over the network, and a file is only ever reported as *Completed*
after its size and (when available) its SHA-256 checksum have been verified.

```
ADZAK-DOWNLOAD-PRO.exe        ← self-contained Windows x64 single-file executable
```

---

## Features

### Download modes

| Mode | Connections | Behaviour |
|------|-------------|-----------|
| **LOW** | 1 | One connection, lowest CPU/memory. For weak PCs and unstable lines. |
| **MEDIUM** | configurable (default 4) | Uses multiple connections **only when the server supports HTTP ranges**; automatic retries for temporary failures; resumes when supported. |
| **PRO** | configurable (default 8, hard max 16) | Detects range support, splits compatible files into byte ranges, downloads them concurrently and merges them correctly; **dynamically adjusts concurrency** by splitting stalled segments based on real measured throughput; resumes partial downloads **across application restarts**; verifies final file size and SHA-256 checksum when advertised; never downloads the same byte range twice. |

### Honest speed measurement

* Real bytes/second, displayed as KB/s and MB/s.
* **Current** speed (sliding 1-second window over bytes actually received) and
  **average** speed (total bytes ÷ time actually transferring — paused time excluded).
* Downloaded/total size and an **ETA computed from real transferred bytes over elapsed
  time**. No invented maximums, no simulated speeds, no smoothing tricks.

### Download integrity

* HTTP responses are **validated before any data is used**: a `206` must carry a
  `Content-Range` whose start matches the requested offset and whose total matches the
  probed size — otherwise the segment is rejected and retried.
* Segments are downloaded to **temporary part files** and only merged after every part's
  length has been checked.
* The final file's **size is verified** against the server-declared size, and its
  **SHA-256 is verified** when the server advertises one (`Digest: sha-256=…` RFC 9530,
  `X-Checksum-Sha256`, …) or when you supply one.
* A **mismatching or incomplete file is deleted and the download is marked Failed** —
  a corrupted or incomplete file is never reported as successful.
* Resume never re-downloads bytes that are already on disk (each segment continues from
  its recorded offset; a server that stops honouring ranges mid-download is detected).

### Reliability

* Redirects (up to 10), timeouts, cancellation, disk errors and network interruptions
  are handled. Per-request **response timeout** and per-transfer **idle timeout** (a
  stalled connection cannot hang a download).
* **Automatic retries with exponential backoff + jitter** for transient failures
  (5xx, 429, network resets, mid-body disconnects). `429 Too Many Requests` honours the
  server's `Retry-After` header. `416 Range Not Satisfiable` restarts the segment.
* **Resume after restart**: progress metadata (`.adzakmeta`) and part files are written
  continuously; a new session resumes exactly where the previous one stopped. If the
  file changed on the server (different size/ETag), the download restarts cleanly.
* **Respects server limits**: bounded per-server connection count (also enforced by the
  HTTP handler), no auth/paywall/rate-limit bypass of any kind, no Windows network
  tweaks.

### UI (Windows 11 style)

* **Dark and light themes** (instant switch).
* LOW / MEDIUM / PRO selector, URL input + Download button.
* Per-download: progress bar, percentage, size, live speed, ETA, active connection
  count, status badge, Pause / Resume / Cancel / Retry / Open folder.
* **Live total-throughput graph** (measured bytes/second, 2-minute window).
* **Download history** (persisted, newest first, capped at 500 entries).
* Destination folder selection, **settings** for connection limits (per mode + hard
  maximum), simultaneous downloads, retries, timeouts, disk buffer size, minimum
  segment size and checksum verification.

### Performance & resource use

* Fully **asynchronous I/O**; files are never loaded into memory (streamed in
  configurable buffers, default 64 KB).
* Large-file support (64-bit offsets throughout).
* One shared `HttpClient` with pooled connections and a bounded per-server connection
  count; LOW mode uses a single connection.

### Real-world limits (honest expectations)

Your download speed is bounded by the **slowest link in the chain**: your ISP plan, your
Wi-Fi, the server's load and bandwidth, and any per-connection throttling the server
applies. Splitting a file into more connections helps when the server limits each
connection but not the total; it cannot exceed your line speed, and some servers
penalise many parallel connections. ADZAK DOWNLOAD PRO measures and reports what
actually happens — it does not pretend otherwise.

---

## Project structure

```
AdzakDownloadPro/
├── AdzakDownloadPro.sln
├── README.md
├── build/
│   ├── build.ps1                 # Windows: restore + test + publish (produces the .exe)
│   ├── build.sh                  # Linux/macOS: restore + test
│   ├── verify-sandbox.sh         # No-SDK verification (see "Verification without the SDK")
│   └── sandbox/
│       └── compile_and_test.py   # Roslyn-in-process compile + test runner harness
├── src/
│   ├── AdzakDownloadPro.Core/    # The download engine (net8.0, no UI dependencies)
│   │   ├── DownloadEngine.cs         # orchestration: probe → plan → segments → merge → verify
│   │   ├── SegmentDownloader.cs      # per-range worker: validation, retries, resume, idle timeout
│   │   ├── SegmentPlanner.cs         # pure range-splitting logic
│   │   ├── SpeedMeter.cs             # honest current/average speed measurement
│   │   ├── Checksum.cs               # SHA-256 + Digest/X-Checksum header parsing
│   │   ├── DownloadItem.cs           # one download: state, segments, events
│   │   ├── DownloadMetaStore.cs      # .adzakmeta resume metadata (survives restarts)
│   │   ├── DownloadHistory.cs        # persisted history
│   │   ├── AppSettings.cs            # persisted settings
│   │   └── …                         # ByteFormatter, HttpUtils, DownloadException, …
│   └── AdzakDownloadPro/         # The WPF application (net8.0-windows)
│       ├── App.xaml / MainWindow.xaml / SettingsWindow.xaml
│       ├── ViewModels/               # MainViewModel, DownloadItemViewModel, commands
│       ├── Controls/SpeedGraphControl.xaml(.cs)
│       ├── Converters/  Themes/  Services/
│       └── app.manifest              # per-monitor DPI awareness, runs asInvoker
└── tests/
    └── AdzakDownloadPro.Tests/   # net8.0 console test suite (no external packages)
        ├── TestFramework/            # tiny [Fact]/Assert/runner (no xunit needed)
        ├── TestServer/               # scriptable raw-TcpListener HTTP server
        └── *.cs                      # 88 tests (unit + end-to-end engine tests)
```

## Build, test, run

### Windows (produces the executable)

Requirements: Windows 10/11 x64, [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0),
internet access for the first NuGet restore.

```powershell
# Restore, run the full test suite, then publish a self-contained single-file exe:
.\build\build.ps1

# Publish only (skip tests):
.\build\build.ps1 -SkipTests
```

The publish step runs:

```
dotnet publish src/AdzakDownloadPro/AdzakDownloadPro.csproj -c Release -r win-x64 `
    --self-contained true -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true -o publish
```

Result: **`publish\ADZAK-DOWNLOAD-PRO.exe`** — double-click to run. No installation, no
admin rights, no runtime prerequisites (self-contained).

### Linux / macOS (build + test the engine)

```bash
./build/build.sh
```

This restores, runs the test suite and builds. Cross-publishing the Windows executable
from Linux is possible with `-p:EnableWindowsTargeting=true` (needs NuGet access for the
Windows Desktop reference/runtime packs); the recommended path is `build.ps1` on Windows.

### Run from source (any OS with the .NET 8 SDK)

```bash
dotnet run --project src/AdzakDownloadPro/AdzakDownloadPro.csproj     # Windows only (WPF)
dotnet run --project tests/AdzakDownloadPro.Tests/AdzakDownloadPro.Tests.csproj   # tests
```

---

## Tests

`tests/AdzakDownloadPro.Tests` is a **dependency-free** console test suite (a tiny built-in
`[Fact]`/`Assert`/runner — no xunit/NUnit, so it restores without extra packages). It runs
**88 tests**, including end-to-end engine tests against a scriptable raw-`TcpListener`
HTTP server that can honour or ignore `Range`, throttle, drop connections mid-body,
return 404/416/429/500, redirect, advertise checksums, and change ETags.

Coverage includes:

* **Segment planning** — exact tiling (no gaps, no overlaps), connection-count clamping,
  split-offset math.
* **Speed measurement** — current (sliding window) and average (active time only) math.
* **Checksums** — SHA-256 known vectors, `Digest` (RFC 9530 base64/hex) and
  `X-Checksum-Sha256` parsing, case-insensitive comparison.
* **Single-connection downloads** — byte-identical results, redirects, 404 with a clear
  error and no leftover file, Content-Disposition file names, truncated bodies fail
  (never reported as success), extra bytes beyond Content-Length are ignored, empty
  files, unknown sizes, pause/resume, cancel cleanup, simultaneous-download limit,
  honest speed reporting.
* **Segmented downloads** — 8-way split + byte-identical merge, **every byte range
  requested exactly once**, MEDIUM/LOW connection counts, checksum pass/fail (a failing
  checksum deletes the file and marks the download Failed), **resume after a simulated
  restart continues from the recorded offsets without re-downloading**, changed ETag
  restarts from scratch, **adaptive concurrency splits a stalled segment** (bounded by
  the configured maximum), monotonic progress with real speeds and ETAs.
* **Retries** — 5xx retried until success, permanent 5xx fails after `MaxRetries` with a
  clear error, 429 + `Retry-After` retried, **mid-body connection drops resume from the
  offset where they stopped**, retry-after-failure resumes partial progress.

Run them with:

```bash
dotnet run --project tests/AdzakDownloadPro.Tests/AdzakDownloadPro.Tests.csproj -c Release
```

## Verification without the .NET SDK (sandbox)

This repository was developed in an environment **without** the .NET SDK and **without**
NuGet access. `build/verify-sandbox.sh` still verifies the deliverable end-to-end using
only reachable sources (pypi + GitHub):

1. Downloads a real **.NET Core 3.1 runtime** (pypi wheel `dotnetcore2`).
2. Downloads the **Roslyn 4.8 (C# 12)** compiler DLLs (committed in a public GitHub repo).
3. Hosts the runtime in-process with **pythonnet**, loads Roslyn in a custom
   `AssemblyLoadContext`, and compiles **the same `.cs` sources that ship in the repo**
   against the .NET Core 3.1 runtime assemblies. (The Core engine deliberately uses an
   API surface that exists in both .NET Core 3.1 and .NET 8, so what is verified here is
   what ships; the csproj files target `net8.0`.)
4. Runs the **full test suite** on the real runtime.
5. **Syntax-checks** the WPF application sources with Roslyn (a full WPF compile needs
   the Windows Desktop reference pack from NuGet, which is unreachable in the sandbox)
   and validates that all XAML files are well-formed.

```bash
./build/verify-sandbox.sh
```

Expected output: `Passed: 88 / 88` and `SANDBOX VERIFICATION: ALL TESTS PASSED`.

---

## How it works (engine pipeline)

1. **Probe** — one ranged `GET` (`Range: bytes=0-0`, headers only) reveals range support,
   total size, final URL after redirects, ETag, suggested file name and checksum headers.
2. **Plan** — LOW → 1 segment; MEDIUM/PRO → N segments (contiguous, non-overlapping byte
   ranges) when the server supports ranges and the file is big enough; otherwise a single
   plain download (servers that ignore `Range` are handled gracefully).
3. **Transfer** — each segment downloads to its own part file with response validation,
   resume-from-offset, retries with backoff, and an idle-timeout watchdog. In PRO mode an
   adaptive controller watches real per-segment throughput and splits stalled segments
   (never beyond the configured maximum, at most twice per segment).
4. **Merge** — parts are merged in order, each part's length is validated first.
5. **Verify** — final size, then SHA-256 when advertised or supplied. Only then is the
   download marked **Completed**.

Partial progress is persisted as `.adzakmeta` + `.adzakpart<N>` files inside a
`.adzak-tmp` folder next to the destination file, so restarts resume automatically.

## Privacy & ethics

The application only downloads URLs you explicitly provide. It does not bypass
authentication, paywalls or rate limits, does not modify system network settings, and
does not fabricate performance numbers.

## License

MIT.
