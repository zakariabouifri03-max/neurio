// NovaForge Engine - component definitions
//
// A "component" is a plain data struct attached to an Entity. The editor
// inspector edits these fields, the JSON serializer writes them to the scene
// file and the runtime systems (physics, AI, scripts, audio) consume them.
#pragma once
#include "core/math.h"

#include <string>
#include <vector>

namespace nf {

// ---------------------------------------------------------------- transform
struct Transform {
    Vec3 position{0, 0, 0};
    Quat rotation = Quat::identity();
    Vec3 scale{1, 1, 1};

    // Inspector friendly euler angles (degrees, YXZ). Uses |rotation|.
    Vec3 eulerDegrees() const { return rotation.toEulerDeg(); }
    void setEulerDegrees(const Vec3& deg) { rotation = Quat::fromEulerDeg(deg); }
    Mat4 matrix() const { return Mat4::trs(position, rotation, scale); }
};

// ---------------------------------------------------------------- rendering
struct MeshRendererComponent {
    std::string modelPath = "primitive://Cube";   // .nfmodel.json or primitive://Name
    std::string materialOverride;                 // project relative .nfmat.json ("" = model default)
    std::vector<std::string> subMaterialOverrides;
    Vec3 colorTint{1, 1, 1};
    bool visible = true;
    bool castShadow = true;
    bool receiveShadow = true;
    // runtime stats (not serialized): triangles per frame, from the last draw
    mutable size_t lastTriangleCount = 0;
};

// ---------------------------------------------------------------- camera
struct CameraComponent {
    float fovDegrees = 60.0f;
    float nearPlane = 0.1f;
    float farPlane = 600.0f;
    bool orthographic = false;
    bool isActive = false;          // the camera the game starts with
    Vec3 backgroundColor{0.42f, 0.55f, 0.70f};
    float exposure = 1.0f;
};

// ---------------------------------------------------------------- light
enum class LightType { Directional = 0, Point = 1, Spot = 2 };

struct LightComponent {
    LightType type = LightType::Directional;
    Vec3 color{1.0f, 0.97f, 0.92f};
    float intensity = 1.0f;
    float range = 15.0f;          // point / spot
    float spotAngleDegrees = 40.0f;
    float spotSoftness = 0.25f;
    bool castShadow = true;
    float shadowBias = 0.0015f;
    bool enabled = true;
};

// ---------------------------------------------------------------- physics
enum class ColliderShape { Box = 0, Sphere = 1, Capsule = 2, Cylinder = 3, Mesh = 4 };

struct ColliderComponent {
    ColliderShape shape = ColliderShape::Box;
    Vec3 center{0, 0, 0};          // local offset
    Vec3 size{1, 1, 1};            // box half extents source (full size in inspector)
    float radius = 0.5f;           // sphere / capsule / cylinder
    float height = 1.8f;           // capsule / cylinder
    bool isTrigger = false;
    float friction = 0.6f;
    float restitution = 0.1f;
    std::string layer = "Default";
    bool debugDraw = false;
};

enum class MotionType { Static = 0, Dynamic = 1, Kinematic = 2 };

struct RigidBodyComponent {
    MotionType motionType = MotionType::Dynamic;
    float mass = 1.0f;
    float linearDamping = 0.05f;
    float angularDamping = 0.2f;
    bool useGravity = true;
    bool freezeRotation = false;
    Vec3 initialVelocity{0, 0, 0};
};

// ---------------------------------------------------------------- gameplay
struct CharacterComponent {
    enum class ViewMode { ThirdPerson = 0, FirstPerson = 1 };
    bool isPlayer = true;                  // false = AI controlled character
    ViewMode viewMode = ViewMode::ThirdPerson;
    float walkSpeed = 4.0f;
    float runSpeed = 8.0f;
    float jumpHeight = 1.5f;
    float mouseSensitivity = 0.12f;
    float cameraDistance = 5.0f;
    float cameraHeight = 1.5f;
    float cameraPitchLimit = 75.0f;
    bool invertY = false;
    float stepHeight = 0.45f;
    float spawnYawDegrees = 0.0f;         // used by the third person camera at start
};

struct NPCComponent {
    enum class State { Idle = 0, Patrol = 1, Chase = 2, Attack = 3, Follow = 4, Dead = 5 };
    enum class Behavior { Idle = 0, Patrol = 1, ChasePlayer = 2, FollowPlayer = 3 };
    Behavior behavior = Behavior::ChasePlayer;
    State state = State::Idle;             // runtime value, reset when play starts
    std::string targetTag = "Player";
    float detectionRange = 14.0f;
    float loseTargetRange = 22.0f;
    float attackRange = 2.2f;
    float moveSpeed = 2.8f;
    float turnSpeed = 8.0f;
    float attackDamage = 12.0f;
    float attackCooldown = 1.2f;
    float idleTime = 1.5f;                 // seconds in Idle before patrolling
    bool faceTarget = true;
    std::vector<Vec3> patrolPoints;        // world space waypoints
    bool loopPatrol = true;
    // runtime (not serialized)
    mutable float stateTime = 0.0f;
    mutable float attackTimer = 0.0f;
    mutable int patrolIndex = 0;
    mutable bool hasTarget = false;
};

struct HealthComponent {
    float maxHealth = 100.0f;
    float currentHealth = 100.0f;
    bool destroyOnDeath = false;
    bool invulnerable = false;
    bool dead() const { return currentHealth <= 0.0f; }
    void reset() { currentHealth = maxHealth; }
};

struct TriggerComponent {
    enum class Action {
        None = 0,
        OpenDoor = 1,
        CloseDoor = 2,
        Damage = 3,
        Heal = 4,
        Pickup = 5,
        PlaySound = 6,
        SetActive = 7,
        WinGame = 8,
    };
    Action onEnter = Action::None;
    Action onExit = Action::None;
    std::string targetEntity;      // name of the entity the action applies to
    float value = 10.0f;           // damage/heal amount
    std::string message;           // shown on the HUD
    bool oneShot = false;
    // runtime
    mutable bool firedEnter = false;
    mutable bool firedExit = false;
};

struct InteractableComponent {
    enum class Action { None = 0, Pickup = 1, ToggleDoor = 2, Message = 3, Damage = 4, Heal = 5, Teleport = 6 };
    Action action = Action::Message;
    std::string prompt = "Press E to interact";
    std::string message = "Hello!";
    float value = 20.0f;
    std::string targetEntity;
    Vec3 teleportTo{0, 1, 0};
    bool oneShot = false;
    float interactRange = 2.5f;
    // runtime
    mutable bool used = false;
};

struct DoorComponent {
    Vec3 openOffset{0, 2.2f, 0};
    float speed = 2.0f;
    bool startsOpen = false;
    bool locked = false;
    mutable bool open = false;
    mutable float t = 0.0f;        // 0 closed, 1 open (runtime)
};

struct AudioSourceComponent {
    std::string clip;              // project relative .wav
    float volume = 1.0f;
    float pitch = 1.0f;
    bool loop = false;
    bool playOnStart = false;
    float minDistance = 1.0f;
    float maxDistance = 30.0f;
    bool spatial = true;
};

struct AnimatorComponent {
    std::string defaultClip;       // "-" / "" = first clip of the model
    bool playOnStart = true;
    bool loop = true;
    float speed = 1.0f;
    // optional state clips driven by the character/NPC systems
    std::string idleClip = "Idle";
    std::string walkClip = "Walk";
    std::string runClip = "Run";
    std::string attackClip = "Attack";
    std::string deathClip = "Death";
};

struct ScriptComponent {
    std::string scriptPath;        // project relative .lua (Assets/Scripts/...)
    bool enabled = true;
    // runtime
    mutable int luaRef = -1;
};

struct ParticleComponent {
    // Deliberately tiny "V1 VFX": a burst of billboard sprites. Advanced VFX
    // (Niagara style) is explicitly out of scope, see docs/ROADMAP.md.
    Vec3 color{1.0f, 0.6f, 0.2f};
    float size = 0.15f;
    float lifetime = 0.8f;
    float speed = 2.5f;
    int count = 24;
    bool playOnStart = false;
    bool looping = false;
    bool emitOnInteract = true;
};

// ---------------------------------------------------------------- registry
enum class ComponentType {
    MeshRenderer = 0,
    Camera,
    Light,
    Collider,
    RigidBody,
    Character,
    NPC,
    Health,
    Trigger,
    Interactable,
    Door,
    AudioSource,
    Animator,
    Script,
    Particle,
    Count
};

const char* componentTypeName(ComponentType t);
ComponentType componentTypeFromName(const std::string& name);

}  // namespace nf
