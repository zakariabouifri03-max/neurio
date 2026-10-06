# AI assistant

The assistant lives in the editor's right dock. It turns a plain-language request into a **plan of
concrete actions**, shows the files and components each action touches, and only changes the project
after you press **Apply**. Everything it does is reversible with a single **Revert**.

## Model

```
prompt ──► AiAssistant::Plan ──► AiPlan { summary, actions[], filesAffected[] }
                                     │
                                     ├─ preview:  "AI ACTION 1/4  CreateObject  CrateA"
                                     │            "Scene Objects · Assets/Scenes/Main.nfscene"
                                     ├─ Apply    → executes through EditorContext (undo-aware)
                                     └─ Revert   → restores the pre-apply snapshot
```

Actions are whitelisted engine operations - the assistant can never invent a code path:

| Action | Effect |
|---|---|
| `CreateObject`, `CreatePrimitive` | new empty/box/sphere/cylinder/cone/plane object |
| `CreateGround`, `CreateLight`, `CreateCamera` | the matching `SceneFactory` creation |
| `CreatePlayer`, `CreateNpc` | player with controller + collider + health **or** an NPC with AI and health |
| `AddComponent`, `SetProperty` | add a component / set one typed property (validated against the registry) |
| `CreateScript`, `AttachBehaviour` | write a real `.nfscript` file and attach it to an object |
| `CreateScene` | create and register a new scene file |
| `MoveObject`, `SetEnvironment` | transform / environment (gravity, fog, ambient) changes |
| `ImportAsset` | run the real mesh/texture importer |
| `DeleteObject` | **destructive** - requires the explicit confirmation dialog |
| `Explain` | answer-only step, changes nothing |

## Two planners, one contract

1. **Offline rule planner (default).** A deterministic intent parser maps requests such as
   *"create a player with 150 health and add three patrolling guards"*, *"make the sun brighter"*,
   *"add a rotating crate script"* to the actions above. It needs no network and always works.
2. **OpenAI-compatible backend (optional).** If `Settings/ai.json` has `enabled: true` with an
   endpoint, model and key, the prompt (plus a compact scene summary) is sent to that endpoint and
   the JSON reply is validated and converted into the same `AiPlan` structure.

If the network request fails, times out, or returns something that does not validate, the assistant
falls back to the offline planner and says so in the panel. It never fabricates a result.

## Configuration - `Settings/ai.json`

```json
{
  "enabled": false,
  "provider": "openai-compatible",
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "model": "gpt-4o-mini",
  "apiKey": "",
  "timeoutSeconds": 20,
  "maxActionsPerPlan": 12
}
```

* With `enabled: false` (or an empty key) everything runs locally.
* The file lives in the project so a team can share a setup; the key field is stored as written -
  prefer an environment-scoped key, and keep the project out of public repositories.
* Any endpoint that speaks the OpenAI chat-completions JSON shape works (local llama.cpp/Ollama
  proxies included).

## Safety model

* **Preview first.** Every action is listed with the file/component it modifies and a diff-style
  preview; individual actions can be unchecked before applying.
* **Confirmation for destructive work.** Delete/overwrite actions are marked `destructive` and show
  a confirmation dialog listing exactly what will be removed.
* **Undo-aware.** Applying a plan pushes one undo entry (the pre-apply scene snapshot), and the
  assistant's own **Revert last apply** button restores it. `Ctrl+Z` does the same.
* **Bounded.** `maxActionsPerPlan` caps a single plan; oversized plans are rejected with an error
  message instead of partially applied.
* **Honest reporting.** Files the planner wrote are listed with their real paths, and the panel
  flags actions that could not be applied. Failed actions are never reported as applied.

## Prompts that work well

* "Create a player that starts at the spawn point and give it 150 health."
* "Add three guards around the ruins, patrolling, and one brute that chases the player."
* "Make the scene darker and add fog from 20 to 90 metres."
* "Write a script that spins the crate 90 degrees per second and attach it to Crate1."
* "Import Assets/Models/robot.glb and place it in front of the gate."
* "Delete the old test cubes." (marked destructive, asks for confirmation)

Anything the engine genuinely cannot do (terrain, cinematics, multiplayer) is answered with an
explanation and, where relevant, a pointer to `V2-SCOPE.md` - the assistant does not pretend to have
created something it did not.
