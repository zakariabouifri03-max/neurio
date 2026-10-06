// NovaForge Engine - runtime/GameRuntime.h
// The gameplay runtime. Play mode inside the editor and the exported game
// executable run *this* class, which is what guarantees "play mode simulates the
// same systems as the shipped game".
#pragma once

#include "core/Base.h"
#include "core/Time.h"
#include "scene/Scene.h"
#include "physics/PhysicsWorld.h"
#include "audio/AudioSystem.h"
#include "renderer/RenderTypes.h"
#include "runtime/PlayerController.h"

namespace nf {

class Renderer;
class DebugDrawList;
namespace platform { class Window; class InputState; }

struct RuntimeConfig {
  std::string projectRoot;
  std::string sceneToLoad;              // "" = use the project's start scene
  bool headless = false;                // no window / GPU: simulation only
  bool softwareRasterizer = false;      // verification rendering
  bool verbose = false;
  bool startPlaying = true;
  platform::InputState* input = nullptr;   // supplied by the host window
  f32 fixedTimeStep = 1.0f / 60.0f;
};

struct HudMessage {
  std::string text;
  f32 remaining = 3.0f;
  int type = 0;      // 0 info, 1 warning, 2 reward
};

struct RuntimeHud {
  f32 healthPercent = 1.0f;
  f32 healthValue = 100.0f;
  f32 maxHealth = 100.0f;
  bool showHealth = false;
  bool dead = false;
  std::string interactionPrompt;
  bool showPrompt = false;
  std::string objective;
  bool showObjective = false;
  std::vector<HudMessage> messages;
  f32 deltaTime = 0.0f;
  u32 fps = 0;
  bool paused = false;
};

struct RuntimeStats {
  f32 simulationMs = 0.0f;
  f32 physicsMs = 0.0f;
  u32 activeBodies = 0;
  u32 sleepingBodies = 0;
  u32 broadphasePairs = 0;
  u32 contacts = 0;
  u32 triggerEvents = 0;
  usize drawnObjects = 0;
  usize triangles = 0;
  usize culledObjects = 0;
  usize instancedBatches = 0;
  f32 fps = 0.0f;
};

class GameRuntime {
public:
  GameRuntime();
  ~GameRuntime();

  NF_NONCOPYABLE(GameRuntime)

  bool Initialize(const RuntimeConfig& config, std::string* error = nullptr);
  void Shutdown();

  // ---- play control (editor toolbar + game app)
  void StartPlay();
  void StopPlay();
  void Pause();
  void Resume();
  void TogglePause();
  void StepOnce(f32 deltaTime = 0.0f);
  bool IsPlaying() const { return playing_; }
  bool IsPaused() const { return paused_; }

  // Simulation tick. `rawDelta` is the real frame time; fixed stepping is handled here.
  void Tick(f32 rawDelta);

  // Camera view of the gameplay camera (used by the editor viewport and the game app).
  RenderView MakeGameView(f32 aspect) const;

  // Extraction + submission for the GPU renderer.
  void ExtractRenderScene(const RenderView& view, RenderScene& out, const RenderSettings& settings);
  // Editor camera view of the (non-simulated) scene.
  void ExtractEditorScene(const RenderView& view, RenderScene& out, const RenderSettings& settings);

  // Named Clock()/GameScene() so they do not shadow the Time/Scene type names.
  Time& Clock() { return time_; }
  const Time& Clock() const { return time_; }
  Scene& GameScene() { return *scene_; }
  PhysicsWorld& Physics() { return *physics_; }
  AudioSystem& Audio() { return *audio_; }
  AssetDatabase& Assets() { return *assets_; }
  RenderSettings& Settings() { return settings_; }
  const RenderSettings& Settings() const { return settings_; }
  GameRuntime* Runtime() { return this; }

  // ---- player helpers used by the HUD / interactions
  EntityId PlayerObject() const { return playerEntity_; }
  void SetPlayerObject(EntityId id) { playerEntity_ = id; }
  bool PlayerGrounded() const { return playerGrounded_; }
  void SetPlayerGrounded(bool grounded) { playerGrounded_ = grounded; }
  EntityId RuntimeCameraEntity() const { return runtimeCameraEntity_; }
  void SetRuntimeCameraEntity(EntityId id) { runtimeCameraEntity_ = id; }

  bool ConsumeInteractRequest();
  void RequestInteract() { interactRequested_ = true; }

  // ---- combat: the player swings at whatever is in front of them
  void RequestAttack() { attackRequested_ = true; }
  f32 AttackDamage() const { return attackDamage_; }
  void SetAttackDamage(f32 damage) { attackDamage_ = damage > 0.0f ? damage : 0.0f; }
  f32 AttackRange() const { return attackRange_; }
  void SetAttackRange(f32 range) { attackRange_ = range > 0.1f ? range : 0.1f; }
  f32 AttackInterval() const { return attackInterval_; }
  u32 AttackCount() const { return attackCount_; }
  EntityId LastAttackedEntity() const { return lastAttacked_; }

  // ---- HUD state (rendered by the host application)
  const RuntimeHud& Hud() const { return hud_; }
  void PushMessage(const std::string& text, int type = 0, f32 seconds = 3.0f);

  // ---- event stream (physics triggers, gameplay events, damage...)
  std::vector<std::string> ConsumeEvents();

  // ---- statistics
  const RuntimeStats& Stats() const { return stats_; }
  const ExtractionStats& LastExtraction() const { return lastExtraction_; }

  // Head-less verification: rasterise the current view on the CPU and write a PNG.
  bool SaveSoftwareFrame(const std::string& pngPath);
  const std::vector<u8>& SoftwareFramePixels() const { return softwarePixels_; }
  int SoftwareFrameWidth() const { return softwareWidth_; }
  int SoftwareFrameHeight() const { return softwareHeight_; }

  // Debug overlay sink (editor gizmos / AI patrol routes / collider wireframes).
  void SetDebugDraw(DebugDrawList* list) { debugDraw_ = list; }
  DebugDrawList* DebugDraw() { return debugDraw_; }

  // Loads a scene file relative to the project root ("" = start scene).
  bool LoadScene(const std::string& sceneRelativePath, std::string* error = nullptr);
  // Loads an in-memory scene document (used by editor Play mode so unsaved edits
  // are simulated by exactly the same runtime the exported game uses).
  bool LoadSceneDocument(const JsonValue& document, std::string* error = nullptr);
  // Serialises the live runtime scene (HUD/debug tools).
  JsonValue CurrentSceneDocument() const;
  bool SaveCurrentScene(std::string* error = nullptr);

  // Object bookkeeping helpers used by the editor and the AI assistant.
  EntityId SpawnObjectFromAsset(const std::string& assetPath, const Vec3& position);
  EntityId SpawnPrimitive(const std::string& primitive, const Vec3& position);

  // Applies project settings (resolution, vsync, quality...) to the runtime.
  void ApplyProjectSettings();

private:
  void UpdatePlayer(f32 dt);
  void PerformAttack();
  int SyncPhysicsBodies();
  void UpdateFixed(f32 dt);
  void ProcessRuntimeEvents();
  void UpdateHud(f32 dt);
  void EnsurePlayerCamera();
  void DestroyRuntimeObjects();

  RuntimeConfig config_;
  Time time_;
  std::unique_ptr<Scene> scene_;
  std::unique_ptr<PhysicsWorld> physics_;
  std::unique_ptr<AudioSystem> audio_;
  std::unique_ptr<AssetDatabase> assets_;
  RenderSettings settings_;

  bool playing_ = false;
  bool paused_ = false;
  bool stepRequested_ = false;
  bool interactRequested_ = false;
  bool playerGrounded_ = false;
  bool initialized_ = false;

  EntityId playerEntity_ = 0;
  EntityId runtimeCameraEntity_ = 0;
  f32 fixedAccumulator_ = 0.0f;
  f32 cameraYaw_ = 0.0f;
  f32 cameraPitch_ = 12.0f;
  f32 thirdPersonDistance_ = 5.0f;

  RuntimeHud hud_;
  RuntimeStats stats_;
  ExtractionStats lastExtraction_;
  std::vector<std::string> pendingEvents_;
  DebugDrawList* debugDraw_ = nullptr;

  // combat state
  bool attackRequested_ = false;
  u32 attackCount_ = 0;
  f32 attackDamage_ = 22.0f;
  f32 attackRange_ = 2.6f;
  f32 attackInterval_ = 0.45f;
  f32 attackCooldownTimer_ = 0.0f;
  EntityId lastAttacked_ = 0;

  // player controller state
  PlayerController::State playerState_;

  std::vector<u8> softwarePixels_;
  int softwareWidth_ = 0;
  int softwareHeight_ = 0;
  std::string scratch_;
};

} // namespace nf
