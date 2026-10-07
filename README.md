# Neurio Studio

Neurio Studio is a local-first, browser-based multitrack video editor. The current build is a self-contained static application: it imports local media, edits clips and overlays in a timeline, previews the composite in a canvas, and records a WebM export in real time using the browser's `MediaRecorder` API.

## Run it

Serve the repository root over HTTP (ES modules, IndexedDB and service workers need a secure web origin):

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# open http://localhost:8000
```

There is no package install or build step. All editing and media persistence happen in the browser on the user's device. Imported source files are not uploaded.

The `arena/65e7f515-neurio` branch includes a GitHub Actions Pages workflow. Once Pages is enabled for the repository, pushes to that branch publish only the editor shell and its required assets at `https://zakariabouifri03-max.github.io/neurio/`.

## Working workflows

- Import video, image, audio and local font files into the project media bin.
- Add media at the playhead or drag media onto a timeline track.
- Work with multiple video/overlay/text/audio tracks; add and remove tracks, lock, hide or mute them.
- Select one or more clips, move them, snap to nearby edit points, trim either edge, split at the playhead, duplicate, copy/paste, and undo/redo.
- Scrub and step through the edit frame by frame; preview image/video, text, stickers, effects, transitions and audio together.
- Adjust transform, opacity, speed, volume, fades and supported color controls; animate transform values with keyframes and easing.
- Add editable titles and graphic overlays, procedural music/SFX, reusable starter templates, and local audio silence analysis.
- Save project state automatically in IndexedDB, restore the last autosave, duplicate projects, and import/export a `.neurio` project-edit file.
- Export a real-time WebM recording with browser-supported VP8/VP9 options, resolution, FPS, and bitrate controls.

## Honest capability boundaries

This repository does not bundle a remote processing service or licensed stock-media catalogue. Music and sound effects in the library are generated locally from original oscillator/noise synthesis; they are not stock recordings. Browser export uses `MediaRecorder` and produces WebM only. MP4/MOV encoding, caption transcription, background/object removal, face detection, video stabilization, upscaling, advanced HSL/curves/LUTs, professional audio mastering, and other model- or encoder-backed tools require services/models that are not configured here. The AI panel identifies these as not connected instead of simulating their work.

Browser codec, resolution, media format and local-storage support vary by device. For larger edits, use a current desktop browser and keep an independent copy of source files and exported project files.

## Code layout

```text
index.html                 # Editor shell and main application layout
src/editor.css             # Workspace, preview, inspector and timeline styling
src/editor/main.js         # Editor state, media import, playback, timeline, canvas and export
src/editor/catalog.js      # Track colors, effects, transitions, text styles, templates and sound definitions
src/editor/audio.js        # Procedural, original WAV sound/music synthesis
src/editor/storage.js      # IndexedDB project/media persistence with local recovery fallback
sw.js                      # Offline cache for the editor shell
```

The project and source media use separate IndexedDB stores so timeline operations remain independent of the imported blobs. Clip records are plain, serializable data structures with per-clip transforms, color, transitions and keyframes. This is an intentionally browser-native foundation; model services or a server-side renderer can be integrated behind explicit adapters as the product grows.
