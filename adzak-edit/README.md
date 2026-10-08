# ADZAK EDIT

A free, local-first video editor. No account, no subscription, no cloud upload.
AI runs on your machine or not at all.

> **Phase 1.** The editing engine and the full UI work in a browser. There is
> **no desktop installer yet** — `src-tauri/` is an empty directory. See
> [What is not done](#what-is-not-done) before you assume anything works.

## Run it

Requires **Node 20+** (developed on Node 22.22.3 / npm 10.9.8).

```bash
cd adzak-edit
npm ci          # install from the committed lockfile
npm run dev     # http://localhost:5173
```

Other commands:

```bash
npm test              # 206 unit + UI integration tests
npm run typecheck     # tsc --noEmit, strict mode
npm run build         # production bundle into dist/
```

All four were run from a clean `npm ci` before this README was written.

The optional end-to-end suite encodes real video and needs an FFmpeg binary:

```bash
ADZAK_FFMPEG=/path/to/ffmpeg npx vitest run --config vitest.e2e.config.ts
```

It auto-discovers FFmpeg from `ADZAK_FFMPEG` then `PATH`, and **self-skips** when
absent — so a green run without FFmpeg means "skipped", not "verified".

## What works

- Import video / audio / image / GIF, by picker or drag-and-drop
- Canvas preview player, virtualised multi-track timeline
- Split, trim, move, delete, ripple delete, full undo/redo
- Multi-track A/V, waveforms, thumbnails, text layers, keyframes, 12 effects
- Subtitles: SRT / VTT / ASS import, export and burn-in
- `.adzak` project save, load, autosave and crash recovery
- Export presets: YouTube 1080p/4K, Shorts, TikTok, Instagram reel/square,
  WebM, Archive, Custom
- AI editing assistant: natural language → validated command → your approval

## What is not done

Stated plainly, because a silent gap is worse than an admitted one.

| Gap | Reality |
| --- | --- |
| **Desktop app** | `src-tauri/` is empty. No installer, no bundled FFmpeg. Browser build only. |
| **MP4/H.264 export** | The encoder works and is tested against real FFmpeg, but there is no desktop binary to run it in. The browser build falls back to MediaRecorder — realtime, and limited to whatever codec your browser records. The export dialog says so. |
| **Transitions** | Registered in the AI toolset, returns an honest Phase-2 error. Not implemented. |
| **Auto captions** | The cue pipeline is built and tested, but Whisper has never been run here. |
| **Local LLM** | Ollama and llama.cpp providers are written against loopback endpoints; no model was available to test against. |
| **Background removal** | Not started. |
| **Performance at scale** | Everything here was tested with 1–3 clips. Nothing is benchmarked on a real project. |

## Architecture in one paragraph

`src/core/**` is pure TypeScript — no React, no zustand, no DOM, no OS calls. It
runs headlessly, which is why 206 tests need no browser and no GPU. The UI reads
and writes it. `PlatformBridge` is the only door to the operating system, and the
UI disables features from `bridge.capabilities` rather than guessing from the
environment. `buildRenderPlan` is pure and does zero I/O; FFmpeg is always
spawned with an argument vector, never a shell.

## The AI safety model

Three layers, all in `src/core/ai/`:

1. **Validation** — 23 whitelisted tools, schema + semantic checks, type coercion.
2. **Permissions** — destructive commands always ask. Off by default, and the
   toggle is buried in Settings on purpose.
3. **Execution** — the executor can only reach `EditorApi`. There is no path from
   a tool definition to the filesystem or a shell.

That last point is structural, not a promise: **the model has no verb for it.**

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module map, data flow, invariants
- [`docs/DATA_MODELS.md`](docs/DATA_MODELS.md) — every shared type
- [`docs/AI_COMMAND_SYSTEM.md`](docs/AI_COMMAND_SYSTEM.md) — the trust boundary
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phase status, honest completion state
- [`docs/RISKS.md`](docs/RISKS.md) — what can go wrong, what already did

## Rebranding

Name, monogram and accent colours live in `src/brand.ts`, mirrored in
`tailwind.config.ts`. Two files.
