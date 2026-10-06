// Scripting tests: real Lua files must drive the real engine (transform, health,
// physics, effects, HUD) and every failure mode must be reported, not crash.
#include "test_framework.h"

#include "ai/npc_ai.h"
#include "audio/audio.h"
#include "core/fs.h"
#include "physics/physics.h"
#include "render/effects.h"
#include "scene/scene.h"
#include "script/script_host.h"

#include <map>

extern "C" {
#include "lauxlib.h"
#include "lua.h"
}

using namespace nf;

namespace {

std::string tempDir() {
    std::string d = fs::join(fs::tempDir(), "novaforge_script_tests");
    fs::createDirectories(d);
    return d;
}

struct ScriptFixture {
    Scene scene;
    PhysicsWorld physics;
    AudioSystem audio;
    EffectsQueue effects;
    ScriptHost host;
    std::string dir;
    std::vector<std::string> console;
    std::vector<std::pair<std::string, float>> messages;
    int wins = 0;

    ScriptFixture() {
        dir = tempDir();
        audio.init();
        ScriptContext ctx;
        ctx.scene = &scene;
        ctx.physics = &physics;
        ctx.effects = &effects;
        ctx.audio = &audio;
        ctx.keyDown = [](const std::string& key) { return key == "W"; };
        ctx.keyPressed = [](const std::string& key) { return key == "E"; };
        ctx.actionValue = [](const std::string& action) { return action == "MoveForward" ? 1.0f : 0.0f; };
        ctx.hudMessage = [this](const std::string& msg, float seconds) {
            messages.push_back({msg, seconds});
        };
        ctx.consolePrint = [this](const std::string& msg) { console.push_back(msg); };
        ctx.requestWin = [this]() { ++wins; };
        ctx.resolveAssetPath = [this](const std::string& path) -> std::string {
            if (path.rfind("prefab://", 0) == 0) {
                // stand-in for the engine's prefab spawner
                std::string prefab = path.substr(9);
                EntityId id = scene.createEntity("Spawned " + prefab);
                spawned.push_back(id);
                return "ok:" + std::to_string(id);
            }
            return fs::join(dir, path);
        };
        host.setContext(ctx);
        host.init();
    }

    std::vector<EntityId> spawned;

    // Writes a script into the temp dir and returns its "project relative" path.
    std::string writeScript(const std::string& name, const std::string& source) {
        std::string path = "Scripts/" + name;
        fs::createDirectories(fs::join(dir, "Scripts"));
        fs::writeText(fs::join(dir, path), source);
        return path;
    }

    EntityId addEntity(const std::string& name, const std::string& scriptPath) {
        EntityId id = scene.createEntity(name);
        scene.get(id)->script = ScriptComponent();
        scene.get(id)->script->scriptPath = scriptPath;
        scene.get(id)->script->enabled = true;
        return id;
    }
};

}  // namespace

NF_TEST(script_moves_an_entity_every_frame) {
    ScriptFixture fx;
    std::string src = R"(
local t = 0
function onStart(entity)
    Log.info("started")
end
function onUpdate(entity, dt)
    t = t + dt
    local p = Scene.getPosition(entity)
    Scene.setPosition(entity, p.x + 1.0 * dt, p.y, p.z)
end
)";
    std::string path = fx.writeScript("mover.lua", src);
    EntityId e = fx.addEntity("Mover", path);
    fx.scene.get(e)->transform.position = Vec3(0, 0, 0);

    fx.host.callStart(fx.scene, e);
    CHECK_EQ(fx.host.instanceCount(), 1u);
    CHECK(!fx.console.empty());
    for (int i = 0; i < 60; ++i) {
        fx.host.context().time += 1.0f / 60.0f;
        fx.host.callUpdate(fx.scene, e, 1.0f / 60.0f);
    }
    CHECK_NEAR(fx.scene.get(e)->transform.position.x, 1.0f, 0.05f);
    CHECK(fx.host.errors().empty());
}

NF_TEST(script_can_damage_heal_and_kill) {
    ScriptFixture fx;
    std::string src = R"(
function onUpdate(entity, dt)
    local target = Scene.findByTag("Enemy")
    if target then
        Game.damage(target, 30.0)
        local hp, max = Game.health(target)
        if Game.isDead(target) and not done then
            done = true
            Game.burst(0, 1.0, 0, 1, 0, 0, 8)
        end
    end
end
function onDamaged(entity, amount)
    -- heal back half of what was lost
    Game.heal(entity, amount * 0.5)
end
)";
    std::string path = fx.writeScript("combat.lua", src);
    EntityId caster = fx.addEntity("Caster", path);
    EntityId enemy = fx.scene.createEntity("Enemy");
    fx.scene.get(enemy)->tag = "Enemy";
    fx.scene.get(enemy)->health = HealthComponent();
    fx.scene.get(enemy)->health->maxHealth = 50.0f;
    fx.scene.get(enemy)->health->currentHealth = 50.0f;

    fx.host.callStart(fx.scene, caster);
    fx.host.callUpdate(fx.scene, caster, 1.0f / 60.0f);   // 50 -> 20
    CHECK_EQ(fx.scene.get(enemy)->health->currentHealth, 20.0f);
    fx.host.callUpdate(fx.scene, caster, 1.0f / 60.0f);   // 20 -> dead (clamped at 0)
    CHECK(isDead(fx.scene, enemy));
    CHECK_EQ(fx.scene.get(enemy)->health->currentHealth, 0.0f);
    CHECK_MSG(fx.effects.particleCount() > 0, "Game.burst must spawn real particles");

    // the onDamaged hook really runs: the script heals half of the incoming hit
    fx.scene.get(caster)->health = HealthComponent();
    fx.scene.get(caster)->health->maxHealth = 100.0f;
    fx.scene.get(caster)->health->currentHealth = 50.0f;
    fx.host.callDamaged(fx.scene, caster, 40.0f);
    CHECK_NEAR(fx.scene.get(caster)->health->currentHealth, 70.0f, 0.001f)
    ;
}

NF_TEST(script_uses_physics_and_input) {
    ScriptFixture fx;
    std::string src = R"(
function onUpdate(entity, dt)
    if Input.isDown("W") then
        Scene.move(entity, 0, 0, 0.1)
    end
    if Input.wasPressed("E") then
        local hit = Physics.raycast(0, 1, 0, 0, 0, 1, 50)
        if hit then
            Log.info("hit at " .. string.format("%.2f", hit.distance))
        end
    end
    if Input.action("MoveForward") > 0.5 then
        UI.message("forward", 1.0)
    end
end
)";
    std::string path = fx.writeScript("input.lua", src);
    EntityId e = fx.addEntity("Probe", path);
    fx.scene.get(e)->transform.position = Vec3(0, 1, 0);
    // a wall to hit with the raycast
    EntityId wall = fx.scene.createEntity("Wall");
    fx.scene.get(wall)->collider = ColliderComponent();
    fx.scene.get(wall)->collider->shape = ColliderShape::Box;
    fx.scene.get(wall)->collider->size = Vec3(4, 4, 1);
    fx.scene.get(wall)->transform.position = Vec3(0, 1, 10);
    fx.physics.syncScene(fx.scene);

    fx.host.callStart(fx.scene, e);
    fx.host.callUpdate(fx.scene, e, 1.0f / 60.0f);
    CHECK_MSG(!fx.console.empty(), "the raycast must hit the wall and log the distance");
    CHECK_MSG(fx.messages.size() >= 1, "UI.message must reach the HUD hook");
    CHECK_EQ(fx.messages[0].first, std::string("forward"));
}

NF_TEST(script_spawn_and_destroy_entities) {
    ScriptFixture fx;
    std::string src = R"(
function onStart(entity)
    local spawned = Scene.spawn("Crate", 1, 2, 3)
    if spawned then
        Scene.setPosition(spawned, 4, 5, 6)
    end
end
)";
    std::string path = fx.writeScript("spawner.lua", src);
    EntityId e = fx.addEntity("Spawner", path);
    size_t before = fx.scene.count();
    fx.host.callStart(fx.scene, e);
    CHECK_EQ(fx.spawned.size(), 1u);
    CHECK_EQ(fx.scene.count(), before + 1);
    CHECK_NEAR(fx.scene.get(fx.spawned[0])->transform.position.y, 5.0f, 0.001f);
}

NF_TEST(script_errors_are_isolated_and_reported) {
    ScriptFixture fx;
    std::string bad = fx.writeScript("broken.lua", "function onUpdate(entity, dt)\n  return 1 +\nend\n");
    EntityId broken = fx.addEntity("Broken", bad);
    std::string good = fx.writeScript("good.lua",
                                      "function onUpdate(entity, dt)\n"
                                      "  Scene.translate(entity, 1.0 * dt, 0, 0)\n"
                                      "end\n");
    EntityId working = fx.addEntity("Working", good);

    fx.host.callStart(fx.scene, broken);
    CHECK_MSG(!fx.host.errors().empty(), "a syntax error must be reported");
    CHECK(fx.host.hasError(broken));

    fx.host.callStart(fx.scene, working);
    CHECK(!fx.host.hasError(working));
    fx.host.callUpdate(fx.scene, working, 0.5f);
    CHECK_NEAR(fx.scene.get(working)->transform.position.x, 0.5f, 0.01f);

    // runtime error: disable only that instance
    std::string crasher = fx.writeScript("crasher.lua",
                                         "function onUpdate(entity, dt)\n"
                                         "  local t = nil\n"
                                         "  return t.field + 1\n"
                                         "end\n");
    EntityId crashing = fx.addEntity("Crashing", crasher);
    fx.host.callStart(fx.scene, crashing);
    fx.host.callUpdate(fx.scene, crashing, 0.016f);
    CHECK_MSG(fx.host.hasError(crashing), "a runtime error must disable that script");
    CHECK_MSG(!fx.console.empty(), "the error must reach the console");
    size_t errorsAfter = fx.host.errors().size();
    fx.host.callUpdate(fx.scene, crashing, 0.016f);   // must not run again
    CHECK_EQ(fx.host.errors().size(), errorsAfter);
}

NF_TEST(script_sandbox_blocks_file_and_os_access) {
    ScriptFixture fx;
    std::string src = R"(
function onStart(entity)
    sandbox = {
        io = io, os = os, package = package, require = require, debug = debug,
        dofile = dofile, loadfile = loadfile, load = load
    }
end
)";
    std::string path = fx.writeScript("sandbox.lua", src);
    EntityId e = fx.addEntity("Sandbox", path);
    fx.host.callStart(fx.scene, e);
    CHECK(fx.host.errors().empty());
    // the script stores what it can see in a global; read it back through Lua
    lua_State* L = (lua_State*)fx.host.luaStateForTests();
    CHECK(L != nullptr);
    lua_getglobal(L, "sandbox");
    CHECK(lua_istable(L, -1));
    for (const char* key : {"io", "os", "package", "require", "debug", "dofile", "loadfile", "load"}) {
        lua_getfield(L, -1, key);
        CHECK_MSG(lua_isnil(L, -1), (std::string("sandbox must hide '") + key + "'").c_str());
        lua_pop(L, 1);
    }
    lua_pop(L, 1);
}

NF_TEST(script_lifecycle_hooks_fire) {
    ScriptFixture fx;
    std::string src = R"(
events = {}
function onStart(entity) table.insert(events, "start") end
function onUpdate(entity, dt) table.insert(events, "update") end
function onInteract(entity, other) table.insert(events, "interact") end
function onTrigger(entity, other, enter) table.insert(events, enter and "enter" or "exit") end
function onDeath(entity) table.insert(events, "death") end
)";
    std::string path = fx.writeScript("hooks.lua", src);
    EntityId e = fx.addEntity("Hooks", path);
    EntityId other = fx.scene.createEntity("Player");
    fx.host.callStart(fx.scene, e);
    fx.host.callUpdate(fx.scene, e, 0.016f);
    fx.host.callInteract(fx.scene, e, other);
    fx.host.callTrigger(fx.scene, e, other, true);
    fx.host.callTrigger(fx.scene, e, other, false);
    fx.host.callDeath(fx.scene, e);
    CHECK(fx.host.errors().empty());

    lua_State* L = (lua_State*)fx.host.luaStateForTests();
    lua_getglobal(L, "events");
    CHECK(lua_istable(L, -1));
    std::vector<std::string> got;
    int n = (int)lua_rawlen(L, -1);
    for (int i = 1; i <= n; ++i) {
        lua_rawgeti(L, -1, i);
        got.push_back(lua_tostring(L, -1) ? lua_tostring(L, -1) : "");
        lua_pop(L, 1);
    }
    lua_pop(L, 1);
    std::vector<std::string> expected = {"start", "update", "interact", "enter", "exit", "death"};
    CHECK_EQ(got.size(), expected.size());
    for (size_t i = 0; i < expected.size() && i < got.size(); ++i) CHECK_EQ(got[i], expected[i]);
}

NF_TEST(script_reload_and_reset) {
    ScriptFixture fx;
    std::string path = fx.writeScript("version.lua",
                                      "function onStart(entity)\n  version = 1\nend\n");
    EntityId e = fx.addEntity("Versioned", path);
    fx.host.callStart(fx.scene, e);
    CHECK_EQ(fx.host.instanceCount(), 1u);

    // edit the file and reload: the new version must run on the next start
    fs::writeText(fs::join(fx.dir, path), "function onStart(entity)\n  version = 2\nend\n");
    std::string error;
    CHECK(fx.host.loadScript(path, &error));
    fx.host.resetInstances();
    CHECK_EQ(fx.host.instanceCount(), 0u);
    fx.host.callStart(fx.scene, e);

    lua_State* L = (lua_State*)fx.host.luaStateForTests();
    lua_getglobal(L, "version");
    CHECK_EQ((int)lua_tointeger(L, -1), 2);
    lua_pop(L, 1);
}

NF_TEST(script_template_is_compilable) {
    ScriptFixture fx;
    std::string path = fx.writeScript("template.lua", scriptTemplate("Crate"));
    EntityId e = fx.addEntity("Crate", path);
    fx.host.callStart(fx.scene, e);
    CHECK(fx.host.errors().empty());
    for (int i = 0; i < 30; ++i) {
        fx.host.context().time += 1.0f / 60.0f;
        fx.host.callUpdate(fx.scene, e, 1.0f / 60.0f);
    }
    CHECK(fx.host.errors().empty());
    CHECK(!fx.console.empty());
}
