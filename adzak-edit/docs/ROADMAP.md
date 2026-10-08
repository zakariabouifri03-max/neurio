# ADZAK EDIT — Roadmap

Phases as the product owner defined them, with an honest completion state for
each line. **Nothing here is marked done that has not been run.**

Legend: ✅ implemented and tested · 🟡 partial · ⬜ not started · ⛔ blocked in
this environment

---

## Phase 1 — Desktop shell and the core edit loop

| Item | State | Evidence |
| --- | --- | --- |
| Main UI shell (toolbar, rail, panels, status bar) | ✅ | `src/App.tsx`, mounts in `tests/unit/appShell.test.tsx` |
| Import media (file picker + drag-and-drop) | ✅ | `editorStore.importFiles` / `importPaths`; tested via `webBridge.register` |
| Media browser with thumbnails + probe state | ✅ | `MediaPanel.tsx` |
| Preview player | ✅ | `PreviewPanel.tsx` + `core/render/compositor.ts` |
| Timeline with virtualised clip rendering | ✅ | `TimelinePanel.tsx`, `visibleClips` viewport filter |
| Clip movement, trim, split, delete, ripple delete | ✅ | `core/timeline/operations.ts`, 35 timeline tests |
| Undo / redo | ✅ | `History<Sequence>`, exercised through the toolbar in the UI tests |
| Project save / load (`.adzak`) | ✅ | round-trip test: save → new → reload → 2 clips restored |
| Autosave + crash recovery | ✅ | interval + `beforeunload`; recovery toast offers the newest autosave |
| Basic MP4 export | ✅ (engine) ⛔ (packaging) | 16 e2e tests encode real MP4s with FFmpeg 7.0.2. No desktop app ships it yet — `src-tauri/` is empty |
| Tauri desktop shell | ⬜ | `src-tauri/` is an empty directory; no Rust toolchain available here |

**Phase 1 is functionally complete in the browser build.** The gap is packaging:
the encoder works, there is no desktop binary to run it in.

## Phase 2 — Tracks, text, subtitles, transitions, keyframes

| Item | State | Notes |
| --- | --- | --- |
| Multi-track A/V | ✅ | add/remove/mute/solo/lock/hide per track |
| Waveforms on audio clips | ✅ | cached peak data, bucketed by `secondsPerPeak` |
| Thumbnails on video clips | ✅ | sprite sheet from the bridge |
| Text layers | ✅ | `addTextLayer`, full Inspector controls, animation presets |
| Subtitles SRT / VTT / ASS | ✅ | `core/subtitles/codecs.ts`, round-trip tested for all three |
| Burn-in subtitles | ✅ | ASS sidecar → `subtitles=` filter in the render plan |
| Effects | ✅ | 12 registered; per-clip instances, params, enable/disable, keyframed |
| Keyframes | ✅ | clip-local time; `splitClip` rebases them |
| Volume / fades / audio processing chain | ✅ | non-destructive, `AUDIO_PROCESS_FILTERS` |
| **Transitions** | ⬜ | `add_transition` is registered in the AI toolset and returns an honest Phase-2 error. Rail button is disabled with a tooltip |
| Effect presets & browser | ⬜ | effects are added one at a time from the Inspector |
| Light theme | ⬜ | the selector offers it and labels it "coming soon" |

## Phase 3 — Local AI for speech and audio

| Item | State | Notes |
| --- | --- | --- |
| Whisper transcription | 🟡 | `PlatformBridge.transcribe` declared; `webBridge` throws `CapabilityError`; no model has ever been run here |
| Auto captions → editable subtitle clips | 🟡 | `wordsToCues` is implemented and tested; nothing calls it with real ASR output yet |
| Word-level timestamps | ✅ (data model) | `SubtitleClipMeta.words`, survives trim/split |
| Silence removal (preview → Apply All / Cancel / Review) | 🟡 | `detectSilence` implemented and tested; the review UI is not built |
| Video highlights → editable sequence | ⬜ | planner intent exists; scoring needs a transcript |
| Audio AI: denoise / normalize / enhance | ✅ | filter chain built and asserted; "enhance-voice" is a filter preset, not a model |

## Phase 4 — The AI editing agent

| Item | State | Notes |
| --- | --- | --- |
| Natural language → structured command | ✅ | planner + providers, fallback chain tested |
| Validation of every AI command | ✅ | 52 tests |
| Consent before destructive acts | ✅ | asserted end-to-end in the UI tests |
| "Make a 45-second Short" | 🟡 | produces a plan (resize + trim + sequence); highlight *selection* needs ASR |
| Smart reframe | ⬜ | needs subject detection |
| Local LLM integration (Ollama / llama.cpp) | 🟡 | providers written, `127.0.0.1` only; no model was available to test against |

## Phase 5 — Advanced

| Item | State |
| --- | --- |
| Background removal (ONNX) | ⬜ |
| Proxy media | ⬜ (`generateProxy` declared, no caller) |
| GPU / hardware encoding | ⬜ (settings toggle + plan field exist, never exercised) |
| Advanced export (queue, chapters, multi-format) | ⬜ |
| Plugin system | ⬜ |

---

## Engineering debt, in the order it should be paid

1. **`src-tauri/` — write the Rust backend.** This is the largest single gap.
   The plan is pure and `planToArgs()` is tested, so the backend is genuinely
   thin: spawn FFmpeg with the vector, parse `-progress`, write sidecars first.
2. **ESLint config** enforcing `src/core/**` cannot import React, zustand or the
   DOM. Currently upheld only by the test environment.
3. **Silence-removal review UI.** The analysis exists; the Apply All / Cancel /
   Review-individually surface the spec requires does not.
4. **Wire `wordsToCues` to a real ASR result** so captions can be produced
   end-to-end at least once.
5. **Transitions** in the render plan (xfade), then remove the Phase-2 error.
6. **Act warnings in `AiPanel`** — the store updates React state outside `act`
   in tests. Cosmetic, but it hides real bugs.
7. **`vitest.e2e.config.ts` fixtures live in `/tmp`**, so they vanish between
   sessions. Move fixture generation into `scripts/` and have the suite build
   them if absent.

## What "done" means for the next increment

The next milestone should be: **a Windows installer that imports an MP4, cuts
it, and exports an MP4 through FFmpeg.** Everything needed for that except the
Rust backend already exists and is tested.
