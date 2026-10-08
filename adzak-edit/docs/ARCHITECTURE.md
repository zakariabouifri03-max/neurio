# ADZAK EDIT — Architecture

> Status: Phase 1 complete and running; Phase 2 partially landed.
> Every claim in this document is verifiable against the source paths given.

## 1. The one rule

**`src/core/**` never imports React, zustand, the DOM, or the OS.** It is pure
TypeScript: data in, data out. The UI reads and writes it; the platform bridge
executes it. That single constraint is what makes the whole system testable in a
plain Node process — 206 of the project's tests run with no browser, no FFmpeg
and no GPU.

```
┌────────────────────────────────────────────────────────────┐
│  src/ui/**          React + zustand. Presentation only.     │
│                     No FFmpeg strings, no OS calls.         │
├────────────────────────────────────────────────────────────┤
│  src/core/**        Pure engine. Timeline maths, effects,   │
│                     audio chain, subtitles, project I/O,    │
│                     AI trust boundary, render plan.         │
├────────────────────────────────────────────────────────────┤
│  src/core/bridge/** PlatformBridge — the ONLY door to the OS│
│                     webBridge (browser) | tauriBridge (app) │
├────────────────────────────────────────────────────────────┤
│  src-tauri/**       Rust executor. INTENDED to be thin: it  │
│                     runs the plan core/ produced, it does   │
│                     not decide it. **Directory is empty —   │
│                     no Rust has been written yet.**         │
└────────────────────────────────────────────────────────────┘
```

There is **no ESLint config in this repository**, so the rule is not machine-
enforced. What does enforce it: `npx vitest run` executes `src/core/**` in a
`node` environment with no DOM available, so a stray `document.` or React import
fails the suite. Adding a lint rule is on the roadmap.

## 2. Module map

| Path | Files | Lines | Responsibility |
| --- | --- | --- | --- |
| `src/core/types/` | 10 | 1157 | Every shared shape. No behaviour. |
| `src/core/timeline/` | 5 | 1250 | Pure timeline operations, snapping, history. |
| `src/core/effects/` | 4 | 576 | Effect definitions → neutral `FilterSpec`. |
| `src/core/audio/` | 1 | 201 | Audio filter chain, silence detection, gain. |
| `src/core/subtitles/` | 2 | 483 | The only SRT/VTT/ASS parser + serialiser. |
| `src/core/project/` | 2 | 262 | `.adzak` read/write/repair/migrate. |
| `src/core/ai/` | 11 | 2163 | Schema, validation, permissions, executor, planner, agent, providers. |
| `src/core/bridge/` | 5 | 1122 | Platform abstraction + browser and Tauri implementations. |
| `src/core/render/` | 2 | 556 | Canvas compositor (shared by preview and export) + browser export. |
| `src/core/export/` | 2 | 661 | Presets + pure render plan → FFmpeg argument vector. |
| `src/ui/store/` | 5 | 1716 | zustand stores + the `EditorApi` adapter. |
| `src/ui/panels/` | 7 | 3313 | Media, Preview, Timeline, Inspector, AI, Export, Settings. |
| `src/ui/components/` | 3 | 618 | Icons, Toolbar, Toasts. |
| `src/utils/` | 2 | 294 | FFmpeg argument escaping and probe parsing. |

Total: **65 TypeScript files, 14,874 lines.** Largest files, measured with
`wc -l`: `ui/store/editorStore.ts` 756, `ui/panels/TimelinePanel.tsx` 713,
`ui/panels/InspectorPanel.tsx` 637, `ui/panels/ExportDialog.tsx` 624,
`core/timeline/operations.ts` 597. Nothing exceeds 800 lines.

## 3. Data flow for the three things that matter

### 3.1 An edit

```
user drags a clip
  → TimelinePanel.onMove (pixels → seconds via zoomPxPerSec)
  → snapTime(desired, collectSnapTargets(...))
  → useEditor.moveSelected(start)
  → core/timeline/operations.moveClip(sequence, ...)   ← PURE
  → history.push(nextSequence, 'Move clip')
  → setState({ project: { ...project, sequence: next }, dirty: true })
  → React re-renders; PreviewPanel draws the new frame
```

Because `moveClip` is pure, **undo/redo is a stack of whole sequences**
(`core/timeline/history.ts`, `History<Sequence>`). There is no inverse-command
bookkeeping to get wrong. `pushCoalesced` collapses a ~450 ms drag into one
undo step so one gesture is one Ctrl+Z.

### 3.2 A preview frame

`core/render/compositor.ts` owns a pool of `<video>`/`<img>` elements (capped at
8, LRU-evicted) and paints the sequence to a `CanvasRenderingContext2D`. The same
class serves the live preview **and** the browser exporter, so what you see is
what you get by construction rather than by discipline.

Seek correction only fires when drift exceeds 0.18 s — re-seeking on every frame
is what makes canvas players stutter.

### 3.3 An export

```
ExportDialog → buildRenderPlan(project, settings, options)   ← PURE, zero I/O
             → RenderPlan { inputs, filterComplex, labels, outputArgs, sidecars }
             → planToArgs(plan) → string[]
             → bridge.startExport(plan, settings, onProgress)
             → Rust spawns FFmpeg with an ARGUMENT VECTOR (never a shell)
```

`buildRenderPlan` performs no I/O and touches no globals, which is why the e2e
suite can assert the exact argument vector and then hand the same vector to a
real FFmpeg binary.

## 4. The platform bridge

`PlatformBridge` (`src/core/bridge/PlatformBridge.ts`) is the only interface
between the engine and the machine. It declares `capabilities:
RuntimeCapabilities` — `ffmpeg`, `ffprobe`, `hevc`, `hardwareEncoding`,
`whisper`, `localLlm`, `segmentation`, `nativeDialogs`, `persistentStorage`,
`fileExport`.

**The UI disables features from that object, never from `import.meta.env`.**
A missing capability produces a disabled control with an explanation, not a
button that fails when clicked.

`initBridge()` picks `TauriBridge` when `__TAURI_INTERNALS__` is on `window`,
otherwise `webBridge`. Both are real:

- **webBridge** — virtual `web://` paths over `File`, HTMLMediaElement probing,
  canvas thumbnails, `decodeAudioData` waveforms, IndexedDB project storage,
  MediaRecorder export. FFmpeg-only operations throw `CapabilityError`.
- **tauriBridge** — `invoke()` wrappers over Rust commands that **do not exist
  yet**. `src-tauri/` is an empty directory. The bridge typechecks and its call
  signatures are reviewed, but it has never been executed and cannot be: there
  is no Rust toolchain in this environment and no backend to talk to.
  See `RISKS.md`.

## 5. Time

Time is a float number of **seconds** everywhere — never frames, never
milliseconds. Rasterisation happens at the edges via `snapToRaster(t, fps)` with
`TIME_EPSILON = 1/1200`.

Two coordinate systems, never confused:

- `clip.source.{in,out}` — seconds **in the original file**. Trimming moves these.
- `clip.timeline.{start,duration}` — seconds **in the sequence**.

They are linked by `timeline.duration === (source.out - source.in) / speed`.
Reversal is a boolean flag, never a negative speed, so the time maths stays
monotonic.

## 6. FFmpeg discipline

- FFmpeg is **always** spawned with an argument array. No shell, no string
  interpolation of user data into a command line.
- All escaping lives in `src/utils/ffmpegEscape.ts`; all probe parsing in
  `src/utils/ffmpegProbe.ts`.
- `core/effects/filtergraph.ts` is the **only** file that knows FFmpeg filter
  syntax. Effects themselves are data (`EffectDefinition` → neutral
  `FilterSpec`).
- The audio chain is fixed and ordered: per-clip → `aformat` →
  `amix=…:normalize=0` → `atrim=0:D` → `alimiter=limit=0.97` →
  `apad=whole_dur=D`.
- `apad` is **always** bounded (`apad=whole_dur=D` plus an output `-t D`).
  An unbounded `apad` hangs the encoder forever; this is regression-tested.

## 7. What is deliberately not built yet

Stated plainly, because a silent gap is worse than an admitted one:

- **Transitions.** `add_transition` exists in the AI tool registry, and
  `editorApi.addTransition` returns an honest Phase-2 error rather than a no-op.
  The timeline panel's Transitions rail button is disabled with a tooltip.
- **Background removal.** Needs ONNX Runtime; not started.
- **GPU/hardware encoding.** The settings toggle exists and the render plan
  accepts a `hardwareEncoder`, but no hardware path has been exercised.
- **Proxy media.** `PlatformBridge.generateProxy` is declared; no caller.
- **Rust backend.** `src-tauri/` is empty. Nothing to compile. The desktop
  app therefore does not build; only the browser build runs.
- **ESLint.** No config exists. The `core/` isolation rule described in §1 is
  upheld by the test environment, not by a linter.

## 8. Branding

`src/brand.ts` holds the name, monogram, accent colours and `windowTitle()`.
`tailwind.config.ts` mirrors the palette. Renaming the product is a two-file
change; no component hardcodes the name.
