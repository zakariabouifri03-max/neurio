// NovaForge Engine - gameplay layer
//
// This is the *same* code that runs in the editor's PLAY mode and in the
// exported game (runtime/main.cpp), so what you test in the editor is what
// ships. It owns:
//
//   PlayerController - third/first person camera, walking, running, jumping
//   GameplaySystem   - interactions (E), attack, triggers, doors, audio
//                      sources, HUD messages, win / death handling
//
// It never touches the renderer: the editor and the runtime both ask for a
// RenderCamera and a HudState and draw them themselves.
#pragma once
#include "audio/audio.h"
#include "core/math.h"
#include "physics/physics.h"
#include "render/draw_list.h"
#include "render/effects.h"
#include "ai/npc_ai.h"    // applyDamage / applyHeal / isDead
#include "scene/scene.h"
#include "script/script_host.h"

#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace nf {

// Input for one frame, already mapped from keys/actions.
struct PlayerInputState {
    Vec2 move{0.0f, 0.0f};        // x = strafe (-1 left, +1 right), y = forward
    float lookX = 0.0f;           // mouse delta in pixels
    float lookY = 0.0f;
    bool run = false;
    bool jumpPressed = false;
    bool interactPressed = false;
    bool attackPressed = false;
    bool attackHeld = false;
    bool resetRequested = false;
};

struct HudState {
    std::string message;           // transient message (pickup, trigger, script)
    float messageTimer = 0.0f;
    std::string prompt;            // "Press E: open the chest"
    float health = 100.0f;
    float maxHealth = 100.0f;
    bool hasHealth = false;
    bool dead = false;
    int pickups = 0;
    int kills = 0;
    bool won = false;
    std::string winMessage = "You escaped the island!";
    float playTime = 0.0f;
};

class PlayerController {
public:
    // Reads the spawn yaw and camera settings from the character component.
    void reset(const Scene& scene, EntityId player);

    void applyInput(const PlayerInputState& in);
    // Moves the player through the physics character controller and updates the
    // camera angles. Call once per frame before PhysicsWorld::simulate().
    void update(Scene& scene, PhysicsWorld& physics, EntityId player, float dt);

    // Needs a mutable scene: it refreshes world transforms before reading them.
    RenderCamera camera(Scene& scene, const PhysicsWorld* physics, EntityId player, int width,
                        int height, float dt);

    EntityId playerEntity() const { return playerEntity_; }
    float yawDegrees() const { return yaw_; }
    float pitchDegrees() const { return pitch_; }
    void setAngles(float yawDeg, float pitchDeg);
    void addLook(float dx, float dy);
    Vec3 position() const { return position_; }
    Vec3 forward() const;
    bool grounded() const { return grounded_; }
    bool firstPerson() const { return firstPerson_; }

private:
    EntityId playerEntity_ = kInvalidEntity;
    float yaw_ = 0.0f;
    float pitch_ = -12.0f;
    float pendingLookX_ = 0.0f, pendingLookY_ = 0.0f;
    Vec2 move_{0.0f, 0.0f};
    bool run_ = false;
    bool jump_ = false;
    bool grounded_ = false;
    Vec3 position_{0, 0, 0};
    bool firstPerson_ = false;
    mutable float smoothDist_ = 5.0f;
};

class GameplaySystem {
public:
    void setEffectsQueue(EffectsQueue* fx) { effects_ = fx; }
    void setAudio(AudioSystem* audio) { audio_ = audio; }
    void setScripts(ScriptHost* scripts) { scripts_ = scripts; }
    // Project-relative -> absolute path resolution (audio clips live in Assets/).
    void setPathResolver(std::function<std::string(const std::string&)> fn) { pathResolver_ = std::move(fn); }

    // Play mode starts: script onStart, door base positions, playOnStart sounds.
    void start(Scene& scene, PhysicsWorld& physics, EntityId player);
    // Play mode stops: stop looping sounds, drop script instances, clear effects.
    void stop(Scene& scene, PhysicsWorld& physics);

    // One gameplay frame: prompts, interactions, attack, scripts.
    void update(Scene& scene, PhysicsWorld& physics, EntityId player,
                const PlayerController& controller, const PlayerInputState& in, float dt);
    // Consumes physics events (called right after the physics step).
    void handlePhysicsEvents(Scene& scene, PhysicsWorld& physics, EntityId player);
    // Doors, spatial audio, health/HUD bookkeeping (called after the physics step).
    void postStep(Scene& scene, PhysicsWorld& physics, EntityId player, float dt);

    // The interactable the player is looking at right now ("" when none).
    EntityId interactionTarget(Scene& scene, const PlayerController& controller) const;

    bool interact(Scene& scene, PhysicsWorld& physics, EntityId player, EntityId target);
    bool attack(Scene& scene, PhysicsWorld& physics, EntityId player, const Vec3& origin,
                const Vec3& forward);

    HudState& hud() { return hud_; }
    const HudState& hud() const { return hud_; }
    void message(const std::string& text, float seconds = 3.0f);
    void requestWin(const std::string& text = "");
    void setGameOver(bool over) { hud_.dead = over; }
    void addPickup() { ++hud_.pickups; }
    void addKill() { ++hud_.kills; }

private:
    std::string resolvePath(const std::string& projectRelative) const;
    void applyTriggerAction(Scene& scene, PhysicsWorld& physics, EntityId trigger, EntityId other,
                            bool enter);
    void updateDoor(Scene& scene, EntityId door, float dt);
    void playAudioSources(Scene& scene, EntityId player);

    EffectsQueue* effects_ = nullptr;
    AudioSystem* audio_ = nullptr;
    ScriptHost* scripts_ = nullptr;
    std::function<std::string(const std::string&)> pathResolver_;
    HudState hud_;
    std::unordered_map<EntityId, SoundHandle> loopSounds_;
    std::unordered_map<EntityId, Vec3> doorBasePositions_;
    EntityId interactTarget_ = kInvalidEntity;
    float attackCooldown_ = 0.0f;
    float interactCooldown_ = 0.0f;
    float invulnTimer_ = 0.0f;
};

// Finds the player entity: CharacterComponent::isPlayer, then tag "Player",
// then the first character. kInvalidEntity when the scene has no character.
EntityId findPlayerEntity(const Scene& scene);

}  // namespace nf
