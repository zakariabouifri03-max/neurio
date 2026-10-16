# ADZAK Lite Browser — Windows (C#/.NET 8 + WebView2)

A complete, lightweight desktop web browser for Windows 10/11 x64, tuned for PCs
with **8 GB RAM**. Chromium engine via **Microsoft Edge WebView2** with GPU
hardware acceleration enabled by default.

> **Honest by design:** ADZAK Lite cannot boost your Wi-Fi signal, cannot exceed
> your ISP speed, and does not add RAM. It makes browsing lighter the real way:
> one shared engine process, suspended inactive tabs, a capped cache, and a
> Data Saver that simply refuses to download ads/trackers (and optionally images).

## Download / files

- `ADZAKLiteBrowser.exe` — single-file, self-contained Windows x64 Release build
  (includes the .NET runtime; rename it freely, e.g. `ADZAK Lite Browser.exe`).
- `ADZAK-Lite-Browser-win-x64-folder.zip` — the same build as a classic folder
  (EXE + DLLs), if you prefer that layout.
- Source: `src/ADZAKLiteBrowser/` (WinForms + WebView2, .NET 8).

## Runtime instructions

1. You need **Windows 10 or 11 (64-bit)**.
2. You need the free **Microsoft Edge WebView2 Runtime**. It is already present
   on Windows 11 and on most Windows 10 PCs with Edge. If it's missing, the app
   tells you and offers the official page:
   <https://developer.microsoft.com/microsoft-edge/webview2/>
   (Evergreen Bootstrapper → it installs in under a minute.)
3. Run `ADZAKLiteBrowser.exe`. No installation, no admin rights, no account.
4. Optional flags:
   - `ADZAKLiteBrowser.exe --smoke-test` — headless self-check; writes
     `%TEMP%\adzak-smoke-result.json` and exits 0 (OK) / 1 (failure).
5. Your data (settings, bookmarks, history, browser profile/cache) lives in
   `%AppData%\ADZAK Lite Browser`. Delete that folder to reset everything.

First run tips: the shield button in the toolbar toggles **Data Saver**;
☰ menu → **Suspend Inactive Tabs Now** shows the RAM feature in action;
☰ menu → **GPU Status…** shows the real WebGL renderer your PC is using.

## Features

- **Navigation:** back/forward/reload/home, smart address bar (URLs, localhost,
  IPs, or search), default search DuckDuckGo (Google/Bing selectable), HTTPS by default for bare domains.
- **Tabs:** unlimited tabs, favicons, loading indicators, close button/middle-click,
  `Ctrl+T / Ctrl+W / Ctrl+L / Ctrl+F / Ctrl+J` (also works when a page has focus),
  fullscreen video support (F11-style), zoom controls.
- **Bookmarks:** star button, bookmarks bar, manager (add/open/delete).
- **History:** automatic, searchable manager, per-item delete, clear all (max 1 000 entries).
- **Downloads:** WebView2 download interception, save to Downloads (or ask each time),
  progress, pause/resume, open/show-in-folder, custom folder in Settings.
- **Data Saver:**
  - curated **ad/tracker host blocklist** (suffix matching, fast HashSet),
  - **optional image blocking** (the biggest saving; off by default for compatibility),
  - **autoplay prevention** (Chromium policy flag + a content script that strips
    `autoplay` from media elements; media you press play on is untouched),
  - honest counter: it counts **blocked requests**, never invented "MB saved".
- **Memory optimization for 8 GB RAM:**
  - one shared `CoreWebView2Environment` for every tab,
  - **automatic tab suspension** after N idle minutes (default 5) with 💤 marker;
    suspended tabs resume instantly when clicked,
  - manual "Suspend Inactive Tabs Now", disk-cache cap (default 200 MB),
  - live status bar: host RAM, whole-PC RAM usage, tab/suspension counts.
  - Deliberately **not** used: `--process-per-site`/renderer limits — they weaken
    Chromium's site isolation, a security regression we won't trade for RAM.
- **Security & compatibility:**
  - certificate errors are **always blocked** (never silently accepted),
  - camera/microphone ask you first; notifications/geolocation/clipboard are denied by default,
  - web pages can only navigate to http/https (no `file://`, `javascript:` top-level tricks),
  - `target=_blank` opens in a tab, downloads are user-visible and cancellable,
  - built-in Chromium error pages, autofill and password save kept for site compatibility,
  - DevTools off by default (can be enabled in Settings), no telemetry anywhere.

## Build from source (Windows)

Requirements: **.NET 8 SDK** (free) — everything else restores from NuGet.

```powershell
cd adzak-lite-browser\src\ADZAKLiteBrowser
dotnet restore
dotnet publish -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
  -o ..\..\publish\single
```

Or just run the GitHub Actions workflow **“Build ADZAK Lite Browser (Windows x64)”**
in this repo — it publishes both layouts, installs the WebView2 runtime on the
runner, smoke-tests the EXE, and uploads the artifacts.

## Build & test results (honest)

- The authoring environment for this delivery is a Linux sandbox with **no .NET
  SDK and no Windows**, so the EXE could not be compiled locally. It is compiled
  by GitHub Actions on `windows-latest` from exactly this source.
- The CI **smoke test really runs the shipped single-file EXE**: it creates a
  WebView2 environment, loads a local page, checks the title/DOM, exercises the
  blocklist/address logic, and reports the machine's actual WebGL renderer.
  See `BUILD-RESULTS.md` in this folder for the recorded run (exit code and the
  JSON it produced) — including anything that failed.
- Not tested: interactive browsing on a physical 8 GB PC, enterprise proxies,
  DRM video (Widevine works only where the WebView2 runtime supports it),
  and long-session memory soak. The GUI itself has only been exercised
  headlessly via the smoke test.

## Known limitations

- Ad/tracker blocking is host-based: first-party ads and some video ads will
  still appear, and a few sites may ask you to disable blocking (use the shield).
- Suspended tabs keep their URL/title but the page reloads its state from the
  engine when resumed; unsaved form text in a suspended tab can be lost —
  the same trade-off Chrome's Memory Saver makes.
- Autoplay prevention is best-effort: the Chromium policy + attribute stripping
  stops the overwhelming majority of autoplay, but pages that start media from
  script timers can occasionally still begin playback (sound is still gated by
  the Chromium policy until you interact with the page).
