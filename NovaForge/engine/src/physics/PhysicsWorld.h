// NovaForge Engine - physics/PhysicsWorld.h
// A real (if deliberately small) rigid body engine written for NovaForge:
//   * dynamic + kinematic + static bodies
//   * box / sphere / capsule shapes with swept, axis-resolved collision response
//   * gravity, mass, drag, restitution, friction and sleeping
//   * trigger volumes with enter/exit events
//   * broadphase via a uniform spatial hash, narrowphase via shape-specific tests
//   * ray and sphere queries used by editor picking and gameplay
//
// The public API intentionally mirrors the part of PhysX/Jolt that the engine
// needs, so swapping in a larger solver later only touches this module.
#pragma once

#include "core/Base.h"
#include "core/Math.h"
#include <unordered_map>
#include <unordered_set>
#include "physics/PhysicsTypes.h"

namespace nf {

class Scene;

struct PhysicsSettings {
  Vec3 gravity{0.0f, -20.0f, 0.0f};
  int solverIterations = 6;
  int substeps = 2;
  f32 sleepVelocityThreshold = 0.05f;
  f32 sleepTimeThreshold = 0.6f;
  bool enableCCD = true;                 // swept motion for fast movers
  f32 maxVelocity = 120.0f;
  int maxBodies = 8192;
};

struct PhysicsStepResult {
  u32 activeBodies = 0;
  u32 sleepingBodies = 0;
  u32 staticBodies = 0;
  u32 broadphasePairs = 0;
  u32 contacts = 0;
  u32 triggerEvents = 0;
  f32 stepMs = 0.0f;
};

class PhysicsWorld {
public:
  PhysicsWorld();
  ~PhysicsWorld();

  NF_NONCOPYABLE(PhysicsWorld)

  void Initialize(const PhysicsSettings& settings = {});
  void Shutdown();
  bool IsInitialized() const { return initialized_; }

  PhysicsSettings& Settings() { return settings_; }
  const PhysicsSettings& Settings() const { return settings_; }

  // ---- body management
  PhysicsBodyId CreateBody(const BodyDesc& desc);
  void DestroyBody(PhysicsBodyId id);
  void DestroyBodiesForEntity(EntityId entity);
  PhysicsBody* GetBody(PhysicsBodyId id);
  const PhysicsBody* GetBody(PhysicsBodyId id) const;
  PhysicsBody* GetBodyForEntity(EntityId entity);
  const PhysicsBody* GetBodyForEntity(EntityId entity) const;
  EntityId EntityOf(PhysicsBodyId id) const;

  // ---- simulation
  void Step(f32 deltaTime, Scene* scene = nullptr);
  void SyncFromScene(Scene& scene);   // component transforms -> bodies (on play start)
  void SyncToScene(Scene& scene);     // simulated bodies -> component transforms (after step)
  bool RaycastBody(PhysicsBodyId id, const Ray& ray, PhysicsRayHit* out) const;
  // Iterates contacts logged by the last Step().
  const std::vector<ContactEvent>& ContactEvents() const { return contactEvents_; }
  void ClearContactEvents() { contactEvents_.clear(); }

  // ---- queries
  bool Raycast(const Ray& ray, f32 maxDistance, bool includeTriggers, PhysicsRayHit* out) const;
  std::vector<PhysicsBodyId> QuerySphere(const Vec3& center, f32 radius,
                                         bool includeTriggers = false) const;
  u32 BodyCount() const { return (u32)bodies_.size(); }
  // Read-only view of every body (runtime bookkeeping, editor debug overlays).
  const std::vector<PhysicsBody>& BodyList() const { return bodies_; }
  const PhysicsStepResult& LastStepResult() const { return lastResult_; }
  bool IsSleeping(PhysicsBodyId id) const;

  // ---- direct control (used by gameplay code and the character controller)
  void SetPosition(PhysicsBodyId id, const Vec3& position);
  void SetRotation(PhysicsBodyId id, const Quat& rotation);
  void SetVelocity(PhysicsBodyId id, const Vec3& velocity);
  Vec3 GetVelocity(PhysicsBodyId id) const;
  void AddForce(PhysicsBodyId id, const Vec3& force);
  void AddImpulse(PhysicsBodyId id, const Vec3& impulse);
  Vec3 GetLinearVelocity(PhysicsBodyId id) const { return GetVelocity(id); }
  void SetLinearVelocity(PhysicsBodyId id, const Vec3& v) { SetVelocity(id, v); }

  // ---- character controller support
  // Moves a capsule through the world with sliding, step-up and ground detection.
  struct MoveResult {
    Vec3 position{0, 0, 0};
    Vec3 normal{0, 1, 0};
    bool grounded = false;
    bool hitCeiling = false;
    bool hitWall = false;
    EntityId hitEntity = 0;
  };
  MoveResult MoveCapsule(PhysicsBodyId body, const Vec3& displacement, f32 radius, f32 height,
                         bool allowStepUp = true);
  std::vector<PhysicsBodyId> GatherPotentialContacts(PhysicsBodyId body) const;

private:
  void BroadphasePairs(std::vector<std::pair<i32, i32>>& pairs);
  void Integrate(f32 deltaTime);
  void ResolveContacts(f32 deltaTime);
  void ProcessTriggers(Scene* scene);
  void UpdateSleepStates(f32 deltaTime);
  AABB ComputeWorldBounds(const PhysicsBody& body) const;
  void UpdateBroadphaseCell(i32 index, const AABB& bounds);
  void InsertIntoCells(i32 index, const AABB& bounds);
  void RemoveFromCells(i32 index);

  PhysicsSettings settings_;
  bool initialized_ = false;
  std::vector<PhysicsBody> bodies_;
  std::vector<i32> freeIndices_;
  std::vector<ContactEvent> contactEvents_;
  std::vector<std::pair<i32, i32>> cachedPairs_;
  std::unordered_map<EntityId, i32> entityToBody_;

  // spatial hash
  std::unordered_map<i64, std::vector<i32>> grid_;
  std::vector<AABB> lastBounds_;
  std::vector<std::vector<i64>> bodyCells_;
  f32 cellSize_ = 4.0f;

  // trigger overlap tracking (pair key -> still overlapping)
  std::unordered_set<u64> activeTriggerPairs_;
  std::unordered_set<u64> activeContactPairs_;
  PhysicsStepResult lastResult_;
  friend class PhysicsDebug;
};

} // namespace nf
