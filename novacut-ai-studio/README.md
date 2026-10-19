# NovaCut AI Studio

A professional, **offline** video editor for Windows with privacy-preserving
**local AI** tools. CapCut-style multitrack editing, non-destructive projects,
a real FFmpeg render engine, and a dedicated AI studio — no accounts, no cloud
APIs, no telemetry, no silent model downloads.

> Built with Python 3.11, PySide6 (Qt 6), FFmpeg and OpenCV. The same codebase
> runs on Linux/macOS for development; the shipped target is Windows x64.

---

## 1. What works

See **[FEATURES.md](FEATURES.md)** for the full honest status matrix. Highlights:

- Multitrack timeline: drag-and-drop, trim, split, ripple delete, duplicate,
  snapping, zoom, markers, track lock/hide, thumbnails and waveforms.
- Full undo/redo (command pattern, 300 steps) and non-destructive editing —
  every edit is serialisable project data, nothing is baked into source files.
- Keyframed transform/opacity/gain, color correction, LUTs, chroma key, masks,
  blur/sharpen/vignette/denoise, transitions (xfade), animated titles.
- WYSIWYG preview built from the **same filter graph** as the exporter.
- Export MP4/MOV/MKV/WebM with H.264/H.265, NVENC/QuickSync/AMF with automatic
  CPU fallback, 480p–4K, 24–60 fps, progress/ETA/cancel and diagnostics.
- AI studio: local Whisper subtitles (SRT/VTT/ASS + burn-in), silence cuts,
  background removal, Demucs separation, scene detection, subject-tracked smart
  reframing, FFmpeg audio cleanup, and an Ollama local assistant that only
  suggests and never edits without you.
- Versioned `.novacut` project archives, autosave and crash recovery.

## 2. Requirements

- Windows 10/11 x64 (development also works on Linux/macOS)
- Python 3.10–3.12
- An FFmpeg build (the app auto-detects PATH, a bundled `bin/` folder, or the
  `imageio-ffmpeg` wheel). Windows builds use gyan.dev essentials, which
  includes `drawtext`, `xfade`, `chromakey`, `lut3d`, `afftdn`, etc.
- Optional AI engines are installed on demand (Model Manager):
  `faster-whisper`, `rembg` + `onnxruntime`, `demucs` + `torch`, and the Ollama
  app for the assistant.

## 3. Run from source

```bat
git clone <this repo>
cd novacut-ai-studio
py -3.11 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Linux/macOS:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

If FFmpeg is missing, install it (`winget install Gyan.FFmpeg` on Windows) or
set the path in **Tools ▸ Settings**. The app never blocks startup when an
optional component is missing — the affected feature shows an honest
"unavailable" banner with installation instructions.

## 4. Testing

```bash
# Linux/macOS
./scripts/run_tests.sh
# Windows
scripts\run_tests.bat
# or directly
pytest tests -q
```

The suite (55+ tests) covers project serialization/portability/missing media,
every timeline command and its undo, filter-graph structure, **real FFmpeg
renders** of transitions/titles/effects/multi-track audio, export cancellation
and hardware-fallback paths, silence/scene/reframe analysis against generated
media, subtitle writers, model-manager downloads/cancellation, the loopback
assistant, preview frame decoding, and headless UI smoke tests.

## 5. Building the Windows application

Two artifacts are produced:

1. **Portable folder** `dist/NovaCutAIStudio/` (zip and share)
2. **Installer** `installer/Output/NovaCutSetup.exe` (Inno Setup, Start Menu,
   desktop icon, `.novacut` file association)

```bat
installer\build_windows.bat
```

The script creates a venv, installs dependencies, downloads the FFmpeg
essentials build into `installer/bin/`, runs the test suite, invokes
PyInstaller (`installer/novacut.spec`) and then Inno Setup if present.

### Continuous integration

`.github/workflows/windows-build.yml` runs on `windows-latest` and uploads both
artifacts on every tag/push. `.github/workflows/tests.yml` runs the test suite
on Ubuntu, Windows and macOS.

> **Honest build note:** this repository was developed and fully tested on a
> headless Linux sandbox whose Python lacks the shared `libpython` that
> PyInstaller requires, so no Windows `.exe` is committed alongside the source.
> The Windows runner in `windows-build.yml` performs the actual EXE/installer
> build; the packaging scripts and spec are part of this delivery. No EXE is
> claimed to exist unless produced by that build.

## 6. Project format

`.novacut` files are ZIP archives:

```
manifest.json     app/format version, bundled file list
project.json      versioned document (settings, media refs, full timeline)
media/...         optional consolidated copies (Save As ▸ bundle media)
```

Media references store both absolute and project-relative paths, survive drive
letter/folder changes, and missing files are flagged with one-click relink
(file or whole folder). The format carries `format_version` and a migration
hook (`novacut/models/project.py`).

## 7. Architecture

```
novacut/
  app.py                 QApplication bootstrap, theme, entry point
  core/                  paths, config, logging, FFmpeg discovery/runner,
                         undo stack, background workers, timecode
  models/                Project / Timeline / Clip / Effect dataclasses,
                         versioned (de)serialization
  media/                 import library, SQLite cache, thumbnails/waveforms,
                         proxies, Qt title rendering
  playback/              FFmpeg pipe frame server + QAudioSink feed
  editing/               undoable commands + snapping engine
  timeline_ui/           QGraphicsView multitrack timeline
  render/                filter_complex builder + export engine/presets
  ai/                    8 local tools + explicit model download manager
  ui/                    main window, docks, dialogs, AI studio, export
  diagnostics/           system report, autosave, crash recovery
```

Rendering is fully data-driven: `FilterGraphBuilder` compiles the timeline into
an FFmpeg `filter_complex` script (keyframes become eval expressions, effects
become named filters, tracks become overlays/concat/xfade, audio becomes
atrim/atempo/amix). The preview uses the same builder, so what you see is what
gets exported.

## 8. Local AI and privacy

- All inference runs on-device. There is no telemetry and no remote endpoint.
- Models download **only** after an explicit install click with a disk-space
  check, size and license display, progress bar and cancellation.
- The assistant is restricted to loopback Ollama hosts and returns text
  suggestions; timeline edits always require your confirmation.
- AI features degrade gracefully: missing engines/models produce a clear
  unavailable state instead of broken buttons.

## 9. License

GPL-3.0-or-later. Third-party components and model licenses are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), including the GPL status of
convenience FFmpeg builds and the research-license notice on Demucs weights.
