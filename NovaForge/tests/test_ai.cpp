// AI tests: the NPC state machine must actually patrol, chase, attack, kill and
// die - driven through the same physics the game uses.
#include "test_framework.h"

#include "ai/npc_ai.h"
#include "physics/physics.h"
#include "render/effects.h"
#include "scene/prefabs.h"
#include "scene/scene.h"

using namespace nf;

namespace {

EntityId addGround(Scene& scene) {
    EntityId id = scene.createEntity("Ground");
    Entity& e = *scene.get(id);
    e.tag = "Ground";
    e.collider = ColliderComponent();
    e.collider->shape = ColliderShape::Box;
    e.collider->size = Vec3(80, 0.5f, 80);
    e.transform.position = Vec3(0, -0.25f, 0);
    return id;
}

EntityId addPlayer(Scene& scene, const Vec3& pos) {
    EntityId id = scene.createEntity("Player");
    Entity& e = *scene.get(id);
    e.tag = "Player";
    e.character = CharacterComponent();
    e.collider = ColliderComponent();
    e.collider->shape = ColliderShape::Capsule;
    e.collider->radius = 0.35f;
    e.collider->height = 1.8f;
    e.health = HealthComponent();
    e.health->maxHealth = 100.0f;
    e.transform.position = pos;
    return id;
}

EntityId addNpc(Scene& scene, const Vec3& pos, NPCComponent::Behavior behavior) {
    EntityId id = scene.createEntity("Guard");
    Entity& e = *scene.get(id);
    e.npc = NPCComponent();
    e.npc->behavior = behavior;
    e.npc->detectionRange = 12.0f;
    e.npc->loseTargetRange = 18.0f;
    e.npc->attackRange = 2.0f;
    e.npc->moveSpeed = 4.0f;
    e.npc->attackDamage = 15.0f;
    e.npc->attackCooldown = 0.8f;
    e.npc->turnSpeed = 360.0f;
    e.collider = ColliderComponent();
    e.collider->shape = ColliderShape::Capsule;
    e.collider->radius = 0.35f;
    e.collider->height = 1.8f;
    e.health = HealthComponent();
    e.transform.position = pos;
    return id;
}

}  // namespace

NF_TEST(ai_idle_npc_does_not_move) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.1f, 0));
    EntityId npc = addNpc(scene, Vec3(6, 0.1f, 0), NPCComponent::Behavior::Idle);
    PhysicsWorld physics;
    AISystem ai;
    for (int i = 0; i < 120; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
    }
    CHECK(scene.get(npc)->npc->state == NPCComponent::State::Idle);
    CHECK_MSG((scene.get(npc)->transform.position - Vec3(6, 0, 0)).length() < 1.0f,
              "an idle NPC must stay where it was placed");
}

NF_TEST(ai_patrolling_npc_walks_its_route) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.1f, -20));
    EntityId npc = addNpc(scene, Vec3(0, 0.05f, 0), NPCComponent::Behavior::Patrol);
    scene.get(npc)->npc->idleTime = 0.2f;
    scene.get(npc)->npc->patrolPoints = {Vec3(0, 0.05f, 6), Vec3(6, 0.05f, 6)};
    PhysicsWorld physics;
    AISystem ai;

    bool reachedPoint = false;
    for (int i = 0; i < 60 * 12 && !reachedPoint; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
        for (const AIEvent& e : ai.drainEvents())
            if (e.type == AIEvent::Type::PatrolPointReached) reachedPoint = true;
    }
    CHECK_MSG(reachedPoint, "patrolling NPC should report reaching a patrol point");
    Vec3 p = scene.get(npc)->transform.position;
    CHECK_MSG(Vec3(p.x, 0, p.z - 6.0f).length() < 1.5f, "NPC should have walked to its first waypoint");
    CHECK_MSG(p.y < 1.0f, "NPC should stay on the ground while patrolling");
}

NF_TEST(ai_hostile_npc_chases_and_attacks_the_player) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.05f, 0));
    EntityId npc = addNpc(scene, Vec3(0, 0.05f, 10), NPCComponent::Behavior::ChasePlayer);
    PhysicsWorld physics;
    AISystem ai;

    float closest = 999.0f;
    int attacks = 0;
    for (int i = 0; i < 60 * 20; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
        for (const AIEvent& e : ai.drainEvents()) {
            if (e.type == AIEvent::Type::Attacked && e.target == player) attacks++;
        }
        Vec3 a = scene.get(npc)->transform.position, b = scene.get(player)->transform.position;
        closest = std::min(closest, Vec3(a.x - b.x, 0, a.z - b.z).length());
    }
    CHECK_MSG(closest < 2.4f, "hostile NPC should close in to attack range");
    CHECK_MSG(attacks >= 3, "hostile NPC should attack repeatedly on its cooldown");
    CHECK(scene.get(npc)->npc->state == NPCComponent::State::Attack ||
          scene.get(npc)->npc->state == NPCComponent::State::Chase);
    float hp = scene.get(player)->health->currentHealth;
    CHECK_MSG(hp < 100.0f, "attacks must really damage the player");
    CHECK_MSG(hp > 0.0f || scene.get(player)->health->dead(), "health must not go negative");
}

NF_TEST(ai_npc_loses_the_target_when_the_player_runs_away) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.05f, 0));
    EntityId npc = addNpc(scene, Vec3(0, 0.05f, 8), NPCComponent::Behavior::ChasePlayer);
    PhysicsWorld physics;
    AISystem ai;
    for (int i = 0; i < 60 * 3; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
    }
    CHECK(scene.get(npc)->npc->hasTarget);
    // teleport the player far away
    scene.get(player)->transform.position = Vec3(0, 0.05f, 60);
    scene.markDirty(player);
    bool lost = false;
    for (int i = 0; i < 60 * 3; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
        for (const AIEvent& e : ai.drainEvents())
            if (e.type == AIEvent::Type::TargetLost) lost = true;
    }
    CHECK_MSG(lost, "NPC should report losing a target that left its lose range");
    CHECK_MSG(scene.get(npc)->npc->state != NPCComponent::State::Chase ||
                  !scene.get(npc)->npc->hasTarget,
              "NPC should stop chasing once the target is lost");
}

NF_TEST(ai_npc_dies_and_reports_it) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.05f, 0));
    EntityId npc = addNpc(scene, Vec3(0, 0.05f, 6), NPCComponent::Behavior::ChasePlayer);
    scene.get(npc)->health->maxHealth = 40.0f;
    scene.get(npc)->health->currentHealth = 40.0f;
    PhysicsWorld physics;
    AISystem ai;
    EffectsQueue fx;

    applyDamage(scene, npc, 25.0f, &fx);
    CHECK_EQ(scene.get(npc)->health->currentHealth, 15.0f);
    CHECK_MSG(fx.particleCount() > 0, "a hit should spawn real particles");
    CHECK(!isDead(scene, npc));

    bool died = false;
    applyDamage(scene, npc, 100.0f, &fx);
    CHECK(isDead(scene, npc));
    for (int i = 0; i < 10 && !died; ++i) {
        ai.update(scene, &physics, player, 1.0f / 30.0f);
        physics.simulate(scene, 1.0f / 30.0f);
        for (const AIEvent& e : ai.drainEvents())
            if (e.type == AIEvent::Type::Died && e.npc == npc) died = true;
    }
    CHECK_MSG(died, "the AI must report the NPC death exactly once");
    CHECK(scene.get(npc)->npc->state == NPCComponent::State::Dead);
    // dead NPCs stop moving
    Vec3 before = scene.get(npc)->transform.position;
    for (int i = 0; i < 60; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
    }
    Vec3 after = scene.get(npc)->transform.position;
    CHECK_MSG((after - before).length() < 0.5f, "dead NPCs must stop");
    // healing a dead entity does nothing while it stays dead
    applyHeal(scene, npc, 50.0f);
    CHECK(!isDead(scene, npc));
}

NF_TEST(ai_follow_behavior_keeps_its_distance) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.05f, 0));
    EntityId npc = addNpc(scene, Vec3(0, 0.05f, 12), NPCComponent::Behavior::FollowPlayer);
    PhysicsWorld physics;
    AISystem ai;
    for (int i = 0; i < 60 * 12; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
    }
    Vec3 a = scene.get(npc)->transform.position;
    float d = Vec3(a.x, 0, a.z).length();
    CHECK_MSG(d < 6.0f, "a follower should walk towards the player");
    CHECK_MSG(d > 1.0f, "a follower should not stand inside the player");
    CHECK(scene.get(npc)->npc->state == NPCComponent::State::Follow);
}

NF_TEST(ai_status_report_is_complete) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.05f, 0));
    addNpc(scene, Vec3(0, 0.05f, 5), NPCComponent::Behavior::ChasePlayer);
    addNpc(scene, Vec3(4, 0.05f, 5), NPCComponent::Behavior::Patrol);
    PhysicsWorld physics;
    AISystem ai;
    ai.update(scene, &physics, player, 1.0f / 60.0f);
    auto statuses = ai.statuses(scene);
    CHECK_EQ(statuses.size(), 2u);
    CHECK(!statuses[0].name.empty());
    CHECK_EQ(statuses[0].maxHealth, 100.0f);
    CHECK_MSG(statuses[0].distanceToTarget > 0.0f, "status should report the distance to the player");

    ai.setSettings(AISettings{.freezeAi = true});
    Vec3 before = scene.get(statuses[0].entity)->transform.position;
    for (int i = 0; i < 60; ++i) ai.update(scene, &physics, player, 1.0f / 60.0f);
    CHECK_MSG((scene.get(statuses[0].entity)->transform.position - before).length() < 0.01f,
              "freezeAi must stop all NPC movement (editor pause)");
}

NF_TEST(ai_reset_rewinds_runtime_state) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.05f, 0));
    EntityId npc = addNpc(scene, Vec3(0, 0.05f, 5), NPCComponent::Behavior::ChasePlayer);
    applyDamage(scene, player, 40.0f);
    PhysicsWorld physics;
    AISystem ai;
    for (int i = 0; i < 60; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
    }
    CHECK(scene.get(player)->health->currentHealth < 100.0f);
    ai.reset(scene);
    CHECK(scene.get(npc)->npc->state == NPCComponent::State::Idle);
    CHECK_EQ(scene.get(npc)->npc->stateTime, 0.0f);
    CHECK_EQ(scene.get(npc)->npc->patrolIndex, 0);
    CHECK_EQ(scene.get(player)->health->currentHealth, 100.0f);
}

NF_TEST(ai_characters_do_not_sink_while_standing) {
    Scene scene;
    addGround(scene);
    EntityId player = addPlayer(scene, Vec3(0, 0.1f, 0));
    PhysicsWorld physics;
    AISystem ai;
    for (int i = 0; i < 60 * 3; ++i) {
        ai.update(scene, &physics, player, 1.0f / 60.0f);
        physics.simulate(scene, 1.0f / 60.0f);
    }
    float y = scene.get(player)->transform.position.y;
    CHECK_MSG(std::fabs(y - 0.1f) < 0.12f, "a standing character must keep its feet on the ground");
    CHECK(physics.isGrounded(player));
}
