// NovaForge Engine - editor/EditorContext.h
// Everything the editor panels share: the open project, the scene being edited,
// selection, gizmo state, play mode runtime, undo history and the command helpers
// that every menu item / panel / AI action funnels through.
#pragma once

#include "core/Base.h"
#include "core/Math.h"
#include "core/Json.h"
#include "scene/Scene.h"
#include "scene/SceneFactory.h"
#include "assets/AssetDatabase.h"
#include "projectsystem/Project.h"
#include "renderer/RenderTypes.h"
#include "renderer/DebugDraw.h"
#include "runtime/GameRuntime.h"

#include <memory>

namespace nf {

namespace platform { class Window; }
class Renderer;

enum class GizmoMode : int { Translate = 0, Rotate, Scale };
enum class TransformSpace : int { World = 0, Local };

const char* GizmoModeName(GizmoMode mode);
const char* TransformSpaceName(TransformSpace space);

// A single undo step: the scene document before and after an edit.
struct UndoEntry {
  std::string label;
  std::string before;
  std::string after;
};

struct BuildUiState {
  bool running = false;
  bool finished = false;
  bool success = false;
  f32 progress = 0.0f;
  std::string step;
  std::string message;
  std::string outputDirectory;
  std::string reportPath;
  std::string verificationReport;
  bool verificationValid = false;
  f64 startedAt = 0.0;
  f64 finishedAt = 0.0;
};

struct EditorContext {
  // ---- services
  platform::Window* window = nullptr;
  Renderer* renderer = nullptr;

  // ---- project / scene
  Project project;
  AssetDatabase assets;
  Scene scene;
  std::string sceneRelativePath;             // "Assets/Scenes/Main.nfscene"
  bool sceneLoaded = false;

  // ---- selection
  std::vector<EntityId> selection;
  EntityId active = 0;

  DebugDrawList debugDraw;                   // gizmos / grid / collider wireframes

  // ---- gizmo / viewport state
  GizmoMode gizmoMode = GizmoMode::Translate;
  TransformSpace space = TransformSpace::World;
  bool snapEnabled = false;
  f32 translateSnap = 0.5f;
  f32 rotateSnapDegrees = 15.0f;
  f32 scaleSnap = 0.1f;
  bool showGrid = true;
  bool showColliders = true;
  bool showIcons = true;
  bool showNavMeshDebug = false;             // "Not implemented in V1" (documented)
  bool renderWireframe = false;
  bool shadowsEnabled = true;
  int qualityLevel = 2;

  // ---- editor camera
  Vec3 cameraTarget{0.0f, 1.0f, 0.0f};
  f32 cameraYaw = 45.0f;
  f32 cameraPitch = -22.0f;
  f32 cameraDistance = 14.0f;
  bool cameraOrthographic = false;
  f32 cameraOrthoHeight = 12.0f;
  f32 cameraFov = 60.0f;
  f32 cameraFlySpeed = 8.0f;
  bool cameraFlying = false;

  // ---- play mode
  std::unique_ptr<GameRuntime> runtime;
  bool playing = false;
  bool paused = false;
  bool stepRequested = false;
  f32 fixedTimeStep = 1.0f / 60.0f;
  std::string playSceneDoc;                  // JSON of the scene when Play was pressed

  // ---- undo history
  std::vector<UndoEntry> undoStack;
  std::vector<UndoEntry> redoStack;
  std::string pendingUndoLabel;
  std::string pendingUndoBefore;
  bool editInProgress = false;
  usize maxUndoSteps = 100;

  // ---- build
  BuildUiState build;
  std::string engineSourceDirectory;

  // ---- UI state
  bool showHierarchy = true;
  bool showInspector = true;
  bool showViewport = true;
  bool showAssetBrowser = true;
  bool showConsole = true;
  bool showProjectBrowser = false;
  bool showAiAssistant = true;
  bool showStats = false;
  bool showSettings = false;
  bool showAbout = false;
  bool showScope = false;
  bool showShortcuts = false;
  bool showDemoWindow = false;
  bool showImGuiMetrics = false;
  bool layoutInitialized = false;
  bool closeRequested = false;
  bool dirtyLayoutSaved = false;

  // ---- dialogs
  bool showNewProjectDialog = false;
  bool showNewSceneDialog = false;
  bool showSaveSceneAsDialog = false;
  bool showCreateScriptDialog = false;
  bool showBuildDialog = false;
  bool showDeleteSceneDialog = false;
  std::string dialogNameBuffer;
  std::string dialogFolderBuffer;
  std::string dialogBehavior = "Rotator";
  std::string dialogSceneToDelete;
  bool dialogStarterContent = true;

  // ---- console
  std::string consoleFilter;
  int consoleLevelFilter = 0;                // 0 all, 1 info+, 2 warning+, 3 error
  bool consoleAutoScroll = true;
  u64 consoleLastVersion = 0;

  // ---- status line
  std::string statusMessage;
  f32 statusTimer = 0.0f;
  std::string lastImportReport;
  std::string assetBrowserFolder = "Assets";
  std::string hierarchySearch;
  std::string currentLayoutName = "Default";

  // ---- AI assistant (implemented in aiassistant/AiAssistant.h)
  struct AiAssistantState* ai = nullptr;

  // ============================================================ helpers
  Scene& SceneRef() { return scene; }
  bool HasProject() const { return project.IsOpen(); }
  bool HasSelection() const { return !selection.empty(); }
  Vec3 SelectionCenter() const;
  AABB SelectionBounds() const;
  EntityId PrimarySelection() const { return selection.empty() ? 0 : selection.front(); }

  void Status(const std::string& message, f32 seconds = 4.0f);
  const std::string& StatusMessage() const { return statusMessage; }
  f32 StatusTimer() const { return statusTimer; }

  bool IsSelected(EntityId id) const;

  // ---- selection
  void Select(EntityId id, bool additive = false);
  void SelectMany(const std::vector<EntityId>& ids);
  void Deselect();
  void SelectAll();

  // ---- undo ------------------------------------------------------------
  void BeginEdit(const std::string& label);       // captures the "before" document
  void EndEdit();                                  // pushes the entry (ignored if unchanged)
  void CancelEdit();
  bool Undo();
  bool Redo();
  bool CanUndo() const { return !undoStack.empty(); }
  bool CanRedo() const { return !redoStack.empty(); }
  const char* UndoLabel() const { return undoStack.empty() ? "" : undoStack.back().label.c_str(); }
  const char* RedoLabel() const { return redoStack.empty() ? "" : redoStack.back().label.c_str(); }
  void ClearHistory();

  // ---- object commands (all undoable) ----------------------------------
  EntityId CommandCreateEmpty(const std::string& name = "Object");
  EntityId CommandCreatePrimitive(const std::string& primitive);
  EntityId CommandCreateLight(int lightType);
  EntityId CommandCreateCamera();
  EntityId CommandCreatePlayer(bool firstPerson);
  EntityId CommandCreateNpc(int behavior);
  EntityId CommandCreateDoor();
  EntityId CommandCreatePickup(int kind);
  EntityId CommandCreateTrigger();
  EntityId CommandCreateQuest();
  EntityId CommandCreateAudio();
  EntityId CommandCreateGround();
  EntityId CommandSpawnAsset(const std::string& assetPath, const Vec3& position);

  void CommandDuplicateSelection();
  void CommandDeleteSelection();
  void CommandRename(EntityId id, const std::string& name);
  void CommandSetTag(EntityId id, const std::string& tag);
  void CommandReparent(EntityId child, EntityId newParent);
  void CommandAddComponent(EntityId id, const std::string& typeName);
  void CommandRemoveComponent(EntityId id, const std::string& typeName);
  void CommandSetPlayer(EntityId id);
  void CommandMarkDirty();
  void CommandResetTransform(EntityId id);

  // ---- scene / project -------------------------------------------------
  bool NewScene(bool starterContent);
  bool OpenScene(const std::string& relativePath, std::string* error = nullptr);
  bool SaveScene(std::string* error = nullptr);
  bool SaveSceneAs(const std::string& relativePath, std::string* error = nullptr);
  bool ImportAsset(const std::string& absolutePath, bool spawnInScene);
  void RefreshAssets();
  void FocusSelection();

  // ---- play mode -------------------------------------------------------
  bool StartPlay(std::string* error = nullptr);
  void StopPlay();
  void TogglePlay();
  void PausePlay(bool pause);
  void StepPlay();

  // ---- build ------------------------------------------------------------
  void LaunchBuild(bool debugConfiguration, bool copyEngineSources, bool compileExecutable);
  void PollBuild();
  void VerifyLastBuild();
};

// Shared project-level helpers.
std::string AbsoluteAssetPath(const Project& project, const std::string& projectRelative);

} // namespace nf
