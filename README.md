# AI Download Manager Pro

**Use Your Available Internet Speed More Efficiently.**

AI Download Manager Pro is a real desktop download manager built around a separate Node.js download engine and a secure Electron UI. It confirms byte-range support with an actual `GET Range` request, downloads verified segments concurrently when the server supplies a stable validator, writes directly to disk, retries from the last saved byte, and verifies the final size before atomically renaming `.part` to the requested filename.

> Download speed depends on your internet connection, server bandwidth, network conditions, and whether the server supports parallel connections. This application cannot increase your ISP plan, exceed a server's limits, or bypass authentication, access controls, DRM, paywalls, or rate limits.

## What is implemented

- HTTP/HTTPS metadata inspection: `HEAD` when useful, `Content-Length`, `Accept-Ranges`, `Content-Type`, `ETag`, `Last-Modified`, disposition filename, and optional source digests.
- Real byte-range confirmation and configurable **1 / 2 / 4 / 8 / 16** parallel connections (default **8**). If ranges are unavailable, the engine uses one connection from the start; if a server stops honoring ranges mid-transfer, it discards the segmented partial data and safely restarts as a single full request.
- Stable-validator checks (`ETag` or `Last-Modified`) to prevent combining bytes from different versions. If a host offers ranges without a stable validator, parallel mode is deliberately disabled.
- Disk-backed random-access segment writing; no whole-file buffering. Partial progress and segment offsets are stored in `filename.part` plus `filename.part.json`.
- Resume after pause, network interruption, or application restart where byte ranges and validators permit it. Unsafe resumes restart from zero rather than risking a corrupt output.
- Exponential retry and `Retry-After` handling, slow/error adaptation, shared aggregate bandwidth limiting, keep-alive HTTP agents, and a configurable concurrent queue.
- Final size verification and validation of `Digest` / `Content-MD5` values when the source provides them. Only verified files are marked complete and renamed.
- Priority, queue reorder, pause/resume/cancel all, scheduler, optional file organization, duplicate handling, diagnostics, and a local-only Native Messaging browser integration.
- Windows installer configuration that bundles Electron/Chromium and the Node runtime; the user does not need to install Python, Node.js, or FFmpeg.

## Run the real engine and UI in development

Requires Node.js 22 or newer for development/testing. Runtime downloads themselves use only Node built-ins.

```bash
npm install
npm run dev
```

Open the URL printed by the server (normally `http://localhost:4173/`). This development server runs the **same DownloadManager engine** through a local API; it is not a simulated download preview. Its test downloads and state are stored under the operating system's temporary directory (`ai-download-manager-pro-preview`). Set `AIDMP_DOWNLOAD_DIR` to choose another destination.

To run the native desktop shell locally:

```bash
npm start
```

## Build the Windows EXE and installer

Build on a Windows 10/11 x64 machine (or a configured Windows build runner):

```powershell
npm install
npm run dist:win
```

The packaged outputs are written to `release/`:

- `AI-Download-Manager-Pro.exe` (the installed application executable)
- `AI-Download-Manager-Pro-Setup-1.0.0.exe` (the NSIS installer)

Electron includes Chromium and its Node runtime in the application/installer. The configured installer is per-user (`asInvoker`), has no mandatory runtime prerequisites, and does not require administrator rights.

**This checkout does not contain a prebuilt Windows installer.** Run `npm run dist:win` from a Windows 10/11 x64 machine or a configured compatible build runner to generate the installer. A source checkout or web preview is not a generated Windows EXE.

## Tests

```bash
npm test
npm run check
```

The tests use local HTTP fixtures (no third-party download host) to verify byte correctness for real range and non-range servers, clean fallback, retries, pause/resume and restart recovery, checksum failure, truncated partial-file safety, duplicate choices, deferred queue behavior, and scheduler rules.

## Browser integration (optional)

The extension uses the browser's **Native Messaging** protocol, not an unauthenticated localhost service. It transmits only a link the user explicitly selects from the context menu or types into the extension popup; it does not request or store browsing history. See [`browser-extension/README.md`](browser-extension/README.md). The packaged app includes the extension source and `scripts/register-native-host.ps1` as extra resources.

## Architecture

```text
electron/                  Desktop window, safe IPC preload, Native Messaging host
engine/                    UI-independent Node download engine
  download-manager.mjs     State machine, events, persistence, queue, scheduler
  http-client.mjs          Redirect-safe HTTP(S), metadata probe, range checks
  segment-manager.mjs      Byte-range partitioning and coverage checks
  connection-manager.mjs   Adaptive connection limits
  retry-manager.mjs        Backoff, Retry-After, abortable waits
  resume-manager.mjs       Atomic .part.json metadata
  file-writer.mjs          Streaming positional disk writes
  integrity-checker.mjs    Final size and optional source-digest validation
  bandwidth-limiter.mjs    Shared, enforced aggregate rate cap
desktop/                   Dark Windows-style renderer UI
browser-extension/         Chrome/Edge/Firefox Native Messaging extension
tools/dev-server.mjs       Local API harness using the production engine
test/                      Local deterministic HTTP integration tests
```

## Safety notes

- No speed or progress values are fabricated. The UI displays bytes written by the engine.
- Range support is verified at runtime; an `Accept-Ranges` header alone is not enough.
- A server returning `200 OK` to a segmented request triggers a clean single-connection restart, never a blind merge.
- 403/429 responses are not bypassed. The engine reduces connection use and reports the server response; `429` honors `Retry-After`.
- Existing files are never silently overwritten. Replace, rename, skip, or resume are explicit choices.
- Automatic category folders are off by default.
- Logs omit URL query strings to avoid writing signed download tokens to the diagnostic log.
