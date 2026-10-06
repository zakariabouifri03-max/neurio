# Third-party dependencies (vendored)

NovaForge vendors every dependency so a clean checkout builds without a package
manager. Versions and licenses:

| Library  | Version            | License        | Used for |
|----------|--------------------|----------------|----------|
| ImGui    | v1.91.9b-docking   | MIT            | Editor UI (panels, docking, widgets) |
| Bullet3  | 3.25               | zlib           | Rigid bodies, colliders, character controller, raycasts |
| Lua      | 5.4.7              | MIT            | Gameplay scripting (`Script` components) |
| stb      | stb_image 2.30 / stb_image_write 1.16 | public domain / MIT | Texture decode, PNG screenshots |

## Local modifications

* `lua/linit.c` - the `package` (dynamic library loader) entry was removed and
  `loadlib.c` is not compiled. Games must not be able to `dlopen` arbitrary
  libraries; all engine access goes through the explicit `nf` script API
  (`engine/script/api_bindings.cpp`).
* `imgui/` - unmodified upstream docking branch sources; the engine's own
  backend (`engine/render/imgui_backend.cpp`) drives it, so no per-OS ImGui
  backend files are used.
