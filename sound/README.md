# Safi — Local Sound Studio

An installable, mobile-first **web app (PWA), not an APK**. Plays local audio
with -6 to +12 dB gain, three tone presets, output volume, a live analyzer,
playlist controls, seeking, and a stereo-linked look-ahead sample-peak limiter.

## Use

Open the live preview in Chrome (Android) or Safari (iOS), choose **Add audio**,
select an audio file, then press Play. Start with a low phone volume and 0 dB
boost; raise gradually only if needed. Choose Install / Add to Home screen
from the browser menu to use it like an app. Install prompt availability
varies by browser. No microphone, account or server upload is used.

This processes **only files opened in this player**. It cannot increase calls,
YouTube, other apps, or the phone's hardware output limit. It cannot promise
zero distortion, make existing clipping disappear, or guarantee safe listening.
Boosting already-loud audio mostly reduces dynamics as the limiter engages.
Limiter amplitude protection does not measure SPL or hardware distortion.

## Run locally / host

No dependencies or build step:

```sh
python3 -m http.server 8000 --bind 0.0.0.0 --directory sound
```

For an actual phone, serve the folder over **HTTPS**; plain LAN HTTP is not a
secure context. AudioWorklet, service worker and installation need a supported
browser and secure context (localhost is allowed for local development).
Do not open index.html as a file:// URL. On a static host, keep the complete
folder together and serve .mjs/.js as JavaScript. If hosted as part of this
repository, open /sound/ under the site's base path.

## Audio path

Local HTMLAudioElement -> low shelf -> peaking EQ -> high shelf -> gain ->
AudioWorklet limiter -> output volume -> analyser -> destination.
The limiter adds 5 ms look-ahead, uses a monotonic peak queue, links stereo
channels, and applies immediate gain reduction / 120 ms gain recovery.
Its ceiling is **-1 dBFS sample peak**, not a true-peak reconstruction limiter.
Input/output buffer state remains stable across render blocks. It does not
make guarantees for downstream hardware, intersample peaks or hearing safety.
If the worklet cannot load, positive gain and tone presets are disabled and
basic playback remains available; the UI explicitly shows missing protection.
Gain and volume initialize at 0 dB / 70% every fresh session, never a saved
high boost. Output device volume is separate from this player's gain.

## Privacy and offline

Only app shell files are cached by a dedicated, scoped service worker. User
tracks are not uploaded, stored in a database, or cached. Select them again
after reopening; original files are never modified. Track names are rendered
using textContent. Object URLs are revoked when tracks are removed.
Open once online and allow the service worker to finish preparing before
using offline. Media formats and background playback support vary by browser.
This is stereo audio playback, not a multichannel or DRM stream processor.

## Checks

```sh
node --test sound/tests/dsp.test.mjs
node --check sound/app.js
```

DSP tests cover quiet-signal transparency with delay, boosted peak ceilings at
8/44.1/48/96 kHz, stereo gain linking, isolated peaks, and non-finite input.
Headless Chromium smoke tests were also run for actual AudioWorklet playback,
file selection/removal, gain/preset/reset controls, pause, mobile layout,
dialogs, offline reload and the unavailable-worklet fallback. Tested mobile
viewport: 390 x 844. These are not a physical-phone or speaker distortion test.
