# ADZAK EDIT — AI Command System

The AI layer is a **trust boundary**, not a feature. Its job is to make sure
that whatever a model says, nothing reaches the timeline until it has been
validated against a whitelist and consented to by a human.

Three layers, all in `src/core/ai/`. `src/core/ai/**` imports no store, no
filesystem and no bridge — it cannot reach the machine even if it wanted to.

```
model output (untrusted JSON)
   │
   ▼
① validate.ts     schema + semantics + type coercion
   │
   ▼
② permissions.ts  consent decision (auto / prompt / block)
   │
   ▼
③ executor.ts     dispatch to EditorApi — and only EditorApi
```

## 1. Layer one — validation (`validate.ts`)

`validateCommand(raw) → { ok, errors, normalized }`

Order matters, and the order was learned the hard way:

1. **Reject unknown `action` first.** Never validate arguments for a command we
   will not run.
2. **Strip every envelope key** — `reason` *and* `action`.
3. **Coerce types** via `coerceToSchema` (`"14.5"` → `14.5`, `"true"` → `true`).
4. **Validate semantics** with the schema's optional `validate` hook.

> **Regression note.** An earlier version destructured only `reason` before
> coercion, so `action` survived into the payload and
> `additionalProperties: false` rejected **every single command** with
> `"action" is not a recognised argument`. It passed review and was caught only
> by a test. The lesson is encoded as a test, not a comment:
> `tests/unit/aiCommands.test.ts` asserts a well-formed command validates.

Semantic limits enforced beyond the JSON schema:

| Constraint | Limit |
| --- | --- |
| Subtitle cue | `end > start`, duration ≤ 30 s, ≤ 34 chars/line |
| Crop / resize | even dimensions, no zero-area frame |
| Volume | ≤ +6 dB per command |
| `minSilenceSec` | ≥ 0.15 s |
| Text content | non-empty |

Cross-field rules that JSON Schema cannot express live in the optional
`validate` hook on `AiToolSchema` — e.g. `crop_video`'s opposing-sides limit.
`describeErrors(errors)` renders them as human sentences.

`jsonRepair.ts` handles the two things small local models get wrong constantly:
markdown fences around the JSON, and trailing commas.

## 2. Layer two — permissions (`permissions.ts`)

`decideConsent(command, settings, session) → { autoApprove, blocked, policy, reason }`

Evaluated in this exact order:

1. Unknown action → **blocked**.
2. Tool in `settings.blocked` → **blocked**.
3. Mutation while `aiEditingEnabled === false` → **blocked** (read-only still works).
4. Read-only tool → **auto-approve**.
5. `policy === 'auto'` → **auto-approve**.
6. `risk === 'destructive'` → **always prompts**, unless `autoApplyDestructive`
   (default `false`).
7. `policy === 'confirm-once'` and already granted this session → auto-approve.
8. Otherwise → prompt.

`ConsentPolicy` is `'auto' | 'confirm-once' | 'confirm-always'`, resolved per
tool from `settings.overrides[tool.name] ?? tool.defaultPolicy`. The Settings →
AI panel exposes all three per tool.

`DEFAULT_PERMISSIONS.maxCommandsPerPlan = 24` — a hard cap so a confused model
cannot flood the timeline.

Verified behaviour (`decideConsent`, run directly):

```
split_clip      {autoApprove:false, policy:"confirm-once",   reason:"This changes your timeline. Undo (Ctrl+Z) restores it."}
remove_silence  {autoApprove:false, policy:"confirm-always", reason:"This change removes material from your timeline. Destructive commands always ask."}
```

## 3. Layer three — execution (`executor.ts`)

`executeCommand` **re-validates even when the caller already did.** The executor
never trusts a flag from upstream.

`executePlan` stops at the **first declined step** — it does not skip and
continue. `tests/unit/aiCommands.test.ts` asserts `api.calls === ['splitClip']`
for exactly this case.

Destructive tools (verified from the registry): `delete_clip`, `remove_silence`,
`export_video`.

## 4. The whitelist — 23 tools

**Read-only (5):** `get_project`, `get_timeline`, `get_selected_clip`,
`get_clip`, `search_media`.

**Mutating (18):** `split_clip`, `trim_clip`, `move_clip`, `delete_clip` ⚠,
`add_text`, `add_subtitle`, `change_speed`, `reverse_clip`, `crop_video`,
`resize_video`, `add_transition`, `add_effect`, `set_volume`, `set_keyframe`,
`remove_silence` ⚠, `create_sequence`, `export_video` ⚠, `transcribe_clip`.

⚠ = `destructive`, always prompts.

`toolManifestForPrompt()` renders this list into the system prompt, so the model
is told the vocabulary rather than invited to invent one.

> `add_transition` is registered but **not implemented** in the render plan.
> `editorApi.addTransition` returns an honest Phase-2 error rather than
> pretending to succeed.

## 5. `EditorApi` — the only surface the executor can touch

`src/core/ai/editorApi.ts` defines the interface; `src/ui/store/editorApi.ts`
adapts the zustand store to it. The executor holds an `EditorApi` reference and
nothing else. There is no path from a tool definition to `useEditor`, to the
filesystem, or to `getBridge()`.

This is what makes "never execute arbitrary shell commands generated by an LLM"
structurally true rather than a promise: **the model has no verb for it.**

## 6. Planning

`EditingAgent.createPlan(goal) → { plan, source }` where
`source: 'local-model' | 'offline-rules'`.

**Providers are local-only by construction:**

| Provider | Endpoint | Notes |
| --- | --- | --- |
| Ollama | `127.0.0.1:11434/api/generate` | `format: 'json'` |
| llama.cpp | `127.0.0.1:8080/v1/chat/completions` | `response_format: {type:'json_object'}` |

Both declare `requiresInternet = false`. There is no cloud provider and no code
path to one.

**On any provider failure the agent emits `onProgress` and falls back to the
offline planner rather than erroring.** The AI panel labels which source produced
a plan, so the user is never misled about whether a model was involved.

### The offline planner (`planner.ts`)

Keyword matching over 12 intents, plus a `(\d+)\s*sec` duration regex:

`split_clip`, `make_short`, `remove_silence`, `add_captions`, `find_highlights`,
`improve_audio`, `normalize_audio`, `resize_vertical`, `resize_square`,
`translate_subtitles`, `speed_up`, `add_title`.

Longer matched phrases score higher confidence. `buildOfflinePlan` resolves the
`PRIMARY_CLIP` sentinel to the first clip on the first populated video track and
**drops any step whose target cannot be resolved** — a plan never contains a
dangling clip id. Missing Whisper or LLM prerequisites become explicit
`warnings`, surfaced in the panel.

> `split_clip` was added after a UI integration test showed
> "split the clip at 5 seconds" fell through to `get_project` alone. Split is
> the most basic editing verb; the planner should not have been missing it.

### Honesty about silence removal

The planner emits `remove_silence` with `dryRun: true`. The agent proposes an
**analysis for review**; it never deletes material on its own authority. This is
asserted by `tests/unit/appShell.test.tsx`, which approves the consent request
and then verifies the clip count is unchanged.

## 7. Test coverage

`tests/unit/aiCommands.test.ts` — 52 tests covering: valid commands, every
invalid-command class, coercion, the envelope-stripping regression, permission
ordering, per-tool overrides, blocked tools, `maxCommandsPerPlan`, plan
execution stopping at a decline, and offline planner intent resolution.

`tests/unit/appShell.test.tsx` — drives the real AI panel end to end: a
natural-language request produces a plan, the plan pauses for consent, approving
it applies the edit, and `confirm-once` is remembered for the session.

## 8. What this system cannot do

Stated so nobody has to discover it:

- No free-form command invention. Anything outside the 23 tools is rejected
  before execution, not during.
- No file access. No tool reads or writes paths.
- No shell. No tool spawns a process.
- No network. Providers are loopback-only and optional.
- No silent destruction. `destructive` risk always prompts by default.
