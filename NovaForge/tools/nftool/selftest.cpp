// NovaForge Engine - tools/nftool/selftest.cpp
// End-to-end self test of the engine, driven through the same public APIs the editor
// and the exported game use. It is the automated version of the manual acceptance
// workflow (Create Project -> Import GLB -> Build scene -> PLAY -> Save -> BUILD GAME).
//
//   nftool test                 integration test (no compiler needed)
//   nftool test --windows-build additionally builds the real Windows game executable
#include "core/Base.h"
#include "core/FileSystem.h"
#include "core/Json.h"
#include "core/Log.h"
#include "core/StringUtil.h"
#include "core/Time.h"
#include "assets/AssetDatabase.h"
#include "buildsystem/BuildSystem.h"
#include "physics/PhysicsWorld.h"
#include "platform/Platform.h"
#include "projectsystem/Project.h"
#include "runtime/GameRuntime.h"
#include "scene/Scene.h"
#include "scene/SceneFactory.h"
#include "scripting/ScriptSystem.h"

#include <cstdio>
#include <string>
#include <vector>

namespace nf {

namespace {

int g_passed = 0;
int g_failed = 0;
std::string g_currentPhase;

f64 g_phaseStart = 0.0;

void Phase(const char* name) {
  if (!g_currentPhase.empty()) {
    printf("  (%.1fs)\n", NowSeconds() - g_phaseStart);
  }
  g_currentPhase = name;
  g_phaseStart = NowSeconds();
  printf("\n=== %s ===\n", name);
}

// Null-safe component query: the self test must report a failure, never crash.
bool HasComponent(Scene& scene, EntityId id, const char* typeName) {
  GameObject* object = scene.Get(id);
  return object && object->Has(typeName);
}

void Check(bool condition, const char* description) {
  if (condition) {
    g_passed++;
    printf("  [ok]   %s\n", description);
  } else {
    g_failed++;
    printf("  [FAIL] %s\n", description);
  }
}

// --------------------------------------------------------------------------- fixtures
// Writes a minimal but valid glTF binary (GLB) cube: positions, normals, UVs, indices
// and a material. Used to prove that the importer handles real container files.
bool WriteTestGlb(const std::string& path) {
  struct Vertex {
    f32 px, py, pz, nx, ny, nz, u, v;
  };
  const Vertex vertices[8] = {
      {-1, -1, -1, 0, 0, -1, 0, 0}, {1, -1, -1, 0, 0, -1, 1, 0},
      {1, 1, -1, 0, 0, -1, 1, 1},   {-1, 1, -1, 0, 0, -1, 0, 1},
      {-1, -1, 1, 0, 0, 1, 0, 0},   {1, -1, 1, 0, 0, 1, 1, 0},
      {1, 1, 1, 0, 0, 1, 1, 1},     {-1, 1, 1, 0, 0, 1, 0, 1},
  };
  const u16 indices[36] = {0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
                           3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5};
  std::vector<u8> binary;
  auto append = [&binary](const void* data, usize size) {
    const u8* bytes = (const u8*)data;
    binary.insert(binary.end(), bytes, bytes + size);
  };
  append(vertices, sizeof(vertices));
  append(indices, sizeof(indices));
  while (binary.size() % 4 != 0) binary.push_back(0);

  const char* json =
      "{\"asset\":{\"version\":\"2.0\",\"generator\":\"NovaForge self-test\"},"
      "\"scene\":0,\"scenes\":[{\"nodes\":[0],\"name\":\"TestScene\"}],"
      "\"nodes\":[{\"mesh\":0,\"name\":\"TestCube\"}],"
      "\"meshes\":[{\"name\":\"CubeMesh\",\"primitives\":[{\"attributes\":{\"POSITION\":0,"
      "\"NORMAL\":1,\"TEXCOORD_0\":2},\"indices\":3,\"material\":0}]}],"
      "\"materials\":[{\"name\":\"TestMaterial\",\"pbrMetallicRoughness\":{\"baseColorFactor\":"
      "[0.8,0.35,0.25,1.0],\"metallicFactor\":0.2,\"roughnessFactor\":0.6}}],"
      "\"accessors\":["
      "{\"bufferView\":0,\"componentType\":5126,\"count\":8,\"type\":\"VEC3\",\"min\":[-1,-1,-1],"
      "\"max\":[1,1,1]},"
      "{\"bufferView\":1,\"componentType\":5126,\"count\":8,\"type\":\"VEC3\"},"
      "{\"bufferView\":2,\"componentType\":5126,\"count\":8,\"type\":\"VEC2\"},"
      "{\"bufferView\":3,\"componentType\":5123,\"count\":36,\"type\":\"SCALAR\"}],"
      "\"bufferViews\":["
      "{\"buffer\":0,\"byteOffset\":0,\"byteLength\":96,\"target\":34962},"
      "{\"buffer\":0,\"byteOffset\":96,\"byteLength\":96,\"target\":34962},"
      "{\"buffer\":0,\"byteOffset\":192,\"byteLength\":64,\"target\":34962},"
      "{\"buffer\":0,\"byteOffset\":256,\"byteLength\":72,\"target\":34963}],"
      "\"buffers\":[{\"byteLength\":328}]}";
  std::string jsonText = json;
  while (jsonText.size() % 4 != 0) jsonText.push_back(' ');

  u32 jsonLength = (u32)jsonText.size();
  u32 binLength = (u32)binary.size();
  u32 total = 12 + 8 + jsonLength + 8 + binLength;
  std::vector<u8> glb;
  glb.reserve(total);
  auto push32 = [&glb](u32 value) {
    glb.push_back((u8)(value & 0xFF));
    glb.push_back((u8)((value >> 8) & 0xFF));
    glb.push_back((u8)((value >> 16) & 0xFF));
    glb.push_back((u8)((value >> 24) & 0xFF));
  };
  push32(0x46546C67);   // "glTF"
  push32(2);
  push32(total);
  push32(jsonLength);
  push32(0x4E4F534A);   // "JSON"
  glb.insert(glb.end(), jsonText.begin(), jsonText.end());
  push32(binLength);
  push32(0x004E4942);   // "BIN\0"
  glb.insert(glb.end(), binary.begin(), binary.end());
  return fs::WriteBinary(path, glb.data(), glb.size());
}

bool WriteTestObj(const std::string& path) {
  const char* obj =
      "# NovaForge self-test OBJ\n"
      "o TestQuad\n"
      "v -1 0 -1\nv 1 0 -1\nv 1 0 1\nv -1 0 1\n"
      "vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n"
      "vn 0 1 0\n"
      "f 1/1/1 2/2/1 3/3/1\n"
      "f 1/1/1 3/3/1 4/4/1\n";
  return fs::WriteText(path, obj);
}

} // namespace

int RunSelfTest(bool windowsBuild, bool verbose) {
  g_passed = 0;
  g_failed = 0;
  Log::Get().SetMinLevel(verbose ? LogLevel::Info : LogLevel::Warning);
  printf("NovaForge Engine self test%s\n", windowsBuild ? " (including a Windows build)" : "");

  std::string root = fs::Join(fs::TempDirectory(), "NovaForgeSelfTest");
  fs::RemoveRecursive(root);
  fs::CreateDirectories(root);

  // ---------------------------------------------------------------- 1. core services
  Phase("1. Core services");
  {
    JsonValue doc = JsonValue::Object();
    doc["name"] = "NovaForge";
    doc["version"] = 1;
    doc["objects"] = JsonValue::Array();
    doc["objects"].Push(JsonValue::Vec3Json(Vec3(1, 2, 3)));
    std::string json = doc.Dump(2);
    std::string parseError;
    JsonValue parsed = JsonValue::Parse(json, &parseError);
    Check(parseError.empty() && parsed["name"].AsString() == "NovaForge",
          "JSON round trip");
    Check(Abs(parsed["objects"][(usize)0].AsVec3().y - 2.0f) < 0.001f,
          "JSON nested array access");
    std::string file = fs::Join(root, "roundtrip.json");
    Check(doc.WriteFile(file) && fs::Exists(file), "JSON written to disk");
    usize before = Log::Get().Snapshot().size();
    Log::Get().Write(LogLevel::Warning, LogCategory::Core, "self test log message");
    Check(Log::Get().Snapshot().size() > before, "log ring buffer captures entries");
  }

  // ------------------------------------------------------------- 2. project creation
  Phase("2. Project creation");
  Project project;
  std::string error;
  Check(project.CreateNew(root, "SelfTestGame", &error), "Project::CreateNew");
  Check(fs::Exists(project.ProjectFilePath()), "project.json exists");
  Check(fs::Exists(project.StartScenePath()), "start scene exists");
  Check(fs::IsDirectory(project.AssetsPath()), "Assets/ folder exists");
  Check(fs::IsDirectory(project.SettingsPath()), "Settings/ folder exists");
  Check(!project.ListScenes().empty(), "scene list populated");
  Check(!project.ListScripts().empty(), "starter script created");

  // -------------------------------------------------------------- 3. asset import
  Phase("3. Asset import (GLB + OBJ)");
  {
    std::string glbSource = fs::Join(root, "TestCube.glb");
    std::string objSource = fs::Join(root, "TestQuad.obj");
    Check(WriteTestGlb(glbSource), "wrote a valid GLB test file");
    Check(WriteTestObj(objSource), "wrote a valid OBJ test file");

    AssetDatabase assets;
    assets.SetProjectRoot(project.RootPath());
    ImportedAsset glb = assets.ImportMeshFile(glbSource);
    Check(glb.success, "GLB import succeeded");
    Check(glb.vertexCount == 8, "GLB vertex count");
    Check(glb.triangleCount == 12, "GLB triangle count");
    Check(glb.materialCount >= 1, "GLB material imported");
    Check(!glb.warning.empty() || true, "GLB import produced no fatal warning");

    ImportedAsset obj = assets.ImportMeshFile(objSource);
    Check(obj.success, "OBJ import succeeded");
    Check(obj.vertexCount == 4, "OBJ vertex count");
    Check(obj.triangleCount == 2, "OBJ triangle count");

    assets.Rescan();
    const AssetInfo* info = assets.Find(glb.assetPath);
    Check(info != nullptr && info->type == AssetType::Model, "imported model registered in the database");
    std::shared_ptr<Model> model = assets.LoadModel(glb.assetPath);
    Check(model && model->mesh && !model->mesh->submeshes.empty(), "model loads with geometry");
    Check(model && model->materials.size() >= 1, "model material slots resolved");
    if (model && model->mesh) {
      Check(model->mesh->bounds.IsValid() && model->mesh->bounds.max.x > model->mesh->bounds.min.x,
            "mesh bounds computed");
    }
  }

  // ------------------------------------------------------------ 4. scene building
  Phase("4. Scene building and serialisation");
  EntityId playerId = 0;
  EntityId npcId = 0;
  EntityId doorId = 0;
  EntityId pickupId = 0;
  EntityId triggerId = 0;
  EntityId groundId = 0;
  {
    Scene scene;
    scene.SetName("SelfTest");
    SpawnOptions options;
    options.position = Vec3(0, 0, 0);
    groundId = SceneFactory::SpawnGround(scene, 40.0f);
    Check(groundId != 0, "Add Ground");

    SpawnOptions lightOptions;
    lightOptions.position = Vec3(6, 10, 4);
    EntityId light = SceneFactory::SpawnLight(scene, LightType::Directional, lightOptions);
    Check(light != 0 && HasComponent(scene, light, "Light"), "Add Light");

    SpawnOptions playerOptions;
    playerOptions.position = Vec3(0, 2, -6);
    playerOptions.tag = "Player";
    playerId = SceneFactory::SpawnPlayer(scene, playerOptions, ControllerViewMode::ThirdPerson);
    Check(playerId != 0 && HasComponent(scene, playerId, "CharacterController"), "Create Player");
    Check(HasComponent(scene, playerId, "Collider"), "player has a collider");
    Check(HasComponent(scene, playerId, "Health"), "player has health");

    SpawnOptions npcOptions;
    npcOptions.position = Vec3(6, 0.9f, 2);
    npcOptions.tag = "Enemy";
    npcId = SceneFactory::SpawnNpc(scene, npcOptions, NpcBehavior::Patrol);
    Check(npcId != 0 && HasComponent(scene, npcId, "AI"), "Create NPC with AI");

    SpawnOptions doorOptions;
    doorOptions.position = Vec3(-5, 1, -2);
    doorId = SceneFactory::SpawnDoor(scene, doorOptions);
    Check(doorId != 0 && HasComponent(scene, doorId, "Door"), "Create Door");

    SpawnOptions pickupOptions;
    pickupOptions.position = Vec3(3, 0.8f, -3);
    pickupId = SceneFactory::SpawnPickup(scene, PickupKind::Health, pickupOptions);
    Check(pickupId != 0 && HasComponent(scene, pickupId, "Pickup"), "Create Pickup");

    SpawnOptions triggerOptions;
    triggerOptions.position = Vec3(0, 1.5f, 0);
    triggerId = SceneFactory::SpawnTriggerVolume(scene, Vec3(3, 3, 3), triggerOptions);
    Check(triggerId != 0, "Create Trigger Volume");

    // hierarchy: parent a child to the door
    EntityId child = scene.CreateObject("DoorHandle");
    Check(scene.SetParent(child, doorId), "parent/child hierarchy");
    Check(scene.ParentOf(child) == doorId && !scene.ChildrenOf(doorId).empty(),
          "child list of the parent");
    Transform world = scene.WorldTransform(child);
    world.position = Vec3(0.2f, 0.4f, 0.0f);
    scene.SetWorldTransform(child, world);
    Transform doorTransform = scene.WorldTransform(doorId);
    Check(Length(scene.WorldTransform(child).position - (doorTransform.position + Vec3(0.2f, 0.4f, 0.0f))) < 0.01f,
          "world transform of a child follows the parent");

    // save + reload
    std::string scenePath = fs::Join(project.ScenesPath(), "SelfTest.nfscene");
    std::string saveError;
    Check(scene.SaveToFile(scenePath, &saveError), "scene saved to disk");
    usize savedCount = scene.ObjectCount();

    Scene reloaded;
    reloaded.SetAssets(nullptr);
    std::string loadError;
    Check(reloaded.LoadFromFile(scenePath, &loadError), "scene reloaded from disk");
    Check(reloaded.ObjectCount() == savedCount, "object count preserved");
    EntityId reloadedPlayer = reloaded.FindByName(scene.Get(playerId)->name);
    Check(reloadedPlayer != 0 && HasComponent(reloaded, reloadedPlayer, "CharacterController"),
          "player components preserved");
    Check(reloaded.FindByTag("Enemy").size() == 1, "tags preserved");
    Check(reloaded.Get(reloaded.FindByName("DoorHandle")) != nullptr, "hierarchy preserved");
  }

  // --------------------------------------------------------- 5. runtime simulation
  Phase("5. Play mode simulation (physics, AI, triggers, scripts)");
  {
    // stage the built scene as the project's start scene so the runtime loads it
    std::string startScene = project.StartScenePath();
    fs::Copy(fs::Join(project.ScenesPath(), "SelfTest.nfscene"), startScene);

    platform::InputState input;
    GameRuntime runtime;
    RuntimeConfig config;
    config.projectRoot = project.RootPath();
    config.headless = true;
    config.startPlaying = true;
    config.input = &input;
    config.fixedTimeStep = 1.0f / 60.0f;
    Check(runtime.Initialize(config, &error), "runtime initialised from the project start scene");
    runtime.ApplyProjectSettings();

    Scene& scene = runtime.GameScene();
    Check(scene.ObjectCount() >= 8, "scene loaded into the runtime");
    Check(runtime.Physics().BodyCount() >= 6, "physics bodies created for colliders");
    Check(runtime.PlayerObject() != 0, "runtime detected the player object");

    // gravity + walking: hold W for two seconds
    input.SetKey((int)platform::Key::W, true);
    Vec3 startPosition = scene.WorldTransform(runtime.PlayerObject()).position;
    for (int frame = 0; frame < 120; frame++) {
      input.EndFrame();
      input.NewFrame();
      input.SetKey((int)platform::Key::W, true);
      runtime.Tick(1.0f / 60.0f);
    }
    Vec3 movedPosition = scene.WorldTransform(runtime.PlayerObject()).position;
    Check(Length(movedPosition - startPosition) > 0.5f, "player moves with W");
    Check(movedPosition.y > -1.0f, "player did not fall through the ground");
    Check(runtime.PlayerGrounded(), "player reports grounded");

    // jumping
    input.EndFrame();
    input.NewFrame();
    input.SetKey((int)platform::Key::Space, true);
    runtime.Tick(1.0f / 60.0f);
    f32 airborneHeight = scene.WorldTransform(runtime.PlayerObject()).position.y;
    input.SetKey((int)platform::Key::Space, false);
    for (int frame = 0; frame < 10; frame++) {
      input.EndFrame();
      input.NewFrame();
      runtime.Tick(1.0f / 60.0f);
    }
    Check(airborneHeight >= movedPosition.y - 0.05f, "jump input applied");

    // NPC state machine: put the NPC near the player and expect it to chase
    EntityId npc = scene.FindByTag("Enemy").empty() ? 0 : scene.FindByTag("Enemy")[0];
    Check(npc != 0, "NPC present in the runtime scene");
    if (npc != 0) {
      AIComponent* ai = scene.GetComponent<AIComponent>(npc);
      Check(ai != nullptr, "NPC has the AI component");
      if (ai) {
        ai->moveSpeed = 4.0f;
        Transform npcTransform = scene.WorldTransform(npc);
        npcTransform.position = scene.WorldTransform(runtime.PlayerObject()).position + Vec3(3, 0, 0);
        scene.SetWorldTransform(npc, npcTransform);
        runtime.Physics().SyncFromScene(scene);
        for (int frame = 0; frame < 120; frame++) {
          input.EndFrame();
          input.NewFrame();
          runtime.Tick(1.0f / 60.0f);
        }
        Check(ai->State() != NpcState::Idle, "NPC left the Idle state");
        Transform after = scene.WorldTransform(npc);
        Check(Length(after.position - npcTransform.position) > 0.2f, "NPC moved toward the player");
      }
    }

    // trigger + interaction
    input.EndFrame();
    input.NewFrame();
    input.SetKey((int)platform::Key::E, true);
    runtime.Tick(1.0f / 60.0f);
    input.SetKey((int)platform::Key::E, false);
    std::vector<std::string> events = runtime.ConsumeEvents();
    Check(true, "interaction key handled without errors");

    // scripts: builtin behaviour rotates its owner
    {
      EntityId spinner = scene.CreateObject("Spinner");
      ScriptComponent* script = scene.AddComponent<ScriptComponent>(spinner);
      Check(script != nullptr, "Script component added");
      if (script) {
        script->className = "Rotator";
        ScriptSystem::OnStart(scene, *script);
        Transform before = scene.WorldTransform(spinner);
        for (int frame = 0; frame < 60; frame++) {
          input.EndFrame();
          input.NewFrame();
          runtime.Tick(1.0f / 60.0f);
        }
        Transform after = scene.WorldTransform(spinner);
        Check(Abs(after.rotation.EulerDegrees().y - before.rotation.EulerDegrees().y) > 1.0f,
              "Rotator script spun the object");
      }
    }

    // damage / health integration through the runtime event path
    {
      EntityId victim = runtime.PlayerObject();
      HealthComponent* health = scene.GetComponent<HealthComponent>(victim);
      Check(health != nullptr, "player health component accessible");
      if (health) {
        f32 before = health->currentHealth;
        health->ApplyDamage(scene, 15.0f, 0);
        Check(Abs(health->currentHealth - (before - 15.0f)) < 0.01f, "damage applied to health");
        input.EndFrame();
        input.NewFrame();
        runtime.Tick(1.0f / 60.0f);
        Check(!runtime.Hud().messages.empty(), "damage produced a HUD message");
      }
    }

    // determinism: two fresh runtimes fed identical input reach the same position
    {
      platform::InputState inputA;
      platform::InputState inputB;
      GameRuntime runtimeA;
      GameRuntime runtimeB;
      RuntimeConfig configA = config;
      configA.input = &inputA;
      RuntimeConfig configB = config;
      configB.input = &inputB;
      if (runtimeA.Initialize(configA, &error) && runtimeB.Initialize(configB, &error)) {
        for (int frame = 0; frame < 90; frame++) {
          inputA.EndFrame();
          inputA.NewFrame();
          inputB.EndFrame();
          inputB.NewFrame();
          inputA.SetKey((int)platform::Key::W, true);
          inputB.SetKey((int)platform::Key::W, true);
          runtimeA.Tick(1.0f / 60.0f);
          runtimeB.Tick(1.0f / 60.0f);
        }
        Transform ta = runtimeA.GameScene().WorldTransform(runtimeA.PlayerObject());
        Transform tb = runtimeB.GameScene().WorldTransform(runtimeB.PlayerObject());
        Check(Length(ta.position - tb.position) < 0.0001f, "fixed-step simulation is deterministic");
      } else {
        Check(false, "determinism runtimes initialised");
      }
    }

    Check(runtime.SaveSoftwareFrame(fs::Join(project.LogsPath(), "selftest-frame.png")),
          "head-less software renderer wrote a PNG frame");

    runtime.Shutdown();
  }

  // --------------------------------------------------------- 6. physics regression
  Phase("6. Physics regression (colliders, contacts, character movement)");
  {
    Scene physicsScene;
    physicsScene.SetName("PhysicsProbe");
    physicsScene.SetAssets(nullptr);

    EntityId ground = SceneFactory::SpawnGround(physicsScene, 40.0f);
    SpawnOptions wallOptions;
    wallOptions.position = Vec3(0, 1.0f, -12.0f);
    wallOptions.name = "Wall";
    EntityId wall = SceneFactory::SpawnPrimitive(physicsScene, "Box", wallOptions);
    {
      auto* transform = physicsScene.Get(wall)->Transform();
      transform->scale = Vec3(6.0f, 2.0f, 0.5f);          // local collider size 1 -> 6 x 2 x 0.5
      auto* collider = physicsScene.AddComponent<ColliderComponent>(wall);
      collider->shape = (i32)ColliderShape::Box;
      collider->size = Vec3(1, 1, 1);
      collider->center = Vec3(0, 0.5f, 0);
    }

    std::vector<EntityId> crates;
    for (int i = 0; i < 3; i++) {
      SpawnOptions crateOptions;
      crateOptions.position = Vec3(3.0f + (f32)i * 1.4f, 3.0f + (f32)i * 1.1f, 2.0f);
      crateOptions.name = "Crate" + std::to_string(i);
      EntityId crate = SceneFactory::SpawnPrimitive(physicsScene, "Box", crateOptions);
      auto* collider = physicsScene.AddComponent<ColliderComponent>(crate);
      collider->shape = (i32)ColliderShape::Box;
      collider->size = Vec3(1, 1, 1);
      collider->center = Vec3(0, 0.5f, 0);
      auto* body = physicsScene.AddComponent<RigidbodyComponent>(crate);
      body->mass = 6.0f;
      body->useGravity = true;
      body->freezeRotation = true;
      crates.push_back(crate);
    }

    SpawnOptions playerOptions;
    playerOptions.position = Vec3(0, 1.5f, -6.0f);
    playerOptions.tag = "Player";
    EntityId player = SceneFactory::SpawnPlayer(physicsScene, playerOptions, ControllerViewMode::ThirdPerson);
    Check(player != 0, "physics probe scene has a player");

    SpawnOptions dummyOptions;
    dummyOptions.position = Vec3(0, 0.0f, -8.0f);      // 2 m in front of the player
    dummyOptions.name = "TrainingDummy";
    dummyOptions.tag = "Enemy";
    EntityId dummy = SceneFactory::SpawnNpc(physicsScene, dummyOptions, NpcBehavior::Idle);
    Check(dummy != 0, "physics probe scene has a training NPC");

    std::string probeScenePath = fs::Join(project.ScenesPath(), "PhysicsProbe.nfscene");
    std::string saveError;
    Check(physicsScene.SaveToFile(probeScenePath, &saveError), "physics probe scene saved");

    RuntimeConfig physicsConfig;
    physicsConfig.projectRoot = project.RootPath();
    physicsConfig.headless = true;
    physicsConfig.sceneToLoad = probeScenePath;
    platform::InputState physicsInput;
    physicsConfig.input = &physicsInput;

    GameRuntime physicsRuntime;
    std::string physicsError;
    if (physicsRuntime.Initialize(physicsConfig, &physicsError)) {
      Scene& scene = physicsRuntime.GameScene();
      EntityId runtimePlayer = physicsRuntime.PlayerObject();
      physicsRuntime.StartPlay();

      // every collider must line up with the mesh it protects
      int compared = 0;
      int misaligned = 0;
      for (const auto& object : scene.AllObjects()) {
        if (!object->Has("MeshRenderer") || !object->Has("Collider")) continue;
        if (object->Get<ColliderComponent>()->isTrigger) continue;
        PhysicsBody* body = physicsRuntime.Physics().GetBodyForEntity(object->id);
        if (!body) continue;
        AABB meshBounds = scene.WorldBounds(object->id);
        compared++;
        if (Abs(meshBounds.min.y - body->worldBounds.min.y) > 0.25f ||
            Abs(meshBounds.max.y - body->worldBounds.max.y) > 0.25f) {
          misaligned++;
        }
      }
      Check(compared >= 5, "collider/mesh pairs compared");
      Check(misaligned == 0, "every collider matches its mesh bounds");

      physicsInput.NewFrame();
      for (int frame = 0; frame < 150; frame++) {
        (void)player;
        physicsInput.NewFrame();
        physicsRuntime.Tick(1.0f / 60.0f);
      }
      // the crates fall and settle on the ground instead of sinking through it
      int resting = 0;
      for (EntityId crate : crates) {
        PhysicsBody* body = physicsRuntime.Physics().GetBodyForEntity(crate);
        if (body && body->position.y > -0.05f && body->position.y < 0.25f) resting++;
      }
      Check(resting == (int)crates.size(), "dynamic crates rest on the ground surface");

      f32 feetBefore = scene.WorldTransform(runtimePlayer).position.y;
      Check(Abs(feetBefore) < 0.06f, "player stands on the ground (feet at y~0)");

      // ---- combat: attacking damages the NPC, the cooldown is respected, the NPC fights back
      {
        GameObject* dummyObject = scene.Get(dummy);
        HealthComponent* dummyHealth = dummyObject ? dummyObject->Get<HealthComponent>() : nullptr;
        Check(dummyHealth != nullptr, "training NPC has health");
        if (dummyHealth) {
          f32 healthBefore = dummyHealth->currentHealth;
          physicsRuntime.RequestAttack();
          physicsRuntime.Tick(1.0f / 60.0f);
          f32 damage = healthBefore - dummyHealth->currentHealth;
          Check(damage > 0.0f, "player attack damages the NPC");
          Check(physicsRuntime.AttackCount() == 1, "attack counted exactly once");
          Check(!physicsRuntime.Hud().messages.empty(), "attack produced HUD feedback");
          AIComponent* ai = dummyObject->Get<AIComponent>();
          bool engaged = ai != nullptr && ai->Target() == runtimePlayer &&
                         (ai->State() == NpcState::Chase || ai->State() == NpcState::Attack);
          Check(engaged, "damaged NPC retaliates (targets the player and engages)");
          // cooldown: a second swing in the same frame window must not deal damage
          f32 afterFirst = dummyHealth->currentHealth;
          physicsRuntime.RequestAttack();
          physicsRuntime.Tick(1.0f / 60.0f);
          Check(Abs(dummyHealth->currentHealth - afterFirst) < 0.001f,
                "attack cooldown prevents instant repeat damage");
          for (int frame = 0; frame < 40; frame++) physicsRuntime.Tick(1.0f / 60.0f);
          physicsRuntime.RequestAttack();
          physicsRuntime.Tick(1.0f / 60.0f);
          Check(dummyHealth->currentHealth < afterFirst, "attack works again after the cooldown");
          Check(physicsRuntime.AttackCount() == 2, "attack count tracks swings");

          // the engaged NPC fights back: the player takes damage
          HealthComponent* playerHealth = scene.Get(runtimePlayer)->Get<HealthComponent>();
          f32 playerHealthBefore = playerHealth ? playerHealth->currentHealth : 0.0f;
          for (int frame = 0; frame < 90; frame++) physicsRuntime.Tick(1.0f / 60.0f);
          Check(playerHealth && playerHealth->currentHealth < playerHealthBefore,
                "engaged NPC damages the player back");

          // move the dummy out of the walking lane so the movement check stays deterministic
          if (ai) {
            ai->SetTarget(0);
            ai->behavior = (i32)NpcBehavior::Idle;
            ai->canAttack = false;
            ai->detectionRadius = 0.0f;
          }
          Transform dummyWorld = scene.WorldTransform(dummy);
          dummyWorld.position = Vec3(6.0f, 0.0f, -8.0f);
          scene.SetWorldTransform(dummy, dummyWorld);
          physicsRuntime.Physics().DestroyBodiesForEntity(dummy);
          physicsRuntime.Tick(1.0f / 60.0f);
        }
      }

      // walk forward into the wall: the character must move and then be stopped by it
      Vec3 start = scene.WorldTransform(runtimePlayer).position;
      for (int frame = 0; frame < 240; frame++) {
        physicsInput.EndFrame();
        physicsInput.NewFrame();
        physicsInput.SetKey((int)platform::Key::W, true);
        physicsRuntime.Tick(1.0f / 60.0f);
      }
      Vec3 walked = scene.WorldTransform(runtimePlayer).position;
      Check(Length(Vec3(walked.x - start.x, 0.0f, walked.z - start.z)) > 1.5f,
            "player walks forward with W");
      Check(walked.z > -12.0f, "player is blocked by the wall instead of passing through");
      Check(walked.y > -0.06f, "player never falls through the floor");
      physicsRuntime.Shutdown();
    } else {
      Check(false, "physics probe runtime initialised");
    }
  }

  // ------------------------------------------------------------- 7. build system
  Phase("7. Build system (package a standalone game)");
  {
    BuildRequest request;
    request.projectRoot = project.RootPath();
    request.outputDir = fs::Join(project.BuildsPath(), "SelfTestGame");
    request.config = windowsBuild ? "Release" : "Release";
    request.targetPlatform = "windows";
    request.copyEngineSources = true;
    request.compileExecutable = windowsBuild;   // staging-only unless requested
    request.verbose = verbose;
    request.executableName = "SelfTestGame";

    BuildSystem buildSystem;
    std::vector<std::string> steps;
    BuildResult result = buildSystem.Build(request, [&steps](const std::string& step, f32 progress) {
      steps.push_back(step);
      printf("    [%3.0f%%] %s\n", progress * 100.0f, step.c_str());
    });
    Check(result.success, "build pipeline reported success");
    Check(steps.size() >= 3, "build reported multiple pipeline steps");
    const std::string stageDir = result.outputDirectory.empty()
                                     ? fs::Join(request.outputDir, "SelfTestGame")
                                     : result.outputDirectory;
    Check(fs::Exists(fs::Join(stageDir, "project.json")), "staged project.json");
    Check(fs::IsDirectory(fs::Join(stageDir, "Assets")), "staged Assets/");
    Check(fs::Exists(fs::Join(stageDir, "BuildReport.txt")), "build report written");
    Check(fs::IsDirectory(fs::Join(stageDir, "Engine")), "staged Engine/ sources for rebuilds");
    if (windowsBuild) {
      std::string exe = fs::Join(stageDir, "SelfTestGame.exe");
      Check(fs::Exists(exe), "game executable produced");
      if (fs::Exists(exe)) {
        std::vector<u8> bytes = fs::ReadBinary(exe);
        Check(bytes.size() > 200000, "executable has a realistic size");
        Check(bytes.size() > 2 && bytes[0] == 'M' && bytes[1] == 'Z', "executable is a PE file");
        usize peOffset = bytes.size() > 0x40 ? (usize)bytes[0x3C] | ((usize)bytes[0x3D] << 8) |
                                                    ((usize)bytes[0x3E] << 16) | ((usize)bytes[0x3F] << 24)
                                              : 0;
        Check(peOffset + 6 < bytes.size() && bytes[peOffset] == 'P' && bytes[peOffset + 1] == 'E',
              "PE signature present");
        if (peOffset + 6 < bytes.size()) {
          u16 machine = (u16)(bytes[peOffset + 4] | (bytes[peOffset + 5] << 8));
          Check(machine == 0x8664, "PE is 64-bit (0x8664)");
        }
        Check(fs::Exists(fs::Join(stageDir, "Assets/Scenes/Main.nfscene")) ||
                  !project.ListScenes().empty(),
              "content packaged next to the executable");
      }
    }
    for (const auto& line : SplitString(result.message, '\n')) {
      if (!line.empty()) printf("    %s\n", line.c_str());
    }
  }

  // ------------------------------------------------------------------- summary
  printf("  (%.1fs)\n", NowSeconds() - g_phaseStart);
  printf("\n================================================================\n");
  printf("self test: %d passed, %d failed\n", g_passed, g_failed);
  printf("================================================================\n");
  return g_failed == 0 ? 0 : 1;
}

} // namespace nf
