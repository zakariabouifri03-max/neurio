// NovaForge Engine - NPC AI
//
// A small, real, deterministic state machine driven by the NPCComponent:
// Idle -> Patrol -> Chase -> Attack -> (Follow) -> Dead. NPCs move through the
// physics character controller, so they collide with the world, fall with
// gravity and can be blocked by walls.
//
// V1 scope: steering is direct (no navmesh pathfinding - documented as a V1
// gap in docs/AI.md), attack/health use HealthComponent, and every state
// transition is observable through AISystem::drainEvents() for the HUD,
// scripts and tests.
#pragma once
#include "core/math.h"
#include "scene/scene.h"

#include <string>
#include <vector>

namespace nf {

class PhysicsWorld;
class EffectsQueue;

struct AIEvent {
    enum class Type { TargetSpotted = 0, TargetLost, Attacked, Died, PatrolPointReached, Spoke };
    Type type = Type::Spoke;
    EntityId npc = kInvalidEntity;
    EntityId target = kInvalidEntity;
    float value = 0.0f;         // attack damage
    std::string message;        // optional text (dialogue / speech)
};

struct NPCStatus {
    EntityId entity = kInvalidEntity;
    std::string name;
    NPCComponent::State state = NPCComponent::State::Idle;
    float health = 100.0f;
    float maxHealth = 100.0f;
    Vec3 position;
    float distanceToTarget = 0.0f;
    bool hasTarget = false;
};

struct AISettings {
    float globalAggressionScale = 1.0f;   // difficulty knob (1 = component values)
    bool freezeAi = false;                // editor pause / debug
};

// Gameplay helpers shared by AI, scripts and the HUD. The optional effects
// queue receives a hit spark at the target position.
void applyDamage(Scene& scene, EntityId target, float amount);
void applyDamage(Scene& scene, EntityId target, float amount, EffectsQueue* effects);
void applyHeal(Scene& scene, EntityId target, float amount);
bool isDead(const Scene& scene, EntityId target);

class AISystem {
public:
    void setSettings(const AISettings& s) { settings_ = s; }
    const AISettings& settings() const { return settings_; }
    // Optional: hit sparks are pushed here when an NPC lands an attack.
    void setEffectsQueue(EffectsQueue* effects) { effects_ = effects; }

    // Advances every NPC by dt. `player` is the entity the AI reacts to (the
    // player character); physics may be null (editor preview without physics).
    void update(Scene& scene, PhysicsWorld* physics, EntityId player, float dt);

    // Rewinds runtime AI state when play mode starts (states, timers, patrol
    // index) so a scene can be replayed deterministically.
    void reset(Scene& scene);

    std::vector<AIEvent> drainEvents();
    std::vector<NPCStatus> statuses(Scene& scene);

private:
    AISettings settings_;
    EffectsQueue* effects_ = nullptr;
    std::vector<AIEvent> events_;
    // per NPC cooldown bookkeeping keyed by entity (reset on reset())
    std::vector<std::pair<EntityId, float>> cooldowns_;
    float cooldownFor(EntityId id) const;
    void setCooldown(EntityId id, float value);
};

}  // namespace nf
