# ADZAK CREATIVE STUDIO

An all-in-one desktop creative suite for **Windows 10/11 (64-bit)** that unifies
video editing, photo editing, graphic design, animation, audio work, media
conversion and AI tools in one professional dark-themed workspace.

Built with **Python 3.11+, PySide6 (Qt 6), FFmpeg, Pillow and NumPy**.
Runs comfortably on low-end hardware (8 GB RAM, Intel UHD 620 class GPUs) with
lightweight defaults and honest, clearly-labelled feature states.

---

## What's inside

| Studio | Highlights |
|---|---|
| 🏠 Dashboard | Project manager, recent projects, autosave + crash recovery |
| 🎬 Video Editor | Multi-track timeline, split/trim/move, speed & reverse, effects (brightness/contrast/saturation/hue/rotate/chroma key/denoise/stabilize), fades, voice-over recording, real H.264/H.265 export pipeline with presets for YouTube/TikTok/Instagram, subtitle burn-in |
| 🖼 Photo Editor | Layers, brush/eraser, crop, rotate, adjustments, curves, filters, background removal, text & shapes, before/after, undo/redo |
| 🎨 Graphic Design | Templates (thumbnail, banner, posts, poster, logo), brand colour kit, PNG/JPG/PDF export |
| ✨ AI Image Studio | Provider-based generation (OpenAI-compatible APIs), honest "not configured" states, local enlarge/restore |
| 🎞 AI Video Studio | Silence removal, scene detection, clip extraction (all local FFmpeg), provider queue for generation APIs |
| 🎧 Audio Studio | Waveform view, trim, normalize, EQ, fades, tempo, silence cut, recording, format export |
| 🌀 Animation | Keyframe animation (position/scale/rotation/opacity) → animated GIF / PNG sequence |
| 🔁 Converter | Video/audio/image conversion, compression with target size, GIF maker, frame/thumbnail extraction, metadata viewers, batch rename/resize, subtitle conversion |
| 💬 Assistant | Offline knowledge base + generators (titles, hashtags, scripts, prompts, export advice); optional chat provider |

Interface languages: **English, العربية (Arabic, full RTL), Français, Español**.

See [FEATURES.md](FEATURES.md) for the complete matrix including known
limitations, and the distinction between offline and internet-dependent tools.

---

## Run from source

```bash
cd adzak-studio
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
python -m adzak
```

FFmpeg: the `imageio-ffmpeg` dependency bundles a static build automatically.
You can instead install FFmpeg system-wide (and set **Settings → FFmpeg path**)
— the app discovers it in this order: env `ADZAK_FFMPEG` → Settings path →
bundled `ffmpeg/bin` (packaged builds) → `imageio-ffmpeg` → system PATH.

## Build the Windows executable & installer

On a Windows machine with Python 3.11+:

```bat
scripts\build_windows.bat
```

The script (reproducible, no manual steps):

1. creates a virtualenv and installs pinned dependencies,
2. **runs the automated test suite** (build fails if tests fail),
3. downloads the official FFmpeg essentials build into `ffmpeg\bin`,
4. builds `dist\AdzakCreativeStudio\AdzakCreativeStudio.exe` with PyInstaller,
5. compiles `ADZAK-Creative-Studio-Setup.exe` with Inno Setup if installed
   (free: https://jrsoftware.org/isinfo.php).

The installer is per-user (**no administrator rights required**) and ships
English, Arabic, French and Spanish setup languages.

> Note: Windows `.exe` artifacts must be built on Windows — PyInstaller does
> not cross-compile from Linux/macOS. The CI-ready scripts above are the
> single source of truth for the build.

## Run the tests

```bash
pip install -r requirements-dev.txt
python -m pytest tests -v
```

The suite covers the settings store, i18n (all 4 languages), undo/redo,
project save/open/autosave/recovery, the timeline model, export presets,
subtitles, background jobs, image ops, and — with FFmpeg present — real
encodes: conversion, compression, GIF creation, audio normalisation/EQ/
silence-removal, and full timeline renders (speed changes, gaps, subtitle
burn-in). UI smoke tests boot the real main window offscreen.

Latest results: see `tests/RESULTS.md`.

## Data & privacy

- Settings, project catalogue and logs live under
  `%LOCALAPPDATA%\AdzakCreativeStudio` — never in protected system folders.
- API keys are stored **encrypted with Windows DPAPI** (obfuscated fallback on
  other OSes), never hardcoded, never written to logs (log redaction included).
- Nothing phones home. Internet is only used when *you* call a provider API.

## Project layout

```
adzak-studio/
├── src/adzak/
│   ├── core/       # Qt-free foundation: settings, i18n, projects, ffmpeg, jobs, undo
│   ├── services/   # timeline, exporter, converter, image/audio ops, subtitles, presets
│   ├── ai/         # capability registry, provider clients, secure key store, assistant
│   ├── ui/         # PySide6: main window + one panel per studio + custom widgets
│   └── resources/  # bundled original design templates (JSON)
├── tests/          # 91 automated tests (unit + FFmpeg integration + UI smoke)
├── scripts/        # build_windows.bat, adzak.spec, Inno Setup .iss, ffmpeg fetch
├── README.md · FEATURES.md · LICENSES.md
```
