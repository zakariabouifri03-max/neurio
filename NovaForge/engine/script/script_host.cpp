// NovaForge Engine - Lua script host implementation
#include "script/script_internal.h"

#include "core/fs.h"
#include "ai/npc_ai.h"
#include "core/log.h"
#include "physics/physics.h"
#include "render/effects.h"
#include "script/script_host.h"

#include <algorithm>
#include <cmath>

namespace nf {

ScriptHost::ScriptHost() : impl_(new Impl()) {}
ScriptHost::~ScriptHost() { shutdown(); }

bool ScriptHost::init(std::string* error) {
    if (impl_->initialised) return true;
    impl_->L = luaL_newstate();
    if (!impl_->L) {
        if (error) *error = "cannot create the Lua state";
        return false;
    }
    // Sandbox: only the safe standard libraries are opened.
    luaL_requiref(impl_->L, LUA_GNAME, luaopen_base, 1);
    lua_pop(impl_->L, 1);
    luaL_requiref(impl_->L, LUA_TABLIBNAME, luaopen_table, 1);
    lua_pop(impl_->L, 1);
    luaL_requiref(impl_->L, LUA_STRLIBNAME, luaopen_string, 1);
    lua_pop(impl_->L, 1);
    luaL_requiref(impl_->L, LUA_MATHLIBNAME, luaopen_math, 1);
    lua_pop(impl_->L, 1);
    luaL_requiref(impl_->L, LUA_COLIBNAME, luaopen_coroutine, 1);
    lua_pop(impl_->L, 1);

    // The base library still exposes dofile/loadfile: drop them (a game script
    // must not read arbitrary files off disk).
    for (const char* name : {"dofile", "loadfile", "load"}) {
        lua_pushnil(impl_->L);
        lua_setglobal(impl_->L, name);
    }

    lua_newtable(impl_->L);
    lua_setfield(impl_->L, LUA_REGISTRYINDEX, kInstanceRegistryKey);

    registerScriptApi(this, impl_->L);
    impl_->initialised = true;
    NF_LOG_INFO("Script", "Lua %s scripting ready (sandboxed: no io/os/package)",
                LUA_VERSION_MAJOR "." LUA_VERSION_MINOR);
    return true;
}

void ScriptHost::shutdown() {
    if (!impl_) return;
    if (impl_->L) {
        resetInstances();
        lua_close(impl_->L);
        impl_->L = nullptr;
    }
    impl_->compiled.clear();
    impl_->failedEntities.clear();
    impl_->initialised = false;
}

bool ScriptHost::isInitialised() const { return impl_ && impl_->initialised; }

void* ScriptHost::luaStateForTests() { return impl_->L; }

void ScriptHost::clearCache() {
    impl_->compiled.clear();
    impl_->failedEntities.clear();
}

bool ScriptHost::loadScript(const std::string& projectRelativePath, std::string* error) {
    if (!init(error)) return false;
    std::string abs = context_.resolveAssetPath ? context_.resolveAssetPath(projectRelativePath)
                                                : projectRelativePath;
    if (!fs::exists(abs)) {
        std::string msg = "script not found: " + projectRelativePath;
        if (error) *error = msg;
        impl_->compiled.push_back({projectRelativePath, -1, false, msg});
        return false;
    }
    std::string source = fs::readText(abs);
    lua_State* L = impl_->L;
    int status = luaL_loadbufferx(L, source.c_str(), source.size(), projectRelativePath.c_str(), "t");
    if (status != LUA_OK) {
        std::string msg = lua_tostring(L, -1) ? lua_tostring(L, -1) : "compile error";
        lua_pop(L, 1);
        if (error) *error = msg;
        CompiledScript* previous = impl_->find(projectRelativePath);
        CompiledScript entry{projectRelativePath, -1, false, msg};
        if (previous) *previous = entry;
        else impl_->compiled.push_back(entry);
        errors_.push_back({projectRelativePath, msg, false});
        NF_LOG_ERROR("Script", "%s: %s", projectRelativePath.c_str(), msg.c_str());
        return false;
    }
    int ref = luaL_ref(L, LUA_REGISTRYINDEX);
    CompiledScript* previous = impl_->find(projectRelativePath);
    if (previous) {
        if (previous->chunkRef >= 0) luaL_unref(L, LUA_REGISTRYINDEX, previous->chunkRef);
        *previous = {projectRelativePath, ref, true, ""};
    } else {
        impl_->compiled.push_back({projectRelativePath, ref, true, ""});
    }
    return true;
}

std::string scriptTemplate(const std::string& entityName) {
    std::string t;
    t += "-- " + entityName + " script\n";
    t += "-- Available: Game, Scene, Physics, Input, Effects, Audio, Log, Time, UI\n";
    t += "local speed = 3.0\n\n";
    t += "function onStart(entity)\n";
    t += "    Log.info(\"" + entityName + " script started\")\n";
    t += "end\n\n";
    t += "function onUpdate(entity, dt)\n";
    t += "    -- example: bob up and down\n";
    t += "    local p = Scene.getPosition(entity)\n";
    t += "    Scene.setPosition(entity, p.x, 1.0 + math.sin(Time.time * 2.0) * 0.25, p.z)\n";
    t += "end\n\n";
    t += "function onInteract(entity, interactor)\n";
    t += "    UI.message(\"Hello from \" .. Scene.getName(entity), 2.0)\n";
    t += "end\n";
    return t;
}

void ScriptHost::resetInstances() {
    if (!impl_->L) return;
    lua_State* L = impl_->L;
    lua_getfield(L, LUA_REGISTRYINDEX, kInstanceRegistryKey);
    if (lua_istable(L, -1)) {
        lua_newtable(L);                       // fresh instance table
        lua_setfield(L, LUA_REGISTRYINDEX, kInstanceRegistryKey);
    }
    lua_pop(L, 1);
    for (Entity* e : std::vector<Entity*>()) (void)e;
    impl_->failedEntities.clear();
    errors_.clear();
}

size_t ScriptHost::instanceCount() const {
    if (!impl_->L) return 0;
    lua_State* L = impl_->L;
    lua_getfield(L, LUA_REGISTRYINDEX, kInstanceRegistryKey);
    size_t n = 0;
    if (lua_istable(L, -1)) n = (size_t)lua_rawlen(L, -1);
    lua_pop(L, 1);
    return n;
}

bool ScriptHost::hasError(EntityId entity) const {
    return std::find(impl_->failedEntities.begin(), impl_->failedEntities.end(), entity) !=
           impl_->failedEntities.end();
}


// ------------------------------------------------------------- lifecycle
namespace {

const char* kCallbackNames[] = {"onStart", "onUpdate", "onInteract", "onTrigger",
                                "onDamaged", "onDeath"};

// One Lua "instance" per (entity, script) pair, stored in the registry so it
// survives between frames. A script may either `return` a table of callbacks
// (recommended: per instance state) or define them as globals (convenient).
bool ensureInstance(ScriptHost::Impl& impl, EntityId entity, const std::string& scriptPath,
                    std::string* error) {
    lua_State* L = impl.L;
    lua_getfield(L, LUA_REGISTRYINDEX, kInstanceRegistryKey);
    if (!lua_istable(L, -1)) {
        lua_pop(L, 1);
        lua_newtable(L);
        lua_pushvalue(L, -1);
        lua_setfield(L, LUA_REGISTRYINDEX, kInstanceRegistryKey);
    }
    lua_rawgeti(L, -1, (lua_Integer)entity);
    if (lua_istable(L, -1)) {
        lua_pop(L, 2);
        return true;                              // already instantiated
    }
    lua_pop(L, 1);

    CompiledScript* script = impl.find(scriptPath);
    if (!script || !script->valid) {
        if (script && error) *error = script->error;
        lua_pop(L, 1);
        return false;
    }
    lua_rawgeti(L, LUA_REGISTRYINDEX, script->chunkRef);
    if (lua_pcall(L, 0, 1, 0) != LUA_OK) {
        const char* msg = lua_tostring(L, -1);
        if (error) *error = msg ? msg : "script error";
        NF_LOG_ERROR("Script", "%s: %s", scriptPath.c_str(), msg ? msg : "script error");
        lua_pop(L, 2);
        return false;
    }
    lua_newtable(L);                              // the instance table
    const int instanceIdx = lua_gettop(L);
    const int resultIdx = instanceIdx - 1;        // the chunk's return value
    if (lua_istable(L, resultIdx)) {
        // the script returned a table of callbacks (recommended style)
        lua_pushnil(L);
        while (lua_next(L, resultIdx) != 0) {
            lua_pushvalue(L, -2);                 // key
            lua_pushvalue(L, -2);                 // value
            lua_settable(L, instanceIdx);
            lua_pop(L, 1);                        // keep the key for lua_next
        }
    } else {
        // the script defined globals (simple style)
        for (const char* name : kCallbackNames) {
            lua_getglobal(L, name);
            if (lua_isfunction(L, -1)) lua_setfield(L, instanceIdx, name);
            else lua_pop(L, 1);
        }
    }
    lua_pushinteger(L, (lua_Integer)entity);
    lua_setfield(L, instanceIdx, "__entity");
    lua_pushstring(L, scriptPath.c_str());
    lua_setfield(L, instanceIdx, "__script");
    // registry[entity] = instance   (stack: instances, chunkResult, instance)
    lua_rawseti(L, instanceIdx - 2, (lua_Integer)entity);
    lua_pop(L, 2);                                // chunkResult, instances
    return true;
}

// Pushes the instance table for `entity`; returns false when there is none.
bool pushInstance(lua_State* L, EntityId entity) {
    lua_getfield(L, LUA_REGISTRYINDEX, kInstanceRegistryKey);
    if (!lua_istable(L, -1)) {
        lua_pop(L, 1);
        return false;
    }
    lua_rawgeti(L, -1, (lua_Integer)entity);
    lua_remove(L, -2);
    if (!lua_istable(L, -1)) {
        lua_pop(L, 1);
        return false;
    }
    return true;
}

}  // namespace

bool ScriptHost::callFunction(Scene& scene, EntityId entity, const std::string& functionName,
                              float arg) {
    if (!impl().L) return false;
    lua_State* L = impl().L;
    if (!pushInstance(L, entity)) return false;
    lua_getfield(L, -1, functionName.c_str());
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 2);
        return false;
    }
    /* instance */ lua_remove(L, -2);
    pushEntity(L, entity);
    int args = 1;
    if (functionName == "onUpdate" || functionName == "onDamaged") {
        lua_pushnumber(L, arg);
        args = 2;
    }
    int status = lua_pcall(L, args, 0, 0);
    if (status == LUA_OK) return true;

    std::string msg = lua_tostring(L, -1) ? lua_tostring(L, -1) : "runtime error";
    lua_pop(L, 1);
    Entity* e = scene.get(entity);
    std::string scriptPath = (e && e->script) ? e->script->scriptPath : std::string("<unknown>");
    errors_.push_back({scriptPath, functionName + ": " + msg, true});
    if (!impl().entityFailed(entity)) impl().failedEntities.push_back(entity);
    NF_LOG_ERROR("Script", "%s %s: %s", scriptPath.c_str(), functionName.c_str(), msg.c_str());
    if (context_.consolePrint)
        context_.consolePrint("[script error] " + scriptPath + " " + functionName + ": " + msg);
    return false;
}

void ScriptHost::callStart(Scene& scene, EntityId entity) {
    if (!init() || impl().entityFailed(entity)) return;
    Entity* e = scene.get(entity);
    if (!e || !e->script || !e->script->enabled || e->script->scriptPath.empty()) return;
    // compile on demand (the editor also pre-compiles on save)
    if (!impl().find(e->script->scriptPath)) loadScript(e->script->scriptPath);
    std::string error;
    if (!ensureInstance(impl(), entity, e->script->scriptPath, &error)) {
        errors_.push_back({e->script->scriptPath, error, true});
        impl().failedEntities.push_back(entity);
        if (context_.consolePrint)
            context_.consolePrint("[script error] " + e->script->scriptPath + ": " + error);
        return;
    }
    callFunction(scene, entity, "onStart", 0.0f);
}

void ScriptHost::callUpdate(Scene& scene, EntityId entity, float dt) {
    if (!impl().L || impl().entityFailed(entity)) return;
    Entity* e = scene.get(entity);
    if (!e || !e->script || !e->script->enabled) return;
    context_.deltaTime = dt;
    callFunction(scene, entity, "onUpdate", dt);
}

void ScriptHost::callInteract(Scene& scene, EntityId entity, EntityId interactor) {
    if (!impl().L || impl().entityFailed(entity)) return;
    Entity* e = scene.get(entity);
    if (!e || !e->script || !e->script->enabled) return;
    lua_State* L = impl().L;
    if (!pushInstance(L, entity)) return;
    lua_getfield(L, -1, "onInteract");
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 2);
        return;
    }
    lua_remove(L, -2);
    pushEntity(L, entity);
    pushEntity(L, interactor);
    if (lua_pcall(L, 2, 0, 0) != LUA_OK) {
        std::string msg = lua_tostring(L, -1) ? lua_tostring(L, -1) : "runtime error";
        lua_pop(L, 1);
        errors_.push_back({e->script->scriptPath, "onInteract: " + msg, true});
        if (!impl().entityFailed(entity)) impl().failedEntities.push_back(entity);
        NF_LOG_ERROR("Script", "%s onInteract: %s", e->script->scriptPath.c_str(), msg.c_str());
    }
}

void ScriptHost::callTrigger(Scene& scene, EntityId entity, EntityId other, bool enter) {
    if (!impl().L || impl().entityFailed(entity)) return;
    Entity* e = scene.get(entity);
    if (!e || !e->script || !e->script->enabled) return;
    lua_State* L = impl().L;
    if (!pushInstance(L, entity)) return;
    lua_getfield(L, -1, "onTrigger");
    if (!lua_isfunction(L, -1)) {
        lua_pop(L, 2);
        return;
    }
    lua_remove(L, -2);
    pushEntity(L, entity);
    pushEntity(L, other);
    lua_pushboolean(L, enter);
    if (lua_pcall(L, 3, 0, 0) != LUA_OK) {
        std::string msg = lua_tostring(L, -1) ? lua_tostring(L, -1) : "runtime error";
        lua_pop(L, 1);
        errors_.push_back({e->script->scriptPath, "onTrigger: " + msg, true});
        if (!impl().entityFailed(entity)) impl().failedEntities.push_back(entity);
    }
}

void ScriptHost::callDamaged(Scene& scene, EntityId entity, float amount) {
    if (!impl().L || impl().entityFailed(entity)) return;
    Entity* e = scene.get(entity);
    if (!e || !e->script || !e->script->enabled) return;
    callFunction(scene, entity, "onDamaged", amount);
}

void ScriptHost::callDeath(Scene& scene, EntityId entity) {
    if (!impl().L || impl().entityFailed(entity)) return;
    Entity* e = scene.get(entity);
    if (!e || !e->script || !e->script->enabled) return;
    callFunction(scene, entity, "onDeath", 0.0f);
}

}  // namespace nf
