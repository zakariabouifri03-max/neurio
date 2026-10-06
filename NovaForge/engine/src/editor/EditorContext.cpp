// NovaForge Engine - editor/EditorContext.cpp
#include "editor/EditorContext.h"
#include "buildsystem/BuildSystem.h"
#include "scripting/ScriptSystem.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"
#include "core/Time.h"
#include "platform/Platform.h"

#include <thread>

namespace nf {

const char* GizmoModeName(GizmoMode mode) {
  switch (mode) {
    case GizmoMode::Translate: return "Move";
    case GizmoMode::Rotate: return "Rotate";
    case GizmoMode::Scale: return "Scale";
  }
  return "Move";
}

const char* TransformSpaceName(TransformSpace space) {
  return space == TransformSpace::World ? "World" : "Local";
}

std::string AbsoluteAssetPath(const Project& project, const std::string& projectRelative) {
  if (projectRelative.empty()) return {};
  if (fs::IsAbsolute(projectRelative)) return projectRelative;
  return fs::Join(project.RootPath(), projectRelative);
}

// ------------------------------------------------------------------ helpers
Vec3 EditorContext::SelectionCenter() const {
  if (selection.empty()) return cameraTarget;
  Vec3 sum(0, 0, 0);
  int count = 0;
  for (EntityId id : selection) {
    if (!scene.IsValid(id)) continue;
    sum = sum + scene.WorldTransform(id).position;
    count++;
  }
  return count > 0 ? sum / (f32)count : cameraTarget;
}

AABB EditorContext::SelectionBounds() const {
  AABB bounds;
  bool first = true;
  for (EntityId id : selection) {
    if (!scene.IsValid(id)) continue;
    AABB b = scene.WorldBounds(id);
    if (first) {
      bounds = b;
      first = false;
    } else {
      bounds.min = Min(bounds.min, b.min);
      bounds.max = Max(bounds.max, b.max);
    }
  }
  if (first) {
    Vec3 center = SelectionCenter();
    bounds.min = center - Vec3(0.5f);
    bounds.max = center + Vec3(0.5f);
  }
  return bounds;
}

void EditorContext::Status(const std::string& message, f32 seconds) {
  statusMessage = message;
  statusTimer = seconds;
}

bool EditorContext::IsSelected(EntityId id) const {
  for (EntityId selected : selection)
    if (selected == id) return true;
  return false;
}

void EditorContext::Select(EntityId id, bool additive) {
  if (id == 0) {
    if (!additive) Deselect();
    return;
  }
  if (!additive) {
    selection.clear();
    selection.push_back(id);
    active = id;
    return;
  }
  for (usize i = 0; i < selection.size(); i++) {
    if (selection[i] == id) {
      selection.erase(selection.begin() + (long)i);
      if (active == id) active = selection.empty() ? 0 : selection.front();
      return;
    }
  }
  selection.push_back(id);
  active = id;
}

void EditorContext::SelectMany(const std::vector<EntityId>& ids) {
  selection = ids;
  active = ids.empty() ? 0 : ids.front();
}

void EditorContext::Deselect() {
  selection.clear();
  active = 0;
}

void EditorContext::SelectAll() {
  selection = scene.ObjectIds();
  active = selection.empty() ? 0 : selection.front();
}

// ------------------------------------------------------------------- undo
void EditorContext::BeginEdit(const std::string& label) {
  if (editInProgress) {
    // nested edits are merged into the outer one
    if (pendingUndoLabel.empty()) pendingUndoLabel = label;
    return;
  }
  pendingUndoLabel = label;
  pendingUndoBefore = scene.Serialize().Dump(-1);
  editInProgress = true;
}

void EditorContext::EndEdit() {
  if (!editInProgress) return;
  editInProgress = false;
  std::string after = scene.Serialize().Dump(-1);
  if (after == pendingUndoBefore) {
    pendingUndoLabel.clear();
    pendingUndoBefore.clear();
    return;
  }
  UndoEntry entry;
  entry.label = pendingUndoLabel.empty() ? "Edit" : pendingUndoLabel;
  entry.before = pendingUndoBefore;
  entry.after = after;
  undoStack.push_back(entry);
  if (undoStack.size() > maxUndoSteps) undoStack.erase(undoStack.begin());
  redoStack.clear();
  pendingUndoLabel.clear();
  pendingUndoBefore.clear();
  scene.SetDirty(true);
}

void EditorContext::CancelEdit() {
  editInProgress = false;
  pendingUndoLabel.clear();
  pendingUndoBefore.clear();
}

bool EditorContext::Undo() {
  if (undoStack.empty()) return false;
  UndoEntry entry = undoStack.back();
  undoStack.pop_back();
  std::string error;
  JsonValue doc = JsonValue::Parse(entry.before, &error);
  if (!error.empty()) {
    Status("Undo failed: scene snapshot is invalid", 6.0f);
    return false;
  }
  scene.Deserialize(doc);
  // the objects may not exist anymore
  std::vector<EntityId> filtered;
  for (EntityId id : selection)
    if (scene.IsValid(id)) filtered.push_back(id);
  selection = filtered;
  active = selection.empty() ? 0 : selection.front();
  redoStack.push_back(entry);
  scene.SetDirty(true);
  Status("Undo: " + entry.label);
  return true;
}

bool EditorContext::Redo() {
  if (redoStack.empty()) return false;
  UndoEntry entry = redoStack.back();
  redoStack.pop_back();
  std::string error;
  JsonValue doc = JsonValue::Parse(entry.after, &error);
  if (!error.empty()) {
    Status("Redo failed: scene snapshot is invalid", 6.0f);
    return false;
  }
  scene.Deserialize(doc);
  std::vector<EntityId> filtered;
  for (EntityId id : selection)
    if (scene.IsValid(id)) filtered.push_back(id);
  selection = filtered;
  active = selection.empty() ? 0 : selection.front();
  undoStack.push_back(entry);
  scene.SetDirty(true);
  Status("Redo: " + entry.label);
  return true;
}

void EditorContext::ClearHistory() {
  undoStack.clear();
  redoStack.clear();
  CancelEdit();
}

// -------------------------------------------------------- object commands
namespace {
SpawnOptions MakeOptions(const Vec3& position, const std::string& name, const std::string& tag) {
  SpawnOptions options;
  options.position = position;
  options.name = name;
  options.tag = tag;
  return options;
}

Vec3 DropPosition(const EditorContext& context) {
  // spawn in front of the editor camera, on the ground plane
  Vec3 forward = Vec3(Cos(context.cameraPitch * kDegToRad) * Sin(context.cameraYaw * kDegToRad),
                      Sin(context.cameraPitch * kDegToRad),
                      Cos(context.cameraPitch * kDegToRad) * Cos(context.cameraYaw * kDegToRad));
  Vec3 target = context.cameraTarget;
  f32 distance = 6.0f;
  f32 y = std::max(0.0f, target.y + forward.y * distance);
  if (y < 0.5f) y = 0.5f;
  return Vec3(target.x + forward.x * distance, y, target.z + forward.z * distance);
}
} // namespace

EntityId EditorContext::CommandCreateEmpty(const std::string& name) {
  BeginEdit("Create " + name);
  EntityId id = scene.CreateObject(scene.UniqueName(name));
  if (TransformComponent* transform = scene.Get(id) ? scene.Get(id)->Transform() : nullptr)
    transform->position = DropPosition(*this);
  scene.MarkTransformDirty(id);
  EndEdit();
  Select(id);
  Status("Created " + scene.Get(id)->name);
  return id;
}

EntityId EditorContext::CommandCreatePrimitive(const std::string& primitive) {
  BeginEdit("Create " + primitive);
  EntityId id = SceneFactory::SpawnPrimitive(scene, primitive,
                                             MakeOptions(DropPosition(*this), primitive, "Untagged"));
  EndEdit();
  Select(id);
  Status("Created " + primitive);
  return id;
}

EntityId EditorContext::CommandCreateLight(int lightType) {
  BeginEdit("Create Light");
  const char* name = lightType == 0 ? "Directional Light" : (lightType == 1 ? "Point Light" : "Spot Light");
  SceneFactory::SpawnLight(scene, (LightType)lightType, MakeOptions(DropPosition(*this), name, "Untagged"));
  EntityId id = scene.FindByName(name);
  if (lightType == 0) {
    if (GameObject* object = scene.Get(id)) {
      if (TransformComponent* transform = object->Transform()) {
        transform->rotationEuler = Vec3(50.0f, -30.0f, 0.0f);
        transform->position = Vec3(0.0f, 8.0f, 0.0f);
      }
    }
    scene.MarkTransformDirty(id);
  }
  EndEdit();
  Select(id);
  Status(std::string("Created ") + name);
  return id;
}

EntityId EditorContext::CommandCreateCamera() {
  BeginEdit("Create Camera");
  SceneFactory::SpawnCamera(scene, MakeOptions(DropPosition(*this), "Camera", "Untagged"), false);
  EndEdit();
  EntityId id = scene.FindByName("Camera");
  Select(id);
  return id;
}

EntityId EditorContext::CommandCreatePlayer(bool firstPerson) {
  BeginEdit("Create Player");
  Vec3 position(0.0f, 1.2f, 0.0f);
  SceneFactory::SpawnPlayer(scene, MakeOptions(position, "Player", "Player"),
                            firstPerson ? ControllerViewMode::FirstPerson
                                        : ControllerViewMode::ThirdPerson);
  EndEdit();
  EntityId id = scene.FindByName("Player");
  scene.SetPlayerEntity(id);
  Select(id);
  Status("Player created - press PLAY and use WASD + mouse");
  return id;
}

EntityId EditorContext::CommandCreateNpc(int behavior) {
  BeginEdit("Create NPC");
  Vec3 position = DropPosition(*this);
  position.y = std::max(0.9f, position.y);
  SceneFactory::SpawnNpc(scene, MakeOptions(position, "NPC", "Enemy"), (NpcBehavior)behavior);
  EndEdit();
  EntityId id = scene.FindByName("NPC");
  Select(id);
  Status("NPC created");
  return id;
}

EntityId EditorContext::CommandCreateDoor() {
  BeginEdit("Create Door");
  SceneFactory::SpawnDoor(scene, MakeOptions(DropPosition(*this), "Door", "Door"));
  EndEdit();
  EntityId id = scene.FindByName("Door");
  Select(id);
  return id;
}

EntityId EditorContext::CommandCreatePickup(int kind) {
  BeginEdit("Create Pickup");
  SceneFactory::SpawnPickup(scene, (PickupKind)kind,
                            MakeOptions(DropPosition(*this), "Pickup", "Pickup"));
  EndEdit();
  EntityId id = scene.FindByName("Pickup");
  Select(id);
  return id;
}

EntityId EditorContext::CommandCreateTrigger() {
  BeginEdit("Create Trigger");
  SceneFactory::SpawnTriggerVolume(scene, Vec3(3, 3, 3),
                                   MakeOptions(DropPosition(*this), "Trigger", "Trigger"));
  EndEdit();
  EntityId id = scene.FindByName("Trigger");
  Select(id);
  return id;
}

EntityId EditorContext::CommandCreateQuest() {
  BeginEdit("Create Quest");
  SceneFactory::SpawnQuest(scene, "Quest1", MakeOptions(DropPosition(*this), "Quest", "Untagged"));
  EndEdit();
  EntityId id = scene.FindByName("Quest");
  Select(id);
  return id;
}

EntityId EditorContext::CommandCreateAudio() {
  BeginEdit("Create Audio Source");
  SceneFactory::SpawnAudioSource(scene, "", MakeOptions(DropPosition(*this), "AudioSource", "Untagged"));
  EndEdit();
  EntityId id = scene.FindByName("AudioSource");
  Select(id);
  return id;
}

EntityId EditorContext::CommandCreateGround() {
  BeginEdit("Add Ground");
  Vec3 position(0.0f, 0.0f, 0.0f);
  SceneFactory::SpawnGround(scene, 40.0f, MakeOptions(position, "Ground", "Ground"));
  EndEdit();
  EntityId id = scene.FindByName("Ground");
  Select(id);
  Status("Ground added with a static collider");
  return id;
}

EntityId EditorContext::CommandSpawnAsset(const std::string& assetPath, const Vec3& position) {
  BeginEdit("Instantiate " + fs::FileName(assetPath));
  EntityId id = SceneFactory::SpawnModel(scene, assetPath, MakeOptions(position, fs::Stem(assetPath), "Untagged"));
  EndEdit();
  if (id != 0) {
    Select(id);
    Status("Added " + fs::FileName(assetPath) + " to the scene");
  } else {
    Status("Could not instantiate " + assetPath, 6.0f);
  }
  return id;
}

void EditorContext::CommandDuplicateSelection() {
  if (selection.empty()) return;
  BeginEdit("Duplicate");
  std::vector<EntityId> duplicates;
  // copy of the original list: the scene mutates while duplicating
  std::vector<EntityId> originals = selection;
  for (EntityId original : originals) {
    GameObject* object = scene.Get(original);
    if (!object) continue;
    EntityId copy = scene.CreateFromTemplate(*object, object->name + " Copy", Vec3(0.75f, 0, 0.75f));
    if (copy == 0) continue;
    for (auto& sourceComponent : object->components) {
      ComponentBase* target = scene.AddComponent(copy, sourceComponent->TypeName());
      if (target) target->CopyStateFrom(*sourceComponent);
    }
    duplicates.push_back(copy);
  }
  EndEdit();
  if (!duplicates.empty()) {
    SelectMany(duplicates);
    Status(Pluralize((int)duplicates.size(), "object") + " duplicated");
  }
}

void EditorContext::CommandDeleteSelection() {
  if (selection.empty()) return;
  BeginEdit("Delete");
  usize count = selection.size();
  std::vector<EntityId> victims = selection;
  for (EntityId id : victims) scene.DestroyObject(id);
  scene.SetPlayerEntity(scene.PlayerEntity() == victims.front() ? 0 : scene.PlayerEntity());
  Deselect();
  EndEdit();
  Status(Pluralize((int)count, "object") + " deleted");
}

void EditorContext::CommandRename(EntityId id, const std::string& name) {
  GameObject* object = scene.Get(id);
  if (!object || name.empty() || object->name == name) return;
  BeginEdit("Rename");
  object->name = name;
  EndEdit();
}

void EditorContext::CommandSetTag(EntityId id, const std::string& tag) {
  GameObject* object = scene.Get(id);
  if (!object || object->tag == tag) return;
  BeginEdit("Change Tag");
  object->tag = tag;
  EndEdit();
}

void EditorContext::CommandReparent(EntityId child, EntityId newParent) {
  if (child == 0 || child == newParent) return;
  BeginEdit("Reparent");
  if (!scene.SetParent(child, newParent)) {
    CancelEdit();
    Status("Cannot parent an object under its own child", 5.0f);
    return;
  }
  EndEdit();
}

void EditorContext::CommandAddComponent(EntityId id, const std::string& typeName) {
  if (!scene.IsValid(id)) return;
  BeginEdit("Add " + typeName);
  ComponentBase* component = scene.AddComponent(id, typeName);
  EndEdit();
  if (component) Status(typeName + " added");
  else Status("Unknown component: " + typeName, 5.0f);
}

void EditorContext::CommandRemoveComponent(EntityId id, const std::string& typeName) {
  if (!scene.IsValid(id)) return;
  BeginEdit("Remove " + typeName);
  if (!scene.RemoveComponent(id, typeName.c_str())) {
    CancelEdit();
    return;
  }
  EndEdit();
  Status(typeName + " removed");
}

void EditorContext::CommandSetPlayer(EntityId id) {
  if (!scene.IsValid(id)) return;
  BeginEdit("Set As Player");
  scene.SetPlayerEntity(id);
  if (GameObject* object = scene.Get(id)) object->tag = "Player";
  EndEdit();
  Status("Marked " + scene.Get(id)->name + " as the player");
}

void EditorContext::CommandMarkDirty() { scene.SetDirty(true); }

void EditorContext::CommandResetTransform(EntityId id) {
  if (!scene.IsValid(id)) return;
  BeginEdit("Reset Transform");
  Transform transform = scene.LocalTransform(id);
  transform.position = Vec3(0, 0, 0);
  transform.rotation = Quat::Identity();
  transform.scale = Vec3(1, 1, 1);
  scene.SetLocalTransform(id, transform);
  EndEdit();
}

// ---------------------------------------------------------------- scenes
bool EditorContext::NewScene(bool starterContent) {
  if (!HasProject()) {
    Status("Open or create a project first", 5.0f);
    return false;
  }
  BeginEdit("New Scene");
  scene.Clear();
  scene.SetPlayerEntity(0);
  scene.SetName("Untitled");
  scene.SetFilePath("");
  if (starterContent) Scene::PopulateStarterScene(scene);
  sceneRelativePath.clear();
  sceneLoaded = true;
  Deselect();
  ClearHistory();
  scene.SetDirty(true);
  Status("New scene created");
  return true;
}

bool EditorContext::OpenScene(const std::string& relativePath, std::string* error) {
  if (!HasProject()) {
    if (error) *error = "no project open";
    return false;
  }
  std::string absolute = AbsoluteAssetPath(project, relativePath);
  std::string loadError;
  if (!scene.LoadFromFile(absolute, &loadError)) {
    if (error) *error = loadError;
    Status("Could not open scene: " + loadError, 8.0f);
    return false;
  }
  scene.SetAssets(&assets);
  scene.SetName(fs::Stem(relativePath));
  scene.SetFilePath(absolute);
  sceneRelativePath = relativePath;
  sceneLoaded = true;
  project.RecordOpenedScene(relativePath);
  Deselect();
  ClearHistory();
  scene.SetDirty(false);
  if (GameObject* player = scene.Get(scene.PlayerEntity())) NF_UNUSED(player);
  Status("Opened " + relativePath);
  return true;
}

bool EditorContext::SaveScene(std::string* error) {
  if (!sceneLoaded) {
    if (error) *error = "no scene open";
    return false;
  }
  if (sceneRelativePath.empty()) return SaveSceneAs("Assets/Scenes/Untitled.nfscene", error);
  std::string absolute = AbsoluteAssetPath(project, sceneRelativePath);
  std::string saveError;
  if (!scene.SaveToFile(absolute, &saveError)) {
    if (error) *error = saveError;
    Status("Save failed: " + saveError, 8.0f);
    return false;
  }
  scene.SetFilePath(absolute);
  scene.SetDirty(false);
  Status("Saved " + sceneRelativePath);
  return true;
}

bool EditorContext::SaveSceneAs(const std::string& relativePath, std::string* error) {
  std::string normalized = relativePath;
  if (fs::Extension(normalized) != "nfscene")
    normalized = fs::ReplaceExtension(normalized, "nfscene");
  if (!StartsWith(normalized, "Assets/")) normalized = "Assets/Scenes/" + fs::FileName(normalized);
  std::string absolute = AbsoluteAssetPath(project, normalized);
  fs::CreateDirectories(fs::Parent(absolute));
  std::string saveError;
  if (!scene.SaveToFile(absolute, &saveError)) {
    if (error) *error = saveError;
    Status("Save failed: " + saveError, 8.0f);
    return false;
  }
  scene.SetFilePath(absolute);
  scene.SetName(fs::Stem(normalized));
  sceneRelativePath = normalized;
  scene.SetDirty(false);
  assets.Rescan();
  Status("Saved " + normalized);
  return true;
}

bool EditorContext::ImportAsset(const std::string& absolutePath, bool spawnInScene) {
  if (!HasProject()) {
    Status("Open a project before importing assets", 5.0f);
    return false;
  }
  if (!fs::Exists(absolutePath)) {
    Status("File not found: " + absolutePath, 6.0f);
    return false;
  }
  std::string extension = fs::Extension(absolutePath);
  ImportedAsset imported;
  if (extension == "glb" || extension == "gltf" || extension == "obj" || extension == "fbx") {
    imported = assets.ImportMeshFile(absolutePath, "Assets/Models");
  } else if (extension == "png" || extension == "jpg" || extension == "jpeg" || extension == "bmp" ||
             extension == "tga") {
    imported = assets.ImportTextureFile(absolutePath, "Assets/Textures");
  } else if (extension == "wav" || extension == "mp3" || extension == "ogg" || extension == "flac") {
    imported = assets.ImportAudioFile(absolutePath, "Assets/Audio");
  } else {
    Status("Unsupported asset type: ." + extension, 6.0f);
    NF_WARN(LogCategory::Editor, "Unsupported import: %s", absolutePath.c_str());
    return false;
  }

  std::string report = imported.success ? ("Imported " + fs::FileName(absolutePath))
                                        : ("Import failed: " + imported.error);
  lastImportReport = report;
  if (!imported.success) {
    Status(imported.error.empty() ? "Import failed" : imported.error, 8.0f);
    NF_ERROR(LogCategory::Editor, "Import failed for %s: %s", absolutePath.c_str(),
             imported.error.c_str());
    return false;
  }
  assets.Rescan();
  Status("Imported " + fs::FileName(absolutePath) + " -> " + imported.assetPath);
  NF_INFO(LogCategory::Editor, "Imported %s -> %s (%d vertices)",
          absolutePath.c_str(), imported.assetPath.c_str(), (int)imported.vertexCount);
  if (spawnInScene) CommandSpawnAsset(imported.assetPath, DropPosition(*this));
  return true;
}

void EditorContext::RefreshAssets() {
  if (HasProject()) {
    assets.SetProjectRoot(project.RootPath());
    assets.Rescan();
    Status("Asset database refreshed");
  }
}

void EditorContext::FocusSelection() {
  if (selection.empty()) {
    Status("Nothing selected");
    return;
  }
  AABB bounds = SelectionBounds();
  Vec3 center = (bounds.min + bounds.max) * 0.5f;
  f32 radius = std::max(0.5f, Length(bounds.max - bounds.min) * 0.5f);
  cameraTarget = center;
  cameraDistance = std::max(2.0f, radius * 3.0f);
  Status("Focused selection");
}

// ------------------------------------------------------------- play mode
bool EditorContext::StartPlay(std::string* error) {
  if (!HasProject()) {
    if (error) *error = "open a project first";
    return false;
  }
  if (playing) return true;

  RuntimeConfig config;
  config.projectRoot = project.RootPath();
  config.input = window ? &window->Input() : nullptr;
  config.fixedTimeStep = fixedTimeStep;
  config.startPlaying = false;
  config.headless = false;

  runtime = std::make_unique<GameRuntime>();
  std::string initError;
  if (!runtime->Initialize(config, &initError)) {
    if (error) *error = initError;
    runtime.reset();
    Status("Play failed: " + initError, 8.0f);
    return false;
  }
  // Hand the editor document to the runtime so unsaved changes are simulated too.
  std::string loadError;
  if (!runtime->LoadSceneDocument(scene.Serialize(), &loadError)) {
    if (error) *error = loadError;
    runtime->Shutdown();
    runtime.reset();
    Status("Play failed: " + loadError, 8.0f);
    return false;
  }
  runtime->SetDebugDraw(&debugDraw);
  runtime->StartPlay();
  playing = true;
  paused = false;
  scene.SetPlaying(true);
  if (window) window->SetMouseCaptured(true);
  Status("Playing - WASD to move, mouse to look, E to interact, Esc to release the cursor");
  return true;
}

void EditorContext::StopPlay() {
  if (!playing) return;
  if (runtime) {
    runtime->StopPlay();
    runtime->Shutdown();
    runtime.reset();
  }
  playing = false;
  paused = false;
  scene.SetPlaying(false);
  if (window) window->SetMouseCaptured(false);
  Status("Stopped");
}

void EditorContext::TogglePlay() {
  if (playing) StopPlay();
  else StartPlay();
}

void EditorContext::PausePlay(bool pause) {
  if (!playing || !runtime) return;
  paused = pause;
  if (pause) runtime->Pause();
  else runtime->Resume();
  Status(pause ? "Paused" : "Resumed");
}

void EditorContext::StepPlay() {
  if (!playing || !runtime) return;
  runtime->Pause();
  runtime->StepOnce(fixedTimeStep);
  paused = true;
  Status("Stepped one frame");
}

// ---------------------------------------------------------------- build
void EditorContext::LaunchBuild(bool debugConfiguration, bool copyEngineSources, bool compileExecutable) {
  if (build.running) return;
  if (!HasProject()) {
    Status("Open a project first", 5.0f);
    return;
  }
  if (scene.IsDirty() && !sceneRelativePath.empty()) SaveScene(nullptr);

  build.running = true;
  build.finished = false;
  build.success = false;
  build.progress = 0.02f;
  build.step = "Starting build...";
  build.message.clear();
  build.verificationReport.clear();
  build.startedAt = NowSeconds();

  // Build on a worker thread: the editor keeps rendering and shows progress.
  std::string projectRoot = project.RootPath();
  std::string engineSource = engineSourceDirectory;
  if (engineSource.empty()) engineSource = BuildSystem::DetectEngineSourceDirectory();
  engineSourceDirectory = engineSource;

  BuildRequest request;
  request.projectRoot = projectRoot;
  request.config = debugConfiguration ? "Debug" : "Release";
  request.targetPlatform = "Windows";
  request.copyEngineSources = copyEngineSources;
  request.compileExecutable = compileExecutable;
  request.engineSourceDir = engineSource;
  request.parallelJobs = 2;

  auto* state = &build;
  auto progress = [state](const std::string& step, f32 progress) {
    state->step = step;
    state->progress = std::max(state->progress, progress);
  };
  std::thread([state, request, progress]() {
    BuildSystem buildSystem;
    BuildResult result = buildSystem.Build(request, progress);
    state->success = result.success;
    state->message = result.message;
    state->outputDirectory = result.outputDirectory;
    state->reportPath = result.reportPath;
    state->progress = 1.0f;
    state->finished = true;
    state->running = false;
    state->finishedAt = NowSeconds();
    if (!result.success && !result.errors.empty()) {
      for (const auto& error : result.errors) state->message += "\n" + error;
    }
  }).detach();
  Status("Building game...");
}

void EditorContext::PollBuild() {
  if (build.finished && build.success && build.step != "Reported") {
    build.step = "Reported";
    Status("BUILD SUCCEEDED", 8.0f);
    NF_INFO(LogCategory::Editor, "Build succeeded: %s", build.outputDirectory.c_str());
  }
}

void EditorContext::VerifyLastBuild() {
  if (build.outputDirectory.empty()) {
    Status("Build the game first", 5.0f);
    return;
  }
  BuildSystem::VerificationResult verification = BuildSystem::VerifyPackage(build.outputDirectory);
  build.verificationValid = verification.valid;
  build.verificationReport = verification.report;
  if (!verification.problems.empty()) {
    for (const auto& problem : verification.problems)
      build.verificationReport += "PROBLEM: " + problem + "\n";
  }
  Status(verification.valid ? "Build verification: OK" : "Build verification FAILED",
         verification.valid ? 5.0f : 10.0f);
}

} // namespace nf
