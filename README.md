# AI Download Manager Pro

**Use Your Available Internet Speed More Efficiently.**

AI Download Manager Pro is a Windows desktop download manager backed by a real streaming HTTP/HTTPS engine. When a source server permits byte-range requests, it divides a file into bounded segments and downloads them concurrently. It verifies the assembled staging file before publishing the final filename. A source that ignores ranges is downloaded through one normal connection instead.

> **Honest speed claim:** This application cannot increase your internet bandwidth or bypass ISP, server, network, authentication, paywall, DRM, CAPTCHA or rate limits. Download speed depends on your internet connection, the source server's bandwidth, network conditions, and whether that server supports parallel connections.

## Run the real engine preview

The browser preview uses the **same real Node download engine** as the Windows app; progress and speed are not simulated. Node.js 22 or newer is needed only to run this developer preview/build, not by end users of the packaged Windows application.

```sh
npm install
npm run dev
# Open http://localhost:4173
```

Add a direct HTTP/HTTPS URL to start a real transfer. The preview process binds to `0.0.0.0` for the Arena live preview. Downloads default to `~/Downloads/AI Download Manager Pro`; the directory can be changed in Settings. To select a different port or data folder:

```sh
PORT=4174 AIDMP_PREVIEW_DATA=/path/to/local/app-data npm run dev
```

The preview API is local to this process and is not part of the packaged desktop app. Do not expose a development preview server to an untrusted network.

## Windows desktop app

The production UI runs in Electron with `contextIsolation`, `nodeIntegration: false`, and a narrow preload API. The renderer does not get direct filesystem or Node access. The download engine lives in `engine/` and has no third-party runtime dependency.

```sh
npm install
npm start                  # desktop app on the current platform
npm test                   # real local HTTP-server integration tests
npm run build:win          # Windows x64 installer + portable executable
```

The Windows build scripts package Electron and its Chromium/Node runtime, compile the small native-messaging host as a self-contained Windows executable, and create:

- `release/AI-Download-Manager-Pro.exe` — portable executable copy
- `release/AI-Download-Manager-Pro-Setup-<version>-x64.exe` — NSIS installer

Windows cross-building is supported from a configured build environment; final installer verification, code-signing and SmartScreen reputation still need to be done by the publisher on Windows. Unsigned builds can show a Windows security warning. The installed app does not require end users to install Python, Node.js or FFmpeg. The browser native-messaging host is bundled with the installer.

## Download-engine behavior

1. **Inspect:** Send `HEAD`, then a one-byte `GET Range: bytes=0-0` probe. `Accept-Ranges` alone is not treated as proof; a correctly formed `206 Content-Range` is required.
2. **Choose a mode:** If a known-size response supports ranges and supplies a strong ETag or `Last-Modified` validator, use the selected limit (1, 2, 4, 8 or 16) with adaptive, disk-backed segments. Segment sizes are bounded; very small files do not open unnecessary connections. If ranges are unavailable—or the source provides no stable validator—the engine uses one normal `GET` to avoid combining bytes from different file versions.
3. **Write safely:** Ranged workers stream into disjoint positions in a pre-sized `filename.ext.part` staging file. They never load the entire file into memory or write to the final path. Checkpointed metadata lives in `filename.ext.part.json` and includes the URL, size, validators, ranges/segment positions and creation time.
4. **Recover:** Failed segments retry with exponential backoff from their saved byte offset. `Retry-After` is honored. A resumed partial is reused only when its file size and server validator can be checked; otherwise it is discarded and downloaded again safely. Servers without range support restart from byte zero.
5. **Adapt:** The connection count can step down after repeated network errors, a sustained speed drop, `429` or `403`. A `403` is terminal; it is never retried as an access-control workaround. A `429` retry waits as directed by the server.
6. **Throttle and schedule:** The bandwidth limiter is shared across active downloads and throttles bytes before disk writes. Queue concurrency and schedule windows are enforced by the engine.
7. **Verify and publish:** Confirm expected size and any source-provided SHA-256, SHA-1 or MD5 checksum. Only then rename the staging file to its final name. Optional organization runs after completion and is off by default.

HTTP agents use keep-alive. Requests do not include saved cookies, credentials, proxies or browser state. Only HTTP and HTTPS URLs without embedded credentials are accepted.

## Main sections

- **Dashboard / Downloads:** real-time byte counts, current and average speed, peak speed, ETA, active connections, progress, retry/error state, pause/resume/cancel.
- **Queue:** up to 100 links per import batch, per-file priority, drag ordering, pause/resume/cancel all, and a configurable active-file limit.
- **Completed:** only verified, finalized files; open or reveal them in Explorer.
- **Scheduler:** local-time daily window, scheduled active-file limit and scheduled bandwidth rate. The PC and app must be awake.
- **Settings:** download folder, connection count, maximum active files, actual aggregate bandwidth limit, optional file organization, browser bridge and local diagnostics logs.

Duplicate policies are **Replace** (the existing completed file remains until the replacement verifies), **Rename**, **Skip**, and **Resume matching partial**.

## Browser integration

`browser-bridge/extension/` contains the Chrome/Edge/Firefox WebExtension source. The extension asks only for context-menu, native-messaging and active-tab permissions. It sends a URL only after an explicit link context-menu or popup action; it does not collect browsing history.

In the installed Windows app, open **Settings → Browser integration → Enable browser bridge**, then load the extension folder in Chrome/Edge's developer extension page. Firefox supports the same Native Messaging host and WebExtension API; a permanently distributed Firefox release must be signed through Mozilla AMO. The native host accepts only HTTP/HTTPS links and launches the installed desktop application with the user-selected link.

## Architecture

```text
electron/
  main.js                 Electron lifecycle and IPC boundary
  preload.cjs             Explicit, context-isolated renderer API
  browser-bridge.js       Per-user Chrome / Edge / Firefox registration
  native-host-cli.cjs     Standalone, self-contained Windows native host
engine/
  download-manager.js     Transfer lifecycle and public engine API
  http-client.js          HTTP(S), redirects, HEAD/range probing, keep-alive
  connection-manager.js   Bounded adaptive parallelism
  segment-manager.js      Byte range planning and recovery validation
  retry-manager.js        Exponential retry and cancellation
  resume-manager.js       Atomic sidecar metadata
  file-writer.js          Streaming positional writes to .part
  integrity-checker.js    Size and optional checksum verification
  queue-manager.js        Priority, ordering and bulk operations
  scheduler.js            Local-time schedule enforcement
  settings-manager.js     Validated persistent configuration
  bandwidth-limiter.js    Shared aggregate token-bucket limiter
  logger.js               Local diagnostics with URL query redaction
desktop/renderer/          Dark desktop UI
browser-bridge/extension/ Explicit user-triggered browser extension
tests/                     Integration tests using local HTTP servers
```

## Verification

```sh
npm test
```

The suite has 23 tests across real local range and non-range HTTP servers, byte-for-byte output checks, large concurrent transfers, safe single-connection fallback when validators are missing, changed-source resume protection, pause/resume, restart recovery, segment retry, `429 Retry-After`, terminal `403`, active-queue limits, actual bandwidth throttling, duplicate policies, source checksums and native-host input validation. No test feeds fake transfer progress into the UI.

## Current boundaries

- The app supports direct HTTP/HTTPS file URLs. It is not a torrent client, streaming media downloader or browser history collector.
- Server-provided credentials, account sign-in flows and protected content are not circumvented.
- No connection count can guarantee a speed increase. Parallel ranges may help use capacity already available when the source allows them; otherwise one connection is used.
- Do not use this manager to violate a source's terms, access controls or rate limits.
