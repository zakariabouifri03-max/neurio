// NovaForge Engine - internal script plumbing shared by script_host.cpp and
// api_bindings.cpp. Not part of the public engine API.
#pragma once
#include "script/script_host.h"

#include <string>
#include <vector>

extern "C" {
#include "lua.h"
#include "lauxlib.h"
#include "lualib.h"
}

namespace nf {

// The nested implementation type (defined here so both translation units see
// the same layout).
struct ScriptHost::Impl {
    lua_State* L = nullptr;
    bool initialised = false;
    std::vector<CompiledScript> compiled;
    std::vector<EntityId> failedEntities;

    CompiledScript* find(const std::string& path) {
        for (CompiledScript& c : compiled)
            if (c.path == path) return &c;
        return nullptr;
    }
    bool entityFailed(EntityId id) const {
        for (EntityId e : failedEntities)
            if (e == id) return true;
        return false;
    }
};

// Registers the engine API tables (Game/Scene/Physics/Input/Effects/Audio/Log/
// Time/UI) into the state.
void registerScriptApi(ScriptHost* host, lua_State* L);

// Entity userdata helpers (an entity is a light userdata holding its id).
int pushEntity(lua_State* L, EntityId id);
EntityId checkEntity(lua_State* L, int index);

// Registry key that holds the ScriptHost pointer for the bindings.
constexpr const char* kHostRegistryKey = "NovaForge.Host";
constexpr const char* kInstanceRegistryKey = "NovaForge.Instances";

}  // namespace nf
