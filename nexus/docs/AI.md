# The NEXUS AI Agent

The AI layer is built on **structured tool calls**, not text generation. An LLM
(when configured) chooses tools; the tools do real work through the same engine
ops the editor uses. Without an LLM, a deterministic planner handles the common
requests — the examples below always work.

## Chat examples (all real)

| You say | What happens |
|---|---|
| "Create a third-person player" | plan → `create_game_object` "Player" with ThirdPersonController + CharacterBody + Collider + RigidBody + Health + Inventory, tagged `player`, camera wiring, animation hooks |
| "Add a zombie enemy" | plan → NPC object (states, detection, chase/attack params, loot) + Collider/RigidBody + **prefab asset** for spawners |
| "Make zombies spawn at night" | ensures DayNightCycle, finds/creates the enemy prefab, adds a **Spawner (mode: night)**; if no enemy exists yet it says so honestly |
| "The player cannot jump" | routes to the **AI debugger**: inspects the player's controller/collider/rigidbody → diagnosis cards → Apply Fix → automated playtest |
| "Build the project" | runs the real build pipeline via the editor context, streams the log |

## Tools (AIAgent/tools.ts)

Objects & scenes: `create_game_object`, `delete_game_object`, `modify_component`,
`add_component`, `remove_component`, `set_transform`, `create_scene`,
`modify_scene` (environment: sky, fog, sun, ambient), `list_objects`,
`find_object`.

Assets & scripts: `create_script` (with sensible default sources),
`modify_script`, `read_script`, `create_material` (PBR), `assign_material`,
`create_prefab`, `inspect_asset`.

Run & debug: `run_game`, `stop_game`, `read_console`, `read_errors`,
`build_project`, `run_playtest` (seconds → passed/frames/errors/failures).

Each tool returns `{ ok, summary, details? }`. Tools never prompt the user;
review gates are handled by the agent (below).

## Deterministic planner (AIAgent/planner.ts)

`planFromText` maps requests to intents (`create-player`, `create-npc`,
`night-spawn`, `create-world`, `create-ui`, `create-gameplay`, `add-light`,
`create-material`, `build`, `debug`, …). Each intent builds a `Plan`:

```
Plan { title, intro, steps: PlanStep[], review?: string[] }
PlanStep { id, label, section?, run(ctx), when(ctx)? }
```

`Agent.executePlan`:
1. emits a `plan` event (the AI panel renders the checklist),
2. **safety review**: destructive plans (delete/modify-script) or ≥8 steps emit a
   `review` event and wait for the user to click **Apply**,
3. `pushUndo(plan.title)` once, then executes steps (skipping `when`-guarded
   ones), emitting `plan-step` progress,
4. refreshes project memory and marks the project dirty.

Unknown requests return `intent: 'unknown'` with no fake plan; with an LLM
configured they fall through to `llmToolLoop`, otherwise the agent says what it
can do.

## Project memory (AIAgent/memory.ts)

The agent never sends the whole project. `refreshMemory(reason)` builds a compact
index: scenes and object counts, component inventory, assets (types, humanoid
flags), scripts (names + @prop signatures), gameplay systems detected (spawners,
checkpoints, save system…), recent console errors, and remembered bugs.
`retrieveMemory(query)` returns only the relevant slices for a given request.
LLM prompts include the memory digest, not the project JSON.

## AI debugger (AIAgent/debugger.ts)

Two entry points:

- `diagnoseProblem(problem)` — script errors: reads the script, locates the line,
  classifies (undefined property, typo, wrong API, null access), proposes a
  concrete patch.
- `diagnoseGameplayBug(report)` — behavior bugs: inspects the player's controller
  (jump force zero? ground check broken?), physics components (missing RigidBody/
  Collider?), camera setup, input conflicts.

Both return `Diagnosis` objects:

```ts
{ title, cause, solution, filesAffected, severity,
  apply(): ToolResult,        // the actual fix via tools
  testPlan?: { seconds, assertions } }  // verify by playtest
```

The AI panel renders diagnosis cards; **Apply Fix** runs `apply()` then the
editor runs the playtest and reports pass/fail in the conversation.

## LLM providers (Server + AIAgent/llm.ts)

Configure via **AI → AI Settings**: provider (`openai` | `anthropic` |
`custom`), base URL (for OpenAI-compatible servers: Ollama
`http://localhost:11434/v1`, LM Studio, vLLM…), API key, model.

The key is stored in `Server/config.json` (gitignored). Requests are proxied by
the server (`POST /api/ai/llm`) — the browser never holds the key. Anthropic
responses are normalized to OpenAI-style `tool_calls` so the agent loop is
provider-agnostic.

`llmToolLoop(messages, tools)` runs up to N rounds: model → tool_calls →
execute tools → feed results back → final answer. Every step is streamed to the
AI panel as `tool` events, so you always see exactly what the agent did.

## Asset assistant (Editor/ai-bridge.ts)

Importing a GLB triggers analysis (meshes, skinned meshes, animations,
**humanoid detection**, height). The Assets panel then offers one-click setups:

- **Player** — ThirdPersonController + capsule collider + locked rigidbody +
  Health, tagged `player`
- **NPC / Enemy** — NPC component (preset by role) + collider + rigidbody +
  Animator if animations exist, tagged `npc`/`enemy`

Dragging a model into the viewport drops it at the cursor with a collider
(humanoids get a CharacterBody). Dragging onto a hierarchy row parents it there.
Audio assets drop as AudioSources.
