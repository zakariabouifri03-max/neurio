# YouTube Smooth 1080p

A Manifest V3 Chrome extension that makes **1080p (or any quality you pick) feel smoother on a
slow or unstable connection** — by watching the buffer, predicting stalls, and briefly pausing to
rebuild it before the player freezes.

> **The honest pitch.** This extension **cannot increase your internet speed.** A 2 Mbps line stays
> a 2 Mbps line. What it can do is spend that bandwidth intelligently: keep more video downloaded
> ahead of the playhead, see a stall coming seconds in advance, and pause for a couple of seconds
> now instead of letting the player freeze for ten seconds later. The result is *perceived*
> smoothness with **your chosen resolution never changed**.

---

## Install (Load unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (`youtube-smooth-1080p`)
5. Pin the 🎬 toolbar icon and open a video on youtube.com

That's it — no build step, no dependencies, no external servers.

## What it does

| Behaviour | How |
| --- | --- |
| **Monitors the buffer** | Reads the `<video>` element's `TimeRanges` on every tick to know exactly how many *playable* seconds sit ahead of the playhead (gaps excluded). |
| **Predicts stalls** | Fits a least-squares slope over the last ~6 s of runway; when the runway is shrinking it computes a time-to-empty and acts before you hit it. |
| **Smart Buffer Protection** | If the runway drops below the low-water mark while the buffer is draining, it pauses for a moment so the player fills further ahead, then resumes automatically at your resume target. Configurable, on by default. |
| **Measures real throughput** | Uses Resource Timing on `…/videoplayback` media requests when the browser exposes transfer sizes; otherwise derives a speed figure from buffer growth and labels its source honestly (`measured` / `derived` / `network-api`). |
| **Classifies your link** | Slow / Medium / Fast from measured Mbps, the quality-relative download ratio, `navigator.connection`, and Save-Data flags. |
| **Never lowers quality** | There is **no code path that selects a lower resolution.** The only quality write it can perform is an opt-in "pin" that moves *up* back to the quality *you* chose if YouTube's own ABR quietly dropped below it. |
| **Dashboard** | A toolbar popup with a live runway bar, plus an optional draggable in-page overlay (`Alt+Shift+Y`). |

## Features & toggles

- **Smart Buffer Protection** — pause-to-buffer / auto-resume. On by default.
- **Maximum Smoothness Mode** — intervenes earlier, targets a ~20 s buffer, samples more often.
  Still never touches resolution.
- **Playback pacing** *(off by default)* — if the link delivers less than realtime, play up to a few
  % slower so the buffer grows. Resolution untouched; your chosen speed is the ceiling and is
  restored as soon as the buffer is healthy.
- **Pin the selected quality** *(off by default)* — best-effort restore of *your* quality if YouTube
  drops below it. Can only move up.
- **Reduce background requests** *(off by default, needs an optional permission)* — blocks YouTube
  telemetry endpoints (`api/stats`, `ptracking`, `activeview`, `log_event`) so they stop competing
  with video bytes. Media, ads, recommendations, login and the player are never touched.

## What it can and cannot do

**Can** — read exact buffered seconds, measure real throughput, predict stalls, pause/rebuild/resume,
pace playback a few %, drop competing telemetry.

**Cannot** — increase bandwidth; make 1080p stream on a link permanently slower than 1080p's bitrate;
choose which byte ranges YouTube's DASH client fetches; rewrite or proxy media segments (Chrome's
security model disallows it); ever lower your resolution.

**Example.** On a 2 Mbps line, 1080p needs roughly 3.5 Mbps. The extension can't close that gap. It
*can* make sure the headroom you have is spent downloading video ahead of you, and trade a two-second
pause now for a ten-second freeze later. If the shortfall is permanent, the honest fix is a lower
resolution — and that decision stays yours.

## Privacy

- Manifest V3 service worker, no remote code, no external servers.
- No tracking, no analytics, no ads, no history reading. The only persisted data is your settings.
- Runs on `youtube.com`, `www.youtube.com`, `m.youtube.com` only.
- Permissions: `storage` (settings) + `scripting` (read the player's quality). `declarativeNetRequest`
  is **optional** and requested only if you enable request reduction.

## Architecture

- `core.js` — pure logic (buffer maths, throughput EWMA, connection classifier, protection FSM, rate
  adapter). Loaded first as a content script **and** as a plain script in the popup/options. Fully
  unit-tested under Node.
- `content.js` — isolated-world brain: finds the `<video>` (watch/embed/Shorts), samples buffers,
  runs the FSM, applies pause/resume and pacing, reports snapshots, draws the HUD.
- `page.js` — injected into the **MAIN** world via `chrome.scripting.executeScript` because YouTube's
  `#movie_player` API lives in the page realm. Read-only by default; its single write (`setPlaybackQuality`)
  only ever restores the user's own quality upward.
- `background.js` — service worker: seeds defaults, injects `page.js`, caches snapshots, badge,
  optional telemetry rules (dynamic, permission-gated).
- `popup.*` / `options.*` — dashboard and settings UI.

## Testing

Everything below executes the *shipped* files (no copies):

```bash
npm test        # 60 assertions: core logic + a VM harness that boots content.js,
                # attaches a fake <video>, and proves it pauses & resumes
npm run check   # node --check on all scripts + icon generation
```

A real-browser end-to-end run is not possible in a headless CI sandbox (no Chromium / blocked
download hosts); the VM harness is the integration check instead.
