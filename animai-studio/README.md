# ANIMAI STUDIO

Local-first 2D animation studio for Windows (and the web during development). Draw frame-by-frame, composite layers, onion-skin, then use a **modular AI provider** for in-betweening, sketch cleanup, coloring, and motion.

The drawing editor is fully usable **without any AI**. Cloud providers are optional, off by default, and never upload drawings unless you select them and configure an endpoint.

## Product

| | |
| --- | --- |
| App name | **ANIMAI STUDIO** |
| Project format | `.animai` (ZIP of `project.json` + PNG cels) |
| Desktop binary | `ANIMAI-STUDIO.exe` (portable) |
| Installer | `ANIMAI-STUDIO-Setup.exe` (NSIS) |
| Target | Windows 10/11 (x64) |

## Features (MVP)

- Raster drawing engine (pencil, brush, ink, eraser, fill, shapes, lasso, selection, text, eyedropper) with size, opacity, hardness, stabilization, pressure, spacing, smoothing
- Windows pen / tablet pressure via Pointer Events
- Timeline with hold frames, insert / duplicate / delete / reorder
- Onion skin (previous + next, counts, opacity, color-coded)
- Layers (drawing / image / video / text): visibility, lock, opacity, rename, duplicate, reorder
- Undo / redo, copy / paste, flip, rotate, scale
- Virtual camera (position, zoom, rotate, shake, keyframes)
- Audio timeline (import WAV/MP3, record voice, waveform, volume/mute)
- PNG / JPG / WEBP / SVG / GIF / MP4 / MOV import (video frame extraction)
- Export GIF, PNG sequence, WebM, MP4 (MediaRecorder), WebP frames
- Autosave + crash recovery + error log
- AI Assistant (natural-language commands)
- Local AI in-betweening (block-matching motion estimation)
- Local sketch cleanup, region colorize, motion generator, experimental text-to-animation
- Character library for consistency
- Settings → AI provider registry: `LocalProvider` | `CloudProvider` | `CustomProvider`

Marked **Coming Soon** (not fake buttons): AI lip-sync.

## Requirements

- Node.js 18+ (20+ recommended)
- npm 9+
- Windows 10/11 to produce `.exe` (electron-builder)
- Optional: `ffmpeg` on PATH for higher-quality MP4 in some environments

## Install (development)

```bash
cd animai-studio
npm install
```

`npm install` pulls Vite, TypeScript, JSZip, Electron, and electron-builder.

If Electron’s binary download fails (corporate TLS, offline Linux CI), install scripts only and use the web editor:

```bash
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts
npm run dev
```

The Windows `.exe` still requires a full Electron install on the machine that runs `npm run dist`.

## Run

Web editor (also used for live preview):

```bash
npm run dev
```

Opens on `http://0.0.0.0:5173`.

Desktop (Electron, after the Vite server is up):

```bash
npm run electron:dev
```

Dependency check (runs automatically before `dev` / `build`):

```bash
npm run check
```

## Build the Windows app

From a Windows x64 machine (or CI with Windows):

```bash
npm run dist
```

Outputs to `release/`:

- `ANIMAI-STUDIO.exe` — portable app
- `ANIMAI-STUDIO-Setup.exe` — installer with desktop + Start Menu shortcuts

The installer is NSIS, allows choosing the install directory, and does not require admin (`perMachine: false`).

Linux AppImage (optional):

```bash
npm run dist:linux
```

## Project format (`.animai`)

ZIP archive:

```
project.json          canvas, fps, layers, timeline, camera, audio, AI metadata, characters
cels/<layerId>/<n>.png
```

Re-opening a project restores every cel. Autosave writes to `localStorage` (web) and `%APPDATA%/animai-studio/animai/autosave.animai` (desktop). On launch you are offered recovery if an autosave exists.

## Architecture

```
src/
  core/       types, events, logger, settings
  engine/     document, drawing, compositor, playback, audio, history
  project/    .animai serializer, autosave
  io/         gif encoder, import, export
  ai/         AIProvider interface + Local / Cloud / Custom
  ui/         workspace, canvas view, panels
  examples/   bouncing-ball demo
electron/     main + preload (file dialogs, autosave, logs)
```

AI is behind `AIProvider`. The app never hard-codes a single vendor. Local algorithms run on-device and keep the UI pumping `requestAnimationFrame` with a progress overlay.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| B / P / E / F / I | Brush / Pencil / Eraser / Fill / Eyedropper |
| O | Onion skin |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+S / Ctrl+Shift+S | Save / Save As |
| Ctrl+C / Ctrl+V | Copy / Paste |
| Ctrl+D | Duplicate frame |
| Delete | Delete frame or selection |
| Arrow keys | Previous / next frame |
| 0 | Fit canvas |
| Ctrl+wheel | Zoom |

## Privacy

Default provider is **Local (offline)**. A yellow **Cloud AI** pill appears in the menu bar only when a cloud/custom provider is selected. No drawing is uploaded unless you configure an endpoint *and* switch to that provider.

## Example

`File → Open Example` loads a 12-frame bouncing ball at 1080×1080 / 12 fps.

## Logs

Help → Error Log, plus `animai.log` in the desktop user-data folder.
