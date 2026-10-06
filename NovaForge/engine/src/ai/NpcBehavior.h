// NovaForge Engine - ai/NpcBehavior.h
// The NPC state machine: Idle -> Patrol -> Chase -> Attack (plus Flee and Dead).
#pragma once

#include "core/Base.h"
#include "scene/Components.h"

namespace nf {

class Scene;

namespace ai {

// Moves a character through the world (uses the physics capsule when available).
// Shared by the player controller and by NPCs.
struct CharacterMoveInput {
  Vec3 desiredVelocity{0, 0, 0};
  bool jump = false;
  f32 gravity = -20.0f;
  f32 radius = 0.4f;
  f32 height = 1.8f;
};

struct CharacterMoveState {
  Vec3 velocity{0, 0, 0};
  bool grounded = false;
};

CharacterMoveState MoveCharacter(Scene& scene, EntityId entity, const CharacterMoveInput& input,
                                 CharacterMoveState state, f32 dt);

// Advances one NPC by dt seconds. Called from AIComponent::OnUpdate.
void UpdateNpc(Scene& scene, AIComponent& npc, f32 dt);

// Returns true when `observer` can see `target` (distance + optional physics ray test).
bool CanSeeTarget(Scene& scene, EntityId observer, EntityId target, f32 maxDistance,
                  bool requireLineOfSight);

} // namespace ai
} // namespace nf
