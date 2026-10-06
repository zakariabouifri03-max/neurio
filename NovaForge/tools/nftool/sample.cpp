// NovaForge Engine - tools/nftool/sample.cpp
// Builds the bundled sample projects through the real engine APIs (Project + SceneFactory),
// so the sample content can never drift away from what the editor creates by hand.
//
//   nftool sample <parent-dir> [Name]      create a playable sample project
#include "core/Base.h"
#include "core/FileSystem.h"
#include "core/Log.h"
#include "core/StringUtil.h"
#include "projectsystem/Project.h"
#include "scene/Scene.h"
#include "scene/SceneFactory.h"
#include "scene/Components.h"
#include "scripting/ScriptSystem.h"

#include <cstdio>

namespace nf {

namespace {

EntityId Spawn(Scene& scene, EntityId id, const std::string& name, const std::string& tag = "") {
  if (GameObject* object = scene.Get(id)) {
    object->name = name;
    if (!tag.empty()) object->tag = tag;
  }
  return id;
}

// A crate that can be pushed around / broken.
EntityId MakeCrate(Scene& scene, const Vec3& position, const Vec3& scale, const Vec4& color,
                   const char* name) {
  SpawnOptions options;
  options.position = position;
  options.scale = scale;
  options.name = name;
  EntityId id = SceneFactory::SpawnPrimitive(scene, "Box", options);
  if (GameObject* object = scene.Get(id)) {
    if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>())
      renderer->baseColor = color;
    ColliderComponent* collider = scene.AddComponent<ColliderComponent>(id);
    if (collider) {
      collider->shape = (i32)ColliderShape::Box;
      collider->size = Vec3(1, 1, 1);         // local size: the transform scale is applied on top
      collider->center = Vec3(0, 0.5f, 0);
    }
    RigidbodyComponent* body = scene.AddComponent<RigidbodyComponent>(id);
    if (body) {
      body->mass = 2.0f;
      body->useGravity = true;
    }
  }
  return id;
}

} // namespace

// ----------------------------------------------------------------------------- sample
int CreateSampleProject(const std::string& parentDir, const std::string& nameIn,
                        std::string* outRoot) {
  std::string name = nameIn.empty() ? "SampleIsland" : nameIn;
  Project project;
  std::string error;
  if (!project.CreateNew(parentDir, name, &error)) {
    printf("ERROR: %s\n", error.c_str());
    return 1;
  }
  if (outRoot) *outRoot = project.RootPath();

  project.Settings().name = name;
  project.Settings().description = "NovaForge Engine sample project - walk, jump, fight, explore.";
  project.Settings().width = 1280;
  project.Settings().height = 720;
  project.Settings().vsync = true;
  project.Settings().quality = 2;

  // ---------------------------------------------------------------- scripts first
  struct ScriptSpec {
    const char* name;
    const char* behavior;
  };
  const ScriptSpec scripts[] = {
      {"Spinner", "Rotator"},          {"BobbingCrate", "Bobber"},
      {"MovingPlatform", "MovingPlatform"}, {"GuardedDoor", "TriggerAction"},
  };
  for (const ScriptSpec& spec : scripts) {
    std::string relative;
    if (!project.CreateScript(spec.name, spec.behavior, &relative)) {
      printf("WARNING: could not create script %s\n", spec.name);
    }
  }

  // ------------------------------------------------------------------- the level
  Scene scene;
  scene.SetName(name);

  SpawnOptions groundOptions;
  groundOptions.position = Vec3(0, 0, 0);
  groundOptions.name = "Ground";
  EntityId ground = SceneFactory::SpawnGround(scene, 60.0f, groundOptions);

  // a second, raised island to jump onto
  SpawnOptions platformOptions;
  platformOptions.position = Vec3(9, 1.6f, -4);
  platformOptions.scale = Vec3(10, 0.6f, 10);
  platformOptions.name = "RaisedPlatform";
  platformOptions.tag = "Ground";
  EntityId platform = SceneFactory::SpawnPrimitive(scene, "Box", platformOptions);
  if (GameObject* object = scene.Get(platform)) {
    if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>())
      renderer->baseColor = Vec4(0.42f, 0.44f, 0.48f, 1.0f);
    ColliderComponent* collider = scene.AddComponent<ColliderComponent>(platform);
    if (collider) {
      collider->shape = (i32)ColliderShape::Box;
      collider->size = Vec3(1, 1, 1);
      collider->center = Vec3(0, 0.5f, 0);
    }
  }

  // lighting: sun + warm point light near the door
  SpawnOptions sunOptions;
  sunOptions.position = Vec3(12, 18, 8);
  sunOptions.name = "Sun";
  sunOptions.rotationEuler = Vec3(50, -35, 0);
  EntityId sun = SceneFactory::SpawnLight(scene, LightType::Directional, sunOptions);
  if (GameObject* object = scene.Get(sun)) {
    if (LightComponent* light = object->Get<LightComponent>()) {
      light->color = Vec3(1.0f, 0.96f, 0.86f);
      light->intensity = 1.15f;
      light->castShadows = true;
    }
  }
  SpawnOptions lampOptions;
  lampOptions.position = Vec3(-6, 3.4f, 2);
  lampOptions.name = "DoorLamp";
  EntityId lamp = SceneFactory::SpawnLight(scene, LightType::Point, lampOptions);
  if (GameObject* object = scene.Get(lamp)) {
    if (LightComponent* light = object->Get<LightComponent>()) {
      light->color = Vec3(1.0f, 0.78f, 0.45f);
      light->intensity = 2.4f;
      light->range = 14.0f;
    }
  }

  // the player: third person controller with collider, health and an interaction prompt
  SpawnOptions playerOptions;
  playerOptions.position = Vec3(0, 1.2f, -8);
  playerOptions.name = "Player";
  playerOptions.tag = "Player";
  EntityId player = SceneFactory::SpawnPlayer(scene, playerOptions, ControllerViewMode::ThirdPerson);
  if (GameObject* object = scene.Get(player)) {
    if (CharacterControllerComponent* controller = object->Get<CharacterControllerComponent>()) {
      controller->moveSpeed = 5.5f;
      controller->sprintMultiplier = 1.8f;
      controller->jumpHeight = 1.35f;
      controller->cameraDistance = 4.5f;
    }
    if (HealthComponent* health = object->Get<HealthComponent>()) {
      health->maxHealth = 120.0f;
      health->currentHealth = 120.0f;
      health->isPlayer = true;
      health->regenerationPerSecond = 2.0f;
    }
  }

  // NPCs: one patrolling guard, two chasers
  struct NpcSpec {
    Vec3 position;
    const char* name;
    NpcBehavior behavior;
    f32 speed;
    f32 damage;
  };
  const NpcSpec npcs[] = {
      {Vec3(-9, 0.9f, 7), "Guard", NpcBehavior::Patrol, 2.6f, 8.0f},
      {Vec3(11, 2.5f, -6), "Brute", NpcBehavior::Chase, 3.4f, 14.0f},
      {Vec3(6, 0.9f, 9), "Scout", NpcBehavior::Chase, 4.0f, 6.0f},
  };
  int npcIndex = 0;
  for (const NpcSpec& spec : npcs) {
    SpawnOptions npcOptions;
    npcOptions.position = spec.position;
    npcOptions.name = spec.name;
    npcOptions.tag = "Enemy";
    EntityId npc = SceneFactory::SpawnNpc(scene, npcOptions, spec.behavior);
    if (GameObject* object = scene.Get(npc)) {
      if (AIComponent* ai = object->Get<AIComponent>()) {
        ai->moveSpeed = spec.speed;
        ai->chaseSpeed = spec.speed + 1.2f;
        ai->attackDamage = spec.damage;
        ai->detectionRadius = 16.0f;
        ai->patrolPoints = {Vec3(-12, 0.9f, 4), Vec3(-12, 0.9f, 12), Vec3(-4, 0.9f, 12)};
        ai->targetTag = "Player";
      }
      if (HealthComponent* health = object->Get<HealthComponent>()) {
        health->maxHealth = 60.0f;
        health->currentHealth = 60.0f;
      }
    }
    npcIndex++;
  }

  // a door that opens when the player gets close, guarded by a trigger volume
  SpawnOptions doorOptions;
  doorOptions.position = Vec3(-4.6f, 0.0f, 4.5f);
  doorOptions.rotationEuler = Vec3(0, 90, 0);
  doorOptions.name = "Gate";
  EntityId door = SceneFactory::SpawnDoor(scene, doorOptions);
  if (GameObject* object = scene.Get(door)) {
    if (DoorComponent* doorComponent = object->Get<DoorComponent>()) {
      doorComponent->openAngle = 95.0f;
      doorComponent->openSpeed = 120.0f;
      doorComponent->autoClose = true;
      doorComponent->autoCloseDelay = 4.0f;
      doorComponent->openSpeed = 120.0f;
    }
  }

  // pickups: health + ammo
  SpawnOptions healthPickup;
  healthPickup.position = Vec3(3.5f, 0.9f, -2.5f);
  healthPickup.name = "HealthPack";
  SceneFactory::SpawnPickup(scene, PickupKind::Health, healthPickup);
  SpawnOptions ammoPickup;
  ammoPickup.position = Vec3(-2.0f, 0.9f, -6.5f);
  ammoPickup.name = "AmmoBox";
  SceneFactory::SpawnPickup(scene, PickupKind::Ammo, ammoPickup);

  // a trigger volume that greets the player, plus a spinning crate driven by a script
  SpawnOptions triggerOptions;
  triggerOptions.position = Vec3(0, 1.5f, 2);
  triggerOptions.name = "WelcomeTrigger";
  EntityId trigger = SceneFactory::SpawnTriggerVolume(scene, Vec3(6, 3, 6), triggerOptions);
  if (GameObject* object = scene.Get(trigger)) {
    if (TriggerVolumeComponent* volume = object->Get<TriggerVolumeComponent>()) {
      volume->message = "Message:Welcome to NovaForge! Find the gate and fight the guards.";
      volume->oneShot = true;
      volume->action = 1;   // TriggerAction::ShowMessage
    }
  }

  EntityId spinner = MakeCrate(scene, Vec3(-1.5f, 0.4f, -3.0f), Vec3(1.0f, 1.0f, 1.0f),
                              Vec4(0.85f, 0.62f, 0.25f, 1.0f), "SpinningCrate");
  if (GameObject* object = scene.Get(spinner)) {
    object->tag = "Pickup";
    if (ScriptComponent* script = scene.AddComponent<ScriptComponent>(spinner)) {
      script->className = "Rotator";
      script->sourcePath = "Assets/Scripts/Spinner.nfscript";
    }
  }

  // scenery: a few static crates and pillars
  MakeCrate(scene, Vec3(5.5f, 0.4f, -1.0f), Vec3(1.0f, 1.0f, 1.0f), Vec4(0.55f, 0.42f, 0.30f, 1.0f),
            "Crate1");
  MakeCrate(scene, Vec3(6.4f, 0.4f, -1.9f), Vec3(1.0f, 1.0f, 1.0f), Vec4(0.55f, 0.42f, 0.30f, 1.0f),
            "Crate2");
  MakeCrate(scene, Vec3(-8.5f, 0.4f, -3.0f), Vec3(1.2f, 1.2f, 1.2f), Vec4(0.62f, 0.30f, 0.30f, 1.0f),
            "RedCrate");
  for (int i = 0; i < 4; i++) {
    SpawnOptions pillarOptions;
    pillarOptions.position = Vec3(-14.0f + (f32)i * 6.0f, 2.0f, 14.0f);
    pillarOptions.name = Format("Pillar%d", i + 1);
    pillarOptions.scale = Vec3(1.2f, 4.0f, 1.2f);
    EntityId pillar = SceneFactory::SpawnPrimitive(scene, "Cylinder", pillarOptions);
    if (GameObject* object = scene.Get(pillar)) {
      if (MeshRendererComponent* renderer = object->Get<MeshRendererComponent>())
        renderer->baseColor = Vec4(0.68f, 0.66f, 0.60f, 1.0f);
    }
    (void)pillar;
  }

  // a quest tracker that makes the objective show up in the HUD
  SpawnOptions questOptions;
  questOptions.position = Vec3(0, 0, 0);
  questOptions.name = "Objectives";
  EntityId quest = SceneFactory::SpawnQuest(scene, "Survive the island", questOptions);
  (void)quest;

  // an audio source (the file is optional; a missing clip is reported, never fatal)
  SpawnOptions audioOptions;
  audioOptions.position = Vec3(0, 1.0f, 0);
  audioOptions.name = "Ambience";
  SceneFactory::SpawnAudioSource(scene, "Assets/Audio/ambience.wav", audioOptions);

  (void)ground;
  (void)npcIndex;

  // ------------------------------------------------------------------ save it all
  std::string sceneRelative = "Assets/Scenes/SampleIsland.nfscene";
  std::string scenePath = fs::Join(project.RootPath(), sceneRelative);
  std::string saveError;
  if (!scene.SaveToFile(scenePath, &saveError)) {
    printf("ERROR: could not save the sample scene: %s\n", saveError.c_str());
    return 1;
  }
  project.Settings().startScene = sceneRelative;
  project.RecordOpenedScene(sceneRelative);
  if (!project.Save(&error)) {
    printf("ERROR: could not save project.json: %s\n", error.c_str());
    return 1;
  }

  // a small procedurally generated ambience loop so the audio source has a real clip to play
  {
    std::string audioDir = fs::Join(project.AssetsPath(), "Audio");
    fs::CreateDirectories(audioDir);
    const int sampleRate = 22050;
    const int seconds = 4;
    const int sampleCount = sampleRate * seconds;
    std::vector<f32> samples((usize)sampleCount);
    for (int i = 0; i < sampleCount; i++) {
      f32 t = (f32)i / (f32)sampleRate;
      f32 pad = 0.20f * Sin(kTwoPi * 110.0f * t) + 0.14f * Sin(kTwoPi * 164.81f * t) +
                0.10f * Sin(kTwoPi * 220.0f * t);
      f32 swell = 0.6f + 0.4f * Sin(kTwoPi * (1.0f / (f32)seconds) * t);
      samples[(usize)i] = pad * swell;
    }
    std::vector<u8> wav;
    auto push32 = [&wav](u32 v) {
      wav.push_back((u8)(v & 0xFF));
      wav.push_back((u8)((v >> 8) & 0xFF));
      wav.push_back((u8)((v >> 16) & 0xFF));
      wav.push_back((u8)((v >> 24) & 0xFF));
    };
    auto push16 = [&wav](u16 v) {
      wav.push_back((u8)(v & 0xFF));
      wav.push_back((u8)((v >> 8) & 0xFF));
    };
    const u32 dataBytes = (u32)(sampleCount * sizeof(i16));
    wav.insert(wav.end(), {'R', 'I', 'F', 'F'});
    push32(36 + dataBytes);
    wav.insert(wav.end(), {'W', 'A', 'V', 'E'});
    wav.insert(wav.end(), {'f', 'm', 't', ' '});
    push32(16);
    push16(1);                  // PCM
    push16(1);                  // mono
    push32((u32)sampleRate);
    push32((u32)(sampleRate * sizeof(i16)));
    push16((u16)sizeof(i16));
    push16(16);
    wav.insert(wav.end(), {'d', 'a', 't', 'a'});
    push32(dataBytes);
    for (f32 value : samples) {
      f32 clamped = Clamp(value, -1.0f, 1.0f);
      push16((u16)(i16)(clamped * 32000.0f));
    }
    fs::WriteBinary(fs::Join(audioDir, "ambience.wav"), wav.data(), wav.size());
  }

  // a README the user can read before playing
  std::string readme;
  readme += "# " + name + " - NovaForge sample project\n\n";
  readme += "Open this folder in NovaForge (`File > Open Project`) or press Play in the editor.\n";
  readme += "The packaged build in `Builds/` is a standalone game - no editor required.\n\n";
  readme += "## Controls\n";
  readme += "| Input | Action |\n|---|---|\n";
  readme += "| W A S D | Move |\n| Shift | Sprint |\n| Space | Jump |\n";
  readme += "| Mouse | Look (click the window to capture the cursor) |\n";
  readme += "| E | Interact (doors, pickups, NPCs) |\n";
  readme += "| Left mouse / F | Attack (NPCs fight back) |\n";
  readme += "| Esc | Pause menu / release the cursor |\n| F5 | Quick save |\n";
  readme += "| F11 | Toggle fullscreen |\n| F1 | Toggle the on-screen HUD |\n\n";
  readme += "Logs are written to `Logs/Game.log` next to the executable.\n\n";
  readme += "## Scene contents (" + std::to_string(scene.ObjectCount()) + " objects)\n";
  readme += "- Player (third person controller, collider, 120 HP)\n";
  readme += "- 3 NPCs using the state machine (Patrol / Chase / Attack)\n";
  readme += "- Gate with an opening door, trigger volume and interaction prompt\n";
  readme += "- Health + ammo pickups, pushable crates, a script-driven spinning crate\n";
  readme += "- Directional sun with shadows + a point lamp\n";
  fs::WriteText(fs::Join(project.RootPath(), "README.md"), readme);

  printf("Created sample project '%s' in %s\n", name.c_str(), project.RootPath().c_str());
  printf("  scene   : %s (%zu objects)\n", sceneRelative.c_str(), scene.ObjectCount());
  printf("  scripts : %zu\n", project.ListScripts().size());
  printf("  play it : nftool sim %s --frames 300\n", project.RootPath().c_str());
  printf("  package : nftool build %s --out Build/Windows\n", project.RootPath().c_str());
  return 0;
}

} // namespace nf
