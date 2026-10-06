// NovaForge Engine - scripting/ScriptSystem.h
// Gameplay scripting, delivered in three layers (V1):
//   1. Component based scripts  - attach built-in or module components (the primary path)
//   2. Action scripts (.nfscript) - a small declarative language with a real interpreter
//   3. Native script modules      - a DLL that registers extra component types at runtime
// All three run inside play mode *and* inside the exported game (same code path).
#pragma once

#include "core/Base.h"
#include "scene/Components.h"

namespace nf {

class Scene;

// Describes a built-in behaviour so the editor and the AI assistant can list them.
struct ScriptBehaviorInfo {
  const char* name;
  const char* description;
  const char* parameterHint;      // human readable list of expected parameters
};

class ScriptSystem {
public:
  static void Initialize(Scene& scene);                 // resets script state
  static void Shutdown(Scene& scene);
  static void OnStart(Scene& scene, ScriptComponent& script);
  static void OnUpdate(Scene& scene, ScriptComponent& script, f32 dt);
  static void OnFixedUpdate(Scene& scene, ScriptComponent& script, f32 dt);
  static void OnTrigger(Scene& scene, ScriptComponent& script, EntityId other);
  static void OnReset(Scene& scene, ScriptComponent& script);

  static std::vector<ScriptBehaviorInfo> BuiltinBehaviors();
  static bool IsBuiltinBehavior(const std::string& name);

  // Native modules (.dll / .so): loads the library and calls its
  // `NovaForgeRegisterComponents()` export.
  static bool LoadModule(const std::string& path, std::string* error = nullptr);
  static void UnloadModule(const std::string& path);
  static std::vector<std::string> LoadedModules();
  static void UnloadAllModules();

  // Creates a default .nfscript file (used by "Create Script" and the AI assistant).
  static bool WriteTemplateScript(const std::string& path, const std::string& name,
                                  const std::string& behavior = "Rotator");
};

} // namespace nf
