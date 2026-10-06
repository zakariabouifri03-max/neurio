// NovaForge Engine - editor/EditorApp.h
// The NovaForge editor: docking UI, scene hierarchy, 3D viewport with real gizmos,
// inspector, asset browser, console, project browser, play mode, build system,
// project settings and the AI assistant panel.
#pragma once

#include "editor/EditorContext.h"
#include "renderer/Renderer.h"
#include "aiassistant/AiAssistant.h"
#include "renderer/SceneExtractor.h"

#include <memory>
#include <vector>

struct ImVec2;

namespace nf {

struct ViewportRect {
  f32 x = 0.0f;
  f32 y = 0.0f;
  f32 width = 0.0f;
  f32 height = 0.0f;
  bool valid = false;
};

class EditorApp {
public:
  EditorApp();
  ~EditorApp();

  bool Initialize(const std::string& projectToOpen);
  int Run();
  void Shutdown();

  bool OpenProject(const std::string& path, bool createIfMissing = false);
  bool CreateProject(const std::string& parentFolder, const std::string& name);

private:
  // ---- frame
  void BeginFrame(f32 deltaTime);
  void DrawUi();
  void EndFrame();
  void HandleShortcuts();
  void UpdatePlayMode(f32 deltaTime);

  // ---- chrome
  void DrawMenuBar();
  void DrawToolbar();
  void DrawStatusBar();
  void DrawDialogs();
  void BuildDefaultLayout();
  void SaveLayoutNow();
  bool DrawNewProjectDialog();
  bool DrawNewSceneDialog();
  bool DrawSaveSceneAsDialog();
  bool DrawCreateScriptDialog();

  // ---- panels (EditorPanels.cpp)
  void DrawHierarchyPanel();
  void DrawInspectorPanel();
  void DrawAssetBrowserPanel();
  void DrawConsolePanel();
  void DrawProjectBrowserPanel();
  void DrawBuildPanel();
  void DrawSettingsPanel();
  void DrawStatsPanel();
  void DrawAboutWindow();
  void DrawScopeWindow();
  void DrawShortcutsWindow();
  void DrawObjectContextMenu(EntityId object);
  void DrawCreateMenu();
  void DrawTextViewer();
  bool DrawPropertyWidget(Property& property);

  // ---- viewport (EditorViewport.cpp)
  void DrawViewportPanel();
  void DrawViewportOverlay(ViewportRect rect);
  void UpdateEditorCamera(f32 deltaTime);
  void HandleViewportNavigation(ViewportRect rect, bool hovered);
  void HandleViewportPicking(ViewportRect rect);
  void HandleGizmoInteraction(ViewportRect rect, const RenderView& view);
  RenderView MakeEditorView(f32 aspect) const;
  void BuildViewportDebugDraw(const RenderView& view);
  void DrawGizmoGeometry(const RenderView& view);
  bool ScreenRay(const ViewportRect& rect, const RenderView& view, const Vec2& mouse, Ray* out) const;
  bool PickObject(const ViewportRect& rect, const RenderView& view, const Vec2& mouse,
                  EntityId* outId) const;

  // ---- helpers
  void SetWindowTitle();
  void OpenSceneFromBrowser(const std::string& relativePath);
  void ShowBuildResultNotification();
  void LoadRecentProjects();
  void SaveRecentProjects();
  void AddRecentProject(const std::string& path);
  void SaveEditorLayoutIfDirty();

  EditorContext ctx_;
  std::unique_ptr<AiAssistant> assistant_;
  RendererStats lastStats_;
  ViewportRect lastViewport_;
  f32 frameTimeMs_ = 0.0f;
  f32 fps_ = 0.0f;
  f32 fpsAccumulator_ = 0.0f;
  int fpsFrames_ = 0;
  f64 lastFrameTime_ = 0.0;
  bool running_ = false;
  bool imguiInitialized_ = false;
  bool glReady_ = false;
  bool projectLoadedAtStartup_ = false;
  bool buildNotified_ = false;
  f64 startupTime_ = 0.0;

  // gizmo drag state
  struct GizmoDrag {
    bool active = false;
    int axis = -1;                 // 0 = X, 1 = Y, 2 = Z, 3 = uniform/screen
    Vec3 startPosition{0, 0, 0};
    Vec3 startRotationEuler{0, 0, 0};
    Vec3 startScale{1, 1, 1};
    Vec3 startHitPoint{0, 0, 0};
    f32 startAngle = 0.0f;
    f32 accumulatedDegrees = 0.0f;
    std::string label;
    std::vector<EntityId> targets;
  } gizmoDrag_;

  std::vector<std::string> recentProjects_;

  // simple text asset viewer/editor (scripts, materials, scenes)
  bool showTextViewer_ = false;
  std::string textViewerPath_;
  std::string textViewerRelative_;
  std::string textViewerBuffer_;
  bool textViewerDirty_ = false;
  std::string textViewerStatus_;
  std::string renameBuffer_;
  EntityId renameTarget_ = 0;
  bool renamePopup_ = false;

  // ImGui text buffers
  char assetSearch_[128] = {0};
  char aiPromptBuffer_[1024] = {0};
  char projectNameBuffer_[128] = "MyGame";
  char projectFolderBuffer_[512] = {0};
  char sceneNameBuffer_[128] = "Main";
  char scenePathBuffer_[512] = "Assets/Scenes/Main.nfscene";
  char scriptNameBuffer_[128] = "NewScript";
  char buildOutputBuffer_[512] = {0};
};

} // namespace nf
