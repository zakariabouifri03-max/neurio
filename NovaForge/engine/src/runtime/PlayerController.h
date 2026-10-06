// NovaForge Engine - runtime/PlayerController.h
// Third-person / first-person player controller: WASD movement, mouse camera,
// jumping, gravity, sprint, collision and animation driving.
#pragma once

#include "core/Base.h"
#include "scene/Scene.h"

namespace nf {

class GameRuntime;
namespace platform { class InputState; }

class PlayerController {
public:
  struct State {
    f32 yaw = 0.0f;
    f32 pitch = 12.0f;
    Vec3 velocity{0, 0, 0};
    bool grounded = false;
    bool sprinting = false;
    bool moving = false;
    f32 speed = 0.0f;
  };

  // Advances the player for one frame. Reads keyboard/mouse, moves the entity through
  // the physics world and updates the gameplay camera.
  static void Update(Scene& scene, GameRuntime& runtime, platform::InputState* input, f32 dt,
                     State& state);

  // Creates/uses the runtime follow camera for third person or embeds it in the head
  // for first person. Returns the camera entity.
  static EntityId EnsureCamera(Scene& scene, EntityId player, const CharacterControllerComponent& controller,
                               State& state);
  static void ResetState(State& state);

  // Movement input in world space (used by both view modes).
  static Vec3 ComputeMoveDirection(const CharacterControllerComponent& controller, f32 yaw,
                                   platform::InputState* input);
};

} // namespace nf
