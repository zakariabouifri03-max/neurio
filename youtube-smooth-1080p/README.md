# YouTube Smooth 1080p

A local-only Chrome extension that monitors YouTube playback and can briefly pause a video when its buffer appears likely to run out. It **never changes the user's chosen resolution**.

## Install (Load unpacked)

1. Download or clone this repository.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `youtube-smooth-1080p` folder (the folder containing this `manifest.json`).
5. Open or reload a YouTube watch page or Short. The extension popup is available from the toolbar.

If YouTube was already open during installation, reload that tab so Chrome injects the content monitor.

## What it does

- Reads the YouTube player quality when the player API exposes it; otherwise it estimates the current output from the media element's dimensions.
- Measures contiguous buffered time ahead of the playhead and watches playback state over time.
- Uses the browser's Network Information API when available for an **estimated** downlink and connection type. This is a browser estimate, not a speed test; it may be unavailable. If it is unavailable, the Slow/Medium label is cautiously inferred from observed buffer and stall behavior, and numeric speed stays unavailable.
- With **Smart Buffer Protection** enabled, may briefly pause a playing video when buffer depletion looks imminent, then attempt to resume after a buffer reserve is available. If the reserve cannot build, it resumes after a safety timeout rather than holding playback indefinitely.
- **Maximum Smoothness Mode** uses a larger reserve and a more cautious low-buffer trigger. It can mean longer intentional pauses and higher data use while the player fills its buffer.
- Monitors YouTube watch pages and Shorts on `youtube.com`, `www.youtube.com`, and `m.youtube.com` where a normal video element is available.

The extension does not call `setPlaybackQuality`, modify YouTube controls, change playback speed, inject overlays into the player, or interfere with captions, fullscreen, playlists, login, or recommendations.

## Important technical limits

YouTube's adaptive/DASH player owns its stream requests, and Chrome does not give extensions a reliable supported way to fetch or prioritize arbitrary future media segments. The extension therefore does **not** rewrite, duplicate, block, or prioritize media requests, and does not force `preload="auto"` (which is not a reliable control for YouTube's Media Source streams). Maximum Smoothness adjusts only the extension's buffer-protection thresholds and resume reserve. YouTube remains responsible for downloading video data.

This extension cannot increase internet bandwidth. A 2 Mbps connection remains a 2 Mbps connection, and some 1080p streams may require more throughput than that connection can sustain. Buffering and brief protection pauses can still happen. The aim is to make playback feel less abrupt when the player can accumulate enough data—not to promise uninterrupted playback.

Smart Buffer Protection is best-effort. A browser or YouTube player may pause its own downloads when playback is paused, or YouTube may change its internal player API. In those cases the extension falls back to monitoring and cannot guarantee that the buffer will grow while paused. Turn the feature off if you prefer uninterrupted playback controls over automatic buffering pauses.

## Permissions and privacy

- `storage`: saves the three playback preferences locally in Chrome.
- YouTube host access: required to run the monitor on YouTube pages only.
- No external server, analytics, advertisements, telemetry uploads, or browsing-history collection. The extension makes no network requests of its own. The displayed downlink estimate, when present, comes from Chrome's local `navigator.connection` API.

## Files

- `manifest.json` — Manifest V3 configuration.
- `background.js` — initializes local defaults; no network activity.
- `content.js` — player discovery, buffer/state monitoring, and optional protection.
- `popup.html`, `popup.css`, `popup.js` — live status and quick toggles.
- `options.html`, `options.css`, `options.js` — detailed settings.
- `icons/` — extension toolbar and listing icons.
