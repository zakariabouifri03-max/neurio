// NovaForge Engine - sample project generator
//
//   python3 build.py --target sample && ./build/tools/make_sample [outputDir]
//
// Builds "SampleIsland": a complete, playable NovaForge project using the same
// authoring APIs the editor uses (Project, AssetLibrary, Scene, prefabs). The
// generated folder is committed to the repository so users can open it in the
// editor or run it with the game runtime, and this tool doubles as an
// integration test of the authoring pipeline.
#include "assets/asset_library.h"
#include "core/fs.h"
#include "core/log.h"
#include "project/project.h"
#include "scene/prefabs.h"
#include "scene/scene.h"

#include <cstdio>
#include <string>

using namespace nf;

namespace {

int failures = 0;

bool expect(bool ok, const std::string& what) {
    if (ok) return true;
    std::fprintf(stderr, "FAILED: %s\n", what.c_str());
    ++failures;
    return false;
}

// Every mesh renderer in the sample points at a built-in primitive, so the
// sample project needs no binary assets at all.
EntityId addMesh(Scene& scene, const std::string& name, const std::string& primitive,
                 const Vec3& position, const Vec3& scale, const std::string& material = "",
                 const std::string& tag = "") {
    EntityId id = scene.createEntity(name);
    Entity* e = scene.get(id);
    e->mesh = MeshRendererComponent();
    e->mesh->modelPath = "primitive://" + primitive;
    e->mesh->materialOverride = material;
    e->transform.position = position;
    e->transform.scale = scale;
    if (!tag.empty()) e->tag = tag;
    return id;
}

void addStaticBox(Scene& scene, EntityId id, const Vec3& size) {
    Entity* e = scene.get(id);
    e->collider = ColliderComponent();
    e->collider->shape = ColliderShape::Box;
    e->collider->size = size;
    e->rigidbody = RigidBodyComponent();
    e->rigidbody->motionType = MotionType::Static;
}

void addDynamicBox(Scene& scene, EntityId id, const Vec3& size, float mass = 4.0f) {
    Entity* e = scene.get(id);
    e->collider = ColliderComponent();
    e->collider->shape = ColliderShape::Box;
    e->collider->size = size;
    e->rigidbody = RigidBodyComponent();
    e->rigidbody->motionType = MotionType::Dynamic;
    e->rigidbody->mass = mass;
}

std::string writeScript(Project& project, const std::string& name, const std::string& source) {
    const std::string rel = fs::join(project.scriptsDir(), name);
    std::string error;
    if (!project.writeTextFile(rel, source, &error)) {
        expect(false, "could not write " + rel + ": " + error);
        return "";
    }
    return rel;
}

}  // namespace

int main(int argc, char** argv) {
    Log::get().setMinLevel(LogLevel::Info);
    const std::string outDir = argc > 1 ? argv[1] : "samples/SampleIsland";
    if (fs::exists(outDir)) fs::removeTree(outDir);

    Project project;
    std::string error;
    if (!expect(project.create(outDir, "SampleIsland", &error), "project create: " + error))
        return 1;
    AssetLibrary& assets = AssetLibrary::get();
    assets.setProjectRoot(project.root());
    assets.ensureStandardFolders();

    // ---------------------------------------------------------------- materials
    Material grass;
    grass.name = "Grass";
    grass.baseColor = Vec3(0.30f, 0.55f, 0.24f);
    grass.roughness = 0.9f;
    const std::string grassMat = assets.createMaterial("Grass", grass);

    Material sand;
    sand.name = "Sand";
    sand.baseColor = Vec3(0.85f, 0.78f, 0.55f);
    sand.roughness = 0.95f;
    const std::string sandMat = assets.createMaterial("Sand", sand);

    Material water;
    water.name = "Water";
    water.baseColor = Vec3(0.16f, 0.45f, 0.62f);
    water.opacity = 0.75f;
    water.roughness = 0.15f;
    water.unlit = false;
    const std::string waterMat = assets.createMaterial("Water", water);

    Material trunk;
    trunk.name = "Trunk";
    trunk.baseColor = Vec3(0.38f, 0.26f, 0.16f);
    trunk.roughness = 0.85f;
    const std::string trunkMat = assets.createMaterial("Trunk", trunk);

    Material gem;
    gem.name = "Gem";
    gem.baseColor = Vec3(1.0f, 0.82f, 0.25f);
    gem.emissive = Vec3(0.9f, 0.6f, 0.1f);
    gem.emissiveStrength = 1.4f;
    gem.metallic = 0.3f;
    gem.roughness = 0.3f;
    const std::string gemMat = assets.createMaterial("Gem", gem);

    Material doorMat;
    doorMat.name = "Door";
    doorMat.baseColor = Vec3(0.55f, 0.36f, 0.2f);
    doorMat.roughness = 0.7f;
    const std::string doorMaterial = assets.createMaterial("Door", doorMat);

    // ------------------------------------------------------------------- scene
    Scene scene;
    scene.name = "Island";

    // --- ground: a grass plane with a thin static collider
    EntityId ground = addMesh(scene, "Island Ground", "Plane", Vec3(0, 0, 0), Vec3(40, 1, 40),
                              grassMat, "Ground");
    addStaticBox(scene, ground, Vec3(80, 0.2f, 80));
    scene.get(ground)->collider->center = Vec3(0, -0.1f, 0);

    // --- a sandy beach strip behind the spawn
    EntityId beach = addMesh(scene, "Beach", "Plane", Vec3(0, 0.02f, 26), Vec3(26, 1, 12),
                             sandMat, "Ground");
    addStaticBox(scene, beach, Vec3(52, 0.2f, 24));
    scene.get(beach)->collider->center = Vec3(0, -0.1f, 0);

    // --- surrounding water (visual only, no collider: you can fall in and swim out)
    addMesh(scene, "Water", "Plane", Vec3(0, -0.35f, 0), Vec3(120, 1, 120), waterMat);

    // --- palm trees: trunk + two foliage blobs, each static
    const Vec3 palms[] = {{8, 0, -6},  {-10, 0, -2}, {13, 0, 9},
                          {-14, 0, 12}, {4, 0, 16},   {-5, 0, -14}};
    int palmIndex = 0;
    for (const Vec3& p : palms) {
        const std::string name = "Palm " + std::to_string(++palmIndex);
        EntityId root = scene.createEntity(name);
        scene.get(root)->transform.position = p;
        EntityId trunkEntity =
            addMesh(scene, name + " Trunk", "Cylinder", p + Vec3(0, 1.4f, 0), Vec3(0.35f, 2.8f, 0.35f),
                    trunkMat);
        addStaticBox(scene, trunkEntity, Vec3(0.5f, 2.8f, 0.5f));
        scene.setParent(trunkEntity, root, false);
        for (int i = 0; i < 2; ++i) {
            EntityId leaves = addMesh(scene, name + " Leaves " + std::to_string(i + 1), "Sphere",
                                      p + Vec3(i == 0 ? -0.9f : 0.9f, 3.4f, i == 0 ? 0.4f : -0.6f),
                                      Vec3(3.2f, 1.2f, 3.2f), grassMat);
            scene.setParent(leaves, root, false);
        }
    }

    // --- gameplay: the player, an enemy, gems, a crate stack and a door
    EntityId player = builtin_prefabs::spawn(scene, "Player", Vec3(0, 1.2f, -14));
    builtin_prefabs::spawn(scene, "PatrollingEnemy", Vec3(9, 1.2f, 6));
    builtin_prefabs::spawn(scene, "Enemy", Vec3(-9, 1.2f, 8));

    const Vec3 gems[] = {{6, 1.0f, -8}, {-7, 1.0f, 4}, {12, 1.0f, -2}};
    int gemIndex = 0;
    for (const Vec3& g : gems) {
        EntityId coin = builtin_prefabs::spawn(scene, "Coin", g);
        scene.get(coin)->name = "Gem " + std::to_string(++gemIndex);
        scene.get(coin)->mesh->materialOverride = gemMat;
        scene.get(coin)->particles = ParticleComponent();
        scene.get(coin)->particles->color = Vec3(1.0f, 0.85f, 0.3f);
        scene.get(coin)->particles->count = 10;
        scene.get(coin)->particles->size = 0.08f;
        scene.get(coin)->particles->lifetime = 0.7f;
        scene.get(coin)->particles->speed = 1.2f;
        scene.get(coin)->particles->looping = true;
    }

    for (int i = 0; i < 3; ++i) {
        EntityId crate = addMesh(scene, "Crate " + std::to_string(i + 1), "Cube",
                                 Vec3(-4.0f + i * 0.1f, 0.6f + i * 1.05f, -4.0f), Vec3(1, 1, 1),
                                 trunkMat);
        addDynamicBox(scene, crate, Vec3(1, 1, 1), 5.0f);
        scene.get(crate)->collider->friction = 0.7f;
    }

    // --- a gate east of the beach: interact (E) or walk through the trigger
    EntityId gatePost = addMesh(scene, "Gate Post", "Cube", Vec3(4.0f, 1.5f, 20.0f),
                                Vec3(0.6f, 3.0f, 0.6f), trunkMat);
    addStaticBox(scene, gatePost, Vec3(0.6f, 3.0f, 0.6f));
    EntityId gate = addMesh(scene, "Gate Door", "Cube", Vec3(2.0f, 1.5f, 20.0f),
                            Vec3(3.4f, 2.8f, 0.25f), doorMaterial);
    addStaticBox(scene, gate, Vec3(3.4f, 2.8f, 0.25f));
    scene.get(gate)->door = DoorComponent();
    scene.get(gate)->door->openOffset = Vec3(0, 3.2f, 0);
    scene.get(gate)->door->speed = 1.6f;
    scene.get(gate)->interactable = InteractableComponent();
    scene.get(gate)->interactable->action = InteractableComponent::Action::ToggleDoor;
    scene.get(gate)->interactable->prompt = "open the gate";
    scene.get(gate)->interactable->interactRange = 3.0f;

    // --- the goal behind the gate: walking in wins the game
    EntityId goal = scene.createEntity("Goal Zone");
    scene.get(goal)->transform.position = Vec3(2.0f, 1.5f, 24.0f);
    scene.get(goal)->trigger = TriggerComponent();
    scene.get(goal)->trigger->onEnter = TriggerComponent::Action::WinGame;
    scene.get(goal)->trigger->message = "You explored the whole island!";
    scene.get(goal)->collider = ColliderComponent();
    scene.get(goal)->collider->shape = ColliderShape::Box;
    scene.get(goal)->collider->size = Vec3(6, 4, 4);
    scene.get(goal)->collider->isTrigger = true;

    // --- a damage volume in the water so the world reacts to the player
    EntityId hazard = scene.createEntity("Deep Water Hazard");
    scene.get(hazard)->transform.position = Vec3(22.0f, 0.4f, 0.0f);
    scene.get(hazard)->trigger = TriggerComponent();
    scene.get(hazard)->trigger->onEnter = TriggerComponent::Action::Damage;
    scene.get(hazard)->trigger->value = 8.0f;
    scene.get(hazard)->trigger->message = "The current is strong!";
    scene.get(hazard)->collider = ColliderComponent();
    scene.get(hazard)->collider->shape = ColliderShape::Box;
    scene.get(hazard)->collider->size = Vec3(10, 3, 30);
    scene.get(hazard)->collider->isTrigger = true;

    // --- lighting: sun + a warm torch light near the gate
    const EntityId sun = scene.findByName("Sun");
    if (sun != kInvalidEntity) {
        scene.get(sun)->light->intensity = 1.5f;
        scene.get(sun)->light->color = Vec3(1.0f, 0.96f, 0.88f);
        scene.get(sun)->transform.setEulerDegrees(Vec3(-38, 32, 0));
    }
    EntityId torch = scene.createEntity("Gate Torch");
    scene.get(torch)->transform.position = Vec3(4.2f, 2.6f, 20.0f);
    scene.get(torch)->light = LightComponent();
    scene.get(torch)->light->type = LightType::Point;
    scene.get(torch)->light->color = Vec3(1.0f, 0.72f, 0.35f);
    scene.get(torch)->light->intensity = 2.2f;
    scene.get(torch)->light->range = 9.0f;
    scene.get(torch)->light->castShadow = false;
    scene.get(torch)->particles = ParticleComponent();
    scene.get(torch)->particles->color = Vec3(1.0f, 0.6f, 0.2f);
    scene.get(torch)->particles->size = 0.10f;
    scene.get(torch)->particles->lifetime = 0.9f;
    scene.get(torch)->particles->speed = 1.0f;
    scene.get(torch)->particles->count = 12;
    scene.get(torch)->particles->looping = true;

    // ---------------------------------------------------------------- scripts
    const std::string gemScript = writeScript(project, "gem.lua", R"LUA(
-- Gem: bobs up and down, spins, and pops with a message when picked up.
local base = nil
local bob = 0

function onStart(entity)
    base = Scene.getPosition(entity)      -- { x, y, z }
    Log.info("gem ready")
end

function onUpdate(entity, dt)
    if not base then return end
    bob = bob + dt
    Scene.setPosition(entity, base.x, base.y + math.sin(Time.time * 2.0) * 0.18, base.z)
    Scene.rotate(entity, 0, dt * 45.0, 0)
end

function onInteract(entity, other)
    UI.message("Gem collected - well done!", 2.5)
    local p = Scene.getPosition(entity)
    Effects.burst(p.x, p.y + 0.4, p.z, 1.0, 0.85, 0.3, 20)
end
)LUA");

    const std::string playerScript = writeScript(project, "player.lua", R"LUA(
-- Player: reports state and lets a script win the game with a key.
function onStart(entity)
    Log.info("player spawned")
    UI.message("Explore the island: collect the gems, open the gate", 5.0)
end

function onUpdate(entity, dt)
    local p = Scene.getPosition(entity)
    if p.y < -2.0 then
        UI.message("You fell into the sea - press R after dying to respawn", 2.0)
    end
end

function onDamaged(entity, amount)
    UI.message("Hit for " .. tostring(amount) .. " damage", 1.5)
end
)LUA");

    const std::string enemyScript = writeScript(project, "enemy.lua", R"LUA(
-- Enemy: taunts when it spots the player, dies with a burst.
function onStart(entity)
    Log.info("enemy ready")
end

function onDamaged(entity, amount)
    UI.message("Enemy hit for " .. tostring(amount), 1.0)
end

function onDeath(entity)
    UI.message("Enemy defeated!", 2.0)
    local p = Scene.getPosition(entity)
    Effects.burst(p.x, p.y + 1.0, p.z, 1.0, 0.3, 0.2, 24)
end
)LUA");

    if (!gemScript.empty()) scene.get(scene.findByName("Gem 1"))->script = ScriptComponent{gemScript, true, -1};
    if (!gemScript.empty()) scene.get(scene.findByName("Gem 2"))->script = ScriptComponent{gemScript, true, -1};
    if (!gemScript.empty()) scene.get(scene.findByName("Gem 3"))->script = ScriptComponent{gemScript, true, -1};
    if (!playerScript.empty()) scene.get(player)->script = ScriptComponent{playerScript, true, -1};
    const EntityId patroller = scene.findByName("Enemy");
    if (!enemyScript.empty() && patroller != kInvalidEntity)
        scene.get(patroller)->script = ScriptComponent{enemyScript, true, -1};

    // ------------------------------------------------------------------ camera
    const EntityId camera = scene.findByName("Main Camera");
    if (camera != kInvalidEntity) {
        scene.get(camera)->transform.position = Vec3(0, 8, -22);
        scene.get(camera)->transform.setEulerDegrees(Vec3(-14, 0, 0));
        scene.get(camera)->camera->fovDegrees = 60.0f;
    }

    scene.updateTransforms();
    const std::string sceneRel = fs::join(project.scenesDir(), "Island.nfscene.json");
    expect(scene.save(project.path(sceneRel)), "scene save");
    project.setStartScene(sceneRel);

    // ---------------------------------------------------------------- manifest
    project.settings.render.quality = "High";
    project.settings.build.gameName = "SampleIsland";
    project.settings.build.windowWidth = 1280;
    project.settings.build.windowHeight = 720;
    project.settings.ai.provider = "templates";
    expect(project.save(&error), "project save: " + error);

    // ------------------------------------------------------------------ report
    std::printf("sample project: %s\n", project.root().c_str());
    std::printf("  scene:   %s\n", sceneRel.c_str());
    std::printf("  entities: %zu\n", scene.count());
    std::printf("  scripts: gem.lua, player.lua, enemy.lua\n");
    std::printf("  materials: %s\n",
                std::to_string(assets.assetsOfType("Material").size()).c_str());
    if (failures) {
        std::fprintf(stderr, "%d step(s) failed\n", failures);
        return 1;
    }
    std::printf("done - open the folder with the editor, or run:\n"
                "  ./build/runtime/NovaForgeRuntime --project %s\n",
                outDir.c_str());
    return 0;
}
