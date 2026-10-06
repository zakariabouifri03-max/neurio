// NovaForge Engine - physics world implementation (Bullet3)
#include "physics/physics.h"

#include "assets/mesh.h"
#include "core/log.h"

#include <BulletCollision/CollisionDispatch/btGhostObject.h>
#include <BulletCollision/CollisionShapes/btBvhTriangleMeshShape.h>
#include <BulletCollision/CollisionShapes/btConvexHullShape.h>
#include <BulletCollision/CollisionShapes/btTriangleMesh.h>
#include <BulletDynamics/Character/btKinematicCharacterController.h>
#include <btBulletDynamicsCommon.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <memory>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace nf {

// ---------------------------------------------------------------- helpers
namespace {

inline btVector3 toBt(const Vec3& v) { return btVector3(v.x, v.y, v.z); }
inline Vec3 fromBt(const btVector3& v) { return Vec3(v.x(), v.y(), v.z()); }
inline btQuaternion toBt(const Quat& q) { return btQuaternion(q.x, q.y, q.z, q.w); }
inline Quat fromBt(const btQuaternion& q) { return Quat(q.x(), q.y(), q.z(), q.w()); }

std::string num(float v) {
    char buf[32];
    snprintf(buf, sizeof buf, "%.4g", v);
    return buf;
}

// Signature of everything that requires a *shape*/body rebuild. Transform and
// velocity changes do not rebuild, they are applied in place.
std::string bodySignature(const Entity& e, PhysicsBodyKind kind) {
    std::string s = std::to_string((int)kind);
    const ColliderComponent& c = *e.collider;
    s += "|" + num((float)c.shape) + "|" + num(c.center.x) + "," + num(c.center.y) + "," +
         num(c.center.z) + "|" + num(c.size.x) + "," + num(c.size.y) + "," + num(c.size.z) + "|" +
         num(c.radius) + "|" + num(c.height) + "|" + num(c.friction) + "|" + num(c.restitution) +
         "|" + c.layer;
    if (e.rigidbody) {
        const RigidBodyComponent& r = *e.rigidbody;
        s += "|rb" + num((float)r.motionType) + "|" + num(r.mass) + "|" + num(r.linearDamping) +
             "|" + num(r.angularDamping) + "|" + (r.useGravity ? "1" : "0") + "|" +
             (r.freezeRotation ? "1" : "0");
    }
    if (e.mesh) s += "|m" + e.mesh->modelPath;
    return s;
}

struct DynContactCallback : public btCollisionWorld::ContactResultCallback {
    std::vector<EntityId>* out = nullptr;
    btScalar addSingleResult(btManifoldPoint&, const btCollisionObjectWrapper* a, int, int,
                             const btCollisionObjectWrapper* b, int, int) override {
        if (out) {
            if (auto* o = a->m_collisionObject) {
                int i = o->getUserIndex();
                if (i > 0) out->push_back((EntityId)i);
            }
            if (auto* o = b->m_collisionObject) {
                int i = o->getUserIndex();
                if (i > 0) out->push_back((EntityId)i);
            }
        }
        return 0.0f;
    }
};

struct RayFilterCallback : public btCollisionWorld::ClosestRayResultCallback {
    EntityId ignoreBody = kInvalidEntity;
    RayFilterCallback(const btVector3& from, const btVector3& to, EntityId ignore)
        : btCollisionWorld::ClosestRayResultCallback(from, to), ignoreBody(ignore) {}
    bool needsCollision(btBroadphaseProxy* proxy) const override {
        if (!btCollisionWorld::ClosestRayResultCallback::needsCollision(proxy)) return false;
        auto* obj = static_cast<btCollisionObject*>(proxy->m_clientObject);
        if (!obj) return true;
        if ((EntityId)obj->getUserIndex() == ignoreBody) return false;
        // trigger volumes are sensors: they never act as solid geometry
        if (obj->getCollisionFlags() & btCollisionObject::CF_NO_CONTACT_RESPONSE) return false;
        return true;
    }
};

}  // namespace

const char* toString(PhysicsBodyKind k) {
    switch (k) {
        case PhysicsBodyKind::Static: return "Static";
        case PhysicsBodyKind::Dynamic: return "Dynamic";
        case PhysicsBodyKind::Kinematic: return "Kinematic";
        case PhysicsBodyKind::Trigger: return "Trigger";
        case PhysicsBodyKind::Character: return "Character";
        default: return "None";
    }
}

std::string PhysicsSettings::stats() const {
    char buf[128];
    snprintf(buf, sizeof buf, "gravity (%.2f, %.2f, %.2f), step %.1f ms, %d substeps",
             gravity.x, gravity.y, gravity.z, fixedTimestep * 1000.0f, maxSubSteps);
    return buf;
}

// ---------------------------------------------------------------- internals
struct BodyRecord {
    EntityId entity = kInvalidEntity;
    PhysicsBodyKind kind = PhysicsBodyKind::None;
    std::string signature;
    btRigidBody* body = nullptr;
    btPairCachingGhostObject* ghost = nullptr;
    btCollisionShape* shape = nullptr;
    btKinematicCharacterController* controller = nullptr;
    std::vector<std::unique_ptr<btCollisionShape>> ownedShapes;
    std::unique_ptr<btTriangleMesh> triangleMesh;
    bool debugDraw = false;
    float capsuleHeight = 1.8f;
    float capsuleRadius = 0.35f;
    // character runtime
    Vec3 pendingMove{0, 0, 0};
    float pendingJumpSpeed = 0.0f;
    bool grounded = false;
    Vec3 velocity{0, 0, 0};
    float verticalVelocity = 0.0f;   // gravity is integrated here (see step())
    // trigger runtime
    std::set<EntityId> overlaps;
};

struct PhysicsWorld::Impl {
    PhysicsSettings settings;
    btDefaultCollisionConfiguration config;
    std::unique_ptr<btCollisionDispatcher> dispatcher;
    std::unique_ptr<btBroadphaseInterface> broadphase;
    std::unique_ptr<btSequentialImpulseConstraintSolver> solver;
    std::unique_ptr<btDiscreteDynamicsWorld> world;
    std::unique_ptr<btGhostPairCallback> ghostCallback;

    std::unordered_map<EntityId, std::unique_ptr<BodyRecord>> bodies;
    PhysicsMeshProvider meshProvider;
    std::vector<PhysicsEvent> events;
    float accumulator = 0.0f;
    int stepCount = 0;
    bool debugDraw = true;
    bool warnedMeshFallback = false;

    Impl() {
        dispatcher = std::make_unique<btCollisionDispatcher>(&config);
        broadphase = std::make_unique<btDbvtBroadphase>();
        solver = std::make_unique<btSequentialImpulseConstraintSolver>();
        world = std::make_unique<btDiscreteDynamicsWorld>(dispatcher.get(), broadphase.get(),
                                                          solver.get(), &config);
        ghostCallback = std::make_unique<btGhostPairCallback>();
        broadphase->getOverlappingPairCache()->setInternalGhostPairCallback(ghostCallback.get());
        world->setGravity(toBt(settings.gravity));
    }

    btCollisionShape* buildShape(const Entity& e, BodyRecord& rec) {
        const ColliderComponent& c = *e.collider;
        switch (c.shape) {
            case ColliderShape::Box: {
                Vec3 half = c.size * 0.5f;
                if (half.x <= 0) half.x = 0.5f;
                if (half.y <= 0) half.y = 0.5f;
                if (half.z <= 0) half.z = 0.5f;
                return new btBoxShape(toBt(half));
            }
            case ColliderShape::Sphere:
                return new btSphereShape(std::max(c.radius, 0.01f));
            case ColliderShape::Capsule: {
                float r = std::max(c.radius, 0.01f);
                float cyl = std::max(c.height - r * 2.0f, 0.01f);
                return new btCapsuleShape(r, cyl);
            }
            case ColliderShape::Cylinder:
                return new btCylinderShape(
                    btVector3(std::max(c.radius, 0.01f), std::max(c.height * 0.5f, 0.01f),
                              std::max(c.radius, 0.01f)));
            case ColliderShape::Mesh: {
                const Mesh* mesh = e.mesh && meshProvider ? meshProvider(e.mesh->modelPath) : nullptr;
                if (!mesh || mesh->vertices.empty() || mesh->indices.size() < 3) {
                    if (!warnedMeshFallback) {
                        NF_LOG_WARN("Physics", "mesh collider without resolvable mesh geometry - "
                                               "using the collider box. Import the model first.");
                        warnedMeshFallback = true;
                    }
                    Vec3 half = c.size * 0.5f;
                    return new btBoxShape(toBt(Vec3(std::max(half.x, 0.5f),
                                                    std::max(half.y, 0.5f),
                                                    std::max(half.z, 0.5f))));
                }
                bool dynamic = rec.kind == PhysicsBodyKind::Dynamic ||
                               rec.kind == PhysicsBodyKind::Kinematic;
                if (dynamic) {
                    // Concave meshes cannot be dynamic in Bullet: approximate with
                    // a convex hull of the vertices (documented in docs/PHYSICS.md).
                    auto* hull = new btConvexHullShape();
                    size_t stride = std::max<size_t>(1, mesh->vertices.size() / 512);
                    for (size_t i = 0; i < mesh->vertices.size(); i += stride)
                        hull->addPoint(toBt(mesh->vertices[i].pos), false);
                    hull->recalcLocalAabb();
                    return hull;
                }
                rec.triangleMesh = std::make_unique<btTriangleMesh>(true, false);
                for (size_t i = 0; i + 2 < mesh->indices.size(); i += 3) {
                    const Vec3& a = mesh->vertices[mesh->indices[i]].pos;
                    const Vec3& b = mesh->vertices[mesh->indices[i + 1]].pos;
                    const Vec3& d = mesh->vertices[mesh->indices[i + 2]].pos;
                    rec.triangleMesh->addTriangle(toBt(a), toBt(b), toBt(d), false);
                }
                return new btBvhTriangleMeshShape(rec.triangleMesh.get(), true);
            }
        }
        return new btBoxShape(btVector3(0.5f, 0.5f, 0.5f));
    }

    void applyShapeScaling(BodyRecord& rec, const Entity& e) {
        if (!rec.shape) return;
        // Collider dimensions are local; the entity's world scale stretches the
        // shape, so scaling an object in the editor also scales its collider.
        Vec3 s = e.transform.scale;
        if (std::fabs(s.x) < 1e-4f) s.x = 1e-4f;
        if (std::fabs(s.y) < 1e-4f) s.y = 1e-4f;
        if (std::fabs(s.z) < 1e-4f) s.z = 1e-4f;
        rec.shape->setLocalScaling(toBt(Vec3(std::fabs(s.x), std::fabs(s.y), std::fabs(s.z))));
    }

    Vec3 colliderCenter(const Entity& e) const {
        return e.cachedWorld.transformPoint(e.collider ? e.collider->center : Vec3(0, 0, 0));
    }

    void destroy(BodyRecord& rec) {
        if (rec.controller) {
            if (rec.ghost) world->removeCollisionObject(rec.ghost);
            world->removeAction(rec.controller);
            delete rec.controller;
            rec.controller = nullptr;
        }
        if (rec.ghost) {
            if (!rec.controller) world->removeCollisionObject(rec.ghost);
            delete rec.ghost;
            rec.ghost = nullptr;
        }
        if (rec.body) {
            world->removeRigidBody(rec.body);
            delete rec.body->getMotionState();
            delete rec.body;
            rec.body = nullptr;
        }
        if (rec.shape) {
            delete rec.shape;
            rec.shape = nullptr;
        }
        rec.ownedShapes.clear();
        rec.triangleMesh.reset();
    }

    BodyRecord* create(Entity& e, PhysicsBodyKind kind) {
        auto rec = std::make_unique<BodyRecord>();
        rec->entity = e.id;
        rec->kind = kind;
        rec->signature = bodySignature(e, kind);
        rec->debugDraw = e.collider->debugDraw;
        rec->shape = buildShape(e, *rec);
        applyShapeScaling(*rec, e);

        if (kind == PhysicsBodyKind::Character) {
            float total = std::max(e.collider->height, 0.4f);
            float radius = std::max(e.collider->radius, 0.1f);
            if (radius * 2.0f > total) total = radius * 2.0f + 0.1f;
            delete rec->shape;
            rec->shape = new btCapsuleShape(radius, std::max(total - radius * 2.0f, 0.01f));
            rec->capsuleHeight = total;
            rec->capsuleRadius = radius;
            rec->ghost = new btPairCachingGhostObject();
            rec->ghost->setWorldTransform(btTransform(
                btQuaternion::getIdentity(),
                toBt(colliderCenter(e) + Vec3(0, total * 0.5f, 0))));   // capsule centre
            rec->ghost->setCollisionShape(rec->shape);
            rec->ghost->setUserIndex((int)e.id);
            rec->ghost->setCollisionFlags(rec->ghost->getCollisionFlags() |
                                          btCollisionObject::CF_CHARACTER_OBJECT);
            float stepHeight = e.character ? std::max(e.character->stepHeight, 0.05f) : 0.35f;
            rec->controller = new btKinematicCharacterController(
                rec->ghost, static_cast<btConvexShape*>(rec->shape), stepHeight,
                btVector3(0.0, 1.0, 0.0));
            // Gravity is integrated by the engine (deterministic, testable) and
            // fed to the controller as part of the walk direction. The
            // controller only resolves contacts, sliding and step-up/down.
            rec->controller->setGravity(btVector3(0, 0, 0));
            rec->controller->setMaxSlope(btRadians(50.0f));
            rec->controller->setUseGhostSweepTest(true);
            rec->controller->setFallSpeed(60.0f);
            rec->controller->setJumpSpeed(0.0f);
            world->addCollisionObject(rec->ghost, btBroadphaseProxy::CharacterFilter,
                                      btBroadphaseProxy::AllFilter);
            world->addAction(rec->controller);
        } else if (kind == PhysicsBodyKind::Trigger) {
            rec->ghost = new btPairCachingGhostObject();
            rec->ghost->setCollisionShape(rec->shape);
            rec->ghost->setUserIndex((int)e.id);
            rec->ghost->setCollisionFlags(rec->ghost->getCollisionFlags() |
                                          btCollisionObject::CF_NO_CONTACT_RESPONSE);
            world->addCollisionObject(rec->ghost, btBroadphaseProxy::SensorTrigger,
                                      btBroadphaseProxy::AllFilter);
        } else {
            float mass = 0.0f;
            btVector3 inertia(0, 0, 0);
            bool dynamic = kind == PhysicsBodyKind::Dynamic;
            if (dynamic) {
                mass = e.rigidbody ? std::max(e.rigidbody->mass, 0.001f) : 1.0f;
                rec->shape->calculateLocalInertia(mass, inertia);
            }
            btRigidBody::btRigidBodyConstructionInfo info(mass, nullptr, rec->shape, inertia);
            info.m_friction = e.collider->friction;
            info.m_restitution = e.collider->restitution;
            if (e.rigidbody) {
                info.m_linearDamping = e.rigidbody->linearDamping;
                info.m_angularDamping = e.rigidbody->angularDamping;
            }
            rec->body = new btRigidBody(info);
            rec->body->setUserIndex((int)e.id);
            if (e.rigidbody && !e.rigidbody->useGravity) rec->body->setGravity(btVector3(0, 0, 0));
            if (e.rigidbody && e.rigidbody->freezeRotation) rec->body->setAngularFactor(0.0f);
            if (kind == PhysicsBodyKind::Kinematic) {
                rec->body->setCollisionFlags(rec->body->getCollisionFlags() |
                                             btCollisionObject::CF_KINEMATIC_OBJECT);
                rec->body->setActivationState(DISABLE_DEACTIVATION);
            }
            if (settings.enableCcd && dynamic) {
                rec->body->setCcdMotionThreshold(0.05f);
                rec->body->setCcdSweptSphereRadius(0.15f);
            }
            if (e.rigidbody) rec->body->setLinearVelocity(toBt(e.rigidbody->initialVelocity));
            btTransform t(toBt(e.transform.rotation), toBt(colliderCenter(e)));
            rec->body->setWorldTransform(t);
            world->addRigidBody(rec->body, btBroadphaseProxy::DefaultFilter,
                                btBroadphaseProxy::AllFilter);
        }

        BodyRecord* raw = rec.get();
        bodies[e.id] = std::move(rec);
        return raw;
    }

    // Short downward probe under the capsule: btKinematicCharacterController's
    // own onGround() flag is only updated when its internal gravity moves the
    // character, and this engine integrates gravity itself.
    bool groundProbe(const BodyRecord& rec, const Vec3& ghostOrigin, EntityId self) const {
        Vec3 feet = ghostOrigin - Vec3(0, rec.capsuleHeight * 0.5f, 0);
        RaycastHit hit;
        return worldRaycast(feet + Vec3(0, 0.04f, 0), Vec3(0, -1, 0), 0.10f, hit, self);
    }

    bool worldRaycast(const Vec3& from, const Vec3& dir, float maxDistance, RaycastHit& out,
                      EntityId ignore) const {
        Vec3 d = dir.normalized();
        RayFilterCallback cb(toBt(from), toBt(from + d * maxDistance), ignore);
        world->rayTest(toBt(from), toBt(from + d * maxDistance), cb);
        if (!cb.hasHit()) return false;
        const btCollisionObject* obj = cb.m_collisionObject;
        out.hit = true;
        out.entity = obj ? (EntityId)obj->getUserIndex() : kInvalidEntity;
        out.point = fromBt(cb.m_hitPointWorld);
        out.normal = fromBt(cb.m_hitNormalWorld);
        out.distance = (out.point - from).length();
        return true;
    }

    void removeMissing(Scene& scene) {
        for (auto it = bodies.begin(); it != bodies.end();) {
            Entity* e = scene.get(it->first);
            if (!e || !e->collider) {
                destroy(*it->second);
                it = bodies.erase(it);
            } else {
                ++it;
            }
        }
    }

    void handleTriggers() {
        // Every trigger volume runs a narrow-phase contact test and the result
        // is diffed against the previous step: exact enter/exit events with no
        // sampling and no false positives from AABB proximity.
        for (auto& [id, rec] : bodies) {
            if (rec->kind != PhysicsBodyKind::Trigger || !rec->ghost) continue;
            std::set<EntityId> current;
            DynContactCallback cb;
            std::vector<EntityId> found;
            cb.out = &found;
            world->contactTest(rec->ghost, cb);
            for (EntityId otherId : found) {
                if (otherId == kInvalidEntity || otherId == id) continue;
                current.insert(otherId);
            }
            for (EntityId other : current)
                if (!rec->overlaps.count(other)) events.push_back({PhysicsEvent::Type::TriggerEnter, id, other, 0.0f});
            for (EntityId other : rec->overlaps)
                if (!current.count(other)) events.push_back({PhysicsEvent::Type::TriggerExit, id, other, 0.0f});
            rec->overlaps = std::move(current);
        }
    }
};

// ---------------------------------------------------------------- PhysicsWorld
PhysicsWorld::PhysicsWorld(const PhysicsSettings& settings) : impl_(new Impl()) {
    setSettings(settings);
}

PhysicsWorld::~PhysicsWorld() {
    clear();
    impl_->world.reset();
    impl_->solver.reset();
    impl_->broadphase.reset();
    impl_->dispatcher.reset();
    impl_.reset();
}

void PhysicsWorld::setSettings(const PhysicsSettings& s) {
    impl_->settings = s;
    if (impl_->settings.fixedTimestep <= 0.0001f) impl_->settings.fixedTimestep = 1.0f / 60.0f;
    if (impl_->settings.maxSubSteps < 1) impl_->settings.maxSubSteps = 1;
    impl_->world->setGravity(toBt(impl_->settings.gravity));
    for (auto& [id, rec] : impl_->bodies)
        if (rec->controller) rec->controller->setGravity(toBt(impl_->settings.gravity));
}

const PhysicsSettings& PhysicsWorld::settings() const { return impl_->settings; }

void PhysicsWorld::setMeshProvider(PhysicsMeshProvider provider) {
    impl_->meshProvider = std::move(provider);
}

void PhysicsWorld::clear() {
    for (auto& [id, rec] : impl_->bodies) impl_->destroy(*rec);
    impl_->bodies.clear();
    impl_->events.clear();
    impl_->accumulator = 0.0f;
    impl_->stepCount = 0;
}

void PhysicsWorld::syncScene(Scene& scene) {
    scene.updateTransforms();
    impl_->removeMissing(scene);
    for (Entity* e : scene.allEntities()) {
        if (!e->collider || !e->active) continue;
        PhysicsBodyKind kind;
        if (e->collider->isTrigger) {
            kind = PhysicsBodyKind::Trigger;
        } else if (e->character || e->npc) {
            kind = PhysicsBodyKind::Character;
        } else if (e->rigidbody) {
            kind = e->rigidbody->motionType == MotionType::Dynamic ? PhysicsBodyKind::Dynamic
                 : e->rigidbody->motionType == MotionType::Kinematic ? PhysicsBodyKind::Kinematic
                                                                    : PhysicsBodyKind::Static;
        } else {
            kind = PhysicsBodyKind::Static;
        }
        std::string sig = bodySignature(*e, kind);
        auto it = impl_->bodies.find(e->id);
        if (it == impl_->bodies.end() || it->second->signature != sig) {
            if (it != impl_->bodies.end()) {
                impl_->destroy(*it->second);
                impl_->bodies.erase(it);
            }
            impl_->create(*e, kind);
            continue;
        }
        BodyRecord& rec = *it->second;
        rec.debugDraw = e->collider->debugDraw;
        impl_->applyShapeScaling(rec, *e);
        Vec3 center = impl_->colliderCenter(*e);
        if (rec.body) {
            rec.body->setFriction(e->collider->friction);
            rec.body->setRestitution(e->collider->restitution);
            if (kind != PhysicsBodyKind::Dynamic) {
                // static + kinematic bodies follow the scene transform
                rec.body->setWorldTransform(btTransform(toBt(e->transform.rotation), toBt(center)));
                rec.body->activate(true);
            }
        } else if (rec.ghost && kind == PhysicsBodyKind::Trigger) {
            rec.ghost->setWorldTransform(btTransform(toBt(e->transform.rotation), toBt(center)));
        }
    }
}

void PhysicsWorld::moveCharacter(EntityId entity, const Vec3& displacement) {
    auto it = impl_->bodies.find(entity);
    if (it == impl_->bodies.end() || !it->second->controller) return;
    it->second->pendingMove += displacement;
}

void PhysicsWorld::jumpCharacter(EntityId entity, float jumpSpeed) {
    auto it = impl_->bodies.find(entity);
    if (it == impl_->bodies.end() || !it->second->controller) return;
    // only jump when standing on something
    if (!it->second->grounded) return;
    it->second->pendingJumpSpeed = jumpSpeed;
}

void PhysicsWorld::teleportCharacter(Scene& scene, EntityId entity, const Vec3& worldPosition) {
    auto it = impl_->bodies.find(entity);
    if (it == impl_->bodies.end()) return;
    BodyRecord& rec = *it->second;
    Entity* e = scene.get(entity);
    if (!e) return;
    e->transform.position = worldPosition;
    scene.markDirty(entity);
    scene.updateTransforms();
    if (rec.ghost) {
        btTransform t = rec.ghost->getWorldTransform();
        t.setOrigin(toBt(worldPosition) + btVector3(0, rec.capsuleHeight * 0.5f, 0));
        rec.ghost->setWorldTransform(t);
    }
    if (rec.controller) rec.controller->warp(toBt(worldPosition) + btVector3(0, rec.capsuleHeight * 0.5f, 0));
    rec.pendingMove = Vec3(0, 0, 0);
}

bool PhysicsWorld::isGrounded(EntityId entity) const {
    auto it = impl_->bodies.find(entity);
    return it != impl_->bodies.end() && it->second->controller && it->second->grounded;
}

Vec3 PhysicsWorld::characterVelocity(EntityId entity) const {
    auto it = impl_->bodies.find(entity);
    return it == impl_->bodies.end() ? Vec3(0, 0, 0) : it->second->velocity;
}

bool PhysicsWorld::hasCharacter(EntityId entity) const {
    auto it = impl_->bodies.find(entity);
    return it != impl_->bodies.end() && it->second->controller != nullptr;
}

void PhysicsWorld::step(float dt) {
    if (dt <= 0.0f) return;
    if (dt > 0.25f) dt = 0.25f;   // never let a hitch explode the simulation
    const float fixed = impl_->settings.fixedTimestep;

    // Characters move with their requested displacement, spread over the
    // substeps of this frame so the motion stays smooth.
    const float gravityY = impl_->settings.gravity.y;
    for (auto& [id, rec] : impl_->bodies) {
        if (!rec->controller) continue;
        if (rec->pendingJumpSpeed > 0.0f && rec->grounded) {
            rec->verticalVelocity = rec->pendingJumpSpeed;   // jump off
            rec->grounded = false;
        } else if (rec->grounded && rec->verticalVelocity <= 0.0f) {
            rec->verticalVelocity = 0.0f;                    // standing: gravity is cancelled
        } else {
            rec->verticalVelocity += gravityY * dt;          // falling (or rising from a jump)
            if (rec->verticalVelocity < -55.0f) rec->verticalVelocity = -55.0f;
        }
        rec->pendingJumpSpeed = 0.0f;
        Vec3 perStep = rec->pendingMove * (fixed / std::max(dt, 1e-4f)) +
                       Vec3(0, rec->verticalVelocity * fixed, 0);
        rec->controller->setWalkDirection(toBt(perStep));
        rec->velocity = rec->pendingMove * (1.0f / std::max(dt, 1e-4f));
    }

    impl_->accumulator += dt;
    int steps = 0;
    while (impl_->accumulator >= fixed && steps < impl_->settings.maxSubSteps) {
        impl_->world->stepSimulation(fixed, 0, fixed);
        impl_->accumulator -= fixed;
        ++steps;
        ++impl_->stepCount;
        impl_->handleTriggers();
    }
    if (steps == impl_->settings.maxSubSteps) impl_->accumulator = 0.0f;

    // Characters probe the ground under their feet and emit landing events.
    for (auto& [id, rec] : impl_->bodies) {
        if (!rec->controller) continue;
        Vec3 origin = fromBt(rec->ghost->getWorldTransform().getOrigin());
        bool grounded = impl_->groundProbe(*rec, origin, id);
        if (grounded && !rec->grounded)
            impl_->events.push_back({PhysicsEvent::Type::CharacterLanded, id, kInvalidEntity,
                                     rec->velocity.length()});
        else if (!grounded && rec->grounded)
            impl_->events.push_back({PhysicsEvent::Type::CharacterLeftGround, id, kInvalidEntity, 0.0f});
        rec->grounded = grounded;
        if (grounded && rec->verticalVelocity < 0.0f) rec->verticalVelocity = 0.0f;
        rec->pendingMove = Vec3(0, 0, 0);
    }
}

void PhysicsWorld::writebackTransforms(Scene& scene) {
    for (auto& [id, rec] : impl_->bodies) {
        Entity* e = scene.get(id);
        if (!e || !e->active) continue;
        if (rec->body && rec->kind == PhysicsBodyKind::Dynamic) {
            const btTransform& t = rec->body->getWorldTransform();
            Vec3 world = fromBt(t.getOrigin());
            Quat rot = fromBt(t.getRotation());
            // The body origin is the collider centre, the entity origin may be
            // offset from it: subtract the (rotated) local collider offset.
            Vec3 localOffset = e->collider ? e->collider->center : Vec3(0, 0, 0);
            Vec3 parentSpace = world - rot.rotate(localOffset);
            if (e->parent != kInvalidEntity) {
                Mat4 parentWorld = scene.worldMatrix(e->parent);
                Mat4 inv = parentWorld.inverse();
                Vec3 p = inv.transformPoint(parentSpace);
                e->transform.position = p;
                e->transform.rotation = rot;
            } else {
                e->transform.position = parentSpace;
                e->transform.rotation = rot;
            }
            scene.markDirty(id);
        } else if (rec->ghost && rec->controller) {
            btTransform t = rec->ghost->getWorldTransform();
            Vec3 feet = fromBt(t.getOrigin()) - Vec3(0, rec->capsuleHeight * 0.5f, 0);
            e->transform.position = feet;
            scene.markDirty(id);
        }
    }
    scene.updateTransforms();
}

void PhysicsWorld::simulate(Scene& scene, float dt) {
    syncScene(scene);
    step(dt);
    writebackTransforms(scene);
}

// ---------------------------------------------------------------- queries
bool PhysicsWorld::raycast(const Vec3& from, const Vec3& dir, float maxDistance, RaycastHit& out,
                           EntityId ignore) const {
    out = RaycastHit();
    if (dir.length() < 1e-6f || maxDistance <= 0.0f) return false;
    return impl_->worldRaycast(from, dir, maxDistance, out, ignore);
}

std::vector<EntityId> PhysicsWorld::overlapSphere(const Vec3& center, float radius,
                                                  bool includeTriggers) const {
    std::vector<EntityId> found;
    if (radius <= 0.0f) return found;
    btSphereShape sphere(radius);
    btCollisionObject probe;
    probe.setCollisionShape(&sphere);
    btTransform t;
    t.setIdentity();
    t.setOrigin(toBt(center));
    probe.setWorldTransform(t);
    DynContactCallback cb;
    cb.out = &found;
    impl_->world->contactTest(&probe, cb);
    // Deduplicate and filter triggers if requested.
    std::vector<EntityId> unique;
    for (EntityId id : found) {
        if (!includeTriggers) {
            auto it = impl_->bodies.find(id);
            if (it != impl_->bodies.end() && it->second->kind == PhysicsBodyKind::Trigger) continue;
        }
        if (std::find(unique.begin(), unique.end(), id) == unique.end()) unique.push_back(id);
    }
    return unique;
}

std::vector<PhysicsEvent> PhysicsWorld::drainEvents() {
    std::vector<PhysicsEvent> out;
    out.swap(impl_->events);
    return out;
}

void PhysicsWorld::setDebugDrawEnabled(bool enabled) { impl_->debugDraw = enabled; }
bool PhysicsWorld::debugDrawEnabled() const { return impl_->debugDraw; }

void PhysicsWorld::collectDebugLines(std::vector<PhysicsDebugLine>& out, bool onlyDebugDraw) const {
    auto colorFor = [](PhysicsBodyKind k) {
        switch (k) {
            case PhysicsBodyKind::Static: return Vec3(0.35f, 0.45f, 0.60f);
            case PhysicsBodyKind::Dynamic: return Vec3(0.30f, 0.85f, 0.45f);
            case PhysicsBodyKind::Kinematic: return Vec3(0.85f, 0.75f, 0.25f);
            case PhysicsBodyKind::Trigger: return Vec3(0.95f, 0.80f, 0.20f);
            case PhysicsBodyKind::Character: return Vec3(0.30f, 0.80f, 0.95f);
            default: return Vec3(1, 0, 1);
        }
    };
    auto circle = [&out](const Vec3& center, const Vec3& axisA, const Vec3& axisB, float r,
                         const Vec3& color, int segments = 16) {
        Vec3 prev;
        for (int i = 0; i <= segments; ++i) {
            float a = (float)i / segments * 2.0f * PI;
            Vec3 p = center + axisA * (std::cos(a) * r) + axisB * (std::sin(a) * r);
            if (i > 0) out.push_back({prev, p, color});
            prev = p;
        }
    };

    for (const auto& [id, rec] : impl_->bodies) {
        if (onlyDebugDraw && !rec->debugDraw) continue;
        Vec3 color = colorFor(rec->kind);
        btTransform t;
        Vec3 center;
        if (rec->body) {
            t = rec->body->getWorldTransform();
            center = fromBt(t.getOrigin());
        } else if (rec->ghost) {
            t = rec->ghost->getWorldTransform();
            center = fromBt(t.getOrigin());
        } else {
            continue;
        }
        Quat rot = fromBt(t.getRotation());
        Vec3 ex = rot.rotate(Vec3(1, 0, 0)), ey = rot.rotate(Vec3(0, 1, 0)), ez = rot.rotate(Vec3(0, 0, 1));
        if (!rec->shape) continue;
        Vec3 scale = rec->shape->getLocalScaling().x() != 0
                         ? Vec3(rec->shape->getLocalScaling().x(), rec->shape->getLocalScaling().y(),
                                rec->shape->getLocalScaling().z())
                         : Vec3(1, 1, 1);
        switch (rec->shape->getShapeType()) {
            case BOX_SHAPE_PROXYTYPE: {
                const btBoxShape* box = static_cast<const btBoxShape*>(rec->shape);
                btVector3 h = box->getHalfExtentsWithMargin();
                Vec3 hx = ex * (h.x() * scale.x), hy = ey * (h.y() * scale.y), hz = ez * (h.z() * scale.z);
                Vec3 c[8] = {center - hx - hy - hz, center + hx - hy - hz, center + hx + hy - hz,
                             center - hx + hy - hz, center - hx - hy + hz, center + hx - hy + hz,
                             center + hx + hy + hz, center - hx + hy + hz};
                static const int edges[12][2] = {{0, 1}, {1, 2}, {2, 3}, {3, 0}, {4, 5}, {5, 6},
                                                 {6, 7}, {7, 4}, {0, 4}, {1, 5}, {2, 6}, {3, 7}};
                for (auto& e : edges) out.push_back({c[e[0]], c[e[1]], color});
                break;
            }
            case SPHERE_SHAPE_PROXYTYPE: {
                float r = static_cast<const btSphereShape*>(rec->shape)->getRadius() * scale.x;
                circle(center, ex, ey, r, color);
                circle(center, ey, ez, r, color);
                circle(center, ex, ez, r, color);
                break;
            }
            case CAPSULE_SHAPE_PROXYTYPE: {
                const btCapsuleShape* cap = static_cast<const btCapsuleShape*>(rec->shape);
                float r = cap->getRadius() * scale.x;
                float half = cap->getHalfHeight() * scale.y;
                int upAxis = cap->getUpAxis();
                Vec3 up = upAxis == 1 ? ey : (upAxis == 0 ? ex : ez);
                Vec3 top = center + up * half, bottom = center - up * half;
                Vec3 axisA = std::fabs(up.y) > 0.9f ? Vec3(1, 0, 0) : Vec3(0, 1, 0);
                Vec3 axisB = cross(up, axisA).normalized();
                circle(top, axisA, axisB, r, color);
                circle(bottom, axisA, axisB, r, color);
                out.push_back({top + axisA * r, bottom + axisA * r, color});
                out.push_back({top - axisA * r, bottom - axisA * r, color});
                out.push_back({top + axisB * r, bottom + axisB * r, color});
                out.push_back({top - axisB * r, bottom - axisB * r, color});
                break;
            }
            case CYLINDER_SHAPE_PROXYTYPE: {
                const btCylinderShape* cyl = static_cast<const btCylinderShape*>(rec->shape);
                float r = cyl->getRadius() * scale.x;
                float half = cyl->getHalfExtentsWithMargin().y() * scale.y;
                circle(center + ey * half, ex, ez, r, color);
                circle(center - ey * half, ex, ez, r, color);
                break;
            }
            default: {
                btVector3 mn, mx;
                rec->shape->getAabb(btTransform::getIdentity(), mn, mx);
                Vec3 a = fromBt(mn), b = fromBt(mx);
                for (int i = 0; i < 8; ++i) {
                    Vec3 p(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z);
                    p = center + rot.rotate(p);
                    out.push_back({p, p, color});
                }
                break;
            }
        }
    }
}

int PhysicsWorld::bodyCount() const { return (int)impl_->bodies.size(); }

int PhysicsWorld::characterCount() const {
    int n = 0;
    for (const auto& [id, rec] : impl_->bodies)
        if (rec->controller) ++n;
    return n;
}

PhysicsBodyKind PhysicsWorld::bodyKind(EntityId entity) const {
    auto it = impl_->bodies.find(entity);
    return it == impl_->bodies.end() ? PhysicsBodyKind::None : it->second->kind;
}

int PhysicsWorld::stepCount() const { return impl_->stepCount; }

}  // namespace nf
