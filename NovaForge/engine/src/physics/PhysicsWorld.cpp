// NovaForge Engine - physics/PhysicsWorld.cpp
#include "physics/PhysicsWorld.h"
#include "scene/Scene.h"
#include "core/Log.h"
#include "core/Time.h"

#include <chrono>

namespace nf {

// =============================================================== shape maths
namespace {

Vec3 ShapeWorldCenter(const CollisionShape& shape, const Vec3& position, const Quat& rotation) {
  return position + rotation * shape.offset;
}

// Closest point on segment [a,b] to point p.
Vec3 ClosestPointOnSegment(const Vec3& a, const Vec3& b, const Vec3& p) {
  Vec3 ab = b - a;
  f32 lengthSq = LengthSq(ab);
  if (lengthSq < 1e-9f) return a;
  f32 t = Saturate(Dot(p - a, ab) / lengthSq);
  return a + ab * t;
}

// Distance from a point to a shape's surface (negative inside).
f32 DistanceToShape(const CollisionShape& shape, const Vec3& center, const Quat& rotation,
                    const Vec3& point, Vec3* outNormal) {
  switch (shape.type) {
    case ShapeType::Sphere: {
      Vec3 d = point - center;
      f32 len = Length(d);
      if (outNormal) *outNormal = len > 1e-6f ? d / len : Vec3(0, 1, 0);
      return len - shape.radius;
    }
    case ShapeType::Capsule: {
      Vec3 up = rotation * Vec3(0, 1, 0);
      Vec3 a = center + up * shape.halfHeight;
      Vec3 b = center - up * shape.halfHeight;
      Vec3 closest = ClosestPointOnSegment(a, b, point);
      Vec3 d = point - closest;
      f32 len = Length(d);
      if (outNormal) *outNormal = len > 1e-6f ? d / len : up;
      return len - shape.radius;
    }
    case ShapeType::Plane: {
      Vec3 normal = rotation * Vec3(0, 1, 0);
      if (outNormal) *outNormal = normal;
      return Dot(point - center, normal);
    }
    case ShapeType::Box:
    default: {
      Quat inv = rotation.Conjugate();
      Vec3 local = inv * (point - center);
      Vec3 ext = shape.halfExtents;
      Vec3 clamped(Clamp(local.x, -ext.x, ext.x), Clamp(local.y, -ext.y, ext.y),
                   Clamp(local.z, -ext.z, ext.z));
      Vec3 outside = local - clamped;
      f32 outsideLength = Length(outside);
      if (outsideLength > 1e-6f) {
        if (outNormal) *outNormal = rotation * (outside / outsideLength);
        return outsideLength;
      }
      // inside: distance to the nearest face
      Vec3 dist(ext.x - Abs(local.x), ext.y - Abs(local.y), ext.z - Abs(local.z));
      int axis = dist.x < dist.y ? (dist.x < dist.z ? 0 : 2) : (dist.y < dist.z ? 1 : 2);
      Vec3 localNormal(0, 0, 0);
      localNormal[axis] = local[axis] >= 0 ? 1.0f : -1.0f;
      if (outNormal) *outNormal = rotation * localNormal;
      return -dist[axis];
    }
  }
}

bool RaycastShape(const CollisionShape& shape, const Vec3& center, const Quat& rotation,
                  const Ray& ray, f32* outDistance, Vec3* outNormal) {
  switch (shape.type) {
    case ShapeType::Sphere: {
      f32 t = 0;
      if (!RaycastSphere(ray, center, shape.radius, &t)) return false;
      if (outDistance) *outDistance = t;
      if (outNormal) *outNormal = Normalize(ray.At(t) - center);
      return true;
    }
    case ShapeType::Plane: {
      Vec3 normal = rotation * Vec3(0, 1, 0);
      f32 t = 0;
      if (!RaycastPlane(ray, center, normal, &t)) return false;
      if (outDistance) *outDistance = t;
      if (outNormal) *outNormal = normal;
      return true;
    }
    case ShapeType::Capsule: {
      Vec3 up = rotation * Vec3(0, 1, 0);
      Vec3 a = center + up * shape.halfHeight;
      Vec3 b = center - up * shape.halfHeight;
      // treat as sphere-swept segment: sample the segment for the closest approach
      f32 best = 1e30f;
      Vec3 bestNormal(0, 1, 0);
      for (int i = 0; i <= 8; i++) {
        Vec3 point = a + (b - a) * ((f32)i / 8.0f);
        f32 t = 0;
        if (RaycastSphere(ray, point, shape.radius, &t) && t < best) {
          best = t;
          bestNormal = Normalize(ray.At(t) - point);
        }
      }
      if (best > 1e29f) return false;
      if (outDistance) *outDistance = best;
      if (outNormal) *outNormal = bestNormal;
      return true;
    }
    case ShapeType::Box:
    default: {
      Quat inv = rotation.Conjugate();
      Ray local;
      local.origin = inv * (ray.origin - center);
      local.direction = inv * ray.direction;
      AABB box = AABB::FromCenterExtents(Vec3(0, 0, 0), shape.halfExtents);
      f32 t = 0;
      Vec3 normal;
      if (!RaycastAABB(local, box, &t, &normal)) return false;
      if (outDistance) *outDistance = t;
      if (outNormal) *outNormal = rotation * normal;
      return true;
    }
  }
}

// Scale a local-space collision shape into world space (both dimension and offset).
// Physics bodies keep LOCAL shapes + a scale; every test scales first so local units and
// world units can never disagree.
CollisionShape ScaleCollisionShape(const CollisionShape& shape, const Vec3& scale) {
  CollisionShape out = shape;
  Vec3 s(Abs(scale.x), Abs(scale.y), Abs(scale.z));
  if (s.x <= 1e-5f) s.x = 1.0f;
  if (s.y <= 1e-5f) s.y = 1.0f;
  if (s.z <= 1e-5f) s.z = 1.0f;
  f32 maxScale = std::max(s.x, std::max(s.y, s.z));
  switch (shape.type) {
    case ShapeType::Sphere:
      out.radius = shape.radius * maxScale;
      break;
    case ShapeType::Capsule:
      out.radius = shape.radius * maxScale;
      out.halfHeight = shape.halfHeight * s.y;
      break;
    case ShapeType::Box:
      out.halfExtents = Vec3(shape.halfExtents.x * s.x, shape.halfExtents.y * s.y,
                             shape.halfExtents.z * s.z);
      break;
    case ShapeType::Plane:
    default:
      break;
  }
  // The offset is a LOCAL offset (like the dimensions) - ComputeWorldBounds() scales it the
  // same way, so the collision test and the broadphase never disagree.
  out.offset = Vec3(shape.offset.x * s.x, shape.offset.y * s.y, shape.offset.z * s.z);
  return out;
}

// Points that sample the surface / core of a shape. Used by the generic penetration test:
// every sample is tested against the other shape's exact distance field.
int CollectSupportPoints(const CollisionShape& shape, const Vec3& center, const Quat& rotation,
                         Vec3* out, int maxPoints) {
  int count = 0;
  auto push = [&](const Vec3& p) {
    if (count < maxPoints) out[count++] = p;
  };
  switch (shape.type) {
    case ShapeType::Sphere: {
      Vec3 up = rotation * Vec3(0, 1, 0);
      Vec3 right = rotation * Vec3(1, 0, 0);
      Vec3 fwd = rotation * Vec3(0, 0, 1);
      push(center + up * shape.radius);
      push(center - up * shape.radius);
      push(center + right * shape.radius);
      push(center - right * shape.radius);
      push(center + fwd * shape.radius);
      push(center - fwd * shape.radius);
      break;
    }
    case ShapeType::Capsule: {
      Vec3 up = rotation * Vec3(0, 1, 0);
      Vec3 top = center + up * shape.halfHeight;
      Vec3 bottom = center - up * shape.halfHeight;
      for (int i = 0; i <= 6; i++) push(Lerp(bottom, top, (f32)i / 6.0f));
      break;
    }
    case ShapeType::Plane: {
      push(center);
      break;
    }
    case ShapeType::Box:
    default: {
      Vec3 axis[3] = {rotation * Vec3(1, 0, 0), rotation * Vec3(0, 1, 0), rotation * Vec3(0, 0, 1)};
      Vec3 ext = shape.halfExtents;
      // 8 corners
      for (int sx = -1; sx <= 1; sx += 2) {
        for (int sy = -1; sy <= 1; sy += 2) {
          for (int sz = -1; sz <= 1; sz += 2) {
            push(center + axis[0] * (ext.x * (f32)sx) + axis[1] * (ext.y * (f32)sy) +
                 axis[2] * (ext.z * (f32)sz));
          }
        }
      }
      // 6 face centres (a face can be the deepest contact when the other shape is small)
      push(center + axis[0] * ext.x);
      push(center - axis[0] * ext.x);
      push(center + axis[1] * ext.y);
      push(center - axis[1] * ext.y);
      push(center + axis[2] * ext.z);
      push(center - axis[2] * ext.z);
      break;
    }
  }
  return count;
}

// Exact minimum-translation-vector for two oriented boxes (separating axis test).
// The returned normal points away from B (the direction A must move to separate).
bool BoxBoxPenetration(const Vec3& aPos, const Quat& aRot, const Vec3& aHalf, const Vec3& bPos,
                       const Quat& bRot, const Vec3& bHalf, Vec3* outNormal, f32* outDepth) {
  Vec3 aAxis[3] = {aRot * Vec3(1, 0, 0), aRot * Vec3(0, 1, 0), aRot * Vec3(0, 0, 1)};
  Vec3 bAxis[3] = {bRot * Vec3(1, 0, 0), bRot * Vec3(0, 1, 0), bRot * Vec3(0, 0, 1)};
  const f32* aExt[3] = {&aHalf.x, &aHalf.y, &aHalf.z};
  const f32* bExt[3] = {&bHalf.x, &bHalf.y, &bHalf.z};
  Vec3 delta = bPos - aPos;

  Vec3 axes[15];
  int axisCount = 0;
  for (int i = 0; i < 3; i++) axes[axisCount++] = aAxis[i];
  for (int i = 0; i < 3; i++) axes[axisCount++] = bAxis[i];
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) axes[axisCount++] = Cross(aAxis[i], bAxis[j]);
  }

  f32 bestOverlap = 1e30f;
  Vec3 bestAxis(0, 1, 0);
  for (int i = 0; i < axisCount; i++) {
    Vec3 axis = axes[i];
    f32 len = Length(axis);
    if (len < 1e-5f) continue;            // parallel axes: skip the degenerate cross product
    axis = axis / len;
    f32 ra = 0.0f;
    f32 rb = 0.0f;
    for (int k = 0; k < 3; k++) {
      ra += Abs(Dot(axis, aAxis[k])) * (*aExt[k]);
      rb += Abs(Dot(axis, bAxis[k])) * (*bExt[k]);
    }
    f32 projected = Dot(delta, axis);
    f32 overlap = ra + rb - Abs(projected);
    if (overlap <= 0.0f) return false;     // separating axis found
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      // make the axis point from A towards B, the caller pushes A the other way
      bestAxis = projected < 0.0f ? -axis : axis;
    }
  }
  if (outNormal) *outNormal = -bestAxis;
  if (outDepth) *outDepth = bestOverlap;
  return true;
}

// Generic penetration test between two shapes in world space.
bool ComputePenetration(const CollisionShape& a, const Vec3& aPos, const Quat& aRot,
                        const CollisionShape& b, const Vec3& bPos, const Quat& bRot,
                        Vec3* outNormal, f32* outDepth) {
  Vec3 centerA = ShapeWorldCenter(a, aPos, aRot);
  Vec3 centerB = ShapeWorldCenter(b, bPos, bRot);

  if (a.type == ShapeType::Box && b.type == ShapeType::Box) {
    if (BoxBoxPenetration(centerA, aRot, a.halfExtents, centerB, bRot, b.halfExtents, outNormal,
                          outDepth)) {
      return true;
    }
    return false;
  }

  // A point on A's surface touches B when its distance to B's surface is smaller than A's
  // thickness along that direction (radius for spheres/capsules, 0 for box corners).
  f32 margin = (a.type == ShapeType::Sphere || a.type == ShapeType::Capsule) ? a.radius : 0.0f;
  Vec3 sample[16];
  int count = CollectSupportPoints(a, centerA, aRot, sample, 16);
  f32 bestDepth = 0.0f;
  Vec3 bestNormal(0, 1, 0);
  for (int i = 0; i < count; i++) {
    Vec3 normal;
    f32 distance = DistanceToShape(b, centerB, bRot, sample[i], &normal);
    f32 depth = margin - distance;
    if (depth > bestDepth) {
      bestDepth = depth;
      bestNormal = normal;
      if (LengthSq(bestNormal) < 0.5f) bestNormal = Vec3(0, 1, 0);
    }
  }
  if (bestDepth <= 0.0f) return false;
  if (outNormal) *outNormal = bestNormal;
  if (outDepth) *outDepth = bestDepth;
  return true;
}

} // namespace

// =============================================================== public shape API
ShapeHit SweepShapes(const CollisionShape& moving, const Vec3& from, const Quat& fromRot,
                     const Vec3& movingScale, const CollisionShape& other, const Vec3& otherPos,
                     const Quat& otherRot, const Vec3& otherScale, const Vec3& delta) {
  ShapeHit result;
  f32 distance = Length(delta);
  Vec3 direction = distance > 1e-8f ? delta / distance : Vec3(0, 0, 0);
  if (distance < 1e-8f) return result;

  // Conservative advancement: step along the sweep and test overlap. The step count follows
  // the moving shape's own thickness so a character never tunnels through a thin floor.
  const CollisionShape worldMoving = ScaleCollisionShape(moving, movingScale);
  const CollisionShape worldOther = ScaleCollisionShape(other, otherScale);
  f32 sampleStep = std::max(0.02f, worldMoving.BoundingRadius() * 0.35f);
  int steps = (int)Clamp(distance / sampleStep + 8.0f, 8.0f, 64.0f);

  Vec3 previous = from;
  for (int i = 1; i <= steps; i++) {
    f32 t = (f32)i / (f32)steps;
    Vec3 position = from + delta * t;
    Vec3 normal;
    f32 depth = 0;
    if (ComputePenetration(worldMoving, position, fromRot, worldOther, otherPos, otherRot, &normal,
                           &depth)) {
      // refine between the previous sample and this one (bisection)
      f32 low = (f32)(i - 1) / (f32)steps;
      f32 high = t;
      for (int iter = 0; iter < 8; iter++) {
        f32 mid = (low + high) * 0.5f;
        Vec3 midNormal;
        f32 midDepth = 0;
        if (ComputePenetration(worldMoving, from + delta * mid, fromRot, worldOther, otherPos,
                               otherRot, &midNormal, &midDepth)) {
          high = mid;
        } else {
          low = mid;
        }
      }
      result.hit = true;
      result.distance = high;
      result.normal = Normalize(normal);
      if (LengthSq(result.normal) < 0.5f) result.normal = -Normalize(direction);
      result.point = from + delta * high;
      NF_UNUSED(previous);
      return result;
    }
    previous = position;
  }
  return result;
}

bool OverlapShapes(const CollisionShape& a, const Vec3& aPos, const Quat& aRot, const Vec3& aScale,
                   const CollisionShape& b, const Vec3& bPos, const Quat& bRot,
                   const Vec3& bScale) {
  CollisionShape worldA = ScaleCollisionShape(a, aScale);
  CollisionShape worldB = ScaleCollisionShape(b, bScale);
  Vec3 normal;
  f32 depth = 0;
  return ComputePenetration(worldA, aPos, aRot, worldB, bPos, bRot, &normal, &depth);
}

// =============================================================== PhysicsWorld
PhysicsWorld::PhysicsWorld() {}
PhysicsWorld::~PhysicsWorld() { Shutdown(); }

void PhysicsWorld::Initialize(const PhysicsSettings& settings) {
  settings_ = settings;
  bodies_.clear();
  freeIndices_.clear();
  entityToBody_.clear();
  grid_.clear();
  initialized_ = true;
  NF_INFO(LogCategory::Physics, "Physics world initialised (gravity %.2f, substeps %d)",
          settings_.gravity.y, settings_.substeps);
}

void PhysicsWorld::Shutdown() {
  bodies_.clear();
  freeIndices_.clear();
  entityToBody_.clear();
  grid_.clear();
  activeTriggerPairs_.clear();
  activeContactPairs_.clear();
  initialized_ = false;
}

PhysicsBodyId PhysicsWorld::CreateBody(const BodyDesc& desc) {
  if (!initialized_) Initialize();
  i32 index;
  if (!freeIndices_.empty()) {
    index = freeIndices_.back();
    freeIndices_.pop_back();
  } else {
    index = (i32)bodies_.size();
    bodies_.push_back(PhysicsBody{});
    lastBounds_.push_back(AABB{});
    bodyCells_.push_back({});
  }
  PhysicsBody& body = bodies_[(usize)index];
  body = PhysicsBody{};
  body.id = (PhysicsBodyId)index;
  body.entity = desc.entity;
  body.type = desc.type;
  body.shape = desc.shape;
  body.position = desc.position;
  body.rotation = desc.rotation.Normalized();
  body.scale = desc.scale;
  body.mass = std::max(0.001f, desc.mass);
  body.invMass = body.type == BodyType::Dynamic ? 1.0f / body.mass : 0.0f;
  body.friction = desc.friction;
  body.restitution = desc.restitution;
  body.linearDamping = desc.linearDamping;
  body.angularDamping = desc.angularDamping;
  body.isTrigger = desc.isTrigger;
  body.useGravity = desc.useGravity;
  body.freezeRotation = desc.freezeRotation;
  body.freezeX = desc.freezeX;
  body.freezeY = desc.freezeY;
  body.freezeZ = desc.freezeZ;
  body.layer = desc.layer;
  body.name = desc.debugName ? desc.debugName : "";
  body.worldBounds = ComputeWorldBounds(body);
  if (desc.entity != 0) entityToBody_[desc.entity] = index;
  InsertIntoCells(index, body.worldBounds);
  lastBounds_[(usize)index] = body.worldBounds;
  return body.id;
}

void PhysicsWorld::DestroyBody(PhysicsBodyId id) {
  if (id >= bodies_.size()) return;
  PhysicsBody& body = bodies_[id];
  if (body.entity != 0) entityToBody_.erase(body.entity);
  RemoveFromCells((i32)id);
  body = PhysicsBody{};
  body.id = kInvalidBody;
  freeIndices_.push_back((i32)id);
}

void PhysicsWorld::DestroyBodiesForEntity(EntityId entity) {
  auto it = entityToBody_.find(entity);
  while (it != entityToBody_.end()) {
    DestroyBody((PhysicsBodyId)it->second);
    it = entityToBody_.find(entity);
  }
}

PhysicsBody* PhysicsWorld::GetBody(PhysicsBodyId id) {
  if (id >= bodies_.size() || bodies_[id].id == kInvalidBody) return nullptr;
  return &bodies_[id];
}

const PhysicsBody* PhysicsWorld::GetBody(PhysicsBodyId id) const {
  if (id >= bodies_.size() || bodies_[id].id == kInvalidBody) return nullptr;
  return &bodies_[id];
}

PhysicsBody* PhysicsWorld::GetBodyForEntity(EntityId entity) {
  auto it = entityToBody_.find(entity);
  if (it == entityToBody_.end()) return nullptr;
  return GetBody((PhysicsBodyId)it->second);
}

const PhysicsBody* PhysicsWorld::GetBodyForEntity(EntityId entity) const {
  auto it = entityToBody_.find(entity);
  if (it == entityToBody_.end()) return nullptr;
  return GetBody((PhysicsBodyId)it->second);
}

EntityId PhysicsWorld::EntityOf(PhysicsBodyId id) const {
  const PhysicsBody* body = GetBody(id);
  return body ? body->entity : 0;
}

AABB PhysicsWorld::ComputeWorldBounds(const PhysicsBody& body) const {
  AABB local = body.shape.LocalBounds();
  // scale the shape (uniform-ish scaling supported)
  Vec3 scale = Vec3(Abs(body.scale.x), Abs(body.scale.y), Abs(body.scale.z));
  if (body.shape.type == ShapeType::Box) {
    local.min = Vec3(local.min.x * scale.x, local.min.y * scale.y, local.min.z * scale.z);
    local.max = Vec3(local.max.x * scale.x, local.max.y * scale.y, local.max.z * scale.z);
  } else {
    f32 maxScale = std::max(scale.x, std::max(scale.y, scale.z));
    local.min = local.min * maxScale;
    local.max = local.max * maxScale;
  }
  Mat4 matrix = Mat4::TRS(body.position, body.rotation, Vec3(1, 1, 1));
  return AABB::Transform(local, matrix);
}

// ------------------------------------------------------------------ spatial hash
static i64 CellKey(int x, int y, int z) {
  return ((i64)(x & 0xFFFFF) << 42) | ((i64)(y & 0xFFFFF) << 21) | (i64)(z & 0xFFFFF);
}

void PhysicsWorld::InsertIntoCells(i32 index, const AABB& bounds) {
  if (index < 0 || (usize)index >= bodies_.size()) return;
  f32 cell = cellSize_;
  int x0 = (int)Floor(bounds.min.x / cell), x1 = (int)Floor(bounds.max.x / cell);
  int y0 = (int)Floor(bounds.min.y / cell), y1 = (int)Floor(bounds.max.y / cell);
  int z0 = (int)Floor(bounds.min.z / cell), z1 = (int)Floor(bounds.max.z / cell);
  int cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
  if (cells > 512) {
    // very large objects (ground planes) go into a "huge" list only
    grid_[CellKey(0x7FFFF, 0x7FFFF, 0x7FFFF)].push_back(index);
    bodyCells_[(usize)index].push_back(CellKey(0x7FFFF, 0x7FFFF, 0x7FFFF));
    return;
  }
  for (int x = x0; x <= x1; x++)
    for (int y = y0; y <= y1; y++)
      for (int z = z0; z <= z1; z++) {
        i64 key = CellKey(x, y, z);
        grid_[key].push_back(index);
        bodyCells_[(usize)index].push_back(key);
      }
}

void PhysicsWorld::RemoveFromCells(i32 index) {
  if (index < 0 || (usize)index >= bodyCells_.size()) return;
  for (i64 key : bodyCells_[(usize)index]) {
    auto it = grid_.find(key);
    if (it == grid_.end()) continue;
    auto& list = it->second;
    list.erase(std::remove(list.begin(), list.end(), index), list.end());
    if (list.empty()) grid_.erase(it);
  }
  bodyCells_[(usize)index].clear();
}

void PhysicsWorld::UpdateBroadphaseCell(i32 index, const AABB& bounds) {
  if (index < 0 || (usize)index >= lastBounds_.size()) return;
  const AABB& previous = lastBounds_[(usize)index];
  if (previous.min.x <= bounds.min.x && previous.min.y <= bounds.min.y &&
      previous.min.z <= bounds.min.z && previous.max.x >= bounds.max.x &&
      previous.max.y >= bounds.max.y && previous.max.z >= bounds.max.z)
    return;   // still inside the same (conservative) region
  RemoveFromCells(index);
  InsertIntoCells(index, bounds);
  lastBounds_[(usize)index] = bounds;
}

void PhysicsWorld::BroadphasePairs(std::vector<std::pair<i32, i32>>& pairs) {
  pairs.clear();
  std::unordered_set<u64> seen;
  std::unordered_set<i32> candidates;
  for (auto& cell : grid_) {
    const auto& list = cell.second;
    if (list.size() < 2) continue;
    for (usize i = 0; i < list.size(); i++) {
      for (usize j = i + 1; j < list.size(); j++) {
        i32 a = list[i], b = list[j];
        if (a == b) continue;
        if (a > b) std::swap(a, b);
        u64 key = ((u64)(u32)a << 32) | (u32)b;
        if (!seen.insert(key).second) continue;
        const PhysicsBody& bodyA = bodies_[(usize)a];
        const PhysicsBody& bodyB = bodies_[(usize)b];
        if (bodyA.id == kInvalidBody || bodyB.id == kInvalidBody) continue;
        if (bodyA.type == BodyType::Static && bodyB.type == BodyType::Static) continue;
        if (bodyA.isTrigger && bodyB.isTrigger) continue;
        if (bodyA.type == BodyType::Kinematic && bodyB.type == BodyType::Kinematic) continue;
        if (!bodyA.worldBounds.Expanded(0.01f).Intersects(bodyB.worldBounds.Expanded(0.01f)))
          continue;
        pairs.push_back({a, b});
      }
    }
  }
  NF_UNUSED(candidates);
  lastResult_.broadphasePairs = (u32)pairs.size();
}

// ------------------------------------------------------------------ simulation
void PhysicsWorld::Integrate(f32 deltaTime) {
  for (auto& body : bodies_) {
    if (body.id == kInvalidBody) continue;
    if (body.type != BodyType::Dynamic) continue;
    if (body.sleeping) continue;
    Vec3 acceleration = body.forceAccumulator * body.invMass;
    if (body.useGravity) acceleration += settings_.gravity;
    body.linearVelocity += acceleration * deltaTime;
    // damping
    f32 damping = 1.0f - Clamp(body.linearDamping * deltaTime, 0.0f, 1.0f);
    body.linearVelocity *= damping;
    f32 maxSpeed = settings_.maxVelocity;
    if (LengthSq(body.linearVelocity) > maxSpeed * maxSpeed)
      body.linearVelocity = Normalize(body.linearVelocity) * maxSpeed;
    if (body.freezeX) body.linearVelocity.x = 0;
    if (body.freezeY) body.linearVelocity.y = 0;
    if (body.freezeZ) body.linearVelocity.z = 0;
    body.forceAccumulator = Vec3(0, 0, 0);
  }
}

std::vector<PhysicsBodyId> PhysicsWorld::GatherPotentialContacts(PhysicsBodyId id) const {
  std::vector<PhysicsBodyId> out;
  const PhysicsBody* body = GetBody(id);
  if (!body) return out;
  AABB query = body->worldBounds.Expanded(static_cast<f32>(cellSize_));
  for (auto& cell : grid_) {
    for (i32 other : cell.second) {
      if (other == (i32)id) continue;
      const PhysicsBody& candidate = bodies_[(usize)other];
      if (candidate.id == kInvalidBody) continue;
      if (candidate.type == BodyType::Static || candidate.type == BodyType::Kinematic ||
          candidate.type == BodyType::Dynamic) {
        if (candidate.worldBounds.Intersects(query)) {
          if (std::find(out.begin(), out.end(), candidate.id) == out.end())
            out.push_back(candidate.id);
        }
      }
    }
  }
  return out;
}

void PhysicsWorld::ResolveContacts(f32 deltaTime) {
  struct MoveContext {
    PhysicsBody* body = nullptr;
    Vec3 displacement;
    Vec3 originalDisplacement;
  };

  std::vector<i32> dynamicIndices;
  for (usize i = 0; i < bodies_.size(); i++) {
    PhysicsBody& body = bodies_[i];
    if (body.id == kInvalidBody) continue;
    if (body.type == BodyType::Static) { lastResult_.staticBodies++; continue; }
    if (body.sleeping && body.type == BodyType::Dynamic) { lastResult_.sleepingBodies++; continue; }
    if (body.type == BodyType::Dynamic) body.grounded = false;
    if (body.linearVelocity.x == 0 && body.linearVelocity.y == 0 && body.linearVelocity.z == 0 &&
        body.type == BodyType::Dynamic)
      continue;
    dynamicIndices.push_back((i32)i);
  }
  lastResult_.activeBodies = (u32)dynamicIndices.size();

  for (i32 index : dynamicIndices) {
    PhysicsBody& body = bodies_[(usize)index];
    Vec3 displacement = body.linearVelocity * deltaTime;
    f32 remaining = 1.0f;
    int iterations = 0;
    const f32 skin = 0.002f;

    while (remaining > 0.001f && iterations < 4) {
      iterations++;
      Vec3 step = displacement * remaining;
      if (LengthSq(step) < 1e-10f) break;

      AABB sweptBounds = body.worldBounds;
      AABB targetBounds = ComputeWorldBounds(body);
      targetBounds.min += step;                     // where the body would end up
      targetBounds.max += step;
      sweptBounds.Expand(targetBounds);             // union current + destination
      sweptBounds.ExpandBy(Abs(step) * 0.5f);       // plus a safety margin

      // gather candidates from the grid around the swept volume
      std::unordered_set<i32> candidates;
      for (auto& cell : grid_) {
        for (i32 other : cell.second) {
          if (other == index) continue;
          const PhysicsBody& candidate = bodies_[(usize)other];
          if (candidate.id == kInvalidBody) continue;
          if (candidate.type == BodyType::Static || candidate.type == BodyType::Kinematic ||
              candidate.type == BodyType::Dynamic) {
            if (candidate.worldBounds.Intersects(sweptBounds)) candidates.insert(other);
          }
        }
      }

      f32 closestT = 1.0f;
      Vec3 closestNormal(0, 0, 0);
      bool found = false;
      i32 hitIndex = -1;
      for (i32 other : candidates) {
        PhysicsBody& otherBody = bodies_[(usize)other];
        if (otherBody.isTrigger) continue;
        ShapeHit hit = SweepShapes(body.shape, body.position, body.rotation, body.scale,
                                   otherBody.shape, otherBody.position, otherBody.rotation,
                                   otherBody.scale, step);
        if (hit.hit && hit.distance < closestT) {
          closestT = hit.distance;
          closestNormal = hit.normal;
          found = true;
          hitIndex = other;
        }
      }

      if (!found) {
        body.position += step;
        remaining = 0.0f;
      } else {
        // advance to the contact point, leaving a small skin
        f32 travel = std::max(0.0f, closestT - skin / std::max(0.001f, Length(step)));
        body.position += step * travel;

        PhysicsBody* otherBody = hitIndex >= 0 ? &bodies_[(usize)hitIndex] : nullptr;
        // relative velocity along the contact normal
        Vec3 relativeVelocity = body.linearVelocity;
        if (otherBody && otherBody->type == BodyType::Dynamic) relativeVelocity -= otherBody->linearVelocity;
        f32 normalSpeed = Dot(relativeVelocity, closestNormal);

        f32 restitution = body.restitution;
        if (otherBody) restitution = std::max(body.restitution, otherBody->restitution);
        // no bounce for slow contacts (prevents jitter on resting objects)
        if (Abs(normalSpeed) < 0.6f) restitution = 0.0f;

        if (normalSpeed < 0) {
          Vec3 normalComponent = closestNormal * normalSpeed;
          Vec3 tangential = body.linearVelocity - normalComponent;
          f32 friction = body.friction;
          if (otherBody) friction = (body.friction + otherBody->friction) * 0.5f;
          Vec3 newVelocity = body.linearVelocity - normalComponent * (1.0f + restitution);
          if (closestNormal.y > 0.5f) {
            // ground contact: apply friction to the horizontal motion and stop falling
            f32 keep = 1.0f - Clamp(friction * deltaTime * 12.0f, 0.0f, 0.9f);
            newVelocity.x = tangential.x * keep;
            newVelocity.z = tangential.z * keep;
            newVelocity.y = std::max(0.0f, newVelocity.y);
            body.grounded = true;
          } else {
            newVelocity -= closestNormal * Dot(newVelocity, closestNormal) * friction;
          }
          body.linearVelocity = newVelocity;
          if (otherBody && otherBody->type == BodyType::Dynamic) {
            // approximate momentum exchange for dynamic-vs-dynamic
            f32 totalMass = body.mass + otherBody->mass;
            Vec3 push = closestNormal * (-normalSpeed) * (body.mass / totalMass);
            otherBody->linearVelocity += push * (1.0f + restitution);
          }
          body.sleepTimer = 0.0f;
        }
        // continue with whatever motion is left, along the surface
        Vec3 leftover = step * (1.0f - closestT);
        Vec3 slide = leftover - closestNormal * Dot(leftover, closestNormal);
        displacement = slide / std::max(0.0001f, remaining);
        remaining *= (1.0f - closestT);
        if (closestNormal.y > 0.5f) body.grounded = true;
        if (!found) break;
      }
    }

    // keep the body upright if rotation is frozen (typical for gameplay objects)
    if (body.freezeRotation) {
      body.rotation = Quat::Identity();
    }
    body.worldBounds = ComputeWorldBounds(body);
    UpdateBroadphaseCell(index, body.worldBounds);
  }
}

void PhysicsWorld::UpdateSleepStates(f32 deltaTime) {
  for (auto& body : bodies_) {
    if (body.id == kInvalidBody || body.type != BodyType::Dynamic) continue;
    if (LengthSq(body.linearVelocity) < settings_.sleepVelocityThreshold * settings_.sleepVelocityThreshold) {
      body.sleepTimer += deltaTime;
      if (body.sleepTimer > settings_.sleepTimeThreshold) body.sleeping = true;
    } else {
      body.sleepTimer = 0.0f;
      body.sleeping = false;
    }
  }
}

void PhysicsWorld::ProcessTriggers(Scene* scene) {
  std::unordered_set<u64> currentPairs;
  for (auto& pair : cachedPairs_) {
    PhysicsBody& a = bodies_[(usize)pair.first];
    PhysicsBody& b = bodies_[(usize)pair.second];
    if (a.id == kInvalidBody || b.id == kInvalidBody) continue;
    if (!a.isTrigger && !b.isTrigger) continue;
    if (!a.worldBounds.Intersects(b.worldBounds)) continue;
    if (!OverlapShapes(a.shape, a.position, a.rotation, a.scale, b.shape, b.position, b.rotation,
                      b.scale))
      continue;

    EntityId ea = a.entity, eb = b.entity;
    u64 key = ((u64)(u32)std::min(ea, eb) << 32) | (u32)std::max(ea, eb);
    if (ea == 0 || eb == 0) continue;
    // a trigger generates exactly one enter event per overlapping pair
    if (activeTriggerPairs_.insert(key).second) {
      // ensure the pair is not also counted as a normal collision
      contactEvents_.push_back({ContactEventType::TriggerEnter, ea, eb, a.position, Vec3(0, 1, 0), 0.0f});
      lastResult_.triggerEvents++;
      if (scene) scene->DispatchTriggerEnter(ea, eb);
    }
    currentPairs.insert(key);
    lastResult_.contacts++;
  }

  for (u64 key : activeTriggerPairs_) {
    if (currentPairs.count(key)) continue;
    EntityId a = (EntityId)(key >> 32);
    EntityId b = (EntityId)(key & 0xFFFFFFFFull);
    contactEvents_.push_back({ContactEventType::TriggerExit, a, b, Vec3(0, 0, 0), Vec3(0, 1, 0), 0.0f});
    if (scene) scene->DispatchTriggerExit(a, b);
  }
  activeTriggerPairs_ = currentPairs;

  // collision enter/exit for non-trigger pairs
  std::unordered_set<u64> touching;
  for (auto& pair : cachedPairs_) {
    PhysicsBody& a = bodies_[(usize)pair.first];
    PhysicsBody& b = bodies_[(usize)pair.second];
    if (a.id == kInvalidBody || b.id == kInvalidBody) continue;
    if (a.isTrigger || b.isTrigger) continue;
    if (a.entity == 0 || b.entity == 0) continue;
    if (!a.worldBounds.Expanded(0.02f).Intersects(b.worldBounds.Expanded(0.02f))) continue;
    if (!OverlapShapes(a.shape, a.position, a.rotation, a.scale, b.shape, b.position, b.rotation,
                      b.scale))
      continue;
    u64 key = ((u64)(u32)std::min(a.entity, b.entity) << 32) | (u32)std::max(a.entity, b.entity);
    if (activeContactPairs_.insert(key).second) {
      contactEvents_.push_back(
          {ContactEventType::CollisionEnter, a.entity, b.entity, a.position, Vec3(0, 1, 0), 0.0f});
      if (scene) scene->DispatchCollisionEnter(a.entity, b.entity);
    }
    touching.insert(key);
  }
  for (u64 key : activeContactPairs_) {
    if (touching.count(key)) continue;
    EntityId a = (EntityId)(key >> 32);
    EntityId b = (EntityId)(key & 0xFFFFFFFFull);
    contactEvents_.push_back({ContactEventType::CollisionExit, a, b, Vec3(0, 0, 0), Vec3(0, 1, 0), 0.0f});
    if (scene) scene->DispatchCollisionExit(a, b);
  }
  activeContactPairs_ = touching;
}

void PhysicsWorld::Step(f32 deltaTime, Scene* scene) {
  if (!initialized_) return;
  f64 start = NowSeconds();
  lastResult_ = PhysicsStepResult{};
  contactEvents_.clear();

  const int substeps = std::max(1, settings_.substeps);
  f32 subDelta = deltaTime / (f32)substeps;
  for (int step = 0; step < substeps; step++) {
    Integrate(subDelta);
    BroadphasePairs(cachedPairs_);
    ResolveContacts(subDelta);
  }
  UpdateSleepStates(deltaTime);
  ProcessTriggers(scene);

  lastResult_.stepMs = (f32)((NowSeconds() - start) * 1000.0);
}

void PhysicsWorld::SyncFromScene(Scene& scene) {
  scene.UpdateTransforms();
  for (auto& object : scene.AllObjects()) {
    PhysicsBody* body = GetBodyForEntity(object->id);
    if (!body) continue;
    if (body->type == BodyType::Dynamic) continue;   // dynamics own their transform
    Transform world = scene.WorldTransform(object->id);
    body->position = world.position;
    body->rotation = world.rotation;
    body->scale = world.scale;
    body->worldBounds = ComputeWorldBounds(*body);
    UpdateBroadphaseCell((i32)body->id, body->worldBounds);
  }
}

void PhysicsWorld::SyncToScene(Scene& scene) {
  for (auto& body : bodies_) {
    if (body.id == kInvalidBody || body.entity == 0) continue;
    if (body.type != BodyType::Dynamic) continue;
    if (body.sleeping) continue;
    GameObject* object = scene.Get(body.entity);
    if (!object) continue;
    if (TransformComponent* transform = object->Transform()) {
      if (object->parent == 0) {
        transform->position = body.position;
        transform->rotationEuler = body.rotation.EulerDegrees();
      } else {
        Transform world;
        world.position = body.position;
        world.rotation = body.rotation;
        world.scale = transform->scale;
        scene.SetWorldTransform(body.entity, world);
      }
    }
    scene.MarkTransformDirty(body.entity);
  }
}

// ------------------------------------------------------------------ queries
bool PhysicsWorld::Raycast(const Ray& ray, f32 maxDistance, bool includeTriggers,
                           PhysicsRayHit* out) const {
  bool found = false;
  f32 best = maxDistance;
  Vec3 normal(0, 1, 0);
  EntityId entity = 0;
  PhysicsBodyId bodyId = kInvalidBody;
  const_cast<PhysicsWorld*>(this)->BroadphasePairs(const_cast<PhysicsWorld*>(this)->cachedPairs_);
  for (usize i = 0; i < bodies_.size(); i++) {
    const PhysicsBody& body = bodies_[i];
    if (body.id == kInvalidBody) continue;
    if (body.isTrigger && !includeTriggers) continue;
    f32 t = 0;
    Vec3 hitNormal;
    if (!RaycastShape(body.shape, body.position, body.rotation, ray, &t, &hitNormal)) continue;
    if (t < 0 || t > best) continue;
    best = t;
    normal = hitNormal;
    entity = body.entity;
    bodyId = body.id;
    found = true;
  }
  if (out) {
    out->hit = found;
    out->distance = best;
    out->point = ray.origin + ray.direction * best;
    out->normal = normal;
    out->entity = entity;
    out->body = bodyId;
  }
  return found;
}

bool PhysicsWorld::RaycastBody(PhysicsBodyId id, const Ray& ray, PhysicsRayHit* out) const {
  const PhysicsBody* body = GetBody(id);
  if (!body) return false;
  f32 t = 0;
  Vec3 normal;
  if (!RaycastShape(body->shape, body->position, body->rotation, ray, &t, &normal)) return false;
  if (out) {
    out->hit = true;
    out->distance = t;
    out->point = ray.At(t);
    out->normal = normal;
    out->entity = body->entity;
    out->body = body->id;
  }
  return true;
}

std::vector<PhysicsBodyId> PhysicsWorld::QuerySphere(const Vec3& center, f32 radius,
                                                     bool includeTriggers) const {
  std::vector<PhysicsBodyId> out;
  for (const auto& body : bodies_) {
    if (body.id == kInvalidBody) continue;
    if (body.isTrigger && !includeTriggers) continue;
    if (Distance(center, body.position) > radius + body.shape.BoundingRadius()) continue;
    CollisionShape probe;
    probe.type = ShapeType::Sphere;
    probe.radius = radius;
    if (OverlapShapes(probe, center, Quat::Identity(), Vec3(1, 1, 1), body.shape, body.position,
                      body.rotation, body.scale))
      out.push_back(body.id);
  }
  return out;
}

bool PhysicsWorld::IsSleeping(PhysicsBodyId id) const {
  const PhysicsBody* body = GetBody(id);
  return body ? body->sleeping : false;
}

// ------------------------------------------------------------------ control
void PhysicsWorld::SetPosition(PhysicsBodyId id, const Vec3& position) {
  PhysicsBody* body = GetBody(id);
  if (!body) return;
  body->position = position;
  body->worldBounds = ComputeWorldBounds(*body);
  UpdateBroadphaseCell((i32)id, body->worldBounds);
}

void PhysicsWorld::SetRotation(PhysicsBodyId id, const Quat& rotation) {
  PhysicsBody* body = GetBody(id);
  if (!body) return;
  body->rotation = rotation;
  body->worldBounds = ComputeWorldBounds(*body);
  UpdateBroadphaseCell((i32)id, body->worldBounds);
}

void PhysicsWorld::SetVelocity(PhysicsBodyId id, const Vec3& velocity) {
  PhysicsBody* body = GetBody(id);
  if (!body) return;
  body->linearVelocity = velocity;
  body->sleeping = false;
  body->sleepTimer = 0.0f;
}

Vec3 PhysicsWorld::GetVelocity(PhysicsBodyId id) const {
  const PhysicsBody* body = GetBody(id);
  return body ? body->linearVelocity : Vec3(0, 0, 0);
}

void PhysicsWorld::AddForce(PhysicsBodyId id, const Vec3& force) {
  PhysicsBody* body = GetBody(id);
  if (!body || body->type != BodyType::Dynamic) return;
  body->forceAccumulator += force;
  body->sleeping = false;
}

void PhysicsWorld::AddImpulse(PhysicsBodyId id, const Vec3& impulse) {
  PhysicsBody* body = GetBody(id);
  if (!body || body->type != BodyType::Dynamic) return;
  body->linearVelocity += impulse * body->invMass;
  body->sleeping = false;
  body->sleepTimer = 0.0f;
}

// ------------------------------------------------------------------ character moves
PhysicsWorld::MoveResult PhysicsWorld::MoveCapsule(PhysicsBodyId id, const Vec3& displacement,
                                                   f32 radius, f32 height, bool allowStepUp) {
  MoveResult result;
  PhysicsBody* body = GetBody(id);
  if (!body) {
    result.position = displacement;
    return result;
  }
  body->shape.type = ShapeType::Capsule;
  body->shape.radius = radius;
  body->shape.halfHeight = std::max(0.0f, height * 0.5f - radius);
  body->shape.offset = Vec3(0, height * 0.5f, 0);   // capsule origin at the feet

  Vec3 position = body->position;
  Vec3 remaining = displacement;
  const f32 skin = 0.004f;

  for (int iteration = 0; iteration < 4 && LengthSq(remaining) > 1e-10f; iteration++) {
    // gather candidates around the swept volume
    AABB swept = ComputeWorldBounds(*body);
    AABB target = swept;
    target.min += remaining;                       // union current + destination volume
    target.max += remaining;
    swept.Expand(target);
    swept.ExpandBy(Abs(remaining) + Vec3(skin + 0.1f));
    std::unordered_set<i32> candidates;
    for (auto& cell : grid_) {
      for (i32 other : cell.second) {
        if (other == (i32)id) continue;
        const PhysicsBody& candidate = bodies_[(usize)other];
        if (candidate.id == kInvalidBody || candidate.isTrigger) continue;
        if (candidate.worldBounds.Intersects(swept)) candidates.insert(other);
      }
    }

    f32 closest = 1.0f;
    Vec3 hitNormal(0, 0, 0);
    i32 hitIndex = -1;
    for (i32 other : candidates) {
      const PhysicsBody& otherBody = bodies_[(usize)other];
      ShapeHit hit = SweepShapes(body->shape, position, Quat::Identity(), body->scale,
                                 otherBody.shape, otherBody.position, otherBody.rotation,
                                 otherBody.scale, remaining);
      if (hit.hit && hit.distance < closest) {
        closest = hit.distance;
        hitNormal = hit.normal;
        hitIndex = other;
      }
    }

    if (hitIndex < 0) {
      position += remaining;
      remaining = Vec3(0, 0, 0);
      break;
    }

    // step-up: if the obstacle is a low step and we are moving mostly horizontally
    const PhysicsBody& obstacle = bodies_[(usize)hitIndex];
    if (allowStepUp && hitNormal.y < 0.4f) {
      f32 obstacleTop = obstacle.worldBounds.max.y;
      f32 feetY = position.y;
      f32 stepHeight = obstacleTop - feetY;
      bool mostlyHorizontal = Abs(remaining.x) + Abs(remaining.z) > Abs(remaining.y) * 2.0f;
      if (stepHeight > 0.02f && stepHeight <= 0.55f && mostlyHorizontal) {
        // try again from above the step
        Vec3 lifted = position + Vec3(0, stepHeight + 0.04f, 0);
        bool blocked = false;
        for (i32 other : candidates) {
          const PhysicsBody& otherBody = bodies_[(usize)other];
          if (otherBody.id == kInvalidBody || otherBody.isTrigger) continue;
          Vec3 flatDelta = Vec3(remaining.x, 0, remaining.z);
          ShapeHit hit = SweepShapes(body->shape, lifted, Quat::Identity(), body->scale,
                                     otherBody.shape, otherBody.position, otherBody.rotation,
                                     otherBody.scale, flatDelta);
          if (hit.hit && hit.distance < 0.2f) { blocked = true; break; }
        }
        if (!blocked) {
          position = lifted + Vec3(0, 0, 0);
          remaining = Vec3(remaining.x, std::min(remaining.y, 0.0f), remaining.z);
          continue;
        }
      }
    }

    // advance to the contact, then slide along the surface
    f32 travel = std::max(0.0f, closest - skin / std::max(0.001f, Length(remaining)));
    position += remaining * travel;
    Vec3 leftover = remaining * (1.0f - closest);
    Vec3 slide = leftover - hitNormal * Dot(leftover, hitNormal);
    if (hitNormal.y > 0.5f) {
      result.grounded = true;
      result.normal = hitNormal;
      // do not keep pressing into the ground
      if (remaining.y < 0) remaining.y = 0;
    } else if (hitNormal.y < -0.5f) {
      result.hitCeiling = true;
      remaining = Vec3(remaining.x, 0, remaining.z);
      slide = leftover - hitNormal * Dot(leftover, hitNormal);
    } else {
      result.hitWall = true;
      result.hitEntity = obstacle.entity;
    }
    if (slide.x == 0 && slide.z == 0 && hitNormal.y < 0.5f) {
      // fully blocked horizontally: stop
      remaining = Vec3(0, remaining.y, 0);
    } else {
      remaining = slide;
    }
  }

  // ground probe (a short downward sweep) so entities report grounded even without motion
  if (!result.grounded) {
    const PhysicsBody* self = body;
    (void)self;
    CollisionShape capsule = body->shape;
    AABB probeBounds = ComputeWorldBounds(*body);
    probeBounds.min.y -= 0.12f;
    for (auto& cell : grid_) {
      for (i32 other : cell.second) {
        if (other == (i32)id) continue;
        const PhysicsBody& otherBody = bodies_[(usize)other];
        if (otherBody.id == kInvalidBody || otherBody.isTrigger) continue;
        if (!otherBody.worldBounds.Intersects(probeBounds)) continue;
        ShapeHit hit = SweepShapes(capsule, position, Quat::Identity(), body->scale, otherBody.shape,
                                   otherBody.position, otherBody.rotation, otherBody.scale,
                                   Vec3(0, -0.12f, 0));
        if (hit.hit) {
          result.grounded = true;
          result.normal = hit.normal;
          break;
        }
      }
      if (result.grounded) break;
    }
  }

  body->position = position;
  body->worldBounds = ComputeWorldBounds(*body);
  UpdateBroadphaseCell((i32)id, body->worldBounds);
  result.position = position;
  return result;
}

} // namespace nf
