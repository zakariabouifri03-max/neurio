# ADZAK Creative Studio

A Windows desktop creative suite (Python + PySide6 + FFmpeg) that puts a **project manager, video editor, photo editor,
graphic/thumbnail designer, media converter, audio tools and an AI assistant** in one application. It is built to run
offline on modest hardware (8 GB RAM, integrated graphics); online AI features are optional and need your own API key.

> **Status: first working release (0.1.0).** The backend (timeline, FFmpeg rendering, photo layers, converters, audio,
> subtitles, projects, autosave, secrets handling, assistant) is covered by automated tests that run real FFmpeg and Pillow
> operations. The Windows CI run on the session branch (GitHub Actions run 38043026914) passed the tests, the PyInstaller
> build, a 20-second startup smoke test of the packaged app, and the Inno Setup installer build. The Qt user interface
> was **not exercised interactively** anywhere (the build sandbox has no display libraries), so button-level behaviour is
> unverified; the smoke test only checks that the app stays running. See
> [docs/FEATURES.md](docs/FEATURES.md) for an exact list of what works, what is partial and what is not implemented.

## Install (end users)

1. Download `ADZAK-Creative-Studio-Setup.exe` from the build artifacts / releases.
2. Run it. It installs **per user** (no administrator rights needed) into `%LOCALAPPDATA%\Programs\ADZAK Creative Studio`.
3. Launch from the Start menu. FFmpeg is included in the installer, so nothing else needs to be installed.

Windows 10 or 11, 64-bit. Recommended: 8 GB RAM. Turn on **Low-memory mode** in Settings for smaller previews.

## Run from source (developers)

```bash
cd adzak-studio
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
export ADZAK_FFMPEG=/path/to/ffmpeg                     # optional; otherwise PATH or imageio-ffmpeg is used
python -m adzak                                          # starts the app
python -m pytest -q                                      # runs the automated tests (needs FFmpeg)
```

## Build the Windows executable and installer

Option A — on a Windows machine (Python 3.12 64-bit + Inno Setup 6):

```powershell
cd adzak-studio
powershell -ExecutionPolicy Bypass -File scripts\build_windows.ps1
# -> output\ADZAK-Creative-Studio-Setup.exe
```

Option B — GitHub Actions: the workflow `.github/workflows/adzak-windows.yml` (at repository root) runs the tests,
builds with PyInstaller, smoke-starts the app and produces `ADZAK-Creative-Studio-Setup.exe` as a downloadable artifact.

Steps performed by the build:

1. `scripts/fetch_ffmpeg.py` downloads a pinned FFmpeg Windows build into `packaging/ffmpeg/` (SHA-256 is printed; pass
   `--sha256` to enforce a checksum).
2. `pytest` runs the test-suite against that FFmpeg.
3. `packaging/adzak.spec` (PyInstaller, onedir) creates `dist/ADZAK-Creative-Studio/`.
4. `packaging/installer.iss` (Inno Setup) wraps it into `output/ADZAK-Creative-Studio-Setup.exe`.

## Features at a glance

* **Dashboard** with recent projects, new-project wizards, drag-and-drop import, onboarding text.
* **Video Studio**: multi-track timeline (drag clips, zoom, ruler scrubbing), split, trim, speed (0.25×–4×), reverse,
  rotate, crop, brightness/contrast/saturation/exposure, opacity, chroma key, basic stabilisation, fades, volume,
  text titles, silence removal (splits clips at speech), scene-change detection, preview frames, preview proxies,
  undo/redo, project save/open, export with presets (YouTube, TikTok/Reels/Shorts, Instagram square and 4:5,
  H.264 / H.265 / VP9, up to 4K).
* **Photo & Design**: layers (raster, text, shape, adjustment), brush and eraser, rectangular selection, crop, rotate,
  canvas resize, curves/brightness/contrast/saturation/hue, filters, text outline and shadow, background removal
  (GrabCut, box-guided), object removal (inpainting), layer masks, before/after view, undo/redo, project save (`.adzimg`),
  export to PNG, JPG, WebP, BMP, TIFF and PDF with quality and size options. Design templates (preset sizes, not yet covered by tests): YouTube thumbnail,
  channel banner, Instagram post/story, A4 poster, A5 flyer, T-shirt print (transparent), logo, product image.
* **Media Converter**: video, audio and image conversion, video and image compression, batch resize, batch rename with
  preview, GIF from video or images, frame extraction, thumbnails, SRT ↔ VTT subtitle conversion with timing shift,
  metadata viewer, file size estimate, export-preset JSON download.
* **Audio Studio**: waveform view, trim, merge, loudness normalisation (EBU R128 target), noise reduction, bass/treble,
  volume, fades, audio extraction from video.
* **AI Assistant**: works **offline** (how-to answers, title/hashtag/script/prompt generators, export advice). An optional
  OpenAI-compatible endpoint can be configured with your own key. A "What runs where" table labels every feature as
  local, paid API, or not available.
* **Settings**: language (English, French, Spanish, Arabic with right-to-left layout), dark/light theme, low-memory mode,
  render threads, hardware-encoder option, cache limit, autosave interval, AI provider.
* **Reliability**: autosave to a recovery file and crash-recovery prompt, safe atomic writes, redacted structured logs
  (`%APPDATA%\ADZAK-Creative-Studio\logs\adzak.log`), clear error messages, cancellable background jobs with progress.

## Known limitations (important)

* No real-time video playback: the preview shows the frame at the playhead (refresh with the button or by moving the
  playhead). Frame-accurate scrubbing on large 4K footage is slow on integrated graphics.
* No keyframe animation, no transitions other than fades, no AI image/video generation, no speech-to-text or automatic
  captions, no text-to-speech, no voice recording. These are listed as **not available** in the app (not faked).
* SVG export is not available for raster designs.
* Background removal is a rectangle-guided GrabCut; it needs a clear subject/background contrast and manual review.
* Stabilisation uses FFmpeg's basic `deshake` filter.

Details and test results: [docs/FEATURES.md](docs/FEATURES.md). Licences: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Project layout

```
adzak-studio/
├── adzak/
│   ├── core/        paths, logging+redaction, FFmpeg runner, SQLite DB, secrets, history, projects, autosave, i18n
│   ├── video/       timeline model, filtergraph renderer, presets, analysis (silence/scenes), proxies
│   ├── image/       layered document, adjustments, filters, text rendering, export
│   ├── audio/       FFmpeg audio tools and waveform peaks
│   ├── utils/       converters, batch tools, GIF, metadata, subtitles
│   ├── ai/          capability registry, offline assistant, optional OpenAI-compatible provider
│   └── ui/          PySide6 interface (main window, pages, dialogs, theme, workers)
├── tests/           pytest suite (real FFmpeg and Pillow operations)
├── packaging/       PyInstaller spec, Inno Setup script, FFmpeg fetch output folder
├── scripts/         build_windows.ps1, fetch_ffmpeg.py
└── docs/FEATURES.md
```

## Privacy and security

* API keys are read from the `ADZAK_AI_API_KEY` environment variable or the Windows Credential Manager (via `keyring`).
  They are never written to project files, the settings database or logs, and the UI never displays a saved key.
* Log messages pass through a redaction filter for `sk-…` tokens and `key=`, `token=`, `Authorization:` patterns.
* Online requests are only made when you configure a provider. Only HTTPS endpoints are accepted.
