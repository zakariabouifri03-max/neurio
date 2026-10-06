// NovaForge Engine - runtime/PlayerController.cpp
#include "runtime/PlayerController.h"
#include "runtime/GameRuntime.h"
#include "physics/PhysicsWorld.h"
#include "scene/Scene.h"
#include "scene/Components.h"
#include "ai/NpcBehavior.h"
#include "platform/Platform.h"
#include "core/Log.h"

namespace nf {

using platform::Key;
using platform::MouseButton;

void PlayerController::ResetState(State& state) {
  state.yaw = 0.0f;
  state.pitch = 12.0f;
  state.velocity = Vec3(0, 0, 0);
  state.grounded = false;
  state.sprinting = false;
  state.moving = false;
  state.speed = 0.0f;
}

Vec3 PlayerController::ComputeMoveDirection(const CharacterControllerComponent& controller, f32 yaw,
                                           platform::InputState* input) {
  NF_UNUSED(controller);
  if (!input) return Vec3(0, 0, 0);
  f32 forward = 0.0f, right = 0.0f;
  if (input->IsKeyDown(Key::W) || input->IsKeyDown(Key::Up)) forward += 1.0f;
  if (input->IsKeyDown(Key::S) || input->IsKeyDown(Key::Down)) forward -= 1.0f;
  if (input->IsKeyDown(Key::D) || input->IsKeyDown(Key::Right)) right += 1.0f;
  if (input->IsKeyDown(Key::A) || input->IsKeyDown(Key::Left)) right -= 1.0f;
  if (forward == 0.0f && right == 0.0f) return Vec3(0, 0, 0);

  // camera-relative movement on the XZ plane
  Vec3 cameraForward(Sin(yaw), 0.0f, -Cos(yaw));
  Vec3 cameraRight = Normalize(Cross(Vec3(0, 1, 0), cameraForward)) * -1.0f;
  Vec3 direction = cameraForward * forward + cameraRight * right;
  return Normalize(direction);
}

EntityId PlayerController::EnsureCamera(Scene& scene, EntityId player,
                                       const CharacterControllerComponent& controller, State& state) {
  if (player == 0) return 0;
  EntityId camera = scene.FindByName("__PlayerCamera");
  if (camera == 0) {
    camera = scene.CreateObject("__PlayerCamera");
    GameObject* object = scene.Get(camera);
    if (!object) return 0;
    object->tag = "Camera";
    object->runtimeOnly = true;
    auto* cameraComponent = scene.AddComponent<CameraComponent>(camera);
    cameraComponent->isPrimary = true;
    cameraComponent->fieldOfView = controller.viewMode == 1 ? 75.0f : 60.0f;
    // make sure no other camera steals the view
    for (auto& other : scene.AllObjects()) {
      if (other->id == camera) continue;
      if (auto* otherCamera = other->Get<CameraComponent>()) otherCamera->isPrimary = false;
    }
  }
  NF_UNUSED(state);
  return camera;
}

void PlayerController::Update(Scene& scene, GameRuntime& runtime, platform::InputState* input,
                             f32 dt, State& state) {
  EntityId player = runtime.PlayerObject();
  if (player == 0) return;
  GameObject* object = scene.Get(player);
  if (!object) return;
  CharacterControllerComponent* controller = object->Get<CharacterControllerComponent>();
  if (!controller) return;

  // ------------------------------------------------------------------ look
  if (input) {
    Vec2 delta = input->MouseDelta();
    if (delta.x != 0.0f || delta.y != 0.0f) {
      state.yaw += delta.x * controller->mouseSensitivity * 0.1f;
      f32 pitchDelta = delta.y * controller->mouseSensitivity * 0.1f * (controller->invertY ? 1.0f : -1.0f);
      state.pitch = Clamp(state.pitch + pitchDelta, controller->pitchMin, controller->pitchMax);
    }
    if (Fmod(state.yaw, kTwoPi) > kPi) state.yaw -= kTwoPi;
  }

  // ---------------------------------------------------------------- movement
  Vec3 direction = ComputeMoveDirection(*controller, state.yaw, input);
  bool sprinting = false;
  if (input && controller->enableSprint)
    sprinting = input->IsKeyDown(Key::LeftShift) || input->IsKeyDown(Key::RightShift);
  f32 speed = controller->moveSpeed * (sprinting ? controller->sprintMultiplier : 1.0f);
  state.sprinting = sprinting;
  state.moving = LengthSq(direction) > 0.001f;
  state.speed = state.moving ? speed : 0.0f;

  bool jump = false;
  if (input) jump = input->WasKeyPressed(Key::Space);

  ai::CharacterMoveInput moveInput;
  moveInput.desiredVelocity = direction * speed;
  moveInput.jump = jump;
  moveInput.gravity = controller->gravity;
  moveInput.radius = controller->capsuleRadius;
  moveInput.height = controller->capsuleHeight;

  ai::CharacterMoveState moveState;
  moveState.velocity = state.velocity;
  moveState.grounded = state.grounded;
  moveState = ai::MoveCharacter(scene, player, moveInput, moveState, dt);
  state.velocity = moveState.velocity;
  state.grounded = moveState.grounded;
  runtime.SetPlayerGrounded(moveState.grounded);

  // --------------------------------------------------------------- rotation
  if (controller->rotateTowardsMovement && state.moving) {
    Quat desired = Quat::LookRotation(direction, Vec3(0, 1, 0));
    Transform world = scene.WorldTransform(player);
    world.rotation = Quat::Slerp(world.rotation, desired, Saturate(controller->turnSpeed * dt));
    scene.SetWorldTransform(player, world);
  } else if (!state.moving && input) {
    // in first person the body follows the camera yaw so the capsule never blocks the view
    if (controller->IsFirstPerson()) {
      Transform world = scene.WorldTransform(player);
      world.rotation = Quat::FromEuler(0, state.yaw * kRadToDeg, 0);
      scene.SetWorldTransform(player, world);
    }
  }

  // ----------------------------------------------------------------- camera
  EntityId camera = runtime.RuntimeCameraEntity();
  if (camera == 0) {
    camera = EnsureCamera(scene, player, *controller, state);
    runtime.SetRuntimeCameraEntity(camera);
  }
  if (camera != 0) {
    Transform playerWorld = scene.WorldTransform(player);
    Vec3 eye = playerWorld.position + Vec3(0, controller->cameraHeight, 0);
    f32 yawRad = state.yaw;
    f32 pitchRad = state.pitch * kDegToRad;
    Vec3 lookDirection(Sin(yawRad) * Cos(pitchRad), Sin(pitchRad), -Cos(yawRad) * Cos(pitchRad));
    Transform cameraTransform;
    if (controller->IsFirstPerson()) {
      cameraTransform.position = eye + Vec3(0, 0.1f, 0);
      cameraTransform.rotation = Quat::LookRotation(lookDirection, Vec3(0, 1, 0));
    } else {
      // pull the camera back, keeping it out of the geometry
      f32 distance = controller->cameraDistance;
      Vec3 desired = eye - lookDirection * distance;
      if (PhysicsWorld* physics = scene.Physics()) {
        Ray ray{eye, -lookDirection};
        PhysicsRayHit hit;
        if (physics->Raycast(ray, distance + 0.4f, false, &hit) && hit.hit) {
          distance = std::max(0.6f, hit.distance - 0.3f);
          desired = eye - lookDirection * distance;
        }
      }
      cameraTransform.position = desired;
      cameraTransform.rotation = Quat::LookRotation(lookDirection, Vec3(0, 1, 0));
    }
    scene.SetWorldTransform(camera, cameraTransform);
    scene.MarkTransformDirty(camera);
  }

  // -------------------------------------------------------------- animation
  if (controller->useControllerAnimation) {
    if (AnimatorComponent* animator = object->Get<AnimatorComponent>()) {
      const char* clip = "Idle";
      if (!state.grounded) clip = "Jump";
      else if (sprinting && state.moving) clip = "Run";
      else if (state.moving) clip = "Walk";
      animator->Play(clip, false);
      if (!state.grounded && animator->CurrentClip() != "Jump") animator->Play("Run", false);
    }
  }

  // ------------------------------------------------------------- interaction
  if (input && (input->WasKeyPressed(Key::E) || input->WasKeyPressed(Key::Enter))) {
    runtime.RequestInteract();
  }
}

} // namespace nf
