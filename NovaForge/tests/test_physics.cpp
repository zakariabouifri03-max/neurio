// Physics tests: Bullet driven rigid bodies, characters, triggers and queries.
// Every assertion checks real simulation state - nothing is stubbed.
#include "test_framework.h"

#include "assets/mesh.h"
#include "physics/physics.h"
#include "physics/physics_debug.h"
#include "render/draw_list.h"
#include "scene/prefabs.h"
#include "scene/scene.h"

using namespace nf;

namespace {

const Mesh* meshProvider(const std::string& path) {
    static Mesh cube;
    if (path.find("Cube") != std::string::npos || path.find("cube") != std::string::npos) {
        cube = primitives::cube(1.0f);
        return &cube;
    }
    static Mesh sphere = primitives::sphere(0.5f, 16, 12);
    if (path.find("Sphere") != std::string::npos) return &sphere;
    return nullptr;
}

// Runs the world deterministically: `steps` frames of `dt` seconds.
void run(PhysicsWorld& world, Scene& scene, int steps, float dt = 1.0f / 60.0f) {
    for (int i = 0; i < steps; ++i) world.simulate(scene, dt);
}

EntityId addGround(Scene& scene, const Vec3& size = Vec3(20, 0.5f, 20)) {
    EntityId id = scene.createEntity("Ground");
    Entity& e = *scene.get(id);
    e.tag = "Ground";
    e.mesh = MeshRendererComponent();
    e.mesh->modelPath = "primitive://Plane";
    e.collider = ColliderComponent();
    e.collider->shape = ColliderShape::Box;
    e.collider->size = size;
    e.transform.position = Vec3(0, -size.y * 0.5f, 0);   // top surface at y = 0
    return id;
}

EntityId addBox(Scene& scene, const Vec3& pos, const Vec3& size = Vec3(1, 1, 1), float mass = 1.0f) {
    EntityId id = scene.createEntity("Box");
    Entity& e = *scene.get(id);
    e.mesh = MeshRendererComponent();
    e.mesh->modelPath = "primitive://Cube";
    e.collider = ColliderComponent();
    e.collider->shape = ColliderShape::Box;
    e.collider->size = size;
    e.collider->friction = 0.8f;
    e.collider->restitution = 0.0f;
    e.rigidbody = RigidBodyComponent();
    e.rigidbody->mass = mass;
    e.transform.position = pos;
    return id;
}

}  // namespace

NF_TEST(physics_gravity_drops_a_box_onto_the_ground) {
    Scene scene;
    addGround(scene);
    EntityId box = addBox(scene, Vec3(0, 6, 0));
    PhysicsWorld physics;
    physics.setMeshProvider(meshProvider);
    physics.syncScene(scene);
    CHECK_EQ(physics.bodyCount(), 2);
    CHECK(physics.bodyKind(box) == PhysicsBodyKind::Dynamic);

    run(physics, scene, 240);   // 4 seconds

    Vec3 p = scene.get(box)->transform.position;
    // a 1m box resting on a plane whose top is at y = 0 -> centre at 0.5
    CHECK_MSG(std::fabs(p.y - 0.5f) < 0.15f, "box should have landed on the ground");
    CHECK_MSG(std::fabs(p.x) < 0.3f, "box should not drift sideways");
    CHECK(physics.stepCount() > 100);
}

NF_TEST(physics_static_bodies_never_move) {
    Scene scene;
    EntityId ground = addGround(scene);
    PhysicsWorld physics;
    physics.syncScene(scene);
    run(physics, scene, 120);
    CHECK_EQ(scene.get(ground)->transform.position.y, -0.25f);
    CHECK(physics.bodyKind(ground) == PhysicsBodyKind::Static);
}

NF_TEST(physics_stacked_boxes_stay_stacked) {
    Scene scene;
    addGround(scene);
    EntityId lower = addBox(scene, Vec3(0, 0.5f, 0));
    EntityId upper = addBox(scene, Vec3(0.05f, 1.6f, 0.0f));
    PhysicsWorld physics;
    run(physics, scene, 300);
    float lowerY = scene.get(lower)->transform.position.y;
    float upperY = scene.get(upper)->transform.position.y;
    CHECK_MSG(std::fabs(lowerY - 0.5f) < 0.2f, "lower box should rest on the ground");
    CHECK_MSG(upperY > 1.2f && upperY < 2.0f, "upper box should rest on top of the lower one");
}

NF_TEST(physics_character_walks_and_jumps) {
    Scene scene;
    addGround(scene);
    EntityId hero = scene.createEntity("Hero");
    scene.get(hero)->tag = "Player";
    scene.get(hero)->character = CharacterComponent();
    scene.get(hero)->character->jumpHeight = 1.2f;
    scene.get(hero)->collider = ColliderComponent();
    scene.get(hero)->collider->shape = ColliderShape::Capsule;
    scene.get(hero)->collider->radius = 0.35f;
    scene.get(hero)->collider->height = 1.8f;
    scene.get(hero)->transform.position = Vec3(0, 0.05f, 0);

    PhysicsWorld physics;
    physics.syncScene(scene);
    CHECK(physics.hasCharacter(hero));
    CHECK_EQ(physics.characterCount(), 1);
    run(physics, scene, 60);   // settle on the ground
    CHECK_MSG(physics.isGrounded(hero), "character should be standing on the ground");
    float startZ = scene.get(hero)->transform.position.z;

    // walk forward (+Z) for one second
    for (int i = 0; i < 60; ++i) {
        physics.moveCharacter(hero, Vec3(0, 0, 4.0f / 60.0f));
        physics.simulate(scene, 1.0f / 60.0f);
    }
    float walked = scene.get(hero)->transform.position.z - startZ;
    CHECK_MSG(walked > 2.0f, "character should have walked at least 2 metres in one second");
    CHECK_MSG(walked < 6.0f, "character should not teleport");
    CHECK_MSG(std::fabs(scene.get(hero)->transform.position.y) < 0.6f,
              "character should stay on the ground while walking");

    // jump
    float groundY = scene.get(hero)->transform.position.y;
    physics.jumpCharacter(hero, 5.0f);
    float peak = groundY;
    for (int i = 0; i < 90; ++i) {
        physics.simulate(scene, 1.0f / 60.0f);
        peak = std::max(peak, scene.get(hero)->transform.position.y);
    }
    CHECK_MSG(peak > groundY + 0.5f, "character should leave the ground when jumping");
    CHECK_MSG(std::fabs(scene.get(hero)->transform.position.y - groundY) < 0.35f,
              "character should land again");
    CHECK(physics.isGrounded(hero));
}

NF_TEST(physics_character_cannot_walk_through_a_wall) {
    Scene scene;
    addGround(scene);
    EntityId wall = addBox(scene, Vec3(0, 1.0f, 2.0f), Vec3(8, 2.0f, 0.4f));
    scene.get(wall)->rigidbody->motionType = MotionType::Static;
    EntityId hero = scene.createEntity("Hero");
    scene.get(hero)->character = CharacterComponent();
    scene.get(hero)->collider = ColliderComponent();
    scene.get(hero)->collider->shape = ColliderShape::Capsule;
    scene.get(hero)->collider->radius = 0.35f;
    scene.get(hero)->collider->height = 1.8f;
    scene.get(hero)->transform.position = Vec3(0, 0.05f, 0);

    PhysicsWorld physics;
    physics.syncScene(scene);
    for (int i = 0; i < 180; ++i) {
        physics.moveCharacter(hero, Vec3(0, 0, 6.0f / 60.0f));
        physics.simulate(scene, 1.0f / 60.0f);
    }
    float z = scene.get(hero)->transform.position.z;
    CHECK_MSG(z < 1.6f, "the wall must stop the character (blocked slide is a real collision)");
    CHECK_MSG(z > 0.3f, "the character should still advance until it touches the wall");
}

NF_TEST(physics_raycast_and_overlap_queries) {
    Scene scene;
    addGround(scene);
    EntityId box = addBox(scene, Vec3(0, 1.0f, 5.0f));
    PhysicsWorld physics;
    physics.syncScene(scene);

    RaycastHit hit;
    CHECK(physics.raycast(Vec3(0, 1.0f, 0), Vec3(0, 0, 1), 20.0f, hit));
    CHECK_EQ(hit.entity, box);
    CHECK_MSG(hit.distance > 4.0f && hit.distance < 5.0f, "ray should stop on the box surface");
    CHECK_MSG(hit.normal.z < -0.5f, "hit normal should face the ray");

    // ignoring the box makes the ray fly over it and hit nothing else
    CHECK(!physics.raycast(Vec3(0, 1.0f, 0), Vec3(0, 0, 1), 4.4f, hit, box));

    auto overlaps = physics.overlapSphere(Vec3(0, 1.0f, 5.0f), 1.2f);
    CHECK_MSG(!overlaps.empty(), "sphere overlap should find the box");
    CHECK_EQ(overlaps[0], box);
}

NF_TEST(physics_trigger_volumes_fire_events) {
    Scene scene;
    addGround(scene);
    // trigger volume in the middle of the map
    EntityId trigger = scene.createEntity("PickupZone");
    scene.get(trigger)->collider = ColliderComponent();
    scene.get(trigger)->collider->shape = ColliderShape::Box;
    scene.get(trigger)->collider->size = Vec3(2, 2, 2);
    scene.get(trigger)->collider->isTrigger = true;
    scene.get(trigger)->transform.position = Vec3(0, 1.0f, 3.0f);
    scene.get(trigger)->trigger = TriggerComponent();
    scene.get(trigger)->trigger->onEnter = TriggerComponent::Action::Heal;
    scene.get(trigger)->trigger->value = 25.0f;

    EntityId hero = scene.createEntity("Hero");
    scene.get(hero)->character = CharacterComponent();
    scene.get(hero)->collider = ColliderComponent();
    scene.get(hero)->collider->shape = ColliderShape::Capsule;
    scene.get(hero)->collider->radius = 0.35f;
    scene.get(hero)->collider->height = 1.8f;
    scene.get(hero)->transform.position = Vec3(0, 0.05f, 0);

    PhysicsWorld physics;
    physics.syncScene(scene);
    CHECK_EQ(physics.bodyKind(trigger), PhysicsBodyKind::Trigger);

    bool entered = false, exited = false;
    // walk into the trigger
    for (int i = 0; i < 120 && !entered; ++i) {
        physics.moveCharacter(hero, Vec3(0, 0, 5.0f / 60.0f));
        physics.simulate(scene, 1.0f / 60.0f);
        for (const PhysicsEvent& e : physics.drainEvents())
            if (e.type == PhysicsEvent::Type::TriggerEnter && e.a == trigger && e.b == hero)
                entered = true;
    }
    CHECK_MSG(entered, "walking into the trigger volume must fire a TriggerEnter event");

    // walk back out again
    for (int i = 0; i < 180 && !exited; ++i) {
        physics.moveCharacter(hero, Vec3(0, 0, -5.0f / 60.0f));
        physics.simulate(scene, 1.0f / 60.0f);
        for (const PhysicsEvent& e : physics.drainEvents())
            if (e.type == PhysicsEvent::Type::TriggerExit && e.a == trigger && e.b == hero)
                exited = true;
    }
    CHECK_MSG(exited, "leaving the trigger volume must fire a TriggerExit event");
}

NF_TEST(physics_kinematic_body_follows_the_scene) {
    Scene scene;
    addGround(scene);
    EntityId platform = addBox(scene, Vec3(0, 2.0f, 0), Vec3(4, 0.4f, 4));
    scene.get(platform)->rigidbody->motionType = MotionType::Kinematic;
    PhysicsWorld physics;
    physics.syncScene(scene);
    CHECK(physics.bodyKind(platform) == PhysicsBodyKind::Kinematic);
    // move it in the scene, the body must follow
    scene.get(platform)->transform.position = Vec3(3, 2.0f, 0);
    scene.markDirty(platform);
    physics.simulate(scene, 1.0f / 60.0f);

    RaycastHit hit;
    CHECK(physics.raycast(Vec3(3, 6, 0), Vec3(0, -1, 0), 10.0f, hit));
    CHECK_EQ(hit.entity, platform);
    CHECK_MSG(hit.point.y > 1.5f, "kinematic platform should be where the scene put it");
}

NF_TEST(physics_mesh_collider_uses_real_triangles) {
    Scene scene;
    EntityId ground = scene.createEntity("MeshGround");
    Entity& e = *scene.get(ground);
    e.mesh = MeshRendererComponent();
    e.mesh->modelPath = "primitive://Cube";
    e.collider = ColliderComponent();
    e.collider->shape = ColliderShape::Mesh;
    e.transform.position = Vec3(0, -0.5f, 0);
    e.transform.scale = Vec3(20, 1, 20);

    EntityId box = addBox(scene, Vec3(0, 4, 0));
    PhysicsWorld physics;
    physics.setMeshProvider(meshProvider);
    physics.syncScene(scene);
    CHECK(physics.bodyKind(ground) == PhysicsBodyKind::Static);

    run(physics, scene, 240);
    float y = scene.get(box)->transform.position.y;
    CHECK_MSG(y > 0.2f && y < 1.4f, "box should land on the triangle mesh collider");
}

NF_TEST(physics_debug_lines_describe_the_shapes) {
    Scene scene;
    addGround(scene);
    EntityId box = addBox(scene, Vec3(0, 2, 0));
    scene.get(box)->collider->debugDraw = true;
    PhysicsWorld physics;
    physics.syncScene(scene);
    auto all = physicsDebugLines(physics, false);
    auto onlyDebug = physicsDebugLines(physics, true);
    CHECK_MSG(all.size() >= 12, "a box collider is 12 debug edges");
    CHECK_MSG(onlyDebug.size() >= 12, "debug flagged collider should be reported");
    CHECK_MSG(onlyDebug.size() < all.size(), "the ground collider is not debug flagged");
    bool hasVerticalEdge = false;
    for (const auto& l : all)
        if (std::fabs(l.b.y - l.a.y) > 0.5f && std::fabs(l.a.y - l.b.y) < 1.2f) hasVerticalEdge = true;
    CHECK_MSG(hasVerticalEdge, "box wireframe should contain its vertical edges");

    LineBatch batch;
    physicsDebugDraw(physics, batch, false);
    CHECK(batch.lines.size() >= 24);
}

NF_TEST(physics_settings_and_body_removal) {
    // two identical worlds, different gravity: the heavier gravity must fall faster
    Scene heavyScene, normalScene;
    EntityId heavyBox = addBox(heavyScene, Vec3(0, 20, 0));
    EntityId normalBox = addBox(normalScene, Vec3(0, 20, 0));
    PhysicsWorld heavy;
    heavy.setSettings(PhysicsSettings{.gravity = Vec3(0, -25.0f, 0)});
    PhysicsWorld normal;
    heavy.syncScene(heavyScene);
    normal.syncScene(normalScene);
    CHECK_EQ(heavy.settings().gravity.y, -25.0f);
    for (int i = 0; i < 30; ++i) {
        heavy.simulate(heavyScene, 1.0f / 60.0f);
        normal.simulate(normalScene, 1.0f / 60.0f);
    }
    float heavyY = heavyScene.get(heavyBox)->transform.position.y;
    float normalY = normalScene.get(normalBox)->transform.position.y;
    CHECK_MSG(heavyY < normalY - 0.5f, "stronger gravity must make the box fall faster");

    heavyScene.destroyEntity(heavyBox);
    heavy.syncScene(heavyScene);
    CHECK_EQ(heavy.bodyCount(), 0);
    CHECK(heavy.bodyKind(heavyBox) == PhysicsBodyKind::None);
}
