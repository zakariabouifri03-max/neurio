// NovaForge Engine - scene/SceneFactory.cpp
#include "scene/SceneFactory.h"
#include "core/Log.h"
#include "core/FileSystem.h"

namespace nf {

void SceneFactory::ApplyOptions(Scene& scene, EntityId id, const SpawnOptions& options) {
  GameObject* object = scene.Get(id);
  if (!object) return;
  if (!options.name.empty()) object->name = scene.UniqueName(options.name);
  if (!options.tag.empty()) object->tag = options.tag;
  if (auto* transform = object->Transform()) {
    transform->position = options.position;
    transform->rotationEuler = options.rotationEuler;
    transform->scale = options.scale;
  }
  scene.MarkTransformDirty(id);
  scene.SetDirty(true);
}

EntityId SceneFactory::SpawnPrimitive(Scene& scene, const std::string& primitive,
                                      const SpawnOptions& options) {
  EntityId id = scene.CreateObject(options.name.empty() ? primitive : options.name);
  auto* renderer = scene.AddComponent<MeshRendererComponent>(id);
  renderer->meshSource = (i32)MeshSource::Primitive;
  renderer->primitive = primitive;
  if (primitive == "Plane") renderer->baseColor = Vec4(0.45f, 0.47f, 0.5f, 1.0f);
  ApplyOptions(scene, id, options);
  return id;
}

EntityId SceneFactory::SpawnModel(Scene& scene, const std::string& modelAssetPath,
                                  const SpawnOptions& options) {
  std::string name = options.name.empty() ? fs::Stem(modelAssetPath) : options.name;
  EntityId id = scene.CreateObject(name);
  auto* renderer = scene.AddComponent<MeshRendererComponent>(id);
  renderer->meshSource = (i32)MeshSource::Asset;
  renderer->meshAsset = modelAssetPath;
  ApplyOptions(scene, id, options);
  return id;
}

EntityId SceneFactory::SpawnLight(Scene& scene, LightType type, const SpawnOptions& options) {
  std::string defaultName = type == LightType::Directional ? "DirectionalLight"
                            : type == LightType::Point     ? "PointLight"
                                                           : "SpotLight";
  EntityId id = scene.CreateObject(options.name.empty() ? defaultName : options.name);
  auto* light = scene.AddComponent<LightComponent>(id);
  light->lightType = (i32)type;
  if (type == LightType::Directional) {
    light->intensity = 1.2f;
  } else if (type == LightType::Point) {
    light->intensity = 1.8f;
    light->range = 14.0f;
  } else {
    light->intensity = 3.0f;
    light->range = 20.0f;
  }
  ApplyOptions(scene, id, options);
  return id;
}

EntityId SceneFactory::SpawnCamera(Scene& scene, const SpawnOptions& options, bool makePrimary) {
  EntityId id = scene.CreateObject(options.name.empty() ? "Camera" : options.name);
  auto* camera = scene.AddComponent<CameraComponent>(id);
  if (makePrimary) {
    for (auto& object : scene.AllObjects())
      if (auto* other = object->Get<CameraComponent>()) other->isPrimary = false;
    camera->isPrimary = true;
  }
  ApplyOptions(scene, id, options);
  return id;
}

EntityId SceneFactory::SpawnPlayer(Scene& scene, const SpawnOptions& options,
                                   ControllerViewMode mode) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = "Player";
  if (opts.tag.empty()) opts.tag = "Player";
  if (opts.position == Vec3(0, 0, 0)) opts.position = Vec3(0, 1.2f, 0);

  EntityId id = scene.CreateObject(opts.name);
  auto* renderer = scene.AddComponent<MeshRendererComponent>(id);
  renderer->meshSource = (i32)MeshSource::Primitive;
  renderer->primitive = "Capsule";
  renderer->baseColor = Vec4(0.25f, 0.55f, 0.95f, 1.0f);
  renderer->roughness = 0.5f;

  auto* controller = scene.AddComponent<CharacterControllerComponent>(id);
  controller->viewMode = (i32)mode;
  auto* health = scene.AddComponent<HealthComponent>(id);
  health->isPlayer = true;
  health->maxHealth = 100.0f;
  health->currentHealth = 100.0f;
  health->deathEvent = "PlayerDied";

  auto* animator = scene.AddComponent<AnimatorComponent>(id);
  animator->defaultClip = "Idle";
  animator->walkClip = "Walk";
  animator->runClip = "Run";

  // Character capsule collider (dynamic body, rotation locked so it stays upright)
  auto* collider = scene.AddComponent<ColliderComponent>(id);
  collider->shape = (i32)ColliderShape::Capsule;
  collider->radius = controller->capsuleRadius;
  collider->height = controller->capsuleHeight;
  collider->center = Vec3(0, controller->capsuleHeight * 0.5f, 0);   // origin is at the feet
  auto* body = scene.AddComponent<RigidbodyComponent>(id);
  body->isKinematic = true;      // the character controller moves it explicitly
  body->useGravity = false;
  body->mass = 70.0f;

  ApplyOptions(scene, id, opts);
  scene.SetPlayerEntity(id);
  return id;
}

EntityId SceneFactory::SpawnNpc(Scene& scene, const SpawnOptions& options, NpcBehavior behavior) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = "NPC";
  if (opts.tag.empty()) opts.tag = "Enemy";
  if (opts.position == Vec3(0, 0, 0)) opts.position = Vec3(4, 1.0f, -4);

  EntityId id = scene.CreateObject(opts.name);
  auto* renderer = scene.AddComponent<MeshRendererComponent>(id);
  renderer->meshSource = (i32)MeshSource::Primitive;
  renderer->primitive = "Capsule";
  renderer->baseColor = Vec4(0.85f, 0.30f, 0.25f, 1.0f);

  auto* ai = scene.AddComponent<AIComponent>(id);
  ai->behavior = (i32)behavior;
  if (behavior == NpcBehavior::Patrol) {
    ai->patrolPoints = {opts.position + Vec3(4, 0, 0), opts.position + Vec3(0, 0, 4),
                        opts.position - Vec3(4, 0, 0)};
  }
  auto* health = scene.AddComponent<HealthComponent>(id);
  health->maxHealth = 60.0f;
  health->currentHealth = 60.0f;
  health->destroyOnDeath = true;
  health->deathEvent = "EnemyDefeated";

  auto* collider = scene.AddComponent<ColliderComponent>(id);
  collider->shape = (i32)ColliderShape::Capsule;
  collider->radius = 0.45f;
  collider->height = 1.7f;
  collider->center = Vec3(0, 0.85f, 0);
  auto* body = scene.AddComponent<RigidbodyComponent>(id);
  body->mass = 60.0f;
  body->useGravity = true;
  body->freezeRotation = true;

  auto* animator = scene.AddComponent<AnimatorComponent>(id);
  animator->defaultClip = "Idle";
  animator->walkClip = "Walk";
  animator->attackClip = "Attack";

  ApplyOptions(scene, id, opts);
  return id;
}

EntityId SceneFactory::SpawnDoor(Scene& scene, const SpawnOptions& options) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = "Door";
  EntityId frame = scene.CreateObject(opts.name);
  auto* renderer = scene.AddComponent<MeshRendererComponent>(frame);
  renderer->meshSource = (i32)MeshSource::Primitive;
  renderer->primitive = "Box";
  renderer->baseColor = Vec4(0.55f, 0.38f, 0.22f, 1.0f);
  if (auto* transform = scene.Get(frame)->Transform()) transform->scale = Vec3(1.2f, 2.2f, 0.15f);

  auto* collider = scene.AddComponent<ColliderComponent>(frame);
  collider->shape = (i32)ColliderShape::Box;
  collider->size = Vec3(1, 1, 1);         // local: the transform scale (1.2, 2.2, 0.15) applies
  collider->center = Vec3(0, 0.5f, 0);
  auto* door = scene.AddComponent<DoorComponent>(frame);

  // trigger area in front of the door
  EntityId trigger = scene.CreateObject(opts.name + "_Trigger");
  scene.SetParent(trigger, frame, true);
  auto* triggerCollider = scene.AddComponent<ColliderComponent>(trigger);
  triggerCollider->shape = (i32)ColliderShape::Box;
  triggerCollider->size = Vec3(3.0f, 2.4f, 3.0f);
  triggerCollider->center = Vec3(0, 1.2f, 0);        // sits on the floor in front of the door
  triggerCollider->isTrigger = true;
  if (auto* transform = scene.Get(trigger)->Transform()) transform->position = Vec3(0, 0, 1.8f);

  ApplyOptions(scene, frame, opts);
  return frame;
}

EntityId SceneFactory::SpawnPickup(Scene& scene, PickupKind kind, const SpawnOptions& options) {
  SpawnOptions opts = options;
  if (opts.name.empty()) {
    opts.name = kind == PickupKind::Health ? "HealthPickup"
                : kind == PickupKind::Ammo ? "AmmoPickup"
                : kind == PickupKind::Key  ? "KeyPickup"
                                           : "CoinPickup";
  }
  if (opts.position == Vec3(0, 0, 0)) opts.position = Vec3(0, 1.0f, 0);
  EntityId id = scene.CreateObject(opts.name);
  auto* renderer = scene.AddComponent<MeshRendererComponent>(id);
  renderer->meshSource = (i32)MeshSource::Primitive;
  renderer->primitive = kind == PickupKind::Health ? "Sphere" : "Box";
  renderer->unlit = false;
  switch (kind) {
    case PickupKind::Health: renderer->baseColor = Vec4(0.9f, 0.2f, 0.25f, 1.0f); break;
    case PickupKind::Ammo: renderer->baseColor = Vec4(0.9f, 0.75f, 0.2f, 1.0f); break;
    case PickupKind::Key: renderer->baseColor = Vec4(0.95f, 0.85f, 0.3f, 1.0f); break;
    default: renderer->baseColor = Vec4(1.0f, 0.85f, 0.1f, 1.0f); break;
  }
  renderer->emissiveColor = Vec3(renderer->baseColor.x * 0.35f, renderer->baseColor.y * 0.35f,
                                 renderer->baseColor.z * 0.35f);
  if (auto* transform = scene.Get(id)->Transform()) transform->scale = Vec3(0.6f, 0.6f, 0.6f);

  auto* pickup = scene.AddComponent<PickupComponent>(id);
  pickup->kind = (i32)kind;
  pickup->amount = kind == PickupKind::Health ? 30.0f : 1.0f;

  auto* collider = scene.AddComponent<ColliderComponent>(id);
  collider->shape = (i32)ColliderShape::Sphere;
  collider->radius = 0.5f;                 // local: the object's scale (0.6) applies
  collider->isTrigger = true;

  ApplyOptions(scene, id, opts);
  return id;
}

EntityId SceneFactory::SpawnTriggerVolume(Scene& scene, const Vec3& size, const SpawnOptions& options) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = "TriggerVolume";
  EntityId id = scene.CreateObject(opts.name);
  auto* collider = scene.AddComponent<ColliderComponent>(id);
  collider->shape = (i32)ColliderShape::Box;
  collider->size = size;
  collider->center = Vec3(0, size.y * 0.5f, 0);
  collider->isTrigger = true;
  scene.AddComponent<TriggerVolumeComponent>(id);
  ApplyOptions(scene, id, opts);
  return id;
}

EntityId SceneFactory::SpawnAudioSource(Scene& scene, const std::string& clipPath,
                                        const SpawnOptions& options) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = "AudioSource";
  EntityId id = scene.CreateObject(opts.name);
  auto* source = scene.AddComponent<AudioSourceComponent>(id);
  source->clipPath = clipPath;
  source->playOnAwake = true;
  source->spatial = true;
  ApplyOptions(scene, id, opts);
  return id;
}

EntityId SceneFactory::SpawnQuest(Scene& scene, const std::string& questName,
                                  const SpawnOptions& options) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = questName.empty() ? "Quest" : questName;
  EntityId id = scene.CreateObject(opts.name);
  auto* quest = scene.AddComponent<QuestComponent>(id);
  if (!questName.empty()) quest->questName = questName;
  ApplyOptions(scene, id, opts);
  return id;
}

EntityId SceneFactory::SpawnSpawner(Scene& scene, const std::string& templateName,
                                    const SpawnOptions& options) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = "Spawner";
  EntityId id = scene.CreateObject(opts.name);
  auto* spawner = scene.AddComponent<SpawnerComponent>(id);
  spawner->templateObjectName = templateName;
  ApplyOptions(scene, id, opts);
  return id;
}

EntityId SceneFactory::SpawnGround(Scene& scene, f32 size, const SpawnOptions& options) {
  SpawnOptions opts = options;
  if (opts.name.empty()) opts.name = "Ground";
  if (opts.tag.empty()) opts.tag = "Ground";
  EntityId id = SpawnPrimitive(scene, "Plane", opts);
  GameObject* object = scene.Get(id);
  if (auto* renderer = object->Get<MeshRendererComponent>()) {
    renderer->baseColor = Vec4(0.36f, 0.45f, 0.32f, 1.0f);
    renderer->uvTiling = size / 4.0f;
    renderer->roughness = 0.92f;
  }
  if (auto* transform = object->Transform()) transform->scale = Vec3(size / 10.0f, 1.0f, size / 10.0f);
  auto* collider = scene.AddComponent<ColliderComponent>(id);
  collider->shape = (i32)ColliderShape::Box;
  collider->size = Vec3(10.0f, 0.2f, 10.0f);         // local: scaled to (size, 0.2, size)
  collider->center = Vec3(0, -0.1f, 0);              // top face sits exactly on y = 0
  auto* body = scene.AddComponent<RigidbodyComponent>(id);
  body->isKinematic = true;
  body->useGravity = false;
  scene.MarkTransformDirty(id);
  scene.SetDirty(true);
  return id;
}

} // namespace nf
