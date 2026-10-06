// NovaForge Engine - scene/Components.h
// All built-in components. Behaviour lives in Components.cpp (physics/AI helpers in
// the physics/ and ai/ modules) so play mode and the exported game share one code path.
#pragma once

#include "scene/Component.h"
#include "assets/Material.h"
#include "assets/Model.h"

namespace nf {

// ------------------------------------------------------------------ Transform
class TransformComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Transform";
  Vec3 position{0, 0, 0};
  Vec3 rotationEuler{0, 0, 0};      // degrees, YXZ (yaw applied first)
  Vec3 scale{1, 1, 1};

  const char* TypeName() const override { return "Transform"; }
  ComponentCategory Category() const override { return ComponentCategory::Core; }
  const char* Description() const override { return "Position, rotation and scale of the object."; }

  Quat Rotation() const { return Quat::FromEuler(rotationEuler.x, rotationEuler.y, rotationEuler.z); }
  void SetRotation(const Quat& q) { rotationEuler = q.EulerDegrees(); }
  void SetRotationEuler(const Vec3& e) { rotationEuler = e; }
  Transform ToTransform() const {
    Transform t;
    t.position = position;
    t.rotation = Rotation();
    t.scale = scale;
    return t;
  }
  void FromTransform(const Transform& t) {
    position = t.position;
    rotationEuler = t.rotation.EulerDegrees();
    scale = t.scale;
  }

protected:
  void BuildProperties(PropertyList& out) const override;
};

// --------------------------------------------------------------- MeshRenderer
enum class MeshSource : int { Primitive = 0, Asset = 1 };

class MeshRendererComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "MeshRenderer";
  i32 meshSource = 1;                       // MeshSource
  std::string primitive = "Box";            // used when meshSource == Primitive
  std::string meshAsset;                    // "Assets/Models/Hero.glb"
  std::string materialAsset;                // optional .nfmat
  bool visible = true;
  bool castShadows = true;
  bool receiveShadows = true;
  u32 subMeshFilter = 0xFFFFFFFF;           // editor-only helper (hidden)

  // Inline material (used when materialAsset is empty or per-instance override)
  Vec4 baseColor{0.82f, 0.82f, 0.86f, 1.0f};
  Vec3 emissiveColor{0, 0, 0};
  f32 metallic = 0.0f;
  f32 roughness = 0.6f;
  f32 opacity = 1.0f;
  f32 uvTiling = 1.0f;
  bool unlit = false;
  bool doubleSided = false;
  std::string baseColorTexture;
  std::string normalTexture;
  bool useMaterialFile = false;             // true = load materialAsset, ignore inline values

  const char* TypeName() const override { return "MeshRenderer"; }
  ComponentCategory Category() const override { return ComponentCategory::Rendering; }
  const char* Description() const override { return "Renders a mesh primitive or an imported model."; }

  // Resolves mesh + material for rendering. Never returns a null mesh for a valid
  // primitive; asset failures are logged once and reported through outError.
  std::shared_ptr<Mesh> ResolveMesh(class AssetDatabase& assets, std::string* outError = nullptr) const;
  Material ResolveMaterial(class AssetDatabase& assets) const;

protected:
  void BuildProperties(PropertyList& out) const override;
};

// -------------------------------------------------------------------- Camera
enum class CameraProjection : int { Perspective = 0, Orthographic = 1 };

class CameraComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Camera";
  bool isPrimary = false;                   // becomes the gameplay camera on PLAY
  i32 projection = 0;                       // CameraProjection
  f32 fieldOfView = 60.0f;
  f32 nearPlane = 0.1f;
  f32 farPlane = 1000.0f;
  f32 orthoSize = 10.0f;
  Vec3 clearColor{0.52f, 0.68f, 0.88f};

  const char* TypeName() const override { return "Camera"; }
  ComponentCategory Category() const override { return ComponentCategory::Rendering; }
  const char* Description() const override { return "Viewport / gameplay camera."; }

  Mat4 ProjectionMatrix(f32 aspect) const;

protected:
  void BuildProperties(PropertyList& out) const override;
};

// --------------------------------------------------------------------- Light
enum class LightType : int { Directional = 0, Point = 1, Spot = 2 };

class LightComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Light";
  i32 lightType = 1;                        // LightType
  Vec3 color{1.0f, 0.96f, 0.9f};
  f32 intensity = 1.0f;
  f32 range = 12.0f;                        // point/spot
  f32 innerAngle = 25.0f;                   // spot, degrees
  f32 outerAngle = 35.0f;
  bool castShadows = true;
  f32 shadowBias = 0.0015f;
  f32 shadowStrength = 0.85f;

  const char* TypeName() const override { return "Light"; }
  ComponentCategory Category() const override { return ComponentCategory::Rendering; }
  const char* Description() const override { return "Directional, point or spot light source."; }

  LightType Type() const { return (LightType)lightType; }

protected:
  void BuildProperties(PropertyList& out) const override;
  void DrawGizmos(class Scene& scene) override;
};

// ------------------------------------------------------------------ Collider
enum class ColliderShape : int { Box = 0, Sphere = 1, Capsule = 2, Mesh = 3 };

class ColliderComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Collider";
  i32 shape = 0;                            // ColliderShape
  bool isTrigger = false;
  Vec3 center{0, 0, 0};
  Vec3 size{1, 1, 1};                       // box
  f32 radius = 0.5f;                        // sphere/capsule
  f32 height = 1.8f;                        // capsule
  f32 friction = 0.6f;
  f32 restitution = 0.0f;                   // bounciness
  i32 layer = 0;
  bool visibleInEditor = true;              // draw wireframe

  const char* TypeName() const override { return "Collider"; }
  ComponentCategory Category() const override { return ComponentCategory::Physics; }
  const char* Description() const override {
    return "Physics shape. Trigger colliders report overlap events instead of blocking.";
  }

  ColliderShape Shape() const { return (ColliderShape)shape; }
  AABB LocalBounds() const;

protected:
  void BuildProperties(PropertyList& out) const override;
  void DrawGizmos(class Scene& scene) override;
};

// --------------------------------------------------------------- Rigidbody
class RigidbodyComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Rigidbody";
  f32 mass = 1.0f;
  bool useGravity = true;
  bool isKinematic = false;
  f32 drag = 0.02f;
  f32 angularDrag = 0.05f;
  bool freezeRotation = true;               // most gameplay props want upright bodies
  bool freezeX = false, freezeY = false, freezeZ = false;
  f32 linearDamping = 0.0f;
  f32 bounceCombine = 0.0f;

  // runtime mirror (not serialised)
  Vec3 velocity{0, 0, 0};

  const char* TypeName() const override { return "Rigidbody"; }
  ComponentCategory Category() const override { return ComponentCategory::Physics; }
  const char* Description() const override {
    return "Turns the object into a dynamic physics body (needs a Collider).";
  }

protected:
  void BuildProperties(PropertyList& out) const override;
};

// -------------------------------------------------------- CharacterController
enum class ControllerViewMode : int { ThirdPerson = 0, FirstPerson = 1 };

class CharacterControllerComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "CharacterController";
  i32 viewMode = 0;                         // ControllerViewMode
  f32 moveSpeed = 5.0f;
  f32 sprintMultiplier = 1.8f;
  f32 jumpHeight = 1.6f;
  f32 gravity = -20.0f;
  f32 airControl = 0.35f;
  f32 mouseSensitivity = 0.13f;
  bool invertY = false;
  f32 pitchMin = -75.0f;
  f32 pitchMax = 75.0f;
  f32 cameraDistance = 5.0f;                // third person
  f32 cameraHeight = 1.6f;
  f32 cameraPitchOffset = 10.0f;
  bool rotateTowardsMovement = true;
  f32 turnSpeed = 12.0f;
  f32 capsuleRadius = 0.4f;
  f32 capsuleHeight = 1.8f;
  bool autoCreateCamera = true;             // spawn the follow camera at runtime
  bool enableSprint = true;
  bool useControllerAnimation = true;       // drive an AnimatorComponent when present
  std::string interactKeyHint = "E";

  const char* TypeName() const override { return "CharacterController"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override {
    return "Third-person / first-person player controller with gravity, jumping and sprint.";
  }

  bool IsFirstPerson() const { return viewMode == 1; }

protected:
  void BuildProperties(PropertyList& out) const override;
};

// -------------------------------------------------------------------- Health
class HealthComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Health";
  f32 maxHealth = 100.0f;
  f32 currentHealth = 100.0f;
  f32 regenerationPerSecond = 0.0f;
  f32 invulnerableTime = 0.0f;
  bool destroyOnDeath = false;
  bool isPlayer = false;
  std::string deathEvent = "EntityDied";

  const char* TypeName() const override { return "Health"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override { return "Hit points, damage, death and regeneration."; }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;
  void OnDamage(Scene& scene, f32 amount, EntityId source) override;
  void OnReset(Scene& scene) override;

  bool IsAlive() const { return currentHealth > 0.0f; }
  void ApplyDamage(Scene& scene, f32 amount, EntityId source);
  void Heal(Scene& scene, f32 amount);
  f32 HealthPercent() const { return maxHealth > 0 ? Saturate(currentHealth / maxHealth) : 0.0f; }

protected:
  void BuildProperties(PropertyList& out) const override;
};

// ------------------------------------------------------------------- Pickup
enum class PickupKind : int { Health = 0, Ammo = 1, Key = 2, Coin = 3, Custom = 4 };

class PickupComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Pickup";
  i32 kind = 0;                             // PickupKind
  f32 amount = 25.0f;
  f32 pickupRadius = 1.6f;
  f32 spinSpeed = 90.0f;
  f32 bobHeight = 0.25f;
  bool destroyOnPickup = true;
  f32 respawnSeconds = 0.0f;
  std::string pickupEvent = "ItemPickedUp";
  std::string requiredTag = "Player";

  const char* TypeName() const override { return "Pickup"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override { return "Collectable item (health, ammo, key, coin...)."; }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;
  void OnReset(Scene& scene) override;

protected:
  void BuildProperties(PropertyList& out) const override;
};

// --------------------------------------------------------------------- Door
class DoorComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Door";
  f32 openAngle = 95.0f;
  f32 openSpeed = 120.0f;
  bool autoClose = false;
  f32 autoCloseDelay = 3.0f;
  bool locked = false;
  std::string requiredKeyTag = "Key";
  Vec3 hingeAxis{0, 1, 0};
  bool startOpen = false;
  std::string openSound;

  const char* TypeName() const override { return "Door"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override { return "Rotating door that opens on trigger or interaction."; }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;
  void OnTriggerEnter(Scene& scene, EntityId other) override;
  void OnTriggerExit(Scene& scene, EntityId other) override;
  void OnReset(Scene& scene) override;

  void Open(Scene& scene);
  void Close(Scene& scene);
  bool IsOpen() const { return open_; }

protected:
  void BuildProperties(PropertyList& out) const override;
  Quat closedRotation_{0, 0, 0, 1};
  f32 angle_ = 0.0f;
  bool open_ = false;
  f32 closeTimer_ = 0.0f;
  int occupants_ = 0;
};

// --------------------------------------------------------------- Interactable
enum class InteractAction : int { ShowMessage = 0, OpenDoor = 1, Collect = 2, DamageSelf = 3, TriggerScript = 4, Teleport = 5 };

class InteractableComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Interactable";
  std::string prompt = "Press E to interact";
  i32 action = 0;                           // InteractAction
  std::string message = "Hello from NovaForge!";
  f32 range = 3.0f;
  u64 targetEntity = 0;
  Vec3 teleportTarget{0, 0, 0};
  bool oneShot = false;

  const char* TypeName() const override { return "Interactable"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override { return "Makes the object interactive for the player."; }

  void OnUpdate(Scene& scene, f32 dt) override;
  void OnReset(Scene& scene) override;
  void Interact(Scene& scene, EntityId instigator);

protected:
  void BuildProperties(PropertyList& out) const override;
  bool used_ = false;
};

// ------------------------------------------------------------- TriggerVolume
enum class TriggerAction : int { None = 0, OpenDoor = 1, ShowMessage = 2, SpawnEnemy = 3, CompleteQuest = 4, KillInstigator = 5, HealInstigator = 6 };

class TriggerVolumeComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "TriggerVolume";
  std::string requiredTag = "Player";
  bool oneShot = true;
  i32 action = 1;                           // TriggerAction
  std::string message = "You entered the trigger";
  u64 targetEntity = 0;                     // door to open etc.
  std::string spawnObjectName;              // SpawnEnemy: object in the scene to clone
  u64 questEntity = 0;
  f32 healAmount = 25.0f;

  const char* TypeName() const override { return "TriggerVolume"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override {
    return "Fires an action when a tagged object enters its collider (set the Collider to Trigger).";
  }

  void OnTriggerEnter(Scene& scene, EntityId other) override;
  void OnReset(Scene& scene) override;

protected:
  void BuildProperties(PropertyList& out) const override;
  bool fired_ = false;
};

// --------------------------------------------------------------------- Quest
class QuestComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Quest";
  std::string questName = "New Quest";
  std::string description = "Talk to the villager.";
  std::vector<std::string> objectives;
  bool complete = false;
  std::string completedEvent = "QuestCompleted";

  const char* TypeName() const override { return "Quest"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override { return "Simple objective tracker with completion event."; }

  void OnStart(Scene& scene) override;
  void CompleteObjective(Scene& scene, const std::string& objective);
  void Complete(Scene& scene);

protected:
  void BuildProperties(PropertyList& out) const override;
  std::vector<std::string> state_;
  int currentObjective_ = 0;
};

// ------------------------------------------------------------------- Spawner
class SpawnerComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Spawner";
  std::string templateObjectName;           // object in the scene used as a template
  f32 intervalSeconds = 5.0f;
  i32 maxAlive = 4;
  f32 spawnRadius = 3.0f;
  bool spawnOnStart = false;
  bool active = true;

  const char* TypeName() const override { return "Spawner"; }
  ComponentCategory Category() const override { return ComponentCategory::Gameplay; }
  const char* Description() const override { return "Periodically clones a template object into the scene."; }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;
  void OnReset(Scene& scene) override;

protected:
  void BuildProperties(PropertyList& out) const override;
  f32 timer_ = 0.0f;
  std::vector<EntityId> spawned_;
};

// --------------------------------------------------------------- AudioSource
class AudioSourceComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "AudioSource";
  std::string clipPath;
  f32 volume = 1.0f;
  f32 pitch = 1.0f;
  bool loop = false;
  bool playOnAwake = false;
  bool spatial = true;                      // positional audio
  f32 minDistance = 1.0f;
  f32 maxDistance = 25.0f;
  std::string playEvent;                    // optional scene event that triggers playback

  const char* TypeName() const override { return "AudioSource"; }
  ComponentCategory Category() const override { return ComponentCategory::Audio; }
  const char* Description() const override { return "2D/3D sound emitter (WAV, OGG, MP3)."; }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;
  void OnReset(Scene& scene) override;
  void Play(Scene& scene);

protected:
  void BuildProperties(PropertyList& out) const override;
  u64 voiceId_ = 0;
};

// ------------------------------------------------------------------- Animator
class AnimatorComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Animator";
  std::string animationAsset;               // optional .nfanim / model with clips
  std::string defaultClip = "Idle";
  std::string walkClip = "Walk";
  std::string runClip = "Run";
  std::string attackClip = "Attack";
  std::string deathClip = "Death";
  bool playOnStart = true;
  bool loop = true;
  f32 speed = 1.0f;
  bool rootMotion = false;                  // V1: not applied to the transform

  const char* TypeName() const override { return "Animator"; }
  ComponentCategory Category() const override { return ComponentCategory::Rendering; }
  const char* Description() const override { return "Plays skeletal animation clips from an imported model."; }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;
  void OnReset(Scene& scene) override;

  void Play(const std::string& clipName, bool restart = false);
  const std::string& CurrentClip() const { return currentClip_; }

  // runtime state (owned by the animation system)
  int clipIndex = -1;
  f32 time = 0.0f;
  f32 blend = 0.0f;

protected:
  void BuildProperties(PropertyList& out) const override;
  std::string currentClip_;
};

// --------------------------------------------------------------------- Script
class ScriptComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "Script";
  std::string className;                    // built-in behaviour name, e.g. "Rotator"
  std::string sourcePath;                   // .nfscript source (for reference/editing)
  std::string modulePath;                   // native script module (.dll/.so) - optional
  JsonValue parameters = JsonValue::Object();   // free-form script parameters
  bool logStart = false;

  const char* TypeName() const override { return "Script"; }
  ComponentCategory Category() const override { return ComponentCategory::Scripting; }
  const char* Description() const override {
    return "Runs gameplay logic: built-in behaviours, .nfscript data or a native script module.";
  }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;
  void OnFixedUpdate(Scene& scene, f32 dt) override;
  void OnTriggerEnter(Scene& scene, EntityId other) override;
  void OnReset(Scene& scene) override;

  // Helper used by built-in behaviours and by script modules.
  f32 GetFloat(const char* key, f32 fallback = 0.0f) const { return parameters[key].AsFloat(fallback); }
  Vec3 GetVec3(const char* key, const Vec3& fallback = Vec3(0, 0, 0)) const {
    return parameters[key].AsVec3(fallback);
  }
  std::string GetString(const char* key, const std::string& fallback = "") const {
    return parameters[key].AsString(fallback);
  }
  bool GetBool(const char* key, bool fallback = false) const { return parameters[key].AsBool(fallback); }

protected:
  void BuildProperties(PropertyList& out) const override;
  void* instance_ = nullptr;                 // built-in behaviour state / script instance
  std::string loadedModule_;
};

// ------------------------------------------------------------------------- AI
enum class NpcBehavior : int { Idle = 0, Patrol = 1, Follow = 2, Chase = 3, Attack = 4, Flee = 5 };
enum class NpcState : int { Idle = 0, Patrol, Chase, Attack, Flee, Dead, Count };
const char* NpcStateName(NpcState state);
const char* NpcBehaviorName(NpcBehavior behavior);

class AIComponent : public ComponentBase {
public:
  static constexpr const char* kTypeName = "AI";
  i32 behavior = 1;                         // NpcBehavior
  bool requireLineOfSight = false;          // V1: distance based detection (LOS is a stub-free distance fallback)
  f32 detectionRadius = 14.0f;
  f32 loseTargetRadius = 22.0f;
  f32 moveSpeed = 2.4f;
  f32 chaseSpeed = 3.6f;
  f32 turnSpeed = 6.0f;
  f32 attackRange = 2.2f;
  f32 attackDamage = 12.0f;
  f32 attackCooldown = 1.4f;
  f32 attackWindup = 0.35f;
  f32 patrolWaitTime = 1.5f;
  f32 wanderRadius = 8.0f;
  std::vector<Vec3> patrolPoints;
  std::string targetTag = "Player";
  u64 explicitTarget = 0;
  bool canAttack = true;
  bool faceTargetWhenIdle = true;
  f32 gravity = -20.0f;
  bool animateMovement = true;

  const char* TypeName() const override { return "AI"; }
  ComponentCategory Category() const override { return ComponentCategory::AI; }
  const char* Description() const override {
    return "NPC behaviour: Idle, Patrol, Follow, Chase, Attack and Flee with a simple state machine.";
  }

  NpcState State() const { return state_; }
  void SetState(NpcState s) { state_ = s; }
  EntityId Target() const { return target_; }
  u64 targetEntity() const { return target_; }
  i32 patrolIndex() const { return patrolIndex_; }

  void OnStart(Scene& scene) override;
  void OnUpdate(Scene& scene, f32 dt) override;   // delegates to ai/NpcBehavior.cpp
  void OnDamage(Scene& scene, f32 amount, EntityId source) override;
  void OnTriggerEnter(Scene& scene, EntityId other) override;
  void OnReset(Scene& scene) override;

  void SetTarget(EntityId target) { target_ = target; }
  void SetPatrolIndex(i32 index) { patrolIndex_ = index; }
  void NotifyAttacked() { state_ = NpcState::Attack; attackTimer_ = attackCooldown; }
  f32 attackTimerValue() const { return attackTimer_; }
  void setAttackTimer(f32 v) { attackTimer_ = v; }
  u64 targetValue() const { return target_; }
  void setTargetValue(EntityId t) { target_ = t; }
  void setPatrolIndexValue(i32 i) { patrolIndex_ = i; }
  f32 waitTimerValue() const { return waitTimer_; }
  void setWaitTimer(f32 v) { waitTimer_ = v; }
  NpcState& stateRef() { return state_; }
  f32& attackTimerRef() { return attackTimer_; }
  f32& waitTimerRef() { return waitTimer_; }
  Vec3& velocityRef() { return velocity_; }
  int& attackStateRef() { return attackState_; }
  f32& attackAnimTimerRef() { return attackAnimTimer_; }

protected:
  void BuildProperties(PropertyList& out) const override;

  NpcState state_ = NpcState::Idle;
  EntityId target_ = 0;
  i32 patrolIndex_ = 0;
  f32 attackTimer_ = 0.0f;
  f32 waitTimer_ = 0.0f;
  f32 attackAnimTimer_ = 0.0f;
  int attackState_ = 0;
  Vec3 velocity_{0, 0, 0};
  f32 patrolDirection_ = 1.0f;
};

// Registers every built-in component (called once at engine start).
// RegisterBuiltinComponents() is declared in scene/Component.h (called lazily by the registry).

} // namespace nf
