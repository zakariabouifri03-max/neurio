# NovaCut AI Studio

**NovaCut AI Studio** is a local-first Windows desktop video-editor prototype built with Python and PySide6. It has a real, editable multitrack project model, a dark desktop interface, local media workflows, and a full-timeline FFmpeg render path. Editing operations change project data; they do not destructively render clips.

> **Delivery status:** this checkout contains source and Windows build scripts. A Windows `.exe` or installer has **not** been built here: this development container is Linux, and Windows packaging must be run on Windows x64. The executable is not claimed to exist until `build_windows.ps1` has completed and the result has been tested on Windows.

The previous browser racing-game files in the repository are preserved, but they are not part of NovaCut.

## Run from source

Requirements:

- Windows 10/11 x64 (the intended desktop target)
- Python 3.11+ (64-bit)
- PySide6 from PyPI
- A local FFmpeg build for media metadata, audio analysis, proxy generation, and export

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m novacut
```

Use **File → FFmpeg / AI Paths… → Choose FFmpeg executable…** to select `ffmpeg.exe`, or put `ffmpeg.exe` on `PATH`. If a matching `ffprobe.exe` sits beside it, NovaCut uses it for fast metadata reads. Qt Multimedia uses the platform's local playback backend; codec support can vary by Windows installation.

On Linux, install the platform libraries required by Qt 6 (including OpenGL/EGL, xkbcommon, and DBus) before launching the UI. Core project/timeline tests do not require a visible desktop. FFmpeg is a separate dependency and is intentionally not silently downloaded or bundled in the default build.

## Build a Windows x64 portable app / installer

Run this in **64-bit Windows PowerShell** with Python 3.11+:

```powershell
.\build_windows.ps1
```

The script installs the Python requirements, runs `pyflakes` and the automated tests, then starts the packaged app briefly with `--smoke` before building the onedir portable app at:

```text
dist\NovaCut AI Studio\NovaCut AI Studio.exe
```

If Inno Setup (`ISCC.exe`) is installed, the script also creates `dist\installer\NovaCut-AI-Studio-Setup-x64.exe`.

FFmpeg is not bundled by default. To include a specific FFmpeg build, first review its license/build configuration and provide the license/source notice for that exact binary:

```powershell
$env:FFMPEG_DIR = 'C:\tools\ffmpeg\bin'
$env:FFMPEG_LICENSE_FILE = 'C:\tools\ffmpeg\LICENSE.txt'
.\build_windows.ps1
```

The build script refuses to bundle the executable unless its notice file is provided. See [third-party and model notices](THIRD_PARTY_NOTICES.md). Optional AI model files are never included in the portable app or installer.

The `NovaCut Windows x64` GitHub Actions workflow on this branch builds and tests the Windows package, performs a startup smoke test, and creates a ZIP plus SHA-256 checksum. A preview GitHub Release is published only for a commit whose message includes `[novacut-release]`; routine pushes do not publish releases. Startup smoke testing is not a substitute for manual codec/playback checks on a Windows device.

## First editing workflow

1. Start NovaCut and import media with **Import** or `Ctrl+I`.
2. Wait for background metadata probing, then drag media from **Media Bin** to a compatible timeline track. Double-clicking a bin item adds it at the playhead.
3. Select a clip to set timeline/source in/out, speed, opacity, volume, position, scale, rotation, fades, crop, color, chroma-key, optional `.cube` LUT, audio EQ, and local FFmpeg denoising in **Inspector**.
4. Use **Split**, **Duplicate**, **Ripple delete**, track lock/mute/visibility, timeline zoom, markers, and snapping. Use `Ctrl+Z` / `Ctrl+Y` to undo or redo timeline edits.
5. Save as `.novacut`. Projects autosave locally every 30 seconds while dirty and offer recovery after an unexpected exit.
6. Choose **Export Video** to render the complete timeline, not just the selected clip. Export uses a background thread, progress/ETA, cancel, diagnostics, and a CPU retry if the selected NVIDIA encoder fails.

A synthetic, original test video can be generated locally (no stock media is downloaded):

```powershell
python tools\generate_novacut_test_media.py test-media\synthetic.mp4 --ffmpeg C:\tools\ffmpeg\bin\ffmpeg.exe
```

## Implemented in this first runnable milestone

| Area | Current implementation |
|---|---|
| Desktop shell | PySide6 dark editor shell, menus, shortcuts, media bin, preview, Inspector, timeline, AI Studio workspace, project settings. |
| Media | Imports common video/audio/image types; FFprobe/FFmpeg metadata; asynchronous metadata/thumbnail/waveform jobs; disk-backed thumbnail and waveform caches; media-bin drag/drop. |
| Playback | Play/pause, seek, frame stepping, speed control, image preview, Qt Multimedia source-clip playback, optional generated preview proxies, and a lightweight overlay of active editable title clips. Preview shows the active source clip rather than a live multitrack composite. |
| Timeline | Editable, non-destructive multitrack clip data; drag/drop; multiple video/audio tracks; split, source trim, move, duplicate, delete, ripple delete, snapping, zoom, scroll, markers, track lock/mute/visibility. Audio clips display cached peak waveforms; video clips use cached thumbnails. |
| Project/history | Versioned JSON `.novacut` project format, relative plus absolute media references, validation, atomic save, autosave/recovery prompt, 120-step project snapshots for undo/redo. |
| Titles/effects | Editable text overlays; fade-in/fade-out; transform and opacity; crop; brightness/contrast/saturation; FFmpeg chroma key; optional `.cube` LUT; audio fades, gain, simple bass/treble EQ, and optional `afftdn` noise reduction. |
| Export | Full timeline filter graph; MP4/MKV/MOV/WEBM muxing when supported by FFmpeg; H.264/H.265/VP9 encoder selection; resolution and FPS presets; quality/bitrate and audio settings; optional NVENC with CPU retry; background progress, cancel, and failure diagnostics. FFmpeg build capabilities determine what actually works. |
| AI Studio | Local silence analysis with reviewable, undoable ripple cuts; local scene-boundary analysis with reviewable markers/splits; Whisper.cpp transcription integration; editable title-clip subtitles and SRT/VTT export; explicit model manager with disk check/progress/cancel; optional still-image U²-Net/rembg; optional cached Demucs; loopback-only Ollama assistant; manual centered vertical crop suggestion; local FFmpeg denoise/EQ. |

## Optional local AI setup

NovaCut makes no cloud API calls. Local inference is optional. The model manager can explicitly download a selected Whisper.cpp model or U²-Net checkpoint; it shows approximate size, checks free space, reports progress, and supports cancellation. No model is downloaded just by starting the app or opening AI Studio.

- **Subtitles:** install a Whisper.cpp `whisper-cli` executable separately, set its path in **File → FFmpeg / AI Paths…**, then choose/download a model in **AI Studio → Model Manager**. Transcription requires local FFmpeg to extract audio. It runs locally and produces editable title clips after confirmation.
- **Background removal:** install the optional packages with `python -m pip install -r requirements-ai.txt` and explicitly install U²-Net in Model Manager. This version processes still images only; it does not claim video segmentation.
- **Audio separation:** install Demucs and its model weights separately. NovaCut only offers execution if the expected model checkpoint is already in the local PyTorch cache; it refuses to trigger an implicit model download.
- **Local assistant:** install Ollama and a model on the same computer, start Ollama, then refresh the model list. NovaCut accepts only `localhost`/loopback URLs. Assistant output is advice; it never changes project data.
- **Smart reframing:** the current button creates an editable centered 9:16 crop suggestion. It does not track a subject and is not represented as perfect or AI tracking.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for library/model licensing notes and distribution responsibilities.

## Project format

A `.novacut` file is UTF-8 JSON with `format: "novacut-project"` and a `schema_version`. It stores media metadata, tracks, source in/out ranges, timeline placement, clip effects, markers, and project dimensions/FPS. Each media record has an absolute path and a project-relative path hint. Media is not copied into the project automatically. The format is editable and can be inspected with a text editor; keep a backup before editing it manually.

Application data (autosaves, logs, cached proxies, thumbnails, waveforms, models) is kept outside the project under the current user's application-data/cache locations. The log is `novacut.log` inside the NovaCut application-data `Logs` folder.

## Tests

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest
```

The test suite covers project serialization/version errors/missing media, timeline split/trim/ripple/silence operations, undo/redo, export graph generation, actual FFmpeg rendering plus worker success/progress/error signals, subtitle parsing, offline endpoint restrictions, and download disk-space handling. The end-to-end FFmpeg render test runs when `ffmpeg` is on `PATH` or `NOVACUT_FFMPEG` points to it; otherwise it is reported as skipped. The latest development-workspace run passed **22 tests**, and `pyflakes` completed without findings.

The export engine and synthetic FFmpeg integration test are exercised in the development workspace. A live desktop UI smoke test is blocked here because the host is missing `libGL.so.1`; build and then manually smoke-test the packaged preview/player on Windows before distributing it.

## Not complete / not supported yet

This is a working first editor milestone, not a claim that every requested professional feature is production-ready:

- Live, composited multitrack playback preview; preview currently follows one active video/image clip. Export composites the full enabled timeline.
- Dedicated transition objects (cross-dissolve/wipes), animated title presets, editable keyframe curves/automation, and keyframed transforms/opacity.
- General masks, motion tracking, face/object tracking, or AI video background removal.
- Neural audio separation/cleanup is optional and depends on separately installed packages/checkpoints; no model weights are bundled.
- Windows EXE/installer creation and Windows codec/playback testing must be performed on a Windows x64 host; no binary is present in this source-only checkout.
- Advanced proxy quality profiles, GPU decode, export disk-space estimates, HDR/10-bit workflows, and crash-dump diagnostics.

## Layout

```text
novacut/
  app.py         PySide6 desktop shell and workflows
  models.py      Project, asset, track, and clip data types
  project.py     Versioned serialization, autosave, recovery
  timeline.py    Editable timeline operations and history
  media.py       FFmpeg probing, thumbnail/waveform cache, local analysis/proxy jobs
  exporter.py    Full-project FFmpeg filtergraph and async export worker
  ai.py          Optional local AI adapters, model manager and subtitles
  widgets.py     Timeline/media widgets, export/model dialogs
 tests/          Project, timeline, export, and local-AI tests
tools/generate_novacut_test_media.py  On-demand synthetic test clip generator
build_windows.ps1                     Windows x64 portable/installer build
installer/NovaCut.iss                 Optional Inno Setup script
```
