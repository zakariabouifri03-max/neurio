# NEXUS VIDEO STUDIO

**Edit your videos by simply telling the AI what you want.**

NEXUS is an offline-first timeline editor with a Tauri 2 / Rust desktop shell, a local project model, local command tools, and an FFmpeg render backend. There are no OpenAI, Gemini, Claude, transcription, or cloud-render API calls. The browser preview is also usable for project editing; native rendering, analysis, model execution, and MP4 export are deliberately reported unavailable unless their local desktop tools are present.

## What is implemented in this repository

- A professional dark editing workspace with a project bin, program preview, assistant, multi-track timeline, playhead, zoom, track visibility/mute, clip selection, drag-to-place, drag-to-move, edge trimming, splitting, deleting, and frame stepping.
- A typed, non-destructive project model (`.nexusvideo`) with asset references, clips, source in/out points, transforms, volume, effects, keyframes, local analysis cache, bounded undo/redo, and version snapshots. Original media files are not rewritten.
- Browser-local project autosave and IndexedDB media caching; desktop project files reference source files instead of copying large footage into the project.
- An allowlisted natural-language tool layer for concrete edits: trim the beginning/end, split, move, change aspect ratio, set clip audio level, normalize, generate captions, and attach speech-linked zoom keyframes. Specific deterministic commands work without an LLM. Unrecognized/semantic requests are sent only to a configured local GGUF model; model output is JSON-validated against the tool allowlist and is always reviewed before application.
- Local FFmpeg analysis commands for silence and scene cuts; Whisper.cpp transcription for timestamped captions and speech-linked zooms when a local model/runtime is configured.
- Rust/FFmpeg export to H.264/H.265 MP4, including clip timing, video layers, embedded/separate audio mixes, volume, loudness normalization, portrait/landscape center crop, captions, progress events, and useful FFmpeg diagnostics.
- AI Model Manager with model/runtime status, optional model downloads, local file selection, and explicit “Local AI model required” states. Vision/person detection is intentionally marked unavailable in this build rather than simulated.
- A Windows NSIS installer build workflow.

## Important capability boundaries

This is a functional first desktop slice, not a claim that every item in the full studio brief has shipped. The following are not implemented in this build: semantic highlight scoring, face/person tracking or smart reframing, word-level animated emphasis, voice/music separation, noise reduction, transitions, GPU tuning, and a bundled vision model. Portrait conversion currently uses an explicit center crop unless a future local subject-tracking adapter is installed. “Interesting/boring” selection is not guessed: without a ready local LLM it reports **Local AI model required**.

## Example workflows

- **“Remove the first 4 seconds.”** Applies an exact ripple cut to unlocked timeline tracks; undo restores the original edit.
- **“Remove pauses longer than 1.5 seconds.”** Uses local FFmpeg silence detection and stages the real detected ranges for review. Requires the Windows desktop app and FFmpeg.
- **“Add captions.”** Uses timestamped local Whisper transcription and adds caption clips to the timeline. Requires an installed Whisper model and `whisper-cli`; otherwise the assistant says **Local AI model required** and does not invent subtitle text.
- **“Make a 30-second vertical Short.”** Sets a 9:16 sequence and keeps the opening section up to 30 seconds; it does not speed up or duplicate footage. If Whisper is available, the Short workflow can also produce real captions.
- **“Remove the boring parts.”** Reports that local vision analysis is unavailable in this build. A language model cannot inspect the footage, so no content-based cuts are fabricated.

The source repository does not commit large third-party executables. The Windows installer workflow downloads FFmpeg/FFprobe at build time and bundles both binaries plus the upstream license/provenance notice into the NSIS installer. It also embeds Microsoft's offline WebView2 installer, so the standalone setup `.exe` can install the editor without an internet connection and the installed editor can render MP4 offline without a separate FFmpeg install. Whisper captions require an optional local model and `whisper-cli`; semantic commands require an optional GGUF model and `llama-cli`. Model downloads are user-initiated and are not required for basic editing, project saving, or bundled FFmpeg export. No cloud inference is used. Review the upstream FFmpeg build/license terms before redistributing a custom installer.

## Run the browser workspace

Requires Node.js 20+ and npm:

```bash
npm install
npm run dev
```

Open the local Vite URL. The browser build supports media import, playback, timeline edits, undo/redo, project autosave, and project-file download. It does **not** pretend to have desktop FFmpeg, local executable access, or MP4 export. Use the Windows desktop build for those capabilities.

Run project-model tests:

```bash
npm test
```

## Build the Windows desktop app

On Windows 10/11, install the Microsoft C++ Build Tools, WebView2 runtime, Node.js 20+, and the stable Rust MSVC toolchain. Then:

```powershell
npm install
.\tools\prepare-windows.ps1
npm run tauri:dev
npm run tauri:build
```

Tauri produces an NSIS setup executable under:

```text
src-tauri/target/release/bundle/nsis/
```

The repository includes a Windows GitHub Actions workflow that builds the installer, stores it as a run artifact, and publishes a GitHub prerelease asset with a direct download URL. This Linux coding environment does not contain Rust, a Windows toolchain, or FFmpeg, so it cannot emit or validate a Windows `.exe` locally.

## Local engine setup

1. The Windows installer bundles FFmpeg/FFprobe. For development, run `tools/prepare-windows.ps1`; alternatively make both binaries available on PATH or choose `ffmpeg.exe` from **AI Model Manager → Locate FFmpeg**. Native media probing, silence/scene analysis, Whisper audio preparation, and MP4 export use these local binaries.
2. For speech recognition, install the Whisper.cpp Windows CLI (`whisper-cli.exe`), choose it under **Speech to text → Locate**, then select or download a compatible Whisper `.bin` model.
3. For semantic commands, install the llama.cpp CLI (`llama-cli.exe`), choose it under **Local language model → Locate**, then select or download a local GGUF model.
4. Restart/refresh the status panel. Model and runtime status are detected from actual files; missing tools remain unavailable.

Optional model downloads are allowlisted and save under the application's local data folder. They use public model-hosting download URLs only for setup; inference and editing remain local. Verify model license/size before installing. Downloads are user-initiated.

## Project format

`.nexusvideo` is UTF-8 JSON. It stores sequence settings, source references, timeline tracks, clip edits, captions, effects, keyframes, analysis results, and version snapshots. It does not package source video/audio. Move or rename source files only after relinking them in the project.

## Repository layout

```text
src/studio.js                 UI, player, timeline interaction, dialogs
src/editor/project.js         project/clip model and non-destructive operations
src/editor/commands.js        local intent parsing and registered editing tools
src/editor/local-ai-engine.js LLM boundary and tool-plan validation
src/editor/platform.js        browser/Tauri adapter and file/media bridge
src/editor/store.js           bounded undo/redo and project history
src/editor/storage.js         IndexedDB media cache and local project autosave
src-tauri/src/lib.rs          Rust filesystem, FFmpeg, Whisper and local LLM commands
src-tauri/tauri.conf.json     Tauri 2 Windows app and NSIS bundle
.github/workflows/windows.yml Windows installer CI build
```
