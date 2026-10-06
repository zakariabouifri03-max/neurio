// NovaForge Engine - ai/NpcBehavior.cpp
#include "ai/NpcBehavior.h"
#include "scene/Scene.h"
#include "physics/PhysicsWorld.h"
#include "core/Log.h"
#include "core/StringUtil.h"

namespace nf::ai {

bool CanSeeTarget(Scene& scene, EntityId observer, EntityId target, f32 maxDistance,
                  bool requireLineOfSight) {
  if (observer == 0 || target == 0 || observer == target) return false;
  Transform observerWorld = scene.WorldTransform(observer);
  Transform targetWorld = scene.WorldTransform(target);
  f32 distance = Distance(observerWorld.position, targetWorld.position);
  if (distance > maxDistance) return false;
  if (!requireLineOfSight) return true;

  PhysicsWorld* physics = scene.Physics();
  if (!physics) return true;   // no physics world: distance check only
  Vec3 eye = observerWorld.position + Vec3(0, 1.4f, 0);
  Vec3 targetCenter = targetWorld.position + Vec3(0, 0.9f, 0);
  Vec3 direction = targetCenter - eye;
  f32 length = Length(direction);
  if (length < 0.001f) return true;
  Ray ray{eye, direction / length};
  PhysicsRayHit hit;
  if (!physics->Raycast(ray, length + 0.5f, false, &hit)) return true;
  return hit.entity == target;
}

CharacterMoveState MoveCharacter(Scene& scene, EntityId entity, const CharacterMoveInput& input,
                                 CharacterMoveState state, f32 dt) {
  PhysicsWorld* physics = scene.Physics();
  PhysicsBody* body = physics ? physics->GetBodyForEntity(entity) : nullptr;

  // horizontal velocity is driven directly (snappy gameplay), vertical integrates gravity
  Vec3 velocity = state.velocity;
  velocity.x = input.desiredVelocity.x;
  velocity.z = input.desiredVelocity.z;

  bool grounded = state.grounded;
  if (input.jump && grounded) {
    velocity.y = std::sqrt(std::max(0.0f, -2.0f * input.gravity * 1.6f));
    grounded = false;
  } else {
    velocity.y += input.gravity * dt;
  }
  if (velocity.y < -60.0f) velocity.y = -60.0f;

  Vec3 displacement = velocity * dt;

  if (body) {
    if (body->type == BodyType::Dynamic) {
      // let the solver integrate: hand it our horizontal velocity and keep gravity vertical
      body->linearVelocity.x = velocity.x;
      body->linearVelocity.z = velocity.z;
      if (input.jump && grounded) body->linearVelocity.y = velocity.y;
      body->sleeping = false;
      body->sleepTimer = 0.0f;
      state.velocity = body->linearVelocity;
      state.grounded = body->grounded;
      // mirror into the ECS transform so gameplay code sees the movement immediately
      Transform world;
      world.position = body->position;
      world.rotation = body->rotation;
      world.scale = scene.LocalTransform(entity).scale;
      scene.SetWorldTransform(entity, world);
      return state;
    }
    PhysicsWorld::MoveResult move = physics->MoveCapsule(
        body->id, displacement, input.radius, input.height, true);
    if (move.grounded) {
      if (velocity.y < 0) velocity.y = 0;
      state.grounded = true;
    } else {
      state.grounded = false;
    }
    if (move.hitCeiling && velocity.y > 0) velocity.y = 0;
    state.velocity = velocity;
    Transform world;
    world.position = move.position;
    world.rotation = scene.LocalTransform(entity).rotation;
    world.scale = scene.LocalTransform(entity).scale;
    scene.SetWorldTransform(entity, world);
    return state;
  }

  // no physics body: plain kinematics with a ground plane at y = 0
  Vec3 position = scene.WorldTransform(entity).position + displacement;
  if (position.y <= 0.0f) {
    position.y = 0.0f;
    velocity.y = 0.0f;
    state.grounded = true;
  } else {
    state.grounded = false;
  }
  state.velocity = velocity;
  Transform world = scene.WorldTransform(entity);
  world.position = position;
  scene.SetWorldTransform(entity, world);
  return state;
}

static void SetAnimatorClip(AIComponent& npc, Scene& scene, const char* clip, bool restart) {
  if (!npc.animateMovement) return;
  if (GameObject* object = scene.Get(npc.owner)) {
    if (AnimatorComponent* animator = object->Get<AnimatorComponent>())
      animator->Play(clip, restart);
  }
}

void UpdateNpc(Scene& scene, AIComponent& npc, f32 dt) {
  if (npc.State() == NpcState::Dead) return;

  // ---- pick a target
  EntityId target = npc.Target();
  if (target != 0 && !scene.IsValid(target)) {
    target = 0;
    npc.setTargetValue(0);
  }
  if (target == 0 && npc.explicitTarget != 0) target = npc.explicitTarget;
  if (target == 0 && !npc.targetTag.empty()) {
    for (EntityId candidate : scene.FindByTag(npc.targetTag)) {
      if (candidate == npc.owner) continue;
      f32 distance = Distance(scene.WorldTransform(npc.owner).position,
                              scene.WorldTransform(candidate).position);
      if (distance <= npc.detectionRadius) {
        target = candidate;
        break;
      }
    }
  }
  if (target == 0 && scene.PlayerEntity() != 0 && npc.behavior != (i32)NpcBehavior::Patrol) {
    f32 distance = Distance(scene.WorldTransform(npc.owner).position,
                            scene.WorldTransform(scene.PlayerEntity()).position);
    if (distance <= npc.detectionRadius) target = scene.PlayerEntity();
  }
  npc.setTargetValue(target);

  NpcState state = npc.State();
  GameObject* self = scene.Get(npc.owner);
  Transform selfTransform = scene.WorldTransform(npc.owner);
  Vec3 position = selfTransform.position;
  Vec3 desiredVelocity(0, 0, 0);
  Vec3 lookTarget = position;

  bool hasTarget = target != 0;
  f32 distanceToTarget = hasTarget
                             ? Distance(position, scene.WorldTransform(target).position)
                             : 1e9f;
  bool canSee = hasTarget && CanSeeTarget(scene, npc.owner, target, npc.loseTargetRadius,
                                          npc.requireLineOfSight);

  // ---- state transitions
  switch (state) {
    case NpcState::Idle:
      if (npc.behavior == (i32)NpcBehavior::Patrol && !npc.patrolPoints.empty()) state = NpcState::Patrol;
      else if (canSee) state = NpcState::Chase;
      break;
    case NpcState::Patrol:
      if (canSee) state = NpcState::Chase;
      break;
    case NpcState::Chase:
      if (!canSee || !hasTarget) state = npc.behavior == (i32)NpcBehavior::Patrol ? NpcState::Patrol
                                                                                : NpcState::Idle;
      else if (npc.canAttack && distanceToTarget <= npc.attackRange) state = NpcState::Attack;
      else if (npc.behavior == (i32)NpcBehavior::Flee) state = NpcState::Flee;
      break;
    case NpcState::Attack:
      if (!hasTarget || !canSee) state = NpcState::Chase;
      else if (distanceToTarget > npc.attackRange * 1.15f) state = NpcState::Chase;
      break;
    case NpcState::Flee:
      if (!canSee || distanceToTarget > npc.loseTargetRadius * 1.5f) state = NpcState::Idle;
      break;
    default:
      break;
  }
  npc.stateRef() = state;

  // ---- per-state behaviour
  f32& attackTimer = npc.attackTimerRef();
  f32& waitTimer = npc.waitTimerRef();
  int& attackState = npc.attackStateRef();
  f32& attackAnimTimer = npc.attackAnimTimerRef();
  if (attackTimer > 0.0f) attackTimer -= dt;
  if (attackAnimTimer > 0.0f) attackAnimTimer -= dt;

  switch (state) {
    case NpcState::Idle: {
      if (npc.faceTargetWhenIdle && hasTarget) lookTarget = scene.WorldTransform(target).position;
      SetAnimatorClip(npc, scene, "Idle", false);
      break;
    }
    case NpcState::Patrol: {
      if (npc.patrolPoints.empty()) {
        npc.stateRef() = NpcState::Idle;
        break;
      }
      u64 index = (u64)Clamp((f32)npc.patrolIndex(), 0.0f, (f32)(npc.patrolPoints.size() - 1));
      Vec3 waypoint = npc.patrolPoints[(usize)index];
      Vec3 toWaypoint = waypoint - position;
      toWaypoint.y = 0.0f;
      f32 distance = Length(toWaypoint);
      if (distance < 1.0f) {
        waitTimer += dt;
        if (waitTimer >= npc.patrolWaitTime) {
          waitTimer = 0.0f;
          npc.setPatrolIndexValue((i32)((index + 1) % npc.patrolPoints.size()));
        }
      } else {
        Vec3 direction = toWaypoint / distance;
        desiredVelocity = direction * npc.moveSpeed;
        lookTarget = waypoint;
        SetAnimatorClip(npc, scene, "Walk", false);
      }
      break;
    }
    case NpcState::Chase: {
      if (!hasTarget) break;
      Vec3 targetPosition = scene.WorldTransform(target).position;
      Vec3 direction = targetPosition - position;
      direction.y = 0.0f;
      f32 distance = Length(direction);
      if (distance > npc.attackRange * 0.85f) {
        Vec3 normalized = distance > 0.001f ? direction / distance : Vec3(0, 0, 1);
        f32 speed = npc.behavior == (i32)NpcBehavior::Follow ? npc.moveSpeed : npc.chaseSpeed;
        desiredVelocity = normalized * speed;
        SetAnimatorClip(npc, scene, speed > npc.moveSpeed * 1.1f ? "Run" : "Walk", false);
      } else {
        SetAnimatorClip(npc, scene, "Idle", false);
      }
      lookTarget = targetPosition;
      break;
    }
    case NpcState::Flee: {
      if (!hasTarget) break;
      Vec3 targetPosition = scene.WorldTransform(target).position;
      Vec3 away = position - targetPosition;
      away.y = 0.0f;
      f32 distance = Length(away);
      if (distance > 0.001f) desiredVelocity = (away / distance) * npc.chaseSpeed;
      SetAnimatorClip(npc, scene, "Run", false);
      break;
    }
    case NpcState::Attack: {
      if (!hasTarget) break;
      Vec3 targetPosition = scene.WorldTransform(target).position;
      lookTarget = targetPosition;
      if (attackTimer <= 0.0f && attackState == 0) {
        attackState = 1;                 // windup
        attackAnimTimer = npc.attackWindup;
        SetAnimatorClip(npc, scene, "Attack", true);
      }
      if (attackState == 1 && attackAnimTimer <= 0.0f) {
        attackState = 0;
        attackTimer = npc.attackCooldown;
        f32 distance = Distance(position, targetPosition);
        if (distance <= npc.attackRange * 1.25f) {
          scene.ApplyDamage(target, npc.attackDamage, npc.owner);
          scene.PublishEvent(Format("NpcAttack:%s:%s:%.1f",
                                    self ? self->name.c_str() : "NPC",
                                    scene.Get(target) ? scene.Get(target)->name.c_str() : "?",
                                    npc.attackDamage));
          NF_INFO(LogCategory::AI, "%s attacks %s for %.1f", self ? self->name.c_str() : "NPC",
                  scene.Get(target) ? scene.Get(target)->name.c_str() : "?", npc.attackDamage);
        }
      }
      break;
    }
    default:
      break;
  }

  // ---- apply movement
  CharacterMoveInput input;
  input.desiredVelocity = desiredVelocity;
  input.gravity = npc.gravity;
  input.radius = 0.45f;
  input.height = 1.7f;
  if (self) {
    if (ColliderComponent* collider = self->Get<ColliderComponent>()) {
      input.radius = collider->radius;
      input.height = collider->height;
    }
  }
  CharacterMoveState moveState;
  moveState.velocity = npc.velocityRef();
  Scene* scenePtr = &scene;
  NF_UNUSED(scenePtr);
  moveState = MoveCharacter(scene, npc.owner, input, moveState, dt);
  npc.velocityRef() = moveState.velocity;

  // ---- turning
  if (LengthSq(lookTarget - position) > 0.0001f) {
    Vec3 direction = lookTarget - position;
    direction.y = 0.0f;
    if (LengthSq(direction) > 0.0001f) {
      Quat desired = Quat::LookRotation(Normalize(direction), Vec3(0, 1, 0));
      Transform world = scene.WorldTransform(npc.owner);
      world.rotation = Quat::Slerp(world.rotation, desired, Saturate(npc.turnSpeed * dt));
      scene.SetWorldTransform(npc.owner, world);
    }
  }
  scene.MarkTransformDirty(npc.owner);
}

} // namespace nf::ai
