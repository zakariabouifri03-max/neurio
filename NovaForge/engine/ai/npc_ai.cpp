// NovaForge Engine - NPC AI implementation
#include "ai/npc_ai.h"

#include "core/log.h"
#include "physics/physics.h"
#include "render/effects.h"

#include <algorithm>
#include <cmath>

namespace nf {

namespace {

// Yaw-only rotation towards a world position with a maximum turn rate.
void faceTowards(Entity& e, const Vec3& from, const Vec3& to, float turnSpeed, float dt) {
    Vec3 d = to - from;
    d.y = 0;
    if (d.length() < 1e-4f) return;
    float targetYaw = std::atan2(d.x, d.z);
    float currentYaw = 0.0f;
    {
        // extract yaw from the current rotation (yaw around Y)
        Vec3 fwd = e.transform.rotation.rotate(Vec3(0, 0, 1));
        currentYaw = std::atan2(fwd.x, fwd.z);
    }
    float delta = targetYaw - currentYaw;
    while (delta > PI) delta -= 2.0f * PI;
    while (delta < -PI) delta += 2.0f * PI;
    float maxStep = std::max(turnSpeed, 0.01f) * dt;
    if (std::fabs(delta) <= maxStep) {
        currentYaw = targetYaw;
    } else {
        currentYaw += (delta > 0 ? maxStep : -maxStep);
    }
    e.transform.rotation = Quat::fromEulerDeg(Vec3(0.0f, currentYaw * RAD2DEG, 0.0f));
}

// Distance on the ground plane only: an NPC on a hill should still notice the
// player walking right below it.
float planarDistance(const Vec3& a, const Vec3& b) {
    float dx = a.x - b.x, dz = a.z - b.z;
    return std::sqrt(dx * dx + dz * dz);
}

Vec3 planarNormalize(const Vec3& v) {
    Vec3 d(v.x, 0.0f, v.z);
    float len = d.length();
    return len < 1e-5f ? Vec3(0, 0, 0) : d * (1.0f / len);
}

}  // namespace

// ---------------------------------------------------------------- gameplay
void applyDamage(Scene& scene, EntityId target, float amount) {
    applyDamage(scene, target, amount, nullptr);
}

void applyDamage(Scene& scene, EntityId target, float amount, EffectsQueue* effects) {
    Entity* e = scene.get(target);
    if (!e || !e->health || amount <= 0.0f) return;
    if (e->health->invulnerable || e->health->dead()) return;
    e->health->currentHealth = std::max(0.0f, e->health->currentHealth - amount);
    if (effects) {
        Vec3 p = e->cachedWorld.translation();
        effects->spawnBurst(p + Vec3(0, 1.0f, 0), Vec3(1.0f, 0.35f, 0.2f), 10, 0.12f, 0.45f, 2.2f);
    }
    NF_LOG_DEBUG("AI", "%s took %.0f damage (%.0f hp left)", e->displayName().c_str(), amount,
                 e->health->currentHealth);
}

void applyHeal(Scene& scene, EntityId target, float amount) {
    Entity* e = scene.get(target);
    if (!e || !e->health || amount <= 0.0f) return;
    e->health->currentHealth = std::min(e->health->maxHealth, e->health->currentHealth + amount);
}

bool isDead(const Scene& scene, EntityId target) {
    const Entity* e = scene.get(target);
    return e && e->health && e->health->dead();
}

// ---------------------------------------------------------------- AISystem
float AISystem::cooldownFor(EntityId id) const {
    for (const auto& [e, t] : cooldowns_)
        if (e == id) return t;
    return 0.0f;
}

void AISystem::setCooldown(EntityId id, float value) {
    for (auto& [e, t] : cooldowns_)
        if (e == id) {
            t = value;
            return;
        }
    cooldowns_.emplace_back(id, value);
}

void AISystem::reset(Scene& scene) {
    cooldowns_.clear();
    events_.clear();
    for (Entity* e : scene.allEntities()) {
        if (e->npc) {
            e->npc->state = NPCComponent::State::Idle;
            e->npc->stateTime = 0.0f;
            e->npc->attackTimer = 0.0f;
            e->npc->patrolIndex = 0;
            e->npc->hasTarget = false;
        }
        if (e->health) e->health->reset();
        if (e->interactable) e->interactable->used = false;
        if (e->trigger) {
            e->trigger->firedEnter = false;
            e->trigger->firedExit = false;
        }
        if (e->door) {
            e->door->open = e->door->startsOpen;
            e->door->t = e->door->startsOpen ? 1.0f : 0.0f;
        }
    }
}

std::vector<AIEvent> AISystem::drainEvents() {
    std::vector<AIEvent> out;
    out.swap(events_);
    return out;
}

void AISystem::update(Scene& scene, PhysicsWorld* physics, EntityId player, float dt) {
    if (dt <= 0.0f) return;
    if (settings_.freezeAi) return;
    scene.updateTransforms();

    Vec3 playerPos{0, 0, 0};
    bool playerValid = false;
    if (Entity* p = scene.get(player)) {
        playerPos = p->cachedWorld.translation();
        playerValid = true;
    }

    for (Entity* e : scene.allEntities()) {
        if (!e->npc || !e->active) continue;
        NPCComponent& npc = *e->npc;
        Vec3 pos = e->cachedWorld.translation();
        if (e->health && e->health->dead()) {
            if (npc.state != NPCComponent::State::Dead) {
                npc.state = NPCComponent::State::Dead;
                npc.stateTime = 0.0f;
                events_.push_back({AIEvent::Type::Died, e->id, e->id, 0.0f, e->displayName()});
                if (!e->health->destroyOnDeath) {
                    // keeps the corpse in the scene; the editor hides nothing
                }
            }
            continue;
        }

        // resolve the target: the player entity, or the first entity with the
        // configured tag (e.g. an NPC tracking a "Pickup").
        EntityId target = kInvalidEntity;
        Vec3 targetPos{0, 0, 0};
        if (playerValid && (npc.targetTag.empty() || npc.targetTag == "Player")) {
            target = player;
            targetPos = playerPos;
        } else if (!npc.targetTag.empty()) {
            EntityId tagged = scene.firstByTag(npc.targetTag);
            if (Entity* t = scene.get(tagged)) {
                target = tagged;
                targetPos = t->cachedWorld.translation();
            }
        }
        float distance = target == kInvalidEntity ? 1e9f : planarDistance(pos, targetPos);
        bool hadTarget = npc.hasTarget;
        npc.hasTarget = target != kInvalidEntity && distance <= npc.loseTargetRange;
        if (npc.hasTarget && !hadTarget)
            events_.push_back({AIEvent::Type::TargetSpotted, e->id, target, distance, ""});
        if (!npc.hasTarget && hadTarget)
            events_.push_back({AIEvent::Type::TargetLost, e->id, target, distance, ""});

        float speed = npc.moveSpeed * settings_.globalAggressionScale;
        Vec3 move{0, 0, 0};

        // --- state transitions -----------------------------------------
        switch (npc.behavior) {
            case NPCComponent::Behavior::Idle:
                npc.state = NPCComponent::State::Idle;
                break;
            case NPCComponent::Behavior::Patrol:
                if (npc.state != NPCComponent::State::Chase && npc.state != NPCComponent::State::Attack)
                    npc.state = npc.patrolPoints.empty() ? NPCComponent::State::Idle
                                                         : NPCComponent::State::Patrol;
                break;
            case NPCComponent::Behavior::ChasePlayer:
                if (npc.state != NPCComponent::State::Attack &&
                    npc.state != NPCComponent::State::Chase &&
                    npc.state != NPCComponent::State::Idle)
                    npc.state = NPCComponent::State::Idle;
                break;
            case NPCComponent::Behavior::FollowPlayer:
                npc.state = NPCComponent::State::Follow;
                break;
        }

        // hostile behaviours react to the target
        bool hostile = npc.behavior == NPCComponent::Behavior::ChasePlayer;
        if (hostile && npc.hasTarget) {
            if (npc.state == NPCComponent::State::Idle || npc.state == NPCComponent::State::Patrol) {
                npc.state = NPCComponent::State::Chase;
                npc.stateTime = 0.0f;
            }
            if (npc.state == NPCComponent::State::Chase && distance <= npc.attackRange)
                npc.state = NPCComponent::State::Attack;
            if (npc.state == NPCComponent::State::Attack && distance > npc.attackRange * 1.15f)
                npc.state = NPCComponent::State::Chase;
        } else if (hostile && !npc.hasTarget &&
                   (npc.state == NPCComponent::State::Chase || npc.state == NPCComponent::State::Attack)) {
            npc.state = npc.patrolPoints.empty() ? NPCComponent::State::Idle
                                                 : NPCComponent::State::Patrol;
            npc.stateTime = 0.0f;
        }

        npc.stateTime += dt;
        npc.attackTimer = std::max(0.0f, npc.attackTimer - dt);

        // --- per state movement ----------------------------------------
        switch (npc.state) {
            case NPCComponent::State::Idle: {
                if (npc.behavior == NPCComponent::Behavior::Patrol && !npc.patrolPoints.empty() &&
                    npc.stateTime >= npc.idleTime) {
                    npc.state = NPCComponent::State::Patrol;
                    npc.stateTime = 0.0f;
                }
                break;
            }
            case NPCComponent::State::Patrol: {
                if (npc.patrolPoints.empty()) {
                    npc.state = NPCComponent::State::Idle;
                    break;
                }
                if (npc.patrolIndex >= (int)npc.patrolPoints.size()) npc.patrolIndex = 0;
                Vec3 wp = npc.patrolPoints[(size_t)npc.patrolIndex];
                Vec3 dir = planarNormalize(wp - pos);
                if (dir.length() < 1e-4f || planarDistance(pos, wp) < 0.35f) {
                    events_.push_back({AIEvent::Type::PatrolPointReached, e->id, kInvalidEntity, 0.0f, ""});
                    npc.patrolIndex = (npc.patrolIndex + 1) % (int)npc.patrolPoints.size();
                    if (!npc.loopPatrol && npc.patrolIndex == 0) {
                        npc.state = NPCComponent::State::Idle;
                        npc.stateTime = 0.0f;
                    }
                    break;
                }
                move = dir * (speed * dt);
                if (npc.faceTarget) faceTowards(*e, pos, wp, npc.turnSpeed, dt);
                break;
            }
            case NPCComponent::State::Chase: {
                Vec3 dir = planarNormalize(targetPos - pos);
                move = dir * (speed * dt);
                if (npc.faceTarget && target != kInvalidEntity) faceTowards(*e, pos, targetPos, npc.turnSpeed, dt);
                break;
            }
            case NPCComponent::State::Attack: {
                if (npc.faceTarget && target != kInvalidEntity) faceTowards(*e, pos, targetPos, npc.turnSpeed, dt);
                if (npc.attackTimer <= 0.0f && target != kInvalidEntity) {
                    npc.attackTimer = std::max(npc.attackCooldown, 0.1f);
                    float damage = npc.attackDamage * settings_.globalAggressionScale;
                    applyDamage(scene, target, damage, effects_);
                    events_.push_back({AIEvent::Type::Attacked, e->id, target, damage, ""});
                }
                break;
            }
            case NPCComponent::State::Follow: {
                const float followDistance = 3.0f;
                float d = planarDistance(pos, targetPos);
                Vec3 dir = planarNormalize(targetPos - pos);
                if (d > followDistance) move = dir * (speed * dt);
                else if (d < followDistance * 0.5f) move = dir * (-speed * dt * 0.5f);
                if (npc.faceTarget && target != kInvalidEntity && d > 0.8f)
                    faceTowards(*e, pos, targetPos, npc.turnSpeed, dt);
                break;
            }
            case NPCComponent::State::Dead:
                break;
        }

        if (move.length() > 1e-5f && physics) physics->moveCharacter(e->id, move);
    }
}

std::vector<NPCStatus> AISystem::statuses(Scene& scene) {
    std::vector<NPCStatus> out;
    scene.updateTransforms();
    for (Entity* e : scene.allEntities()) {
        if (!e->npc) continue;
        NPCStatus s;
        s.entity = e->id;
        s.name = e->displayName();
        s.state = e->npc->state;
        s.position = e->cachedWorld.translation();
        s.hasTarget = e->npc->hasTarget;
        if (e->health) {
            s.health = e->health->currentHealth;
            s.maxHealth = e->health->maxHealth;
        }
        if (e->id == scene.firstByTag("Player")) {
            s.distanceToTarget = 0.0f;
        } else {
            EntityId p = scene.firstByTag("Player");
            if (Entity* pe = scene.get(p))
                s.distanceToTarget = planarDistance(s.position, pe->cachedWorld.translation());
        }
        out.push_back(s);
    }
    return out;
}

}  // namespace nf
