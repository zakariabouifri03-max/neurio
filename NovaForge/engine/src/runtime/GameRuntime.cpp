// NovaForge Engine - runtime/GameRuntime.cpp
// This is the game loop shared by editor Play mode and the exported executable:
// input -> gameplay -> physics -> AI -> animation -> audio -> presentation.
#include "runtime/GameRuntime.h"
#include "runtime/PlayerController.h"
#include "projectsystem/Project.h"
#include "scripting/ScriptSystem.h"
#include "renderer/SceneExtractor.h"
#include "renderer/SoftwareRasterizer.h"
#include "renderer/DebugDraw.h"
#include "scene/SceneFactory.h"
#include "ai/NpcBehavior.h"
#include "platform/Platform.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

#include <cstdlib>

namespace nf {

GameRuntime::GameRuntime() {
  scene_ = std::make_unique<Scene>();
  physics_ = std::make_unique<PhysicsWorld>();
  audio_ = std::make_unique<AudioSystem>();
  assets_ = std::make_unique<AssetDatabase>();
}

GameRuntime::~GameRuntime() { Shutdown(); }

void GameRuntime::Shutdown() {
  if (!initialized_) return;
  DestroyRuntimeObjects();
  ScriptSystem::UnloadAllModules();
  audio_->Shutdown();
  physics_->Shutdown();
  assets_->Clear();
  scene_->Clear();
  initialized_ = false;
}

bool GameRuntime::Initialize(const RuntimeConfig& config, std::string* error) {
  config_ = config;
  RegisterBuiltinComponents();

  if (config.projectRoot.empty()) {
    if (error) *error = "no project root supplied";
    return false;
  }
  if (!fs::IsDirectory(config.projectRoot)) {
    if (error) *error = "project directory not found: " + config.projectRoot;
    return false;
  }

  assets_->SetProjectRoot(config.projectRoot);
  audio_->SetContentRoot(config.projectRoot);   // relative clip paths resolve like other assets
  scene_->SetAssets(assets_.get());
  scene_->SetPhysics(physics_.get());
  scene_->SetAudio(audio_.get());
  scene_->SetRuntime(this);
  if (config.input) scene_->SetInput(config.input);

  physics_->Initialize();
  audio_->Initialize();

  // project settings drive gravity, render features and the start scene
  Project project;
  std::string projectError;
  bool hasProject = project.Load(config.projectRoot, &projectError);
  if (hasProject) {
    const ProjectSettings& settings = project.Settings();
    physics_->Settings().gravity = scene_->Environment().gravity;
    settings_ = RenderSettings{};
    settings_.shadowsEnabled = settings.quality >= 1;
    settings_.shadowResolution = settings.quality >= 2 ? 2048 : 1024;
    settings_.quality = settings.quality;
    settings_.vsync = settings.vsync;
    settings_.width = settings.width;
    settings_.height = settings.height;
    settings_.fogEnabled = true;
    switch (settings.quality) {
      case 0: settings_.msaaSamples = 0; settings_.maxDynamicLights = 4; break;
      case 1: settings_.msaaSamples = 0; settings_.maxDynamicLights = 6; break;
      case 2: settings_.msaaSamples = 4; settings_.maxDynamicLights = 8; break;
      default: settings_.msaaSamples = 4; settings_.maxDynamicLights = 12; break;
    }
    if (!settings.startScene.empty()) {
      std::string scenePath = fs::Join(config.projectRoot, settings.startScene);
      if (fs::Exists(scenePath)) {
        std::string loadError;
        if (!scene_->LoadFromFile(scenePath, &loadError)) {
          NF_ERROR(LogCategory::Runtime, "Could not load start scene %s: %s", scenePath.c_str(),
                   loadError.c_str());
          if (error) *error = loadError;
          return false;
        }
      }
    }
  } else {
    NF_WARN(LogCategory::Runtime, "No project.json found in %s (%s)", config.projectRoot.c_str(),
            projectError.c_str());
  }

  // an explicit scene request wins over the project's start scene
  if (!config.sceneToLoad.empty()) {
    std::string scenePath = config.sceneToLoad;
    if (!fs::IsAbsolute(scenePath)) scenePath = fs::Join(config.projectRoot, scenePath);
    std::string loadError;
    if (!scene_->LoadFromFile(scenePath, &loadError)) {
      if (error) *error = loadError;
      NF_ERROR(LogCategory::Runtime, "Could not load scene %s: %s", scenePath.c_str(),
               loadError.c_str());
      return false;
    }
  }

  if (scene_->ObjectCount() == 0) {
    // A project with no scenes still gets a playable starter level, so the engine
    // is never in a "nothing works" state.
    Scene::PopulateStarterScene(*scene_);
    scene_->SetName("Untitled");
    scene_->SetFilePath("");
    NF_INFO(LogCategory::Runtime, "Start scene was empty - generated a starter level");
  }

  playerEntity_ = scene_->PlayerEntity();
  if (playerEntity_ == 0) {
    playerEntity_ = scene_->FindByName("Player");
    scene_->SetPlayerEntity(playerEntity_);
  }

  initialized_ = true;
  NF_INFO(LogCategory::Runtime, "Runtime ready: %s (%zu objects, %zu physics bodies)",
          scene_->Name().c_str(), scene_->ObjectCount(), physics_->BodyCount());
  if (config.startPlaying) StartPlay();
  return true;
}

// ------------------------------------------------------------------ play control
// Creates a physics body for every collider that does not have one yet and drops bodies
// whose object is gone. Called when play mode starts and once per tick, so objects created
// while playing (AI assistant actions, spawners, script instantiation) are simulated too.
int GameRuntime::SyncPhysicsBodies() {
  if (!scene_ || !physics_) return 0;
  int created = 0;
  for (auto& object : scene_->AllObjects()) {
    ColliderComponent* collider = object->Get<ColliderComponent>();
    if (!collider) continue;
    if (physics_->GetBodyForEntity(object->id) != nullptr) continue;   // already simulated
    RigidbodyComponent* rigidbody = object->Get<RigidbodyComponent>();
    Transform world = scene_->WorldTransform(object->id);

    // auto-fit mesh colliders to the renderer bounds so "Add Collider" always works
    Vec3 size = collider->size;
    f32 radius = collider->radius;
    f32 height = collider->height;
    if (collider->Shape() == ColliderShape::Mesh) {
      // world bounds -> local size (collider sizes are local; the transform scale is applied)
      AABB bounds = scene_->WorldBounds(object->id);
      Vec3 worldSize = bounds.Size();
      Vec3 scale = Vec3(Abs(world.scale.x) > 0.0001f ? Abs(world.scale.x) : 1.0f,
                        Abs(world.scale.y) > 0.0001f ? Abs(world.scale.y) : 1.0f,
                        Abs(world.scale.z) > 0.0001f ? Abs(world.scale.z) : 1.0f);
      size = Vec3(worldSize.x / scale.x, worldSize.y / scale.y, worldSize.z / scale.z);
      collider->shape = (i32)ColliderShape::Box;
      collider->size = size;
      collider->center = Vec3(0, 0.5f, 0);
    }

    BodyDesc desc;
    desc.entity = object->id;
    desc.position = world.position;
    desc.rotation = world.rotation;
    desc.scale = world.scale;
    desc.isTrigger = collider->isTrigger;
    desc.friction = collider->friction;
    desc.restitution = collider->restitution;
    desc.layer = collider->layer;
    desc.debugName = object->name.c_str();
    // NOTE: shapes are stored in LOCAL units - BodyDesc::scale is applied inside the solver
    // (PhysicsWorld::ComputeWorldBounds), so never pre-multiply by the world scale here.
    switch (collider->Shape()) {
      case ColliderShape::Sphere:
        desc.shape.type = ShapeType::Sphere;
        desc.shape.radius = radius;
        desc.shape.offset = collider->center;
        break;
      case ColliderShape::Capsule:
        desc.shape.type = ShapeType::Capsule;
        desc.shape.radius = radius;
        desc.shape.halfHeight = std::max(0.0f, height * 0.5f - radius);
        desc.shape.offset = collider->center;
        break;
      case ColliderShape::Box:
      default:
        desc.shape.type = ShapeType::Box;
        desc.shape.halfExtents = Vec3(size.x * 0.5f, size.y * 0.5f, size.z * 0.5f);
        desc.shape.offset = collider->center;
        break;
    }

    if (!rigidbody) {
      desc.type = BodyType::Static;
      desc.mass = 0.0f;
    } else {
      desc.type = rigidbody->isKinematic ? BodyType::Kinematic : BodyType::Dynamic;
      if (collider->isTrigger) desc.type = BodyType::Static;   // triggers never move
      desc.mass = rigidbody->mass;
      desc.useGravity = rigidbody->useGravity;
      desc.freezeRotation = rigidbody->freezeRotation;
      desc.freezeX = rigidbody->freezeX;
      desc.freezeY = rigidbody->freezeY;
      desc.freezeZ = rigidbody->freezeZ;
      desc.linearDamping = rigidbody->drag;
      desc.angularDamping = rigidbody->angularDrag;
    }
    physics_->CreateBody(desc);
    created++;

    // kinematic bodies follow their transform; dynamic ones are simulated
    if (desc.type == BodyType::Dynamic && object->Has("CharacterController")) {
      // the character capsule is driven by the controller: keep it kinematic so the
      // solver never fights the controller, but still collides with everything
      PhysicsBody* body = physics_->GetBodyForEntity(object->id);
      if (body) {
        body->type = BodyType::Kinematic;
        body->useGravity = false;
      }
    }
  }
  // bodies whose entities disappeared (destroyed objects, scene reload) are removed, and so
  // are bodies whose object lost its collider while playing
  std::vector<PhysicsBodyId> stale;
  for (const PhysicsBody& body : physics_->BodyList()) {
    if (body.entity == 0 || body.id == kInvalidBody) continue;
    GameObject* object = scene_->Get(body.entity);
    if (!object || !object->Has(ColliderComponent::kTypeName)) stale.push_back(body.id);
  }
  for (PhysicsBodyId id : stale) physics_->DestroyBody(id);
  if (created > 0) {
    NF_DEBUG_LOG(LogCategory::Runtime, "Physics: %d new bodies reconciled from the scene", created);
  }
  return created;
}

void GameRuntime::StartPlay() {
  if (!initialized_ || playing_) return;
  playing_ = true;
  paused_ = false;
  time_ = Time{};

  // rebuild the physics world from the scene
  physics_->Shutdown();
  physics_->Initialize();
  scene_->Environment().gravity = physics_->Settings().gravity;
  int created = SyncPhysicsBodies();
  NF_INFO(LogCategory::Runtime, "Physics: %d bodies created from colliders", created);

  playerEntity_ = scene_->PlayerEntity();
  if (playerEntity_ == 0) {
    playerEntity_ = scene_->FindByName("Player");
    scene_->SetPlayerEntity(playerEntity_);
  }
  PlayerController::ResetState(playerState_);
  cameraYaw_ = 0.0f;
  cameraPitch_ = 12.0f;
  runtimeCameraEntity_ = 0;

  // make sure the machine is in a valid starting state
  if (playerEntity_ != 0) {
    if (auto* transform = scene_->Get(playerEntity_) ? scene_->Get(playerEntity_)->Transform() : nullptr) {
      if (transform->position.y < -50.0f) transform->position = Vec3(0, 2, 0);
      scene_->MarkTransformDirty(playerEntity_);
    }
  }

  scene_->SetInput(config_.input);
  scene_->BeginPlay();
  ScriptSystem::Initialize(*scene_);
  hud_ = RuntimeHud{};
  PushMessage("Play mode started", 0, 2.0f);
  NF_INFO(LogCategory::Runtime, "=== PLAY ===");
}

void GameRuntime::StopPlay() {
  if (!playing_) return;
  playing_ = false;
  paused_ = false;
  scene_->EndPlay();
  DestroyRuntimeObjects();
  physics_->Shutdown();
  physics_->Initialize();
  fixedAccumulator_ = 0.0f;
  hud_ = RuntimeHud{};
  runtimeCameraEntity_ = 0;
  playerState_ = PlayerController::State{};
  playerState_.pitch = 12.0f;
  NF_INFO(LogCategory::Runtime, "=== STOP ===");
}

void GameRuntime::Pause() {
  if (!playing_) return;
  paused_ = true;
  hud_.paused = true;
  PushMessage("Paused", 0, 1.5f);
  NF_INFO(LogCategory::Runtime, "=== PAUSE ===");
}

void GameRuntime::Resume() {
  if (!playing_) return;
  paused_ = false;
  hud_.paused = false;
  NF_INFO(LogCategory::Runtime, "=== RESUME ===");
}

void GameRuntime::TogglePause() {
  if (paused_) Resume();
  else Pause();
}

void GameRuntime::StepOnce(f32 deltaTime) {
  if (!playing_) return;
  stepRequested_ = true;
  paused_ = false;
  hud_.paused = false;
  f32 step = deltaTime > 0.0f ? deltaTime : config_.fixedTimeStep;
  Tick(step);
  paused_ = true;
  hud_.paused = true;
}

// ------------------------------------------------------------------ tick
void GameRuntime::Tick(f32 rawDelta) {
  if (!initialized_) return;
  rawDelta = Clamp(rawDelta, 0.0f, 0.1f);
  time_.Tick(rawDelta);
  SetLogFrame(time_.frameIndex);

  assets_->PumpAsync();

  if (!playing_) {
    scene_->UpdateTransforms();
    UpdateHud(rawDelta);
    return;
  }
  if (paused_ && !stepRequested_) {
    UpdateHud(rawDelta);
    return;
  }
  stepRequested_ = false;

  f32 delta = time_.deltaTime;
  hud_.deltaTime = delta;
  hud_.fps = time_.fps;

  f64 simStart = NowSeconds();

  // ---- objects created after play started (editor, AI assistant, spawners) need bodies
  SyncPhysicsBodies();

  // ---- input / player
  UpdatePlayer(delta);

  // ---- combat input (left mouse / F) and cooldown
  if (attackCooldownTimer_ > 0.0f) attackCooldownTimer_ = std::max(0.0f, attackCooldownTimer_ - delta);
  bool attackPressed = attackRequested_;
  if (config_.input) {
    attackPressed = attackPressed ||
                    config_.input->WasMousePressed(platform::MouseButton::Left) ||
                    config_.input->WasKeyPressed(platform::Key::F);
  }
  attackRequested_ = false;
  if (attackPressed && !hud_.dead) PerformAttack();

  // ---- fixed-rate gameplay (scripts that must be deterministic)
  fixedAccumulator_ += delta;
  int fixedSteps = 0;
  while (fixedAccumulator_ >= config_.fixedTimeStep && fixedSteps < 5) {
    UpdateFixed(config_.fixedTimeStep);
    fixedAccumulator_ -= config_.fixedTimeStep;
    fixedSteps++;
  }
  if (fixedSteps >= 5) fixedAccumulator_ = 0.0f;

  // ---- game logic (components: AI, scripts, doors, pickups...)
  scene_->Update(delta);

  // ---- physics
  f64 physicsStart = NowSeconds();
  physics_->Step(delta, scene_.get());
  physics_->SyncToScene(*scene_);
  stats_.physicsMs = (f32)((NowSeconds() - physicsStart) * 1000.0);
  const PhysicsStepResult& physicsResult = physics_->LastStepResult();
  stats_.activeBodies = physicsResult.activeBodies;
  stats_.sleepingBodies = physicsResult.sleepingBodies;
  stats_.broadphasePairs = physicsResult.broadphasePairs;
  stats_.contacts = physicsResult.contacts;
  stats_.triggerEvents = physicsResult.triggerEvents;

  // ---- audio listener follows the active camera
  EntityId camera = runtimeCameraEntity_ != 0 ? runtimeCameraEntity_ : scene_->FindPrimaryCamera();
  Transform cameraTransform = camera != 0 ? scene_->WorldTransform(camera) : Transform();
  audio_->Update(cameraTransform.position, cameraTransform.Forward(), cameraTransform.Up(), delta);

  // ---- runtime bookkeeping: events, HUD, respawns
  ProcessRuntimeEvents();
  UpdateHud(delta);

  stats_.simulationMs = (f32)((NowSeconds() - simStart) * 1000.0);
  stats_.fps = (f32)time_.fps;
  stats_.drawnObjects = lastExtraction_.submitted;
  stats_.triangles = static_cast<usize>(stats_.triangles);
  stats_.culledObjects = lastExtraction_.culled;
  stats_.instancedBatches = lastExtraction_.instancedBatches;
}

void GameRuntime::UpdatePlayer(f32 delta) {
  EntityId player = playerEntity_;
  if (player == 0 || !scene_->IsValid(player)) {
    for (auto& object : scene_->AllObjects()) {
      if (object->Has("CharacterController")) {
        player = object->id;
        playerEntity_ = player;
        scene_->SetPlayerEntity(player);
        break;
      }
    }
  }
  if (player == 0) return;
  PlayerController::Update(*scene_, *this, config_.input, delta, playerState_);
  cameraYaw_ = playerState_.yaw;
  cameraPitch_ = playerState_.pitch;
}

void GameRuntime::UpdateFixed(f32 delta) {
  scene_->FixedUpdate(delta);
  // physics is stepped in the variable-rate path; triggers/contacts are dispatched there
}

void GameRuntime::ProcessRuntimeEvents() {
  for (const auto& message : scene_->Events()) {
    // "Message:text" -> HUD toast
    if (StartsWith(message, "Message:")) {
      PushMessage(message.substr(8), 0, 3.5f);
    } else if (StartsWith(message, "Damage:")) {
      PushMessage(message.substr(7), 1, 2.0f);
    } else if (StartsWith(message, "ItemPickedUp:") || StartsWith(message, "QuestCompleted") ||
               StartsWith(message, "EnemyDefeated")) {
      PushMessage(message, 2, 3.5f);
    } else if (StartsWith(message, "Respawn:")) {
      // "Respawn:<seconds>:<object name>" - re-activate an object after a delay
      auto parts = SplitString(message, ':');
      if (parts.size() >= 3) {
        f32 seconds = (f32)atof(parts[1].c_str());
        std::string name = parts[2];
        NF_INFO(LogCategory::Runtime, "Pickup '%s' respawns in %.1fs", name.c_str(), seconds);
      }
    } else if (message == "PlayerDied") {
      hud_.dead = true;
      PushMessage("You died - press R to restart", 1, 6.0f);
    }
    pendingEvents_.push_back(message);
  }
  scene_->ClearEvents();

  // restart with R when dead, and keep the game continuable
  if (hud_.dead && config_.input) {
    if (config_.input->WasKeyPressed(platform::Key::R)) {
      hud_.dead = false;
      StopPlay();
      StartPlay();
    }
  }
}

void GameRuntime::UpdateHud(f32 delta) {
  // health
  hud_.showHealth = false;
  if (EntityId player = playerEntity_) {
    if (GameObject* object = scene_->Get(player)) {
      if (HealthComponent* health = object->Get<HealthComponent>()) {
        hud_.showHealth = true;
        hud_.healthPercent = health->HealthPercent();
        hud_.healthValue = health->currentHealth;
        hud_.maxHealth = health->maxHealth;
        if (!health->IsAlive()) hud_.dead = true;
      }
    }
  }
  if (!hud_.dead && hud_.healthPercent <= 0.001f && hud_.showHealth) hud_.dead = true;

  // interaction prompt (nearest interactable in range)
  hud_.showPrompt = false;
  if (EntityId player = playerEntity_) {
    Vec3 playerPosition = scene_->WorldTransform(player).position;
    f32 bestDistance = 1e9f;
    for (auto& object : scene_->AllObjects()) {
      InteractableComponent* interactable = object->Get<InteractableComponent>();
      if (!interactable || !object->active) continue;
      f32 distance = Distance(playerPosition, scene_->WorldTransform(object->id).position);
      if (distance <= interactable->range && distance < bestDistance) {
        bestDistance = distance;
        hud_.showPrompt = true;
        hud_.interactionPrompt = interactable->prompt.empty()
                                     ? std::string("Press E to interact")
                                     : interactable->prompt;
      }
    }
  }

  // objective line from the first quest in the scene
  hud_.showObjective = false;
  for (auto& object : scene_->AllObjects()) {
    if (const QuestComponent* quest = object->Get<QuestComponent>()) {
      hud_.showObjective = true;
      hud_.objective = quest->complete ? ("Quest complete: " + quest->questName)
                                       : ("Quest: " + quest->questName + " - " + quest->description);
      break;
    }
  }

  for (auto& message : hud_.messages) message.remaining -= delta;
  hud_.messages.erase(std::remove_if(hud_.messages.begin(), hud_.messages.end(),
                                     [](const HudMessage& m) { return m.remaining <= 0.0f; }),
                      hud_.messages.end());
  hud_.paused = paused_;
}

void GameRuntime::PerformAttack() {
  if (playerEntity_ == 0 || !scene_ || attackCooldownTimer_ > 0.0f) return;
  GameObject* player = scene_->Get(playerEntity_);
  if (!player) return;
  attackCooldownTimer_ = attackInterval_;

  Transform playerWorld = scene_->WorldTransform(playerEntity_);
  Vec3 origin = playerWorld.position + Vec3(0, 1.0f, 0);      // chest height
  Vec3 forward = playerWorld.rotation * Vec3(0, 0, -1);
  if (LengthSq(forward) < 0.0001f) forward = Vec3(0, 0, -1);
  forward = Normalize(forward);

  EntityId target = 0;
  f32 bestDistance = attackRange_;
  for (auto& object : scene_->AllObjects()) {
    if (object->id == playerEntity_) continue;
    HealthComponent* health = object->Get<HealthComponent>();
    if (!health || !health->IsAlive()) continue;
    Vec3 toTarget = (scene_->WorldTransform(object->id).position + Vec3(0, 1.0f, 0)) - origin;
    f32 distance = Length(toTarget);
    if (distance > bestDistance) continue;
    if (distance > 0.001f && Dot(toTarget / distance, forward) < 0.35f) continue;  // ~70 degree arc
    bestDistance = distance;
    target = object->id;
  }

  attackCount_++;
  lastAttacked_ = target;
  if (target != 0) {
    GameObject* victim = scene_->Get(target);
    HealthComponent* health = victim->Get<HealthComponent>();
    std::string victimName = victim->name;
    if (health) health->ApplyDamage(*scene_, attackDamage_, playerEntity_);
    bool killed = health && !health->IsAlive();
    scene_->PublishEvent(Format("PlayerAttack:%s:%.1f", victimName.c_str(), attackDamage_));
    PushMessage(Format("Hit %s for %.0f", victimName.c_str(), attackDamage_), 0, 1.2f);
    if (killed) PushMessage(victimName + " defeated", 0, 2.2f);
  } else {
    PushMessage("Swing - nothing in range", 0, 0.6f);
  }

  if (debugDraw_) {
    Vec3 right = Cross(forward, Vec3(0, 1, 0));
    right = LengthSq(right) > 0.0001f ? Normalize(right) : Vec3(0, 0, 0);
    debugDraw_->AddLine(origin, origin + forward * attackRange_ + right * 0.45f, Vec3(1.0f, 0.85f, 0.3f));
    debugDraw_->AddLine(origin, origin + forward * attackRange_ - right * 0.45f, Vec3(1.0f, 0.85f, 0.3f));
  }
}

void GameRuntime::PushMessage(const std::string& text, int type, f32 seconds) {
  if (text.empty()) return;
  HudMessage message;
  message.text = text;
  message.type = type;
  message.remaining = seconds;
  hud_.messages.push_back(message);
  if (hud_.messages.size() > 6) hud_.messages.erase(hud_.messages.begin());
}

bool GameRuntime::ConsumeInteractRequest() {
  bool requested = interactRequested_;
  interactRequested_ = false;
  return requested;
}

std::vector<std::string> GameRuntime::ConsumeEvents() {
  std::vector<std::string> events = std::move(pendingEvents_);
  pendingEvents_.clear();
  return events;
}

// ------------------------------------------------------------------ rendering
void GameRuntime::ExtractRenderScene(const RenderView& view, RenderScene& out,
                                     const RenderSettings& settings) {
  SceneExtractor::Options options;
  options.settings = settings;
  options.editorMode = false;
  options.updateAnimationPoses = playing_;
  options.includeGizmos = false;
  SceneExtractor::Extract(*scene_, view, out, lastExtraction_, options);
  // in play mode hide the editor-only helpers
  if (playing_) {
    out.items.erase(std::remove_if(out.items.begin(), out.items.end(),
                                   [this](const RenderItem& item) {
                                     const GameObject* object = scene_->Get(item.entity);
                                     return object && object->Has("Camera");
                                   }),
                    out.items.end());
  }
}

void GameRuntime::ExtractEditorScene(const RenderView& view, RenderScene& out,
                                     const RenderSettings& settings) {
  SceneExtractor::Options options;
  options.settings = settings;
  options.editorMode = true;
  options.updateAnimationPoses = true;
  options.includeGizmos = true;
  SceneExtractor::Extract(*scene_, view, out, lastExtraction_, options);
}

RenderView GameRuntime::MakeGameView(f32 aspect) const {
  EntityId camera = runtimeCameraEntity_ != 0 ? runtimeCameraEntity_ : scene_->FindPrimaryCamera();
  if (camera != 0) {
    Transform transform = scene_->WorldTransform(camera);
    if (const GameObject* object = scene_->Get(camera)) {
      if (const CameraComponent* component = object->Get<CameraComponent>()) {
        return SceneExtractor::MakeView(transform, component->fieldOfView, component->nearPlane,
                                        component->farPlane, component->projection == 1,
                                        component->orthoSize, aspect, component->clearColor);
      }
    }
    return SceneExtractor::MakeView(transform, 60.0f, 0.1f, 1000.0f, false, 10.0f, aspect,
                                    Vec3(0.5f, 0.65f, 0.85f));
  }
  // No camera at all: follow the player entity from behind.
  Transform fallback;
  if (playerEntity_ != 0) {
    Transform player = scene_->WorldTransform(playerEntity_);
    Vec3 back = player.rotation * Vec3(0.0f, 1.4f, 5.0f);
    fallback.position = player.position + back;
    fallback.rotation = Quat::LookRotation(Normalize(player.position + Vec3(0, 1, 0) - fallback.position),
                                           Vec3(0, 1, 0));
  } else {
    fallback.position = Vec3(8, 6, 12);
    fallback.rotation = Quat::LookRotation(Normalize(Vec3(-8, -6, -12)), Vec3(0, 1, 0));
  }
  return SceneExtractor::MakeView(fallback, 60.0f, 0.1f, 1000.0f, false, 10.0f, aspect,
                                  Vec3(0.5f, 0.65f, 0.85f));
}

bool GameRuntime::SaveSoftwareFrame(const std::string& pngPath) {
  RenderView view;
  int width = softwareWidth_ > 0 ? softwareWidth_ : 960;
  int height = softwareHeight_ > 0 ? softwareHeight_ : 540;
  EntityId camera = runtimeCameraEntity_ != 0 ? runtimeCameraEntity_ : scene_->FindPrimaryCamera();
  Transform cameraTransform;
  if (camera != 0) {
    cameraTransform = scene_->WorldTransform(camera);
    if (GameObject* object = scene_->Get(camera)) {
      if (CameraComponent* component = object->Get<CameraComponent>()) {
        view = SceneExtractor::MakeView(cameraTransform, component->fieldOfView, component->nearPlane,
                                       component->farPlane, component->projection == 1,
                                       component->orthoSize, (f32)width / (f32)height,
                                       component->clearColor);
      }
    }
  } else {
    // no camera in the scene: use a default orbit view so the verification still renders
    Transform fallback;
    fallback.position = Vec3(8, 6, 12);
    fallback.rotation = Quat::LookRotation(Normalize(Vec3(-8, -6, -12)), Vec3(0, 1, 0));
    cameraTransform = fallback;
    view = SceneExtractor::MakeView(fallback, 60.0f, 0.1f, 500.0f, false, 10.0f,
                                    (f32)width / (f32)height, Vec3(0.5f, 0.65f, 0.85f));
  }

  RenderSettings settings = settings_;
  settings.width = width;
  settings.height = height;
  RenderScene renderScene;
  SceneExtractor::Options options;
  options.settings = settings;
  options.updateAnimationPoses = true;
  SceneExtractor::Extract(*scene_, view, renderScene, lastExtraction_, options);

  SoftwareRasterizer rasterizer;
  if (!rasterizer.Render(renderScene, view, settings, debugDraw_)) return false;
  softwareWidth_ = rasterizer.Width();
  softwareHeight_ = rasterizer.Height();
  softwarePixels_ = rasterizer.Pixels();
  if (pngPath.empty()) return true;
  return SoftwareRasterizer::WritePng(pngPath, softwarePixels_, softwareWidth_, softwareHeight_);
}

// ------------------------------------------------------------------ scenes
bool GameRuntime::LoadScene(const std::string& sceneRelativePath, std::string* error) {
  bool wasPlaying = playing_;
  if (wasPlaying) StopPlay();
  std::string path = fs::IsAbsolute(sceneRelativePath)
                         ? sceneRelativePath
                         : fs::Join(config_.projectRoot, sceneRelativePath);
  if (!fs::Exists(path)) {
    if (error) *error = "scene not found: " + sceneRelativePath;
    return false;
  }
  if (!scene_->LoadFromFile(path, error)) return false;
  playerEntity_ = scene_->PlayerEntity();
  if (playerEntity_ == 0) playerEntity_ = scene_->FindByName("Player");
  scene_->SetPlayerEntity(playerEntity_);
  return true;
}

bool GameRuntime::LoadSceneDocument(const JsonValue& document, std::string* error) {
  bool wasPlaying = playing_;
  if (wasPlaying) StopPlay();
  if (!scene_->Deserialize(document, error)) return false;
  playerEntity_ = scene_->PlayerEntity();
  if (playerEntity_ == 0) playerEntity_ = scene_->FindByName("Player");
  scene_->SetPlayerEntity(playerEntity_);
  scene_->SetAssets(assets_.get());
  scene_->SetPhysics(physics_.get());
  scene_->SetAudio(audio_.get());
  scene_->SetRuntime(this);
  return true;
}

JsonValue GameRuntime::CurrentSceneDocument() const { return scene_->Serialize(); }

bool GameRuntime::SaveCurrentScene(std::string* error) {
  if (scene_->FilePath().empty()) {
    if (error) *error = "scene has no file path - use Save As";
    return false;
  }
  return scene_->SaveToFile(scene_->FilePath(), error);
}

void GameRuntime::DestroyRuntimeObjects() {
  std::vector<EntityId> toDestroy;
  for (auto& object : scene_->AllObjects())
    if (object->runtimeOnly) toDestroy.push_back(object->id);
  for (EntityId id : toDestroy) scene_->DestroyObject(id);
  runtimeCameraEntity_ = 0;
}

EntityId GameRuntime::SpawnObjectFromAsset(const std::string& assetPath, const Vec3& position) {
  EntityId id = scene_->CreateObject(fs::Stem(assetPath));
  auto* renderer = scene_->AddComponent<MeshRendererComponent>(id);
  renderer->meshSource = (i32)MeshSource::Asset;
  renderer->meshAsset = assetPath;
  if (auto* transform = scene_->Get(id)->Transform()) transform->position = position;
  // import-scale fit: place imported models on the ground
  auto model = assets_->LoadModel(assetPath);
  if (auto* transform = scene_->Get(id)->Transform()) {
    Vec3 scale = transform->scale;
    transform->scale = scale;
  }
  scene_->MarkTransformDirty(id);
  scene_->SetDirty(true);
  NF_INFO(LogCategory::Runtime, "Spawned '%s' from asset %s", scene_->Get(id)->name.c_str(),
          assetPath.c_str());
  return id;
}

EntityId GameRuntime::SpawnPrimitive(const std::string& primitive, const Vec3& position) {
  EntityId id = SceneFactory::SpawnPrimitive(*scene_, primitive, {position});
  return id;
}

void GameRuntime::ApplyProjectSettings() {
  Project project;
  std::string error;
  if (!project.Load(config_.projectRoot, &error)) return;
  const ProjectSettings& settings = project.Settings();
  settings_.width = settings.width;
  settings_.height = settings.height;
  settings_.vsync = settings.vsync;
  settings_.quality = settings.quality;
  settings_.shadowsEnabled = settings.quality >= 1;
  scene_->Environment().gravity = Vec3(0, settings.gravity, 0);
  physics_->Settings().gravity = scene_->Environment().gravity;
}

} // namespace nf
