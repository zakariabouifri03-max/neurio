// NovaForge Engine - gameplay scripting (Lua 5.4)
//
// A script is a plain .lua file in Assets/Scripts. It can define any of:
//
//   function onStart(entity)              -- play mode starts
//   function onUpdate(entity, dt)         -- every frame
//   function onInteract(entity, other)    -- player pressed E on it
//   function onTrigger(entity, other, enter)
//   function onDamaged(entity, amount)
//   function onDeath(entity)
//
// The global tables Game, Scene, Physics, Input, Effects, Audio, Log, Time and
// UI are bound to the running engine (see docs/SCRIPTING.md). Scripts run in a
// sandbox: io, os, package and debug are not exposed.
//
// Error handling: a script that fails to compile is reported to the console and
// skipped; a runtime error disables that one script instance and reports the
// Lua traceback with file and line, without touching the rest of the game.
#pragma once
#include "core/math.h"
#include "scene/scene.h"

#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace nf {

class PhysicsWorld;
class AudioSystem;
class EffectsQueue;

// Everything the script bindings may touch. The engine fills this in; tests can
// leave the optional pointers null and the matching bindings become no-ops.
struct ScriptContext {
    Scene* scene = nullptr;
    PhysicsWorld* physics = nullptr;
    AudioSystem* audio = nullptr;
    EffectsQueue* effects = nullptr;
    std::function<bool(const std::string& key)> keyDown;
    std::function<bool(const std::string& key)> keyPressed;
    std::function<float(const std::string& action)> actionValue;
    std::function<void(const std::string& message, float seconds)> hudMessage;
    std::function<void(const std::string&)> consolePrint;
    std::function<void()> requestWin;
    std::function<std::string(const std::string&)> resolveAssetPath;   // project rel -> abs
    float time = 0.0f;
    float deltaTime = 0.0f;
};

struct ScriptError {
    std::string script;
    std::string message;
    bool fatal = false;      // instance disabled
};

// A compiled, cached script chunk.
struct CompiledScript {
    std::string path;         // project relative
    int chunkRef = -1;        // luaL_ref into the registry (LUA_REFNIL/2 = missing)
    bool valid = false;
    std::string error;
};

class ScriptHost {
public:
    ScriptHost();
    ~ScriptHost();
    ScriptHost(const ScriptHost&) = delete;
    ScriptHost& operator=(const ScriptHost&) = delete;

    bool init(std::string* error = nullptr);
    void shutdown();
    bool isInitialised() const;

    void setContext(const ScriptContext& context) { context_ = context; }
    ScriptContext& context() { return context_; }

    // Compiles (or recompiles) a project relative script path.
    bool loadScript(const std::string& projectRelativePath, std::string* error = nullptr);
    void clearCache();

    // Lifecycle - safe to call for entities without scripts (no-op).
    void callStart(Scene& scene, EntityId entity);
    void callUpdate(Scene& scene, EntityId entity, float dt);
    void callInteract(Scene& scene, EntityId entity, EntityId interactor);
    void callTrigger(Scene& scene, EntityId entity, EntityId other, bool enter);
    void callDamaged(Scene& scene, EntityId entity, float amount);
    void callDeath(Scene& scene, EntityId entity);
    // Calls a named global function if the script defines it (used by the AI
    // assistant templates and by custom events).
    bool callFunction(Scene& scene, EntityId entity, const std::string& functionName, float arg);

    // Play/stop bookkeeping: instances are Lua tables with the script's
    // functions; stopping play drops them.
    void resetInstances();
    size_t instanceCount() const;
    bool hasError(EntityId entity) const;

    const std::vector<ScriptError>& errors() const { return errors_; }
    void clearErrors() { errors_.clear(); }
    // Raw Lua state, for tools and tests (void* keeps Lua out of public headers).
    void* luaStateForTests();

    // Internal: the Lua binding layer (engine/script/api_bindings.cpp) needs the
    // raw state. Use through script_internal.h only.
    struct Impl;
    Impl& impl() { return *impl_; }
    const Impl& impl() const { return *impl_; }

private:
    std::unique_ptr<Impl> impl_;
    ScriptContext context_;
    std::vector<ScriptError> errors_;
};

// Returns the default template source for a new script (used by the editor's
// "Create Script" and by the AI assistant).
std::string scriptTemplate(const std::string& entityName);

}  // namespace nf
