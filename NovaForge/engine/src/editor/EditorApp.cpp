// NovaForge Engine - editor/EditorApp.cpp
#include "editor/EditorApp.h"
#include "buildsystem/BuildSystem.h"
#include "scripting/ScriptSystem.h"
#include "core/FileSystem.h"
#include "renderer/GLFunctions.h"
#include "core/Time.h"
#include "core/StringUtil.h"
#include "core/Log.h"
#include "platform/Platform.h"

#include "imgui.h"
#include "imgui_internal.h"
#include "backends/imgui_impl_opengl3.h"

#if NF_PLATFORM_WINDOWS
// <windows.h> first: the ImGui Win32 backend header declares HWND/UINT/WPARAM types
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include "platform/win32/Win32Interop.h"
#include "backends/imgui_impl_win32.h"
// the backend header keeps this declaration inside an #if 0 block on purpose (see its docs)
extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam,
                                                             LPARAM lParam);
#endif

#include <algorithm>

namespace nf {

namespace {

// ---------------------------------------------------------------- icon drawing
enum class IconType {
  Play, Pause, Stop, Step, Translate, Rotate, Scale, Magnet, World, Local, Save, Undo, Redo,
  Build, Folder, Search, Add, Remove, Camera, Light, Cube, Robot, Grid, Sparkle, Eye, EyeOff,
  Refresh, Import, Duplicate, Trash, Gear, Info, Warning, Error, Chevron, WorldGrid, Script
};

ImU32 IconColor(bool enabled) {
  ImVec4 color = enabled ? ImVec4(0.90f, 0.92f, 0.96f, 1.0f) : ImVec4(0.55f, 0.58f, 0.63f, 1.0f);
  return ImGui::GetColorU32(color);
}

void DrawIcon(ImDrawList* draw, IconType type, ImVec2 center, float size, ImU32 color) {
  const float h = size * 0.5f;
  switch (type) {
    case IconType::Play:
      draw->AddTriangleFilled(ImVec2(center.x - h * 0.7f, center.y - h),
                              ImVec2(center.x - h * 0.7f, center.y + h),
                              ImVec2(center.x + h, center.y), color);
      break;
    case IconType::Pause:
      draw->AddRectFilled(ImVec2(center.x - h * 0.8f, center.y - h),
                          ImVec2(center.x - h * 0.15f, center.y + h), color, 1.0f);
      draw->AddRectFilled(ImVec2(center.x + h * 0.15f, center.y - h),
                          ImVec2(center.x + h * 0.8f, center.y + h), color, 1.0f);
      break;
    case IconType::Stop:
      draw->AddRectFilled(ImVec2(center.x - h * 0.8f, center.y - h * 0.8f),
                          ImVec2(center.x + h * 0.8f, center.y + h * 0.8f), color, 1.5f);
      break;
    case IconType::Step:
      draw->AddTriangleFilled(ImVec2(center.x - h, center.y - h), ImVec2(center.x - h, center.y + h),
                              ImVec2(center.x + h * 0.3f, center.y), color);
      draw->AddRectFilled(ImVec2(center.x + h * 0.5f, center.y - h),
                          ImVec2(center.x + h * 0.85f, center.y + h), color, 1.0f);
      break;
    case IconType::Translate:
      draw->AddLine(ImVec2(center.x - h, center.y), ImVec2(center.x + h, center.y), color, 1.6f);
      draw->AddLine(ImVec2(center.x, center.y - h), ImVec2(center.x, center.y + h), color, 1.6f);
      draw->AddTriangleFilled(ImVec2(center.x + h, center.y), ImVec2(center.x + h - 5, center.y - 4),
                              ImVec2(center.x + h - 5, center.y + 4), color);
      break;
    case IconType::Rotate:
      draw->AddCircle(center, h, color, 16, 1.6f);
      draw->AddTriangleFilled(ImVec2(center.x + h * 0.7f, center.y - h * 0.7f),
                              ImVec2(center.x + h * 1.1f, center.y - h * 0.2f),
                              ImVec2(center.x + h * 0.3f, center.y - h * 0.1f), color);
      break;
    case IconType::Scale:
      draw->AddRect(ImVec2(center.x - h, center.y - h), ImVec2(center.x + h * 0.4f, center.y + h * 0.4f),
                    color, 1.0f, 0, 1.5f);
      draw->AddRectFilled(ImVec2(center.x + h * 0.2f, center.y + h * 0.2f),
                          ImVec2(center.x + h, center.y + h), color, 1.0f);
      break;
    case IconType::Grid:
      for (int i = -1; i <= 1; i++) {
        draw->AddLine(ImVec2(center.x + i * h * 0.6f, center.y - h),
                      ImVec2(center.x + i * h * 0.6f, center.y + h), color, 1.0f);
        draw->AddLine(ImVec2(center.x - h, center.y + i * h * 0.6f),
                      ImVec2(center.x + h, center.y + i * h * 0.6f), color, 1.0f);
      }
      break;
    case IconType::Magnet:
      draw->AddLine(ImVec2(center.x - h * 0.7f, center.y), ImVec2(center.x - h * 0.7f, center.y - h),
                    color, 2.4f);
      draw->AddLine(ImVec2(center.x + h * 0.7f, center.y), ImVec2(center.x + h * 0.7f, center.y - h),
                    color, 2.4f);
      draw->AddLine(ImVec2(center.x - h * 0.7f, center.y - h), ImVec2(center.x + h * 0.7f, center.y - h),
                    color, 2.4f);
      break;
    case IconType::Build:
      draw->AddRect(ImVec2(center.x - h, center.y + h * 0.2f), ImVec2(center.x + h, center.y + h),
                    color, 1.0f, 0, 1.5f);
      draw->AddRectFilled(ImVec2(center.x - h * 0.5f, center.y - h),
                          ImVec2(center.x + h * 0.5f, center.y + h * 0.1f), color, 1.0f);
      break;
    case IconType::Undo:
      draw->AddLine(ImVec2(center.x + h * 0.7f, center.y - h * 0.6f),
                    ImVec2(center.x - h * 0.5f, center.y - h * 0.6f), color, 1.8f);
      draw->AddLine(ImVec2(center.x - h * 0.5f, center.y - h * 0.6f),
                    ImVec2(center.x - h * 0.5f, center.y + h * 0.6f), color, 1.8f);
      draw->AddTriangleFilled(ImVec2(center.x - h, center.y - h * 0.1f),
                              ImVec2(center.x - h, center.y + h * 1.1f),
                              ImVec2(center.x - h * 0.1f, center.y + h * 0.5f), color);
      break;
    case IconType::Redo:
      draw->AddLine(ImVec2(center.x - h * 0.7f, center.y - h * 0.6f),
                    ImVec2(center.x + h * 0.5f, center.y - h * 0.6f), color, 1.8f);
      draw->AddLine(ImVec2(center.x + h * 0.5f, center.y - h * 0.6f),
                    ImVec2(center.x + h * 0.5f, center.y + h * 0.6f), color, 1.8f);
      draw->AddTriangleFilled(ImVec2(center.x + h, center.y - h * 0.1f),
                              ImVec2(center.x + h, center.y + h * 1.1f),
                              ImVec2(center.x + h * 0.1f, center.y + h * 0.5f), color);
      break;
    case IconType::Import:
      draw->AddLine(ImVec2(center.x, center.y - h), ImVec2(center.x, center.y + h * 0.2f), color, 1.8f);
      draw->AddTriangleFilled(ImVec2(center.x - h * 0.5f, center.y),
                              ImVec2(center.x + h * 0.5f, center.y),
                              ImVec2(center.x, center.y + h * 0.7f), color);
      draw->AddRect(ImVec2(center.x - h, center.y + h * 0.5f), ImVec2(center.x + h, center.y + h),
                    color, 1.0f, 0, 1.4f);
      break;
    case IconType::Save:
      draw->AddRect(ImVec2(center.x - h, center.y - h), ImVec2(center.x + h, center.y + h), color, 1.0f,
                    0, 1.5f);
      draw->AddRectFilled(ImVec2(center.x - h * 0.5f, center.y - h),
                          ImVec2(center.x + h * 0.5f, center.y - h * 0.2f), color, 1.0f);
      break;
    case IconType::Folder:
      draw->AddRectFilled(ImVec2(center.x - h, center.y - h * 0.6f),
                          ImVec2(center.x + h, center.y + h * 0.7f), color, 1.5f);
      break;
    case IconType::Add:
      draw->AddLine(ImVec2(center.x - h, center.y), ImVec2(center.x + h, center.y), color, 1.8f);
      draw->AddLine(ImVec2(center.x, center.y - h), ImVec2(center.x, center.y + h), color, 1.8f);
      break;
    case IconType::Remove:
      draw->AddLine(ImVec2(center.x - h, center.y), ImVec2(center.x + h, center.y), color, 1.8f);
      break;
    case IconType::Camera:
      draw->AddRect(ImVec2(center.x - h, center.y - h * 0.6f), ImVec2(center.x + h, center.y + h * 0.6f),
                    color, 2.0f, 0, 1.5f);
      draw->AddCircle(center, h * 0.35f, color, 10, 1.4f);
      break;
    case IconType::Light:
      draw->AddCircle(center, h * 0.45f, color, 12, 1.5f);
      draw->AddLine(ImVec2(center.x - h, center.y - h), ImVec2(center.x - h * 0.5f, center.y - h * 0.5f),
                    color, 1.2f);
      draw->AddLine(ImVec2(center.x + h, center.y - h), ImVec2(center.x + h * 0.5f, center.y - h * 0.5f),
                    color, 1.2f);
      draw->AddLine(ImVec2(center.x, center.y + h * 0.5f), ImVec2(center.x, center.y + h), color, 1.2f);
      break;
    case IconType::Cube:
      draw->AddRect(ImVec2(center.x - h * 0.8f, center.y - h * 0.5f),
                    ImVec2(center.x + h * 0.8f, center.y + h * 0.8f), color, 1.0f, 0, 1.4f);
      draw->AddLine(ImVec2(center.x - h * 0.8f, center.y - h * 0.5f), ImVec2(center.x, center.y - h),
                    color, 1.2f);
      draw->AddLine(ImVec2(center.x + h * 0.8f, center.y - h * 0.5f), ImVec2(center.x, center.y - h),
                    color, 1.2f);
      break;
    case IconType::Eye:
      draw->AddCircle(center, h * 0.7f, color, 14, 1.4f);
      draw->AddCircleFilled(center, h * 0.25f, color);
      break;
    case IconType::EyeOff:
      draw->AddCircle(center, h * 0.7f, color, 14, 1.4f);
      draw->AddLine(ImVec2(center.x - h, center.y + h), ImVec2(center.x + h, center.y - h), color, 1.4f);
      break;
    case IconType::Trash:
      draw->AddRect(ImVec2(center.x - h * 0.7f, center.y - h * 0.4f),
                    ImVec2(center.x + h * 0.7f, center.y + h), color, 1.0f, 0, 1.4f);
      draw->AddLine(ImVec2(center.x - h, center.y - h * 0.6f), ImVec2(center.x + h, center.y - h * 0.6f),
                    color, 1.4f);
      break;
    case IconType::Gear:
      draw->AddCircle(center, h * 0.6f, color, 12, 1.5f);
      draw->AddCircleFilled(center, h * 0.18f, color);
      break;
    case IconType::Script:
      draw->AddRect(ImVec2(center.x - h * 0.7f, center.y - h), ImVec2(center.x + h * 0.7f, center.y + h),
                    color, 1.0f, 0, 1.4f);
      draw->AddLine(ImVec2(center.x - h * 0.35f, center.y - h * 0.3f),
                    ImVec2(center.x - h * 0.35f, center.y + h * 0.6f), color, 1.2f);
      draw->AddLine(ImVec2(center.x + h * 0.25f, center.y - h * 0.3f),
                    ImVec2(center.x + h * 0.55f, center.y + h * 0.6f), color, 1.2f);
      break;
    case IconType::Sparkle:
      draw->AddLine(ImVec2(center.x, center.y - h), ImVec2(center.x, center.y + h), color, 1.5f);
      draw->AddLine(ImVec2(center.x - h, center.y), ImVec2(center.x + h, center.y), color, 1.5f);
      draw->AddLine(ImVec2(center.x - h * 0.6f, center.y - h * 0.6f),
                    ImVec2(center.x + h * 0.6f, center.y + h * 0.6f), color, 1.0f);
      break;
    default:
      draw->AddCircleFilled(center, h * 0.5f, color);
      break;
  }
}

bool IconButton(const char* id, IconType icon, const char* tooltip, bool active = false,
                float size = 26.0f) {
  ImGui::PushID(id);
  ImVec2 position = ImGui::GetCursorScreenPos();
  bool pressed = ImGui::InvisibleButton("##icon", ImVec2(size, size));
  bool hovered = ImGui::IsItemHovered();
  ImDrawList* draw = ImGui::GetWindowDrawList();
  ImVec2 center(position.x + size * 0.5f, position.y + size * 0.5f);
  ImU32 background = active ? ImGui::GetColorU32(ImVec4(0.24f, 0.48f, 0.82f, 1.0f))
                            : (hovered ? ImGui::GetColorU32(ImVec4(0.25f, 0.27f, 0.31f, 1.0f))
                                       : ImGui::GetColorU32(ImVec4(0.16f, 0.17f, 0.19f, 1.0f)));
  draw->AddRectFilled(position, ImVec2(position.x + size, position.y + size), background, 4.0f);
  DrawIcon(draw, icon, center, size * 0.42f, IconColor(true));
  if (tooltip && hovered) ImGui::SetTooltip("%s", tooltip);
  ImGui::PopID();
  return pressed;
}

void ApplyDarkTheme() {
  ImGuiStyle& style = ImGui::GetStyle();
  style.WindowRounding = 3.0f;
  style.ChildRounding = 3.0f;
  style.FrameRounding = 3.0f;
  style.PopupRounding = 3.0f;
  style.ScrollbarRounding = 6.0f;
  style.GrabRounding = 3.0f;
  style.TabRounding = 3.0f;
  style.WindowBorderSize = 1.0f;
  style.FrameBorderSize = 0.0f;
  style.WindowPadding = ImVec2(8.0f, 8.0f);
  style.FramePadding = ImVec2(7.0f, 4.0f);
  style.ItemSpacing = ImVec2(7.0f, 5.0f);
  style.IndentSpacing = 16.0f;
  style.ScrollbarSize = 12.0f;

  ImVec4* colors = style.Colors;
  colors[ImGuiCol_Text] = ImVec4(0.88f, 0.90f, 0.93f, 1.00f);
  colors[ImGuiCol_TextDisabled] = ImVec4(0.48f, 0.51f, 0.55f, 1.00f);
  colors[ImGuiCol_WindowBg] = ImVec4(0.12f, 0.13f, 0.145f, 1.00f);
  colors[ImGuiCol_ChildBg] = ImVec4(0.135f, 0.145f, 0.16f, 1.00f);
  colors[ImGuiCol_PopupBg] = ImVec4(0.11f, 0.12f, 0.135f, 0.98f);
  colors[ImGuiCol_Border] = ImVec4(0.24f, 0.25f, 0.28f, 1.00f);
  colors[ImGuiCol_FrameBg] = ImVec4(0.18f, 0.19f, 0.215f, 1.00f);
  colors[ImGuiCol_FrameBgHovered] = ImVec4(0.23f, 0.25f, 0.28f, 1.00f);
  colors[ImGuiCol_FrameBgActive] = ImVec4(0.26f, 0.30f, 0.36f, 1.00f);
  colors[ImGuiCol_TitleBg] = ImVec4(0.10f, 0.11f, 0.125f, 1.00f);
  colors[ImGuiCol_TitleBgActive] = ImVec4(0.145f, 0.16f, 0.19f, 1.00f);
  colors[ImGuiCol_MenuBarBg] = ImVec4(0.14f, 0.15f, 0.17f, 1.00f);
  colors[ImGuiCol_ScrollbarBg] = ImVec4(0.11f, 0.12f, 0.13f, 1.00f);
  colors[ImGuiCol_ScrollbarGrab] = ImVec4(0.28f, 0.30f, 0.33f, 1.00f);
  colors[ImGuiCol_CheckMark] = ImVec4(0.36f, 0.68f, 1.00f, 1.00f);
  colors[ImGuiCol_SliderGrab] = ImVec4(0.36f, 0.62f, 0.94f, 1.00f);
  colors[ImGuiCol_Button] = ImVec4(0.20f, 0.22f, 0.25f, 1.00f);
  colors[ImGuiCol_ButtonHovered] = ImVec4(0.27f, 0.31f, 0.36f, 1.00f);
  colors[ImGuiCol_ButtonActive] = ImVec4(0.32f, 0.44f, 0.60f, 1.00f);
  colors[ImGuiCol_Header] = ImVec4(0.22f, 0.26f, 0.32f, 1.00f);
  colors[ImGuiCol_HeaderHovered] = ImVec4(0.27f, 0.33f, 0.41f, 1.00f);
  colors[ImGuiCol_HeaderActive] = ImVec4(0.31f, 0.42f, 0.55f, 1.00f);
  colors[ImGuiCol_Separator] = ImVec4(0.24f, 0.25f, 0.28f, 1.00f);
  colors[ImGuiCol_Tab] = ImVec4(0.15f, 0.16f, 0.18f, 1.00f);
  colors[ImGuiCol_TabHovered] = ImVec4(0.26f, 0.34f, 0.44f, 1.00f);
  colors[ImGuiCol_TabActive] = ImVec4(0.21f, 0.27f, 0.35f, 1.00f);
  colors[ImGuiCol_TabUnfocused] = ImVec4(0.14f, 0.15f, 0.17f, 1.00f);
  colors[ImGuiCol_TabUnfocusedActive] = ImVec4(0.18f, 0.22f, 0.28f, 1.00f);
  colors[ImGuiCol_DockingPreview] = ImVec4(0.32f, 0.52f, 0.82f, 0.70f);
  colors[ImGuiCol_DockingEmptyBg] = ImVec4(0.10f, 0.11f, 0.12f, 1.00f);
  colors[ImGuiCol_PlotLines] = ImVec4(0.55f, 0.78f, 0.98f, 1.00f);
  colors[ImGuiCol_TableHeaderBg] = ImVec4(0.16f, 0.17f, 0.20f, 1.00f);
  colors[ImGuiCol_TableBorderStrong] = ImVec4(0.24f, 0.26f, 0.29f, 1.00f);
  colors[ImGuiCol_TableBorderLight] = ImVec4(0.20f, 0.21f, 0.24f, 1.00f);
  colors[ImGuiCol_TextSelectedBg] = ImVec4(0.30f, 0.50f, 0.80f, 0.55f);
}

std::string RecentProjectsPath() {
  std::string base = fs::ExecutableDirectory();
  if (base.empty()) base = fs::CurrentWorkingDirectory();
  return fs::Join(base, "NovaForge.recent.json");
}

} // namespace

// ------------------------------------------------------------------ lifetime
EditorApp::EditorApp() { startupTime_ = NowSeconds(); }
EditorApp::~EditorApp() { Shutdown(); }

bool EditorApp::Initialize(const std::string& projectToOpen) {
  platform::PlatformInitialize();
  Log::Get().SetMinLevel(LogLevel::Info);

  // ---- window
  platform::WindowDesc desc;
  desc.title = "NovaForge Engine";
  desc.width = 1600;
  desc.height = 900;
  desc.vsync = true;
  desc.resizable = true;
  ctx_.window = platform::CreatePlatformWindow().release();
  if (!ctx_.window) return false;
  if (!ctx_.window->Create(desc)) {
    platform::ShowMessageBox("NovaForge", "The editor window could not be created.", true);
    return false;
  }
  ctx_.window->SetResizeCallback([this](int, int) {
    if (ctx_.renderer) ctx_.renderer->OnWindowResized();
  });
  ctx_.window->Show();
  ctx_.window->MakeContextCurrent();

  // ---- renderer
  ctx_.renderer = Renderer::Create();
  std::string rendererError;
  if (!ctx_.renderer->Initialize(ctx_.window->NativeHandle(), desc.width, desc.height,
                                 &rendererError)) {
    platform::ShowMessageBox("NovaForge",
                         "OpenGL 3.3 could not be initialised.\n\n" + rendererError +
                             "\n\nNovaForge needs a GPU driver with OpenGL 3.3 support "
                             "(any card from 2010 onwards). Update your graphics driver and "
                             "try again.",
                         true);
    NF_FATAL(LogCategory::Editor, "Renderer init failed: %s", rendererError.c_str());
    return false;
  }
  glReady_ = true;
  NF_INFO(LogCategory::Editor, "NovaForge editor started - %s (%s)",
          ctx_.renderer->BackendName(), ctx_.renderer->DriverInfo());

  // ---- ImGui
  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGuiIO& io = ImGui::GetIO();
  io.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
  io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
  io.ConfigWindowsMoveFromTitleBarOnly = true;
  io.IniFilename = nullptr;   // layout is stored in the project Logs folder explicitly
  ApplyDarkTheme();

#if NF_PLATFORM_WINDOWS
  ImGui_ImplWin32_Init(ctx_.window->NativeHandle());
  platform::win32::SetMessageHook(
      [](void* hwnd, unsigned msg, unsigned long long wparam, long long lparam) -> long long {
        return (long long)ImGui_ImplWin32_WndProcHandler((HWND)hwnd, (UINT)msg, (WPARAM)wparam,
                                                         (LPARAM)lparam);
      });
#endif
  ImGui_ImplOpenGL3_Init("#version 330");
  imguiInitialized_ = true;

  // ---- state
  ctx_.renderer->SetAssetDatabase(&ctx_.assets);
  ctx_.ai = nullptr;   // the assistant lives in the app
  assistant_ = std::make_unique<AiAssistant>();
  LoadRecentProjects();

  fs::CreateDirectories(fs::Join(fs::CurrentWorkingDirectory(), "Logs"));

  if (!projectToOpen.empty()) {
    if (fs::Exists(projectToOpen)) {
      OpenProject(projectToOpen);
    } else if (fs::IsDirectory(projectToOpen)) {
      CreateProject(projectToOpen, fs::FileName(projectToOpen));
    }
  }
  if (!ctx_.HasProject()) {
    ctx_.showProjectBrowser = true;
    for (bool* flag : {&ctx_.showHierarchy, &ctx_.showInspector, &ctx_.showViewport,
                       &ctx_.showAssetBrowser, &ctx_.showConsole}) {
      NF_UNUSED(flag);
    }
  }
  ctx_.build.step = "Idle";
  ctx_.engineSourceDirectory = BuildSystem::DetectEngineSourceDirectory();
  running_ = true;
  return true;
}

void EditorApp::Shutdown() {
  if (!running_ && !imguiInitialized_) return;
  SaveEditorLayoutIfDirty();
  if (ctx_.runtime) {
    ctx_.runtime->Shutdown();
    ctx_.runtime.reset();
  }
  if (imguiInitialized_) {
#if NF_PLATFORM_WINDOWS
    platform::win32::SetMessageHook(nullptr);
    ImGui_ImplWin32_Shutdown();
#endif
    ImGui_ImplOpenGL3_Shutdown();
    ImGui::DestroyContext();
    imguiInitialized_ = false;
  }
  if (ctx_.renderer) {
    ctx_.renderer->Shutdown();
    delete ctx_.renderer;
    ctx_.renderer = nullptr;
  }
  if (ctx_.window) {
    ctx_.window->Destroy();
    delete ctx_.window;
    ctx_.window = nullptr;
  }
  platform::PlatformShutdown();
  running_ = false;
}

// ------------------------------------------------------------------ projects
bool EditorApp::OpenProject(const std::string& path, bool createIfMissing) {
  std::string error;
  if (createIfMissing && !fs::Exists(fs::Join(path, "project.json"))) {
    ctx_.project.CreateNew(path, fs::FileName(fs::Normalize(path)), &error);
  } else if (!ctx_.project.Load(path, &error)) {
    platform::ShowMessageBox("NovaForge", "Could not open the project:\n" + error, true);
    NF_ERROR(LogCategory::Editor, "Open project failed: %s", error.c_str());
    return false;
  }
  ctx_.assets.SetProjectRoot(ctx_.project.RootPath());
  ctx_.assets.Rescan();
  ctx_.renderer->SetAssetDatabase(&ctx_.assets);
  ctx_.scene.SetAssets(&ctx_.assets);
  ctx_.scene.SetDebugDraw(&ctx_.debugDraw);
  projectLoadedAtStartup_ = true;
  ctx_.showProjectBrowser = false;
  AddRecentProject(ctx_.project.RootPath());
  ctx_.renderer->PurgeAssetCache();

  std::string startScene = ctx_.project.Settings().startScene;
  std::string sceneError;
  if (!ctx_.OpenScene(startScene, &sceneError)) {
    NF_WARN(LogCategory::Editor, "Start scene could not be opened (%s) - creating an empty scene",
            sceneError.c_str());
    ctx_.NewScene(true);
  }
  SetWindowTitle();
  ctx_.Status("Project loaded: " + ctx_.project.Settings().name, 6.0f);
  NF_INFO(LogCategory::Editor, "Project '%s' opened from %s", ctx_.project.Settings().name.c_str(),
          ctx_.project.RootPath().c_str());
  return true;
}

bool EditorApp::CreateProject(const std::string& parentFolder, const std::string& name) {
  std::string error;
  if (!ctx_.project.CreateNew(parentFolder, name, &error)) {
    platform::ShowMessageBox("NovaForge", "Project creation failed:\n" + error, true);
    NF_ERROR(LogCategory::Editor, "Create project failed: %s", error.c_str());
    return false;
  }
  return OpenProject(ctx_.project.RootPath());
}

// ------------------------------------------------------------------- layout
void EditorApp::BuildDefaultLayout() {
  ImGuiID dockspaceId = ImGui::GetID("NovaForgeDockSpace");
  ImGui::DockBuilderRemoveNode(dockspaceId);
  ImGui::DockBuilderAddNode(dockspaceId, ImGuiDockNodeFlags_DockSpace);
  ImGui::DockBuilderSetNodeSize(dockspaceId, ImGui::GetMainViewport()->WorkSize);

  ImGuiID center = dockspaceId;
  ImGuiID left = ImGui::DockBuilderSplitNode(center, ImGuiDir_Left, 0.18f, nullptr, &center);
  ImGuiID right = ImGui::DockBuilderSplitNode(center, ImGuiDir_Right, 0.26f, nullptr, &center);
  ImGuiID bottom = ImGui::DockBuilderSplitNode(center, ImGuiDir_Down, 0.28f, nullptr, &center);
  ImGuiID leftBottom = ImGui::DockBuilderSplitNode(left, ImGuiDir_Down, 0.45f, nullptr, &left);

  ImGui::DockBuilderDockWindow("Hierarchy", left);
  ImGui::DockBuilderDockWindow("AI Assistant", leftBottom);
  ImGui::DockBuilderDockWindow("Inspector", right);
  ImGui::DockBuilderDockWindow("Console", bottom);
  ImGui::DockBuilderDockWindow("Assets", bottom);
  ImGui::DockBuilderDockWindow("Project Settings", bottom);
  ImGui::DockBuilderDockWindow("Build", bottom);
  ImGui::DockBuilderDockWindow("Statistics", right);
  ImGui::DockBuilderDockWindow("Viewport", center);
  ImGui::DockBuilderFinish(dockspaceId);
  ctx_.layoutInitialized = true;
  ctx_.currentLayoutName = "Default";
  ctx_.Status("Layout reset to Default");
}

void EditorApp::SaveLayoutNow() {
  // The layout lives next to the project (or the engine when no project is open).
  std::string directory = ctx_.HasProject() ? fs::Join(ctx_.project.RootPath(), "Logs")
                                            : fs::CurrentWorkingDirectory();
  fs::CreateDirectories(directory);
  std::string path = fs::Join(directory, "editor-layout.ini");
  ImGui::SaveIniSettingsToDisk(path.c_str());
  ctx_.dirtyLayoutSaved = false;
  ctx_.Status("Layout saved to " + path);
}

void EditorApp::SaveEditorLayoutIfDirty() {
  if (!imguiInitialized_) return;
  // ImGui has no public "is dirty" query; always persist the layout on exit.
  std::string directory = ctx_.HasProject() ? fs::Join(ctx_.project.RootPath(), "Logs")
                                            : fs::CurrentWorkingDirectory();
  fs::CreateDirectories(directory);
  ImGui::SaveIniSettingsToDisk(fs::Join(directory, "editor-layout.ini").c_str());
}

void EditorApp::LoadRecentProjects() {
  recentProjects_.clear();
  JsonValue doc;
  std::string error;
  if (JsonValue::ParseFile(RecentProjectsPath(), &doc, &error)) {
    JsonValue list = doc["recent"];
    for (usize i = 0; i < list.Size(); i++) recentProjects_.push_back(list[i].AsString());
  }
}

void EditorApp::SaveRecentProjects() {
  JsonValue doc = JsonValue::Object();
  JsonValue list = JsonValue::Array();
  for (const auto& path : recentProjects_) list.Push(path);
  doc["recent"] = list;
  doc.WriteFile(RecentProjectsPath());
}

void EditorApp::AddRecentProject(const std::string& path) {
  std::string normalized = fs::Normalize(path);
  for (usize i = 0; i < recentProjects_.size(); i++) {
    if (recentProjects_[i] == normalized) {
      recentProjects_.erase(recentProjects_.begin() + (long)i);
      break;
    }
  }
  recentProjects_.insert(recentProjects_.begin(), normalized);
  if (recentProjects_.size() > 10) recentProjects_.resize(10);
  SaveRecentProjects();
}

void EditorApp::SetWindowTitle() {
  if (!ctx_.window) return;
  std::string title = "NovaForge Engine";
  if (ctx_.HasProject()) {
    title = ctx_.project.Settings().name;
    title += " - NovaForge";
    if (!ctx_.sceneRelativePath.empty()) title += " - " + ctx_.sceneRelativePath;
    if (ctx_.scene.IsDirty()) title += " *";
  }
  ctx_.window->SetTitle(title);
}

// --------------------------------------------------------------------- run
int EditorApp::Run() {
  lastFrameTime_ = NowSeconds();
  while (running_ && !ctx_.window->ShouldClose()) {
    f64 now = NowSeconds();
    f32 delta = (f32)std::min(0.25, std::max(0.0, now - lastFrameTime_));
    lastFrameTime_ = now;
    frameTimeMs_ = delta * 1000.0f;
    fpsAccumulator_ += delta;
    fpsFrames_++;
    if (fpsAccumulator_ >= 0.25f) {
      fps_ = (f32)fpsFrames_ / fpsAccumulator_;
      fpsAccumulator_ = 0.0f;
      fpsFrames_ = 0;
    }

    ctx_.window->PollEvents();
    if (ctx_.window->ShouldClose()) break;
    if (ctx_.window->IsMinimized()) {
      platform::SleepMs(20);
      continue;
    }

    UpdatePlayMode(delta);
    BeginFrame(delta);
    DrawUi();
    EndFrame();

    if (ctx_.statusTimer > 0.0f) ctx_.statusTimer -= delta;
    ctx_.assets.PumpAsync();
    ctx_.PollBuild();
  }
  Shutdown();
  return 0;
}

void EditorApp::UpdatePlayMode(f32 deltaTime) {
  if (!ctx_.playing || !ctx_.runtime) return;
  ctx_.runtime->SetDebugDraw(&ctx_.debugDraw);
  if (ctx_.paused) return;
  ctx_.runtime->Tick(deltaTime);
  for (auto& event : ctx_.runtime->ConsumeEvents()) {
    // gameplay events are logged so the Console shows what actually happened
    Log::Get().Write(LogLevel::Debug, LogCategory::Runtime, "%s", event.c_str());
  }
  // release the mouse when Escape is pressed while playing
  if (ctx_.window->Input().WasKeyPressed(platform::Key::Escape) && ctx_.window->IsMouseCaptured()) {
    ctx_.window->SetMouseCaptured(false);
    ctx_.Status("Cursor released - click in the viewport to capture it again", 5.0f);
  }
}

void EditorApp::BeginFrame(f32 deltaTime) {
  ImGui_ImplOpenGL3_NewFrame();
#if NF_PLATFORM_WINDOWS
  ImGui_ImplWin32_NewFrame();
#endif
  ImGuiIO& io = ImGui::GetIO();
  io.DeltaTime = deltaTime > 0.0f ? deltaTime : 1.0f / 60.0f;
  ImGui::NewFrame();
  ctx_.debugDraw.Clear();
}

void EditorApp::EndFrame() {
  ImGui::Render();
  // the renderer leaves whatever framebuffer the viewport target used bound, so bind
  // the window backbuffer again and clear it before ImGui paints the UI
  gl::glBindFramebuffer(gl::GL_FRAMEBUFFER, 0);
  gl::glViewport(0, 0, ctx_.window->Width(), ctx_.window->Height());
  gl::glClearColor(0.055f, 0.06f, 0.07f, 1.0f);
  gl::glClear(gl::GL_COLOR_BUFFER_BIT | gl::GL_DEPTH_BUFFER_BIT);
  ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
  lastStats_.uiVertices = (usize)ImGui::GetDrawData()->TotalVtxCount;
  ctx_.window->SwapBuffers();
}

// ---------------------------------------------------------------------- UI
void EditorApp::DrawUi() {
  if (!ctx_.layoutInitialized) BuildDefaultLayout();

  // Host window: a full-screen dockspace.
  const ImGuiViewport* viewport = ImGui::GetMainViewport();
  ImGui::SetNextWindowPos(viewport->WorkPos);
  ImGui::SetNextWindowSize(viewport->WorkSize);
  ImGui::SetNextWindowViewport(viewport->ID);
  ImGuiWindowFlags hostFlags = ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoCollapse |
                               ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                               ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoNavFocus |
                               ImGuiWindowFlags_MenuBar | ImGuiWindowFlags_NoDocking;
  ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
  ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
  ImGui::Begin("NovaForgeDockHost", nullptr, hostFlags);
  ImGui::PopStyleVar(3);
  {
    ImGuiID dockspaceId = ImGui::GetID("NovaForgeDockSpace");
    ImGui::DockSpace(dockspaceId, ImVec2(0.0f, 0.0f), ImGuiDockNodeFlags_None);
    DrawMenuBar();
    DrawToolbar();
  }
  ImGui::End();

  if (ctx_.showProjectBrowser || !ctx_.HasProject()) DrawProjectBrowserPanel();
  if (ctx_.HasProject()) {
    if (ctx_.showViewport) DrawViewportPanel();
    if (ctx_.showHierarchy) DrawHierarchyPanel();
    if (ctx_.showInspector) DrawInspectorPanel();
    if (ctx_.showAssetBrowser) DrawAssetBrowserPanel();
    if (ctx_.showConsole) DrawConsolePanel();
    if (ctx_.showStats) DrawStatsPanel();
    if (ctx_.showSettings) DrawSettingsPanel();
    if (ctx_.showAiAssistant) {
      if (assistant_) assistant_->DrawPanel(ctx_);
    }
  }
  if (ctx_.build.running || ctx_.build.finished) {
    // keep the build window visible while it runs
    ctx_.showBuildDialog = true;
  }
  DrawBuildPanel();
  if (ctx_.showAbout) DrawAboutWindow();
  if (ctx_.showScope) DrawScopeWindow();
  if (ctx_.showShortcuts) DrawShortcutsWindow();
#if NF_EDITOR_IMGUI_DEMO
  if (ctx_.showDemoWindow) ImGui::ShowDemoWindow(&ctx_.showDemoWindow);
#endif
  if (ctx_.showImGuiMetrics) ImGui::ShowMetricsWindow(&ctx_.showImGuiMetrics);
  DrawDialogs();
  DrawStatusBar();
  HandleShortcuts();

  if (ctx_.build.finished && !ctx_.build.running && !buildNotified_) {
    buildNotified_ = true;
    ShowBuildResultNotification();
  }
  if (ctx_.build.running) buildNotified_ = false;
  SetWindowTitle();
}

void EditorApp::ShowBuildResultNotification() {
  if (ctx_.build.success) {
    platform::ShowMessageBox("NovaForge - Build succeeded",
                         ctx_.build.message + "\n\nReport:\n" + ctx_.build.reportPath);
  } else {
    platform::ShowMessageBox("NovaForge - Build failed", ctx_.build.message, true);
  }
}

// ------------------------------------------------------------------ menu
void EditorApp::DrawMenuBar() {
  if (!ImGui::BeginMenuBar()) return;

  if (ImGui::BeginMenu("File")) {
    if (ImGui::MenuItem("New Project...", "Ctrl+Shift+N")) {
      ctx_.showNewProjectDialog = true;
      ctx_.dialogNameBuffer = "MyGame";
      ctx_.dialogFolderBuffer = fs::CurrentWorkingDirectory();
    }
    if (ImGui::MenuItem("Open Project...", "Ctrl+O")) {
      std::string folder = platform::SelectFolderDialog(ctx_.window, "Select a NovaForge project folder");
      if (!folder.empty()) OpenProject(folder);
    }
    ImGui::Separator();
    if (ImGui::MenuItem("New Scene", "Ctrl+N", false, ctx_.HasProject())) {
      ctx_.showNewSceneDialog = true;
      snprintf(sceneNameBuffer_, sizeof(sceneNameBuffer_), "Scene");
    }
    if (ImGui::MenuItem("Open Scene...", nullptr, false, ctx_.HasProject())) {
      std::string file = platform::OpenFileDialog(
          ctx_.window, "Open scene",
          {{"NovaForge Scene (*.nfscene)", "*.nfscene"}, {"All files", "*.*"}});
      if (!file.empty()) {
        std::string relative = ctx_.assets.ToProjectRelative(file);
        OpenSceneFromBrowser(relative);
      }
    }
    if (ImGui::MenuItem("Save Scene", "Ctrl+S", false, ctx_.HasProject())) ctx_.SaveScene(nullptr);
    if (ImGui::MenuItem("Save Scene As...", "Ctrl+Shift+S", false, ctx_.HasProject())) {
      ctx_.showSaveSceneAsDialog = true;
      snprintf(scenePathBuffer_, sizeof(scenePathBuffer_), "%s",
               ctx_.sceneRelativePath.empty() ? "Assets/Scenes/Main.nfscene"
                                              : ctx_.sceneRelativePath.c_str());
    }
    ImGui::Separator();
    if (ImGui::BeginMenu("Recent Projects", !recentProjects_.empty())) {
      for (const auto& recent : recentProjects_) {
        if (ImGui::MenuItem(recent.c_str())) OpenProject(recent);
      }
      ImGui::EndMenu();
    }
    ImGui::Separator();
    if (ImGui::MenuItem("Exit", "Alt+F4")) ctx_.window->RequestClose();
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Edit")) {
    if (ImGui::MenuItem(ctx_.CanUndo() ? (std::string("Undo ") + ctx_.UndoLabel()).c_str() : "Undo",
                        "Ctrl+Z", false, ctx_.CanUndo()))
      ctx_.Undo();
    if (ImGui::MenuItem(ctx_.CanRedo() ? (std::string("Redo ") + ctx_.RedoLabel()).c_str() : "Redo",
                        "Ctrl+Y", false, ctx_.CanRedo()))
      ctx_.Redo();
    ImGui::Separator();
    if (ImGui::MenuItem("Duplicate", "Ctrl+D", false, ctx_.HasSelection()))
      ctx_.CommandDuplicateSelection();
    if (ImGui::MenuItem("Delete", "Del", false, ctx_.HasSelection())) ctx_.CommandDeleteSelection();
    if (ImGui::MenuItem("Select All", "Ctrl+A", false, ctx_.HasProject())) ctx_.SelectAll();
    if (ImGui::MenuItem("Deselect", "Esc", false, ctx_.HasSelection())) ctx_.Deselect();
    ImGui::Separator();
    if (ImGui::MenuItem("Reset Transform", nullptr, false, ctx_.HasSelection())) {
      for (EntityId id : ctx_.selection) ctx_.CommandResetTransform(id);
    }
    ImGui::Separator();
    if (ImGui::MenuItem("Project Settings...", nullptr, ctx_.showSettings)) ctx_.showSettings = true;
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("GameObject")) {
    DrawCreateMenu();
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Component")) {
    if (!ctx_.HasSelection()) {
      ImGui::MenuItem("Select an object first", nullptr, false, false);
    } else {
      for (ComponentCategory category : {ComponentCategory::Core, ComponentCategory::Rendering,
                                         ComponentCategory::Physics, ComponentCategory::Gameplay,
                                         ComponentCategory::Audio, ComponentCategory::AI,
                                         ComponentCategory::Scripting}) {
        if (!ImGui::BeginMenu(ComponentCategoryName(category))) continue;
        for (const ComponentMeta* meta : ComponentRegistry::Get().ByCategory(category)) {
          GameObject* object = ctx_.scene.Get(ctx_.active);
          bool has = object && object->Has(meta->name.c_str());
          bool isTransform = meta->name == "Transform";
          std::string label = meta->name;
          if (has) label += "  (attached)";
          if (ImGui::MenuItem(label.c_str(), nullptr, false, !has && !isTransform)) {
            for (EntityId id : ctx_.selection) ctx_.CommandAddComponent(id, meta->name);
          }
          if (!meta->description.empty() && ImGui::IsItemHovered())
            ImGui::SetTooltip("%s", meta->description.c_str());
        }
        ImGui::EndMenu();
      }
      ImGui::Separator();
      if (ImGui::MenuItem("Load Script Module (DLL)...")) {
        std::string file = platform::OpenFileDialog(
            ctx_.window, "Select a native script module",
            {{"Native module (*.dll;*.so)", "*.dll;*.so"}, {"All files", "*.*"}});
        if (!file.empty()) {
          std::string error;
          if (ScriptSystem::LoadModule(file, &error)) ctx_.Status("Script module loaded: " + fs::FileName(file));
          else ctx_.Status("Module load failed: " + error, 8.0f);
        }
      }
    }
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Assets")) {
    if (ImGui::MenuItem("Import Model (GLB/GLTF/OBJ/FBX)...", "Ctrl+I", false, ctx_.HasProject())) {
      std::string file = platform::OpenFileDialog(
          ctx_.window, "Import model",
          {{"3D models", "*.glb;*.gltf;*.obj;*.fbx"}, {"All files", "*.*"}});
      if (!file.empty()) ctx_.ImportAsset(file, true);
    }
    if (ImGui::MenuItem("Import Texture...", nullptr, false, ctx_.HasProject())) {
      std::string file = platform::OpenFileDialog(
          ctx_.window, "Import texture", {{"Images", "*.png;*.jpg;*.jpeg;*.bmp;*.tga"}, {"All files", "*.*"}});
      if (!file.empty()) ctx_.ImportAsset(file, false);
    }
    if (ImGui::MenuItem("Import Audio...", nullptr, false, ctx_.HasProject())) {
      std::string file = platform::OpenFileDialog(
          ctx_.window, "Import audio", {{"Audio", "*.wav;*.mp3;*.ogg;*.flac"}, {"All files", "*.*"}});
      if (!file.empty()) ctx_.ImportAsset(file, false);
    }
    ImGui::Separator();
    if (ImGui::MenuItem("Create Script (.nfscript)...", nullptr, false, ctx_.HasProject())) {
      ctx_.showCreateScriptDialog = true;
      snprintf(scriptNameBuffer_, sizeof(scriptNameBuffer_), "NewScript");
    }
    if (ImGui::MenuItem("Create Material...", nullptr, false, ctx_.HasProject())) {
      Material material = Material::Default();
      std::string path = fs::Join(ctx_.project.MaterialsPath(), "NewMaterial.nfmat");
      for (int i = 1; fs::Exists(path); i++)
        path = fs::Join(ctx_.project.MaterialsPath(), "NewMaterial" + std::to_string(i) + ".nfmat");
      JsonValue doc = material.Serialize();
      if (doc.WriteFile(path)) {
        ctx_.assets.RegisterFile(ctx_.assets.ToProjectRelative(path));
        ctx_.Status("Created " + fs::FileName(path));
      }
    }
    ImGui::Separator();
    if (ImGui::MenuItem("Refresh", "F5")) ctx_.RefreshAssets();
    if (ImGui::MenuItem("Reveal Project Folder")) {
      if (ctx_.HasProject()) {
#if NF_PLATFORM_WINDOWS
        ShellExecuteA(nullptr, "open", ctx_.project.RootPath().c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#else
        ctx_.Status("Project folder: " + ctx_.project.RootPath(), 10.0f);
#endif
      }
    }
    if (!ctx_.lastImportReport.empty() && ImGui::BeginMenu("Last Import")) {
      ImGui::TextWrapped("%s", ctx_.lastImportReport.c_str());
      ImGui::EndMenu();
    }
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Play")) {
    if (ImGui::MenuItem(ctx_.playing ? "Stop" : "Play", "F5")) ctx_.TogglePlay();
    if (ImGui::MenuItem("Pause", "F6", ctx_.paused, ctx_.playing)) ctx_.PausePlay(!ctx_.paused);
    if (ImGui::MenuItem("Step One Frame", "F7", false, ctx_.playing)) ctx_.StepPlay();
    ImGui::Separator();
    ImGui::MenuItem("Simulation uses the exported runtime", nullptr, false, false);
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Build")) {
    if (ImGui::MenuItem("Build Game...", "Ctrl+B", false, ctx_.HasProject())) ctx_.showBuildDialog = true;
    if (ImGui::MenuItem("Verify Last Build", nullptr, false, !ctx_.build.outputDirectory.empty()))
      ctx_.VerifyLastBuild();
    if (ImGui::MenuItem("Open Build Folder", nullptr, false, !ctx_.build.outputDirectory.empty())) {
#if NF_PLATFORM_WINDOWS
      ShellExecuteA(nullptr, "open", ctx_.build.outputDirectory.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#endif
    }
    if (ImGui::MenuItem("Open Build Report", nullptr, false, !ctx_.build.reportPath.empty())) {
#if NF_PLATFORM_WINDOWS
      ShellExecuteA(nullptr, "open", ctx_.build.reportPath.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#else
      std::string report;
      if (fs::ReadText(ctx_.build.reportPath, &report)) ctx_.Status(report.substr(0, 200), 20.0f);
#endif
    }
    ImGui::Separator();
    ImGui::MenuItem("Packaging details are shown in the Build window", nullptr, false, false);
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Window")) {
    ImGui::MenuItem("Viewport", nullptr, &ctx_.showViewport);
    ImGui::MenuItem("Hierarchy", nullptr, &ctx_.showHierarchy);
    ImGui::MenuItem("Inspector", nullptr, &ctx_.showInspector);
    ImGui::MenuItem("Assets", nullptr, &ctx_.showAssetBrowser);
    ImGui::MenuItem("Console", nullptr, &ctx_.showConsole);
    ImGui::MenuItem("AI Assistant", "Ctrl+I", &ctx_.showAiAssistant);
    ImGui::MenuItem("Statistics", nullptr, &ctx_.showStats);
    ImGui::MenuItem("Project Settings", nullptr, &ctx_.showSettings);
    ImGui::MenuItem("Build", nullptr, &ctx_.showBuildDialog);
    ImGui::Separator();
    if (ImGui::MenuItem("Reset Layout")) BuildDefaultLayout();
    if (ImGui::MenuItem("Save Layout")) SaveLayoutNow();
    ImGui::Separator();
    ImGui::MenuItem("Project Browser", nullptr, &ctx_.showProjectBrowser);
    ImGui::MenuItem("ImGui Demo (debug)", nullptr, &ctx_.showDemoWindow);
    ImGui::MenuItem("ImGui Metrics (debug)", nullptr, &ctx_.showImGuiMetrics);
    ImGui::EndMenu();
  }

  if (ImGui::BeginMenu("Help")) {
    ImGui::MenuItem("Keyboard Shortcuts", "F1", &ctx_.showShortcuts);
    ImGui::MenuItem("About NovaForge", nullptr, &ctx_.showAbout);
    ImGui::MenuItem("V1 Scope / V2 Roadmap", nullptr, &ctx_.showScope);
    ImGui::Separator();
    ImGui::MenuItem((std::string("Engine: ") + ctx_.renderer->BackendName()).c_str(), nullptr, false,
                    false);
    ImGui::EndMenu();
  }

  // right aligned frame stats
  char stats[128];
  snprintf(stats, sizeof(stats), "%.0f FPS | %.1f ms | %zu objects", fps_, frameTimeMs_,
           ctx_.HasProject() ? ctx_.scene.ObjectCount() : (usize)0);
  f32 width = ImGui::CalcTextSize(stats).x;
  ImGui::SameLine(ImGui::GetWindowWidth() - width - 20.0f);
  ImGui::TextDisabled("%s", stats);
  ImGui::EndMenuBar();
}

void EditorApp::DrawToolbar() {
  ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(6.0f, 5.0f));
  ImGui::BeginChild("##toolbar", ImVec2(0.0f, 36.0f), false,
                    ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
  ImGui::SetCursorPosY(4.0f);

  if (IconButton("play", ctx_.playing ? IconType::Stop : IconType::Play,
                 ctx_.playing ? "Stop (F5)" : "Play (F5)", ctx_.playing))
    ctx_.TogglePlay();
  ImGui::SameLine();
  if (IconButton("pause", IconType::Pause, "Pause / Resume (F6)", ctx_.paused)) {
    if (ctx_.playing) ctx_.PausePlay(!ctx_.paused);
    else ctx_.Status("Start Play mode first (F5)", 4.0f);
  }
  ImGui::SameLine();
  if (IconButton("step", IconType::Step, "Step one frame (F7)", false)) {
    if (ctx_.playing) ctx_.StepPlay();
    else ctx_.Status("Start Play mode first (F5)", 4.0f);
  }
  ImGui::SameLine();
  ImGui::TextDisabled("|");
  ImGui::SameLine();

  if (IconButton("translate", IconType::Translate, "Move tool (W)",
                 ctx_.gizmoMode == GizmoMode::Translate))
    ctx_.gizmoMode = GizmoMode::Translate;
  ImGui::SameLine();
  if (IconButton("rotate", IconType::Rotate, "Rotate tool (E)", ctx_.gizmoMode == GizmoMode::Rotate))
    ctx_.gizmoMode = GizmoMode::Rotate;
  ImGui::SameLine();
  if (IconButton("scale", IconType::Scale, "Scale tool (R)", ctx_.gizmoMode == GizmoMode::Scale))
    ctx_.gizmoMode = GizmoMode::Scale;
  ImGui::SameLine();
  if (IconButton("magnet", IconType::Magnet, "Toggle snapping (Ctrl while dragging also snaps)",
                 ctx_.snapEnabled))
    ctx_.snapEnabled = !ctx_.snapEnabled;
  ImGui::SameLine();
  if (IconButton("space", IconType::World,
                 ctx_.space == TransformSpace::World ? "World space (X to toggle)"
                                                     : "Local space (X to toggle)",
                 ctx_.space == TransformSpace::Local))
    ctx_.space = ctx_.space == TransformSpace::World ? TransformSpace::Local : TransformSpace::World;
  ImGui::SameLine();
  if (IconButton("grid", IconType::Grid, "Show grid (G)", ctx_.showGrid)) ctx_.showGrid = !ctx_.showGrid;
  ImGui::SameLine();
  ImGui::TextDisabled("|");
  ImGui::SameLine();
  if (IconButton("save", IconType::Save, "Save scene (Ctrl+S)")) ctx_.SaveScene(nullptr);
  ImGui::SameLine();
  if (IconButton("undo", IconType::Undo, "Undo (Ctrl+Z)")) ctx_.Undo();
  ImGui::SameLine();
  if (IconButton("redo", IconType::Redo, "Redo (Ctrl+Y)")) ctx_.Redo();
  ImGui::SameLine();
  if (IconButton("import", IconType::Import, "Import a 3D model (Ctrl+I)")) {
    std::string file = platform::OpenFileDialog(
        ctx_.window, "Import model",
        {{"3D models", "*.glb;*.gltf;*.obj;*.fbx"}, {"All files", "*.*"}});
    if (!file.empty()) ctx_.ImportAsset(file, true);
  }
  ImGui::SameLine();
  if (IconButton("build", IconType::Build, "Build game (Ctrl+B)")) ctx_.showBuildDialog = true;
  ImGui::SameLine();
  if (IconButton("ai", IconType::Sparkle, "AI assistant (Ctrl+I)", ctx_.showAiAssistant))
    ctx_.showAiAssistant = !ctx_.showAiAssistant;
  ImGui::SameLine();
  if (IconButton("settings", IconType::Gear, "Project settings")) ctx_.showSettings = !ctx_.showSettings;

  if (ctx_.playing) {
    ImGui::SameLine();
    ImGui::TextColored(ctx_.paused ? ImVec4(1.0f, 0.75f, 0.3f, 1.0f)
                                   : ImVec4(0.4f, 0.9f, 0.5f, 1.0f),
                       ctx_.paused ? "  PLAY MODE - PAUSED" : "  PLAY MODE");
  }
  ImGui::EndChild();
  ImGui::PopStyleVar();
}

void EditorApp::DrawStatusBar() {
  ImGuiViewport* viewport = ImGui::GetMainViewport();
  ImGui::SetNextWindowPos(ImVec2(viewport->Pos.x, viewport->Pos.y + viewport->Size.y - 26.0f));
  ImGui::SetNextWindowSize(ImVec2(viewport->Size.x, 26.0f));
  ImGui::SetNextWindowViewport(viewport->ID);
  ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                           ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoDocking |
                           ImGuiWindowFlags_NoBringToFrontOnFocus;
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(8.0f, 4.0f));
  ImGui::Begin("##statusbar", nullptr, flags);
  ImGui::PopStyleVar();

  std::vector<LogEntry> entries = Log::Get().Snapshot();
  int errors = 0, warnings = 0;
  for (const auto& entry : entries) {
    if (entry.level == LogLevel::Error || entry.level == LogLevel::Fatal) errors++;
    else if (entry.level == LogLevel::Warning) warnings++;
  }
  if (errors > 0) {
    ImGui::TextColored(ImVec4(1.0f, 0.45f, 0.45f, 1.0f), "%d errors", errors);
  } else {
    ImGui::TextDisabled("0 errors");
  }
  ImGui::SameLine();
  if (warnings > 0) ImGui::TextColored(ImVec4(1.0f, 0.8f, 0.4f, 1.0f), "%d warnings", warnings);
  else ImGui::TextDisabled("0 warnings");
  ImGui::SameLine();
  ImGui::TextDisabled("|");

  ImGui::SameLine();
  if (ctx_.statusTimer > 0.0f && !ctx_.statusMessage.empty()) ImGui::Text("%s", ctx_.statusMessage.c_str());
  else if (ctx_.HasProject())
    ImGui::TextDisabled("%s | %s | %zu objects | %s", ctx_.project.Settings().name.c_str(),
                        ctx_.sceneRelativePath.empty() ? "(unsaved scene)" : ctx_.sceneRelativePath.c_str(),
                        ctx_.scene.ObjectCount(),
                        ctx_.scene.IsDirty() ? "modified" : "saved");
  else ImGui::TextDisabled("No project open - use File > New Project");

  ImGui::SameLine(ImGui::GetWindowWidth() - 320.0f);
  ImGui::TextDisabled("%s | %.0f FPS | %.1f ms | %s", ctx_.renderer->BackendName(), fps_,
                      frameTimeMs_, ctx_.playing ? "playing" : "editing");
  ImGui::End();
}

// ------------------------------------------------------------------ dialogs
void EditorApp::DrawDialogs() {
  if (DrawNewProjectDialog()) return;
  if (DrawNewSceneDialog()) return;
  if (DrawSaveSceneAsDialog()) return;
  if (DrawCreateScriptDialog()) return;

  if (ctx_.showDeleteSceneDialog) {
    ImGui::OpenPopup("Delete Scene");
    ctx_.showDeleteSceneDialog = false;
  }
  if (ImGui::BeginPopupModal("Delete Scene", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
    ImGui::Text("Delete %s ?", ctx_.dialogSceneToDelete.c_str());
    ImGui::TextDisabled("This removes the file from disk. It cannot be undone.");
    ImGui::Separator();
    if (ImGui::Button("Delete", ImVec2(120, 0))) {
      std::string error;
      if (ctx_.project.DeleteScene(ctx_.dialogSceneToDelete, &error)) {
        ctx_.assets.Rescan();
        ctx_.Status("Deleted " + ctx_.dialogSceneToDelete);
      } else {
        ctx_.Status(error, 8.0f);
      }
      ImGui::CloseCurrentPopup();
    }
    ImGui::SameLine();
    if (ImGui::Button("Cancel", ImVec2(120, 0))) ImGui::CloseCurrentPopup();
    ImGui::EndPopup();
  }
}

bool EditorApp::DrawNewProjectDialog() {
  if (ctx_.showNewProjectDialog) {
    ImGui::OpenPopup("New Project");
    ctx_.showNewProjectDialog = false;
    snprintf(projectNameBuffer_, sizeof(projectNameBuffer_), "MyGame");
  }
  if (!ImGui::BeginPopupModal("New Project", nullptr, ImGuiWindowFlags_AlwaysAutoResize))
    return false;
  ImGui::Text("Create a new NovaForge project.");
  ImGui::TextDisabled("The project folder will contain project.json, Assets/ and Settings/.");
  ImGui::Separator();
  ImGui::SetNextItemWidth(360.0f);
  ImGui::InputText("Project name", projectNameBuffer_, sizeof(projectNameBuffer_));
  ImGui::SetNextItemWidth(360.0f);
  ImGui::InputText("Parent folder", projectFolderBuffer_, sizeof(projectFolderBuffer_));
  ImGui::SameLine();
  if (ImGui::Button("Browse...")) {
    std::string folder = platform::SelectFolderDialog(ctx_.window, "Choose the parent folder");
    if (!folder.empty())
      snprintf(projectFolderBuffer_, sizeof(projectFolderBuffer_), "%s", folder.c_str());
  }
  ImGui::Separator();
  bool valid = projectNameBuffer_[0] != '\0' && projectFolderBuffer_[0] != '\0';
  if (!valid) ImGui::TextDisabled("Enter a name and a folder.");
  if (ImGui::Button("Create", ImVec2(130, 0)) && valid) {
    ImGui::CloseCurrentPopup();
    CreateProject(projectFolderBuffer_, projectNameBuffer_);
  }
  ImGui::SameLine();
  if (ImGui::Button("Cancel", ImVec2(130, 0))) ImGui::CloseCurrentPopup();
  ImGui::EndPopup();
  return true;
}

bool EditorApp::DrawNewSceneDialog() {
  if (ctx_.showNewSceneDialog) {
    ImGui::OpenPopup("New Scene");
    ctx_.showNewSceneDialog = false;
  }
  if (!ImGui::BeginPopupModal("New Scene", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) return false;
  ImGui::Text("Create a scene inside this project.");
  ImGui::SetNextItemWidth(320.0f);
  ImGui::InputText("Scene name", sceneNameBuffer_, sizeof(sceneNameBuffer_));
  ImGui::Checkbox("Include starter content (ground, sun, camera, player)", &ctx_.dialogStarterContent);
  ImGui::Separator();
  if (ImGui::Button("Create", ImVec2(130, 0)) && sceneNameBuffer_[0]) {
    std::string relative;
    std::string error;
    if (ctx_.project.CreateScene(sceneNameBuffer_, ctx_.dialogStarterContent, &relative, &error)) {
      ctx_.assets.Rescan();
      OpenSceneFromBrowser(relative);
    } else {
      platform::ShowMessageBox("NovaForge", error, true);
    }
    ImGui::CloseCurrentPopup();
  }
  ImGui::SameLine();
  if (ImGui::Button("Cancel", ImVec2(130, 0))) ImGui::CloseCurrentPopup();
  ImGui::EndPopup();
  return true;
}

bool EditorApp::DrawSaveSceneAsDialog() {
  if (ctx_.showSaveSceneAsDialog) {
    ImGui::OpenPopup("Save Scene As");
    ctx_.showSaveSceneAsDialog = false;
  }
  if (!ImGui::BeginPopupModal("Save Scene As", nullptr, ImGuiWindowFlags_AlwaysAutoResize))
    return false;
  ImGui::Text("Project relative path:");
  ImGui::SetNextItemWidth(420.0f);
  ImGui::InputText("##path", scenePathBuffer_, sizeof(scenePathBuffer_));
  ImGui::TextDisabled("The .nfscene extension is added automatically.");
  ImGui::Separator();
  if (ImGui::Button("Save", ImVec2(130, 0))) {
    std::string error;
    if (!ctx_.SaveSceneAs(scenePathBuffer_, &error)) platform::ShowMessageBox("NovaForge", error, true);
    ImGui::CloseCurrentPopup();
  }
  ImGui::SameLine();
  if (ImGui::Button("Cancel", ImVec2(130, 0))) ImGui::CloseCurrentPopup();
  ImGui::EndPopup();
  return true;
}

bool EditorApp::DrawCreateScriptDialog() {
  if (ctx_.showCreateScriptDialog) {
    ImGui::OpenPopup("Create Script");
    ctx_.showCreateScriptDialog = false;
  }
  if (!ImGui::BeginPopupModal("Create Script", nullptr, ImGuiWindowFlags_AlwaysAutoResize))
    return false;
  ImGui::Text("Creates Assets/Scripts/<name>.nfscript");
  ImGui::SetNextItemWidth(300.0f);
  ImGui::InputText("Name", scriptNameBuffer_, sizeof(scriptNameBuffer_));
  auto behaviors = ScriptSystem::BuiltinBehaviors();
  if (ImGui::BeginCombo("Template", ctx_.dialogBehavior.c_str())) {
    for (const auto& behavior : behaviors) {
      bool selected = ctx_.dialogBehavior == behavior.name;
      if (ImGui::Selectable(behavior.name, selected)) ctx_.dialogBehavior = behavior.name;
      if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s\n%s", behavior.description, behavior.parameterHint);
    }
    ImGui::EndCombo();
  }
  ImGui::Separator();
  if (ImGui::Button("Create", ImVec2(130, 0)) && scriptNameBuffer_[0]) {
    std::string relative;
    if (ctx_.project.CreateScript(scriptNameBuffer_, ctx_.dialogBehavior, &relative)) {
      ctx_.assets.Rescan();
      ctx_.Status("Created " + relative);
    }
    ImGui::CloseCurrentPopup();
  }
  ImGui::SameLine();
  if (ImGui::Button("Cancel", ImVec2(130, 0))) ImGui::CloseCurrentPopup();
  ImGui::EndPopup();
  return true;
}

// ------------------------------------------------------------------ shortcuts
void EditorApp::HandleShortcuts() {
  ImGuiIO& io = ImGui::GetIO();
  if (io.WantTextInput) return;
  bool ctrl = io.KeyCtrl;
  bool shift = io.KeyShift;

  // always available
  if (ImGui::IsKeyPressed(ImGuiKey_F1, false)) ctx_.showShortcuts = !ctx_.showShortcuts;
  if (ImGui::IsKeyPressed(ImGuiKey_F5, false)) ctx_.TogglePlay();
  if (ImGui::IsKeyPressed(ImGuiKey_F6, false) && ctx_.playing) ctx_.PausePlay(!ctx_.paused);
  if (ImGui::IsKeyPressed(ImGuiKey_F7, false) && ctx_.playing) ctx_.StepPlay();
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_B, false)) ctx_.showBuildDialog = true;
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_I, false)) ctx_.showAiAssistant = !ctx_.showAiAssistant;

  if (ctx_.playing) return;   // gameplay owns the rest of the keyboard

  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_N, false)) {
    if (shift) {
      ctx_.showNewProjectDialog = true;
    } else if (ctx_.HasProject()) {
      ctx_.showNewSceneDialog = true;
    }
  }
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_O, false)) {
    std::string folder = platform::SelectFolderDialog(ctx_.window, "Select a NovaForge project folder");
    if (!folder.empty()) OpenProject(folder);
  }
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_S, false)) {
    if (shift) ctx_.showSaveSceneAsDialog = true;
    else ctx_.SaveScene(nullptr);
  }
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_Z, false)) ctx_.Undo();
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_Y, false)) ctx_.Redo();
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_D, false)) ctx_.CommandDuplicateSelection();
  if (ctrl && ImGui::IsKeyPressed(ImGuiKey_A, false)) ctx_.SelectAll();
  if (ImGui::IsKeyPressed(ImGuiKey_Delete, false)) ctx_.CommandDeleteSelection();
  if (ImGui::IsKeyPressed(ImGuiKey_W, false)) ctx_.gizmoMode = GizmoMode::Translate;
  if (ImGui::IsKeyPressed(ImGuiKey_E, false)) ctx_.gizmoMode = GizmoMode::Rotate;
  if (ImGui::IsKeyPressed(ImGuiKey_R, false)) ctx_.gizmoMode = GizmoMode::Scale;
  if (ImGui::IsKeyPressed(ImGuiKey_X, false))
    ctx_.space = ctx_.space == TransformSpace::World ? TransformSpace::Local : TransformSpace::World;
  if (ImGui::IsKeyPressed(ImGuiKey_G, false)) ctx_.showGrid = !ctx_.showGrid;
  if (ImGui::IsKeyPressed(ImGuiKey_F, false)) ctx_.FocusSelection();
  if (ImGui::IsKeyPressed(ImGuiKey_Escape, false)) ctx_.Deselect();
}

void EditorApp::OpenSceneFromBrowser(const std::string& relativePath) {
  std::string error;
  if (!ctx_.OpenScene(relativePath, &error)) {
    platform::ShowMessageBox("NovaForge", "Could not open scene:\n" + error, true);
  }
}

} // namespace nf
