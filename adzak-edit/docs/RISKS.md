# ADZAK EDIT — Technical Risks

Each entry: what can go wrong, what has actually been observed, and the
mitigation in place or planned. "Observed" means it happened in this repository,
not that it is theoretical.

---

## R1 — The desktop app does not exist ⛔ highest severity

**Risk.** The product is specified as a Windows desktop editor. `src-tauri/` is
an empty directory. There is no installer, no FFmpeg bundling, no native file
dialog, no SQLite.

**Observed.** `find src-tauri -type f` returns nothing. `rustc` and `cargo` are
absent from this environment and `static.rust-lang.org` is unreachable
(SSL_ERROR_SYSCALL), so the backend could not be written *and* verified here.

**Mitigation.**
- The whole engine is platform-independent and tested headlessly (206 tests).
- `buildRenderPlan` is pure and `planToArgs()` is asserted against exact vectors,
  so the Rust side is a thin executor rather than a second implementation.
- `PlatformBridge.capabilities` means the UI degrades to disabled-with-reason
  instead of broken.

**Residual.** Until the backend ships, MP4/H.264 export is unavailable to real
users. The browser build falls back to MediaRecorder, which is realtime and
codec-limited. The export dialog says so in plain language rather than implying
an encoder it does not have.

---

## R2 — Whisper and local LLMs have never been run

**Risk.** Three headline features (auto captions, silence-driven highlights, the
free-form AI agent) depend on models that were never available here.

**Observed.** No model files, no Ollama, no ONNX Runtime. `webBridge.transcribe`
throws `CapabilityError`. The providers are written against documented endpoints
but have only been exercised in their failure path.

**Mitigation.**
- The offline planner means the AI panel is useful with zero setup, and the panel
  labels which source produced a plan.
- `wordsToCues` is implemented and unit-tested, so the caption pipeline has a
  verified downstream.
- The agent **falls back to the offline planner on any provider failure** instead
  of erroring, so a dead endpoint degrades rather than blocks.

**Residual.** Word error rates, latency and memory for Whisper on a mid-range
Windows machine are unknown. Caption quality claims cannot be made yet.

---

## R3 — Canvas preview diverging from FFmpeg output

**Risk.** The preview is a canvas compositor; the export is FFmpeg. Colour,
filter semantics and text layout can differ.

**Observed.** Effects declare `previewable: boolean`. Non-previewable effects are
labelled "applied at export" in the Inspector rather than silently showing
nothing — but that is a disclosure, not a fix.

**Mitigation.** One `CanvasCompositor` class serves both preview and browser
export, so at least those two agree. The e2e suite extracts a real frame from an
encoded MP4 and checks pixel values.

**Residual.** Text metrics between canvas and libass will differ. This needs a
side-by-side comparison harness, which does not exist.

---

## R4 — Unbounded FFmpeg operations hang forever

**Risk.** A filter that pads or loops without a bound never terminates. The
encoder sits at 100% CPU producing nothing.

**Observed — this actually happened.** An unbounded `apad` hung an export for
the full 300 s test timeout. Fixed to `apad=whole_dur=<D>` plus an output `-t <D>`.

**Mitigation.** Both audio paths are bounded and `tests/e2e/ffmpegExport.test.ts`
regresses it. Every encoder invocation in tests is wrapped in `timeout <n>`.

**Residual.** Any new filter must be reviewed for the same property. This is a
class of bug, not a single bug.

---

## R5 — FFmpeg argument construction

**Risk.** Path or text injection into a command line.

**Mitigation.** FFmpeg is **always** spawned with an argument array — never a
shell. All escaping is centralised in `src/utils/ffmpegEscape.ts` and tested. The
AI layer has no tool that touches a path at all, so a model cannot influence the
command line even indirectly.

**Residual.** Low. The invariant depends on the Rust backend also using an
argument vector — which cannot be verified until R1 is resolved.

---

## R6 — AI validation silently rejecting everything

**Risk.** A schema validator that is too strict fails every command, and because
the failure looks like "the model is bad", it goes unnoticed.

**Observed — this actually happened.** `validate.ts` stripped `reason` but not
`action`, so `additionalProperties: false` rejected **every single AI command**
with `"action" is not a recognised argument`. It survived code review.

**Mitigation.** `tests/unit/aiCommands.test.ts` now asserts that a well-formed
command validates. The general rule: **any schema-validated payload must strip
all envelope keys**, and a positive test must exist alongside the negative ones.

**Residual.** Low, but the pattern recurs whenever a new envelope field is added.

---

## R7 — UI state that typechecks but crashes at runtime

**Risk.** TypeScript cannot catch hook-order violations, and Vite's esbuild
strips types without checking them, so `vite dev` will happily serve a component
that throws on first render.

**Observed — this actually happened.** `ExportDialog` had a `useMemo` below
`if (!dialogOpen) return null`. `tsc --noEmit` was clean. The component threw
"Rendered more hooks than during the previous render" the moment the dialog
opened. Only a jsdom mount caught it.

**Mitigation.** `tests/unit/appShell.test.tsx` mounts the real `<App />` and
drives import → timeline → undo → export dialog → AI consent → project
round-trip. Thirteen tests, all passing.

**Residual.** Coverage is one happy path per surface. There is no visual
regression testing and no E2E browser automation.

---

## R8 — Performance at real project scale

**Risk.** Everything here has been tested with 1–3 clips. A two-hour
multi-cam timeline is a different problem.

**Mitigation in place.** Timeline virtualisation (`visibleClips`), cached
thumbnails and waveforms, an 8-element LRU media pool, seek correction only
above 0.18 s drift, coalesced history so a drag is one undo step, and export
progress on a separate store so the timeline does not re-render per tick.

**Residual.** **Unverified.** No large-file or many-clip benchmark exists. The
`History<Sequence>` design stores whole sequences per step, capped at 200 — on a
large timeline that is real memory and has not been measured.

---

## R9 — Missing and moved media

**Risk.** A project references absolute paths. Move the project, lose the media.

**Mitigation.** `asset.isMissing` is a state, not an exception. Projects load
with warnings, offline clips render as such, and the Media panel offers Relink.
`buildRenderPlan` receives `resolveAssetPath` and records a warning rather than
throwing.

**Residual.** No relative-path or search-by-filename resolution yet.

---

## R10 — Browser export is not an encoder

**Risk.** Users expect MP4/H.264. MediaRecorder gives whatever the browser
supports, in realtime, with no quality control.

**Mitigation.** The export dialog states this explicitly, including that a
N-second timeline takes about N seconds. `pickMimeType` picks the best available
codec and the container follows it.

**Residual.** Acceptable as a stopgap only. R1 is the real fix.

---

## R11 — Environment-specific test fixtures

**Risk.** The e2e suite depends on an FFmpeg binary and fixtures that live in
`/tmp` and are not persisted.

**Observed.** Both were re-derived this session: `pip download imageio-ffmpeg`
for the binary, `ffmpeg -f lavfi` for `A.mp4`/`B.mp4`/`C.png`.

**Mitigation.** The suite auto-discovers the binary (`ADZAK_FFMPEG` →
`/tmp/iff/...` → `PATH`) and **self-skips** when absent, so CI does not produce
false greens or false reds.

**Residual.** A skipped suite reports success. Fixture generation should move
into `scripts/` so the suite can build them itself.

---

## Priority order

1. **R1** — write and compile the Rust backend. Everything else is downstream.
2. **R7** — broaden UI integration coverage before more UI is added.
3. **R2** — run Whisper once, end to end, and stop guessing about captions.
4. **R8** — benchmark on a real project before claiming performance.
5. **R3** — build the preview-vs-export comparison harness.
