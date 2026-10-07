# Neurio Studio

A professional multi-track video editor that runs entirely on-device: WebGL2 compositing, Web Audio mixing, WebCodecs MP4/WebM export, IndexedDB projects, editable templates, a 750-sample CC0 SFX library (Kenney) plus synthesized SFX/music, 870+ Google Fonts, 150+ GPU effects, video scopes, and on-device AI tools (Whisper captions, OPUS-MT caption translation, Kokoro text-to-speech, MediaPipe background removal & face blur, auto-reframe, scene detection, loudness normalization, filler-word removal, silence removal, beat sync, stabilization, auto color).

## Downloads

**Latest release → https://github.com/zakariabouifri03-max/neurio/releases/latest**

| Platform | File |
|---|---|
| Windows 10/11 installer | `Neurio-Studio-Setup-<version>.exe` |
| Windows portable (no install) | `Neurio-Studio-Portable-<version>.exe` |
| Android 7.0+ | `Neurio-Studio-<version>-android.apk` |

- Windows SmartScreen will warn because the EXE is not code-signed yet → *More info → Run anyway* (verify with `SHA256SUMS-windows.txt`).
- Android: allow *Install unknown apps*, then open the APK. Exports are saved to **Documents/Neurio** and offered via the share sheet. Best on tablets / landscape.
- Both run fully offline. AI models (Whisper, MediaPipe) download on first use.

## Run in a browser (dev)

```bash
cd studio
npm install --ignore-scripts   # onnxruntime-node's postinstall is not needed in the browser
npm run dev                    # http://localhost:5173
```

`npm run build` typechecks and produces `dist/` (static — host anywhere).

## Build the apps yourself

```bash
npm run desktop:win     # Electron → release/*.exe   (run on Windows, or in CI)
npm run android:apk     # Capacitor → android/app/build/outputs/apk/   (needs Android SDK + JDK 17)
npm run icons           # regenerate icon.ico + Android launcher/splash assets from electron/resources/icon.png
```

### Releases via GitHub Actions

`.github/workflows/studio-release.yml` builds the Windows EXEs and the Android APK and attaches them to a GitHub Release.

- Push a tag `studio-vX.Y.Z` (keep `package.json` `version` in sync) → release `Neurio Studio vX.Y.Z`.
- Or use **Run workflow** (once the workflow is on the default branch) → pre-release `studio-build-<n>`.
- Optional Android release signing: add repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is signed with a debug key (installable, but updates require uninstall first).

## Architecture

```
src/core      data model, keyframes/easing, commands (pure project transforms), zustand stores (undo/redo)
src/engine    WebGL2 Renderer + shaders, MediaManager (IndexedDB blobs, proxies), AudioEngine, PlaybackEngine, Exporter (WebCodecs + mp4/webm muxers, MediaRecorder fallback)
src/library   registries: effects (effects.ts + effectsExtra.ts, 151 shaders), transitions, text animations/presets, caption styles, stickers, fonts (googleFonts.ts, 876 families), LUTs, color/animation presets, SFX (sfxSamples.ts: 750 CC0 files in public/sfx + synth recipes), music synths, templates
src/ai        captions (Whisper via transformers.js worker), translate (OPUS-MT worker), tts (Kokoro-82M via transformers.js + phonemizer worker), segmentation/face (MediaPipe), faceblur, scenes, loudness (EBU R128-style), fillers, reframe, highlights, silence/jump-cut, beat detection, auto color, stabilization
src/services  projects/autosave/folders/import-export, favorites & creator presets, clip actions, shortcuts, thumbnails
src/ui        home (templates/projects/search), editor shell, preview (gizmos), timeline, inspector panels, left panels, dialogs
src/platform  Capacitor/Electron glue (native save, back button, status bar)
electron/     desktop shell (app:// protocol, permissions, screen-capture picker)
android/      Capacitor Android project (generated, committed)
```

Everything a button exposes either works on-device or states clearly why it is unavailable in the current browser (e.g. no WebCodecs → realtime WebM fallback; no WebGPU → CPU Whisper; no `getDisplayMedia` on Android → screen recording hidden).

## Licenses & credits for bundled assets / models

- **SFX** — 750 samples from [Kenney](https://kenney.nl) audio packs, **CC0 1.0** (`public/sfx/CREDITS.md`, per-pack `License.txt`). Plus synthesized recipes rendered with Web Audio.
- **Fonts** — Google Fonts catalog (`src/library/googleFonts.ts`); fonts are fetched on demand from Google Fonts under their respective OFL/Apache licenses. Local font upload also supported.
- **Whisper** (OpenAI, MIT) via [transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) — speech-to-text.
- **OPUS-MT** (Helsinki-NLP, CC-BY-4.0 models) via transformers.js — caption translation.
- **Kokoro-82M** (hexgrad, Apache-2.0) via transformers.js + [phonemizer](https://www.npmjs.com/package/phonemizer) (Apache-2.0; bundles an espeak-ng WASM build, loaded only when TTS is used) — text-to-speech.
- **MediaPipe Tasks Vision** (Google, Apache-2.0) — selfie segmentation and face detection.

Regenerate catalogs: `node scripts/gen-sfx-catalog.mjs`, `node scripts/gen-fonts.mjs`.
