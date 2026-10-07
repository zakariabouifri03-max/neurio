# Neurio Studio

A professional multi-track video editor that runs entirely on-device: WebGL2 compositing, Web Audio mixing, WebCodecs MP4/WebM export, IndexedDB projects, editable templates, royalty-free (synthesized) SFX/music, and on-device AI tools (Whisper captions, MediaPipe background removal, auto-reframe, silence removal, beat sync, stabilization, auto color).

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
src/library   registries: effects, transitions, text animations/presets, caption styles, stickers, fonts, LUTs, color/animation presets, SFX & music synths, templates
src/ai        captions (Whisper via transformers.js worker), segmentation/face (MediaPipe), reframe, highlights, silence/jump-cut, beat detection, auto color, stabilization
src/services  projects/autosave/folders/import-export, favorites & creator presets, clip actions, shortcuts, thumbnails
src/ui        home (templates/projects/search), editor shell, preview (gizmos), timeline, inspector panels, left panels, dialogs
src/platform  Capacitor/Electron glue (native save, back button, status bar)
electron/     desktop shell (app:// protocol, permissions, screen-capture picker)
android/      Capacitor Android project (generated, committed)
```

Everything a button exposes either works on-device or states clearly why it is unavailable in the current browser (e.g. no WebCodecs → realtime WebM fallback; no WebGPU → CPU Whisper; no `getDisplayMedia` on Android → screen recording hidden).
