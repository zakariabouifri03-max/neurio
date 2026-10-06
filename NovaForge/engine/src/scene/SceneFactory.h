// NovaForge Engine - scene/SceneFactory.h
// High level object creation used by the editor menus, the AI assistant and the
// sample projects: "Create Player", "Create NPC", "Add Light" ... all real objects.
#pragma once

#include "scene/Scene.h"

namespace nf {

struct SpawnOptions {
  Vec3 position{0, 0, 0};
  Vec3 rotationEuler{0, 0, 0};
  Vec3 scale{1, 1, 1};
  std::string name;
  std::string tag;
  std::string prefabScenePath;     // optional template scene
};

class SceneFactory {
public:
  static EntityId SpawnPrimitive(Scene& scene, const std::string& primitive, const SpawnOptions& options);
  static EntityId SpawnModel(Scene& scene, const std::string& modelAssetPath, const SpawnOptions& options);
  static EntityId SpawnLight(Scene& scene, LightType type, const SpawnOptions& options);
  static EntityId SpawnCamera(Scene& scene, const SpawnOptions& options, bool makePrimary);
  static EntityId SpawnPlayer(Scene& scene, const SpawnOptions& options, ControllerViewMode mode);
  static EntityId SpawnNpc(Scene& scene, const SpawnOptions& options, NpcBehavior behavior);
  static EntityId SpawnDoor(Scene& scene, const SpawnOptions& options);
  static EntityId SpawnPickup(Scene& scene, PickupKind kind, const SpawnOptions& options);
  static EntityId SpawnTriggerVolume(Scene& scene, const Vec3& size, const SpawnOptions& options);
  static EntityId SpawnAudioSource(Scene& scene, const std::string& clipPath, const SpawnOptions& options);
  static EntityId SpawnQuest(Scene& scene, const std::string& questName, const SpawnOptions& options);
  static EntityId SpawnSpawner(Scene& scene, const std::string& templateName, const SpawnOptions& options);

  // Ground helper that also creates the matching static collider (used by "Add Ground").
  static EntityId SpawnGround(Scene& scene, f32 size = 20.0f, const SpawnOptions& options = {});

  // Applies position/rotation/scale/name/tag to a freshly created object.
  static void ApplyOptions(Scene& scene, EntityId id, const SpawnOptions& options);
};

} // namespace nf
