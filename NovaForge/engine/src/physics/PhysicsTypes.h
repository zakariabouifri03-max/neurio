// NovaForge Engine - physics/PhysicsTypes.h
#pragma once

#include "core/Base.h"
#include "core/Math.h"

namespace nf {

using PhysicsBodyId = u32;
constexpr PhysicsBodyId kInvalidBody = 0xFFFFFFFFu;

enum class BodyType : int { Static = 0, Dynamic = 1, Kinematic = 2 };
enum class ShapeType : int { Box = 0, Sphere = 1, Capsule = 2, Plane = 3 };

struct CollisionShape {
  ShapeType type = ShapeType::Box;
  Vec3 halfExtents{0.5f, 0.5f, 0.5f};     // box
  f32 radius = 0.5f;                      // sphere / capsule
  f32 halfHeight = 0.5f;                  // capsule cylinder half height (capsule total = 2*(hh+r))
  Vec3 offset{0, 0, 0};                   // local offset from the body origin

  f32 BoundingRadius() const {
    switch (type) {
      case ShapeType::Sphere: return radius + Length(offset);
      case ShapeType::Capsule: return halfHeight + radius + Length(offset);
      default: return Length(halfExtents) + Length(offset);
    }
  }
  AABB LocalBounds() const {
    switch (type) {
      case ShapeType::Sphere:
        return AABB::FromCenterExtents(offset, Vec3(radius));
      case ShapeType::Capsule:
        return AABB::FromCenterExtents(offset, Vec3(radius, halfHeight + radius, radius));
      default:
        return AABB::FromCenterExtents(offset, halfExtents);
    }
  }
};

struct BodyDesc {
  EntityId entity = 0;
  BodyType type = BodyType::Static;
  CollisionShape shape;
  Vec3 position{0, 0, 0};
  Quat rotation = Quat::Identity();
  Vec3 scale{1, 1, 1};
  f32 mass = 1.0f;
  f32 friction = 0.6f;
  f32 restitution = 0.0f;
  f32 linearDamping = 0.05f;
  f32 angularDamping = 0.2f;
  bool isTrigger = false;
  bool useGravity = true;
  bool freezeRotation = true;
  bool freezeX = false, freezeY = false, freezeZ = false;
  int layer = 0;
  const char* debugName = "";
};

struct PhysicsBody {
  PhysicsBodyId id = kInvalidBody;
  EntityId entity = 0;
  BodyType type = BodyType::Static;
  CollisionShape shape;
  Vec3 position{0, 0, 0};
  Quat rotation = Quat::Identity();
  Vec3 scale{1, 1, 1};
  Vec3 linearVelocity{0, 0, 0};
  Vec3 angularVelocity{0, 0, 0};
  Vec3 forceAccumulator{0, 0, 0};
  f32 mass = 1.0f;
  f32 invMass = 1.0f;
  f32 friction = 0.6f;
  f32 restitution = 0.0f;
  f32 linearDamping = 0.05f;
  f32 angularDamping = 0.2f;
  bool isTrigger = false;
  bool useGravity = true;
  bool freezeRotation = true;
  bool freezeX = false, freezeY = false, freezeZ = false;
  int layer = 0;
  bool grounded = false;
  bool sleeping = false;
  f32 sleepTimer = 0.0f;
  AABB worldBounds;
  std::string name;
  bool marked = false;      // scratch flag for broadphase bookkeeping
};

struct PhysicsRayHit {
  bool hit = false;
  f32 distance = 0.0f;
  Vec3 point{0, 0, 0};
  Vec3 normal{0, 1, 0};
  EntityId entity = 0;
  PhysicsBodyId body = kInvalidBody;
};

enum class ContactEventType : int { TriggerEnter, TriggerExit, CollisionEnter, CollisionExit };

struct ContactEvent {
  ContactEventType type = ContactEventType::CollisionEnter;
  EntityId a = 0;
  EntityId b = 0;
  Vec3 point{0, 0, 0};
  Vec3 normal{0, 1, 0};
  f32 impulse = 0.0f;
};

// Internal narrowphase helpers (also unit tested directly).
struct ShapeHit {
  bool hit = false;
  f32 distance = 0.0f;      // for sweeps: 0..1 fraction of delta
  Vec3 normal{0, 1, 0};
  Vec3 point{0, 0, 0};
};
ShapeHit SweepShapes(const CollisionShape& moving, const Vec3& from, const Quat& fromRot,
                     const Vec3& movingScale, const CollisionShape& other, const Vec3& otherPos,
                     const Quat& otherRot, const Vec3& otherScale, const Vec3& delta);
bool OverlapShapes(const CollisionShape& a, const Vec3& aPos, const Quat& aRot, const Vec3& aScale,
                   const CollisionShape& b, const Vec3& bPos, const Quat& bRot, const Vec3& bScale);

} // namespace nf
