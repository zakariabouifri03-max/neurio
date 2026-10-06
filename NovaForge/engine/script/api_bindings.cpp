// NovaForge Engine - Lua API bindings (the surface game scripts program against)
//
// Every function here maps onto real engine systems: the scene graph, the
// Bullet physics world, the audio mixer and the effect queue. See
// docs/SCRIPTING.md for the documented, user facing reference.
#include "script/script_internal.h"

#include "ai/npc_ai.h"
#include "audio/audio.h"
#include "core/fs.h"
#include "core/log.h"
#include "physics/physics.h"
#include "render/effects.h"
#include "script/script_host.h"

#include <cmath>
#include <string>

namespace nf {

namespace {

ScriptHost* hostOf(lua_State* L) {
    lua_getfield(L, LUA_REGISTRYINDEX, kHostRegistryKey);
    ScriptHost* host = (ScriptHost*)lua_touserdata(L, -1);
    lua_pop(L, 1);
    return host;
}

Scene* sceneOf(lua_State* L) {
    ScriptHost* h = hostOf(L);
    return h ? h->context().scene : nullptr;
}

Entity* entityArg(lua_State* L, int index, EntityId* idOut = nullptr) {
    EntityId id = (EntityId)(uintptr_t)lua_touserdata(L, index);
    if (idOut) *idOut = id;
    Scene* scene = sceneOf(L);
    return scene ? scene->get(id) : nullptr;
}

// ---------------------------------------------------------------- Scene table
int l_Scene_find(lua_State* L) {
    Scene* scene = sceneOf(L);
    const char* name = luaL_checkstring(L, 1);
    if (!scene) {
        lua_pushnil(L);
        return 1;
    }
    return pushEntity(L, scene->findByName(name));
}

int l_Scene_findByTag(lua_State* L) {
    Scene* scene = sceneOf(L);
    const char* tag = luaL_checkstring(L, 1);
    if (!scene) {
        lua_pushnil(L);
        return 1;
    }
    return pushEntity(L, scene->firstByTag(tag));
}

int l_Scene_getPosition(lua_State* L) {
    Scene* scene = sceneOf(L);
    if (scene) scene->updateTransforms();     // world transforms are cached
    Entity* e = entityArg(L, 1);
    Vec3 p = e ? e->cachedWorld.translation() : Vec3(0, 0, 0);
    lua_newtable(L);
    lua_pushnumber(L, p.x); lua_setfield(L, -2, "x");
    lua_pushnumber(L, p.y); lua_setfield(L, -2, "y");
    lua_pushnumber(L, p.z); lua_setfield(L, -2, "z");
    return 1;
}

int l_Scene_setPosition(lua_State* L) {
    EntityId id;
    Entity* e = entityArg(L, 1, &id);
    if (!e) return 0;
    float x = (float)luaL_checknumber(L, 2);
    float y = (float)luaL_checknumber(L, 3);
    float z = (float)luaL_checknumber(L, 4);
    // writing through the physics character keeps collisions valid
    Scene* scene = sceneOf(L);
    ScriptHost* h = hostOf(L);
    if (h && h->context().physics && scene && h->context().physics->hasCharacter(id))
        h->context().physics->teleportCharacter(*scene, id, Vec3(x, y, z));
    else
        e->transform.position = Vec3(x, y, z);
    if (scene) scene->markDirty(id);
    return 0;
}

int l_Scene_translate(lua_State* L) {
    EntityId id;
    Entity* e = entityArg(L, 1, &id);
    if (!e) return 0;
    Vec3 d((float)luaL_checknumber(L, 2), (float)luaL_checknumber(L, 3),
           (float)luaL_checknumber(L, 4));
    ScriptHost* h = hostOf(L);
    if (h && h->context().physics && h->context().physics->hasCharacter(id))
        h->context().physics->moveCharacter(id, d);
    else
        e->transform.position += d;
    if (Scene* scene = sceneOf(L)) scene->markDirty(id);
    return 0;
}

int l_Scene_move(lua_State* L) {
    EntityId id;
    if (!entityArg(L, 1, &id)) return 0;
    Vec3 d((float)luaL_checknumber(L, 2), (float)luaL_checknumber(L, 3),
           (float)luaL_checknumber(L, 4));
    if (ScriptHost* h = hostOf(L))
        if (h->context().physics) h->context().physics->moveCharacter(id, d);
    return 0;
}

int l_Scene_rotate(lua_State* L) {
    Entity* e = entityArg(L, 1);
    if (!e) return 0;
    float yaw = (float)luaL_checknumber(L, 2);
    e->transform.rotation = Quat::fromEulerDeg(Vec3(0, yaw, 0));
    return 0;
}

int l_Scene_lookAt(lua_State* L) {
    EntityId id;
    Entity* e = entityArg(L, 1, &id);
    if (!e) return 0;
    float x = (float)luaL_checknumber(L, 2), y = (float)luaL_checknumber(L, 3),
          z = (float)luaL_checknumber(L, 4);
    Vec3 from = e->cachedWorld.translation();
    Vec3 d = Vec3(x, y, z) - from;
    d.y = 0;
    if (d.length() > 1e-4f)
        e->transform.rotation = Quat::fromEulerDeg(Vec3(0, std::atan2(d.x, d.z) * RAD2DEG, 0));
    return 0;
}

int l_Scene_getName(lua_State* L) {
    Entity* e = entityArg(L, 1);
    lua_pushstring(L, e ? e->name.c_str() : "");
    return 1;
}

int l_Scene_getTag(lua_State* L) {
    Entity* e = entityArg(L, 1);
    lua_pushstring(L, e ? e->tag.c_str() : "");
    return 1;
}

int l_Scene_setActive(lua_State* L) {
    Entity* e = entityArg(L, 1);
    if (!e) return 0;
    e->active = lua_toboolean(L, 2) != 0;
    return 0;
}

int l_Scene_spawn(lua_State* L) {
    Scene* scene = sceneOf(L);
    const char* prefab = luaL_checkstring(L, 1);
    float x = (float)luaL_optnumber(L, 2, 0);
    float y = (float)luaL_optnumber(L, 3, 0);
    float z = (float)luaL_optnumber(L, 4, 0);
    if (!scene) return pushEntity(L, kInvalidEntity);
    // Prefabs are resolved by the engine (see engine_api.cpp) through the
    // resolveAssetPath hook: "prefab://Name" is handled by the caller.
    ScriptHost* h = hostOf(L);
    EntityId id = kInvalidEntity;
    if (h && h->context().resolveAssetPath) {
        std::string request = std::string("prefab://") + prefab;
        std::string resolved = h->context().resolveAssetPath(request);
        if (!resolved.empty()) {
            // The engine returns "ok:<id>" for a successful spawn request.
            if (resolved.rfind("ok:", 0) == 0) id = (EntityId)std::stoul(resolved.substr(3));
        }
    }
    if (id != kInvalidEntity) {
        if (Entity* e = scene->get(id)) e->transform.position = Vec3(x, y, z);
    }
    return pushEntity(L, id);
}

int l_Scene_destroy(lua_State* L) {
    Scene* scene = sceneOf(L);
    EntityId id;
    if (!entityArg(L, 1, &id) || !scene) return 0;
    scene->destroyEntity(id);
    return 0;
}

int l_Scene_count(lua_State* L) {
    Scene* scene = sceneOf(L);
    lua_pushinteger(L, scene ? (lua_Integer)scene->count() : 0);
    return 1;
}

int l_Scene_entitiesWithTag(lua_State* L) {
    Scene* scene = sceneOf(L);
    const char* tag = luaL_checkstring(L, 1);
    lua_newtable(L);
    if (!scene) return 1;
    int n = 0;
    for (const auto& [entityId, e] : scene->entities()) {
        (void)entityId;
        if (e.tag == tag) {
            pushEntity(L, e.id);
            lua_rawseti(L, -2, ++n);
        }
    }
    return 1;
}

// ---------------------------------------------------------------- Game table
int l_Game_damage(lua_State* L) {
    EntityId target;
    if (!entityArg(L, 1, &target)) return 0;
    float amount = (float)luaL_checknumber(L, 2);
    Scene* scene = sceneOf(L);
    ScriptHost* h = hostOf(L);
    if (scene) applyDamage(*scene, target, amount, h ? h->context().effects : nullptr);
    return 0;
}

int l_Game_heal(lua_State* L) {
    EntityId target;
    if (!entityArg(L, 1, &target)) return 0;
    Scene* scene = sceneOf(L);
    if (scene) applyHeal(*scene, target, (float)luaL_checknumber(L, 2));
    return 0;
}

int l_Game_health(lua_State* L) {
    Entity* e = entityArg(L, 1);
    if (!e || !e->health) {
        lua_pushnumber(L, 0);
        lua_pushnumber(L, 0);
        return 2;
    }
    lua_pushnumber(L, e->health->currentHealth);
    lua_pushnumber(L, e->health->maxHealth);
    return 2;
}

int l_Game_isDead(lua_State* L) {
    Entity* e = entityArg(L, 1);
    lua_pushboolean(L, e && e->health && e->health->dead());
    return 1;
}

int l_Game_playSound(lua_State* L) {
    ScriptHost* h = hostOf(L);
    const char* path = luaL_checkstring(L, 1);
    float x = (float)luaL_optnumber(L, 2, 0), y = (float)luaL_optnumber(L, 3, 0),
          z = (float)luaL_optnumber(L, 4, 0);
    bool loop = lua_toboolean(L, 5) != 0;
    float volume = (float)luaL_optnumber(L, 6, 1.0);
    if (!h || !h->context().audio) {
        lua_pushinteger(L, 0);
        return 1;
    }
    std::string abs = h->context().resolveAssetPath ? h->context().resolveAssetPath(path) : path;
    SoundHandle s = h->context().audio->playFile(abs, Vec3(x, y, z), volume, loop, true);
    lua_pushinteger(L, (lua_Integer)s);
    return 1;
}

int l_Game_stopSound(lua_State* L) {
    ScriptHost* h = hostOf(L);
    if (h && h->context().audio)
        h->context().audio->stop((SoundHandle)luaL_checkinteger(L, 1));
    return 0;
}

int l_Game_burst(lua_State* L) {
    ScriptHost* h = hostOf(L);
    float x = (float)luaL_optnumber(L, 1, 0), y = (float)luaL_optnumber(L, 2, 0),
          z = (float)luaL_optnumber(L, 3, 0);
    float r = (float)luaL_optnumber(L, 4, 1.0), g = (float)luaL_optnumber(L, 5, 0.6),
          b = (float)luaL_optnumber(L, 6, 0.2);
    int count = (int)luaL_optinteger(L, 7, 12);
    if (h && h->context().effects) h->context().effects->spawnBurst(Vec3(x, y, z), Vec3(r, g, b), count);
    return 0;
}

int l_Game_openDoor(lua_State* L) {
    Entity* e = entityArg(L, 1);
    if (!e || !e->door) return 0;
    if (e->door->locked) return 0;
    e->door->open = true;
    return 0;
}

int l_Game_closeDoor(lua_State* L) {
    Entity* e = entityArg(L, 1);
    if (!e || !e->door) return 0;
    e->door->open = false;
    return 0;
}

int l_Game_win(lua_State* L) {
    ScriptHost* h = hostOf(L);
    if (h && h->context().requestWin) h->context().requestWin();
    return 0;
}

// ------------------------------------------------------------- Physics table
int l_Physics_raycast(lua_State* L) {
    ScriptHost* h = hostOf(L);
    float ox = (float)luaL_checknumber(L, 1), oy = (float)luaL_checknumber(L, 2),
          oz = (float)luaL_checknumber(L, 3);
    float dx = (float)luaL_checknumber(L, 4), dy = (float)luaL_checknumber(L, 5),
          dz = (float)luaL_checknumber(L, 6);
    float maxDistance = (float)luaL_optnumber(L, 7, 100.0);
    EntityId ignore = (EntityId)(uintptr_t)lua_touserdata(L, 8);
    if (!h || !h->context().physics) {
        lua_pushnil(L);
        return 1;
    }
    RaycastHit hit;
    if (!h->context().physics->raycast(Vec3(ox, oy, oz), Vec3(dx, dy, dz), maxDistance, hit, ignore)) {
        lua_pushnil(L);
        return 1;
    }
    lua_newtable(L);
    lua_pushnumber(L, hit.distance); lua_setfield(L, -2, "distance");
    lua_pushnumber(L, hit.point.x); lua_setfield(L, -2, "x");
    lua_pushnumber(L, hit.point.y); lua_setfield(L, -2, "y");
    lua_pushnumber(L, hit.point.z); lua_setfield(L, -2, "z");
    lua_pushnumber(L, hit.normal.x); lua_setfield(L, -2, "nx");
    lua_pushnumber(L, hit.normal.y); lua_setfield(L, -2, "ny");
    lua_pushnumber(L, hit.normal.z); lua_setfield(L, -2, "nz");
    pushEntity(L, hit.entity);
    lua_setfield(L, -2, "entity");
    return 1;
}

int l_Physics_grounded(lua_State* L) {
    ScriptHost* h = hostOf(L);
    EntityId id = (EntityId)(uintptr_t)lua_touserdata(L, 1);
    lua_pushboolean(L, h && h->context().physics && h->context().physics->isGrounded(id));
    return 1;
}

int l_Physics_jump(lua_State* L) {
    ScriptHost* h = hostOf(L);
    EntityId id = (EntityId)(uintptr_t)lua_touserdata(L, 1);
    float speed = (float)luaL_optnumber(L, 2, 5.0);
    if (h && h->context().physics) h->context().physics->jumpCharacter(id, speed);
    return 0;
}

int l_Physics_overlapSphere(lua_State* L) {
    ScriptHost* h = hostOf(L);
    float x = (float)luaL_checknumber(L, 1), y = (float)luaL_checknumber(L, 2),
          z = (float)luaL_checknumber(L, 3);
    float radius = (float)luaL_checknumber(L, 4);
    lua_newtable(L);
    if (!h || !h->context().physics) return 1;
    auto found = h->context().physics->overlapSphere(Vec3(x, y, z), radius);
    int n = 0;
    for (EntityId id : found) {
        pushEntity(L, id);
        lua_rawseti(L, -2, ++n);
    }
    return 1;
}

// --------------------------------------------------------------- Input table
int l_Input_isDown(lua_State* L) {
    ScriptHost* h = hostOf(L);
    const char* key = luaL_checkstring(L, 1);
    lua_pushboolean(L, h && h->context().keyDown && h->context().keyDown(key));
    return 1;
}

int l_Input_wasPressed(lua_State* L) {
    ScriptHost* h = hostOf(L);
    const char* key = luaL_checkstring(L, 1);
    lua_pushboolean(L, h && h->context().keyPressed && h->context().keyPressed(key));
    return 1;
}

int l_Input_action(lua_State* L) {
    ScriptHost* h = hostOf(L);
    const char* action = luaL_checkstring(L, 1);
    lua_pushnumber(L, (h && h->context().actionValue) ? h->context().actionValue(action) : 0.0f);
    return 1;
}

// ---------------------------------------------------------------- Time table
int Time_index(lua_State* L) {
    ScriptHost* h = hostOf(L);
    const char* key = lua_tostring(L, 2);
    if (!key) {
        lua_pushnil(L);
        return 1;
    }
    if (std::string(key) == "time") lua_pushnumber(L, h ? h->context().time : 0.0f);
    else if (std::string(key) == "delta") lua_pushnumber(L, h ? h->context().deltaTime : 0.0f);
    else lua_pushnil(L);
    return 1;
}

// ------------------------------------------------------------- Audio / FX
int l_Audio_play(lua_State* L) { return l_Game_playSound(L); }

int l_Effects_burst(lua_State* L) { return l_Game_burst(L); }

int l_Effects_loop(lua_State* L) {
    ScriptHost* h = hostOf(L);
    EntityId id = (EntityId)(uintptr_t)lua_touserdata(L, 1);
    float r = (float)luaL_optnumber(L, 2, 1.0), g = (float)luaL_optnumber(L, 3, 0.6),
          b = (float)luaL_optnumber(L, 4, 0.2);
    if (h && h->context().effects) h->context().effects->setLooping(id, Vec3(r, g, b), 0.12f, 0.7f, 1.4f, 8);
    return 0;
}

int l_Effects_stop(lua_State* L) {
    ScriptHost* h = hostOf(L);
    EntityId id = (EntityId)(uintptr_t)lua_touserdata(L, 1);
    if (h && h->context().effects) h->context().effects->stopLooping(id);
    return 0;
}

// ------------------------------------------------------------------ Log / UI
int l_Log_info(lua_State* L) {
    ScriptHost* h = hostOf(L);
    std::string msg = luaL_tolstring(L, 1, nullptr);
    lua_pop(L, 1);
    if (h && h->context().consolePrint) h->context().consolePrint(msg);
    else NF_LOG_INFO("Script", "%s", msg.c_str());
    return 0;
}

int l_Log_warn(lua_State* L) {
    ScriptHost* h = hostOf(L);
    std::string msg = luaL_tolstring(L, 1, nullptr);
    lua_pop(L, 1);
    NF_LOG_WARN("Script", "%s", msg.c_str());
    if (h && h->context().consolePrint) h->context().consolePrint("[warn] " + msg);
    return 0;
}

int l_UI_message(lua_State* L) {
    ScriptHost* h = hostOf(L);
    std::string msg = luaL_checkstring(L, 1);
    float seconds = (float)luaL_optnumber(L, 2, 2.5);
    if (h && h->context().hudMessage) h->context().hudMessage(msg, seconds);
    return 0;
}

}  // namespace

// ------------------------------------------------------------- registration
int pushEntity(lua_State* L, EntityId id) {
    if (id == kInvalidEntity) {
        lua_pushnil(L);
        return 1;
    }
    lua_pushlightuserdata(L, (void*)(uintptr_t)id);
    return 1;
}

EntityId checkEntity(lua_State* L, int index) {
    if (lua_isnil(L, index)) return kInvalidEntity;
    return (EntityId)(uintptr_t)lua_touserdata(L, index);
}

void registerScriptApi(ScriptHost* host, lua_State* L) {
    lua_pushlightuserdata(L, host);
    lua_setfield(L, LUA_REGISTRYINDEX, kHostRegistryKey);

    struct Entry {
        const char* name;
        lua_CFunction fn;
    };
    auto makeTable = [L](const char* name, const std::vector<Entry>& entries) {
        lua_newtable(L);
        for (const Entry& e : entries) {
            lua_pushcfunction(L, e.fn);
            lua_setfield(L, -2, e.name);
        }
        lua_setglobal(L, name);
    };

    makeTable("Scene",
              {{"find", l_Scene_find},
               {"findByTag", l_Scene_findByTag},
               {"getPosition", l_Scene_getPosition},
               {"setPosition", l_Scene_setPosition},
               {"translate", l_Scene_translate},
               {"move", l_Scene_move},
               {"rotate", l_Scene_rotate},
               {"lookAt", l_Scene_lookAt},
               {"getName", l_Scene_getName},
               {"getTag", l_Scene_getTag},
               {"setActive", l_Scene_setActive},
               {"spawn", l_Scene_spawn},
               {"destroy", l_Scene_destroy},
               {"count", l_Scene_count},
               {"entitiesWithTag", l_Scene_entitiesWithTag}});

    makeTable("Game",
              {{"damage", l_Game_damage},
               {"heal", l_Game_heal},
               {"health", l_Game_health},
               {"isDead", l_Game_isDead},
               {"playSound", l_Game_playSound},
               {"stopSound", l_Game_stopSound},
               {"burst", l_Game_burst},
               {"openDoor", l_Game_openDoor},
               {"closeDoor", l_Game_closeDoor},
               {"win", l_Game_win}});

    makeTable("Physics",
              {{"raycast", l_Physics_raycast},
               {"grounded", l_Physics_grounded},
               {"jump", l_Physics_jump},
               {"overlapSphere", l_Physics_overlapSphere}});

    makeTable("Input", {{"isDown", l_Input_isDown}, {"wasPressed", l_Input_wasPressed}, {"action", l_Input_action}});

    makeTable("Effects", {{"burst", l_Effects_burst}, {"loop", l_Effects_loop}, {"stop", l_Effects_stop}});
    makeTable("Audio", {{"play", l_Audio_play}});
    makeTable("Log", {{"info", l_Log_info}, {"warn", l_Log_warn}});
    makeTable("UI", {{"message", l_UI_message}});

    // Time is a dynamic table (time / delta change every frame).
    lua_newtable(L);
    lua_newtable(L);
    lua_pushcfunction(L, Time_index);
    lua_setfield(L, -2, "__index");
    lua_setmetatable(L, -2);
    lua_setglobal(L, "Time");
}

}  // namespace nf
