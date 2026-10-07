# MotionForge Studio 1.0.0 — Windows x64

Professional 2D animation studio for Windows 10/11 (64-bit). Nothing else needs
to be installed — the runtime (Python 3.13 + Qt 6 + FFmpeg) travels inside the
download.

## Verified download

**MotionForge-Studio-1.0.0-win64-portable.zip** (99 MB)
Unpack it anywhere (USB stick works too) and double-click **MotionForge Studio.exe**.

**MotionForge-Studio-Setup-1.0.0.exe** — single-file installer: unpacks the very
same portable build, adds Start-menu and desktop shortcuts, registers an
uninstaller in *Apps & features* and associates `.mfs` project files.  It also
accepts `/silent` (unattended) and `/dir <path>`.

## Highlights

* Full drawing engine (pressure brush, pencil, ink, marker, soft brush, eraser,
  bucket fill with gap closing, line/rect/circle/polygon/bezier, text) with
  stabilisation and tablet support.
* Frame-by-frame animation: keyframes, holds, onion skin, exposure, 1–120 fps
  playback, unlimited undo/redo, autosave + crash recovery.
* Layers (groups, blend modes, clipping, alpha lock), rigging (bones, IK/FK,
  constraints, rotation limits, bake IK, auto rig), keyframes with easing curves
  and a graph editor with draggable handles.
* AI animation assistant that turns a sentence into editable keyframes, pose
  generator, inbetween generator, auto inbetween and editable lip sync —
  provider-abstracted with your own API key; everything else works offline.
* Camera keys/shake/shots, audio with waveforms and fades, scenes, asset and
  animation libraries, 7 project templates.
* Export to MP4, WebM, GIF or PNG/JPEG sequences up to 4K / 120 fps with a
  background render thread.

Windows SmartScreen may warn because the build is not code-signed yet:
*More info → Run anyway*. Third-party licences are in `licenses/` inside the zip.
