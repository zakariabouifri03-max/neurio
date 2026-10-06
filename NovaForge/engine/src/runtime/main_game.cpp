// NovaForge Engine - runtime/main_game.cpp
// Entry point of an EXPORTED GAME (NovaForgeGame -> Build/<Game>/<Game>.exe).
//
// This is deliberately *not* the editor: it links only the engine runtime + renderer +
// platform layer, loads the packaged project.json / Assets / Scenes that the build
// system staged next to the executable, and runs the very same GameRuntime class the
// editor uses for Play mode.
#include "runtime/GameRuntime.h"
#include "renderer/Renderer.h"
#include "renderer/GLFunctions.h"
#include "renderer/SoftwareRasterizer.h"
#include "platform/Platform.h"
#include "projectsystem/Project.h"
#include "core/Log.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Time.h"

#include "imgui.h"
#include "imgui_impl_opengl3.h"
#if NF_PLATFORM_WINDOWS
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include "imgui_impl_win32.h"
#endif

#include <memory>
#include <string>
#include <vector>

namespace nf {
namespace {

struct GameArguments {
  std::string projectRoot;       // defaults to the executable folder
  bool showConsole = false;      // --console keeps the log window visible
  bool hudVisible = true;        // F1 toggles the on-screen HUD
  std::string scene;             // "" = project start scene
  bool windowed = false;
  bool headless = false;
  bool verbose = false;
  bool captureMouse = true;
  int width = 0;
  int height = 0;
  int frames = 0;                // >0: run N frames then exit (automated verification)
  std::string screenshot;        // write a PNG after the last frame
  bool showHelp = false;
};

GameArguments ParseArguments(const std::vector<std::string>& arguments) {
  GameArguments args;
  for (usize i = 0; i < arguments.size(); i++) {
    const std::string& a = arguments[i];
    if (a == "--windowed" || a == "-w") args.windowed = true;
    else if (a == "--fullscreen") args.windowed = false;
    else if (a == "--headless") args.headless = true;
    else if (a == "--verbose" || a == "-v") args.verbose = true;
    else if (a == "--no-mouse-capture") args.captureMouse = false;
    else if (a == "--scene" && i + 1 < arguments.size()) args.scene = arguments[++i];
    else if (a == "--project" && i + 1 < arguments.size()) args.projectRoot = arguments[++i];
    else if (a == "--console") args.showConsole = true;
    else if (a == "--frames" && i + 1 < arguments.size()) args.frames = std::atoi(arguments[++i].c_str());
    else if (a == "--screenshot" && i + 1 < arguments.size()) args.screenshot = arguments[++i];
    else if (a == "--width" && i + 1 < arguments.size()) args.width = std::atoi(arguments[++i].c_str());
    else if (a == "--height" && i + 1 < arguments.size()) args.height = std::atoi(arguments[++i].c_str());
    else if (a == "--help" || a == "-h" || a == "/?") args.showHelp = true;
  }
  return args;
}

std::vector<std::string> SplitCommandLine(const std::string& raw) {
  std::vector<std::string> out;
  std::string current;
  bool quoted = false;
  for (char c : raw) {
    if (c == '"') { quoted = !quoted; continue; }
    if (c == ' ' && !quoted) {
      if (!current.empty()) out.push_back(current);
      current.clear();
      continue;
    }
    current.push_back(c);
  }
  if (!current.empty()) out.push_back(current);
  return out;
}

void DrawHud(GameRuntime& runtime, const ProjectSettings& settings, bool showPauseMenu) {
  const RuntimeHud& hud = runtime.Hud();
  ImGuiIO& io = ImGui::GetIO();
  ImDrawList* draw = ImGui::GetBackgroundDrawList();

  if (hud.showHealth) {
    ImVec2 min(28.0f, io.DisplaySize.y - 62.0f);
    ImVec2 max(min.x + 240.0f, min.y + 18.0f);
    draw->AddRectFilled(min, max, IM_COL32(15, 16, 20, 215), 4.0f);
    ImVec2 fill(min.x + (max.x - min.x) * Clamp(hud.healthPercent, 0.0f, 1.0f), max.y);
    draw->AddRectFilled(min, fill, hud.healthPercent > 0.3f ? IM_COL32(205, 70, 70, 240)
                                                            : IM_COL32(235, 40, 40, 245), 4.0f);
    char text[64];
    snprintf(text, sizeof(text), "HP  %.0f / %.0f", hud.healthValue, hud.maxHealth);
    draw->AddText(ImVec2(min.x + 8.0f, min.y - 18.0f), IM_COL32(238, 240, 246, 240), text);
  }
  if (hud.showObjective && !hud.objective.empty()) {
    draw->AddText(ImVec2(28.0f, 26.0f), IM_COL32(240, 230, 170, 240), hud.objective.c_str());
  }
  if (hud.showPrompt && !hud.interactionPrompt.empty()) {
    ImVec2 size = ImGui::CalcTextSize(hud.interactionPrompt.c_str());
    draw->AddText(ImVec2(io.DisplaySize.x * 0.5f - size.x * 0.5f, io.DisplaySize.y * 0.58f),
                  IM_COL32(250, 240, 180, 245), hud.interactionPrompt.c_str());
  }
  f32 y = io.DisplaySize.y - 110.0f;
  for (const auto& message : hud.messages) {
    ImU32 color = IM_COL32(228, 233, 245, 235);
    if (message.type == 1) color = IM_COL32(250, 205, 120, 240);
    if (message.type == 2) color = IM_COL32(150, 240, 165, 240);
    draw->AddText(ImVec2(28.0f, y), color, message.text.c_str());
    y -= 20.0f;
  }
  if (hud.dead) {
    const char* text = "YOU DIED  -  press R to respawn";
    ImVec2 size = ImGui::CalcTextSize(text);
    draw->AddText(ImVec2(io.DisplaySize.x * 0.5f - size.x * 0.5f, io.DisplaySize.y * 0.42f),
                  IM_COL32(255, 85, 85, 245), text);
  }
  if (settings.showFpsInGame || showPauseMenu) {
    char text[96];
    snprintf(text, sizeof(text), "%u FPS | %.1f ms", hud.fps, hud.deltaTime * 1000.0f);
    draw->AddText(ImVec2(io.DisplaySize.x - 150.0f, 12.0f), IM_COL32(200, 210, 225, 200), text);
  }

  if (showPauseMenu) {
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                            ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(320.0f, 0.0f));
    ImGui::Begin("Paused", nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse |
                                       ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoMove);
    ImGui::TextColored(ImVec4(0.8f, 0.85f, 1.0f, 1.0f), settings.name.c_str());
    ImGui::Separator();
    if (ImGui::Button("Resume", ImVec2(-1.0f, 30.0f))) runtime.Resume();
    if (ImGui::Button("Restart Scene", ImVec2(-1.0f, 30.0f))) {
      runtime.StopPlay();
      runtime.LoadScene("");
      runtime.StartPlay();
    }
    ImGui::Separator();
    ImGui::TextDisabled("Controls");
    ImGui::BulletText("WASD - move, Space - jump");
    ImGui::BulletText("Shift - sprint, Mouse - look");
    ImGui::BulletText("E - interact, LMB / F - attack");
    ImGui::BulletText("F5 - quick save, Esc - pause");
    ImGui::Separator();
    if (ImGui::Button("Quit to Desktop", ImVec2(-1.0f, 30.0f))) runtime.StopPlay();
    ImGui::End();
  }
}

int RunGame(const std::vector<std::string>& arguments) {
  GameArguments args = ParseArguments(arguments);
  if (args.showHelp) {
    const char* help =
        "NovaForge game runtime\n"
        "Usage: <Game>.exe [--windowed] [--headless] [--scene <path>] [--frames N]\n"
        "                  [--screenshot file.png] [--width W] [--height H] [--verbose]\n";
#if NF_PLATFORM_WINDOWS
    MessageBoxA(nullptr, help, "NovaForge", MB_OK | MB_ICONINFORMATION);
#else
    fprintf(stdout, "%s", help);
#endif
    return 0;
  }

  std::string projectRoot = args.projectRoot;
  if (projectRoot.empty()) projectRoot = fs::ExecutableDirectory();
  projectRoot = fs::Normalize(projectRoot);

  fs::CreateDirectories(fs::Join(projectRoot, "Logs"));
  Log::Get().OpenFile(fs::Join(projectRoot, "Logs/Game.log"));
  Log::Get().SetMinLevel(args.verbose ? LogLevel::Debug : LogLevel::Info);
  Log::Get().Write(LogLevel::Info, LogCategory::Runtime, "Game runtime starting in %s",
                   projectRoot.c_str());

  Project project;
  std::string error;
  ProjectSettings settings;
  if (project.Load(projectRoot, &error)) {
    settings = project.Settings();
  } else {
    // A packaged game always ships project.json. Falling back keeps a manual copy
    // of the exe usable instead of crashing on a missing file.
    Log::Get().Write(LogLevel::Warning, LogCategory::Runtime,
                     "project.json not found (%s) - using built-in defaults", error.c_str());
    settings.ApplyDefaults();
    settings.startScene = "Assets/Scenes/Main.nfscene";
  }

  // ---------------------------------------------------------------- window + renderer
  std::unique_ptr<platform::Window> window;
  Renderer* renderer = nullptr;
  bool haveGpu = false;
  int width = args.width > 0 ? args.width : settings.width;
  int height = args.height > 0 ? args.height : settings.height;

  if (!args.headless) {
    platform::PlatformInitialize();
    if (settings.showConsoleWindow || args.showConsole)
      platform::EnsureConsoleVisible();
    else
      platform::SetConsoleVisible(false);   // console-subsystem build: hide the log window
    window = platform::CreatePlatformWindow();
    platform::WindowDesc desc;
    desc.title = settings.name;
    desc.width = width;
    desc.height = height;
    desc.vsync = settings.vsync;
    desc.fullscreen = settings.fullscreen && !args.windowed;
    desc.resizable = settings.allowWindowedToggle;
    desc.showConsole = settings.showConsoleWindow;
    if (!window || !window->Create(desc)) {
      Log::Get().Write(LogLevel::Error, LogCategory::Runtime, "could not create the game window");
      window.reset();
    } else {
      renderer = Renderer::Create();
      std::string rendererError;
      if (renderer && renderer->Initialize(window->NativeHandle(), width, height, &rendererError)) {
        haveGpu = true;
      } else {
        Log::Get().Write(LogLevel::Error, LogCategory::Runtime,
                         "OpenGL renderer unavailable (%s) - the game will run head-less",
                         rendererError.c_str());
        delete renderer;
        renderer = nullptr;
      }
    }
  }

  // ------------------------------------------------------------------- runtime
  RuntimeConfig config;
  config.projectRoot = projectRoot.empty() ? fs::CurrentWorkingDirectory() : projectRoot;
  config.sceneToLoad = args.scene.empty() ? settings.startScene : args.scene;
  config.headless = !haveGpu;
  config.verbose = args.verbose;
  config.startPlaying = true;
  config.input = (window && haveGpu) ? &window->Input() : nullptr;

  GameRuntime runtime;
  if (!runtime.Initialize(config, &error)) {
    Log::Get().Write(LogLevel::Error, LogCategory::Runtime, "runtime initialisation failed: %s",
                     error.c_str());
#if NF_PLATFORM_WINDOWS
    platform::ShowMessageBox(settings.name + " - NovaForge", "Could not start the game:\n" + error, true);
#endif
    if (window) window->Destroy();
    platform::PlatformShutdown();
    return 1;
  }
  runtime.ApplyProjectSettings();
  project.Close();

  if (renderer) renderer->SetAssetDatabase(&runtime.Assets());

  // ------------------------------------------------------------------- ImGui HUD
  bool imguiReady = false;
  if (haveGpu && window) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    ImGui::StyleColorsDark();
#if NF_PLATFORM_WINDOWS
    imguiReady = ImGui_ImplWin32_Init(window->NativeHandle()) && ImGui_ImplOpenGL3_Init("#version 330");
#endif
    if (!imguiReady) Log::Get().Write(LogLevel::Warning, LogCategory::Runtime, "HUD overlay disabled");
  }

  if (haveGpu && window && args.captureMouse) window->SetMouseCaptured(true);

  // ------------------------------------------------------------------- loop
  f64 last = NowSeconds();
  u64 frame = 0;
  bool paused = false;
  bool running = true;
  while (running) {
    if (window) {
      window->PollEvents();
      if (window->ShouldClose()) break;
      if (window->IsMinimized()) {
        platform::SleepMs(10);
        continue;
      }
    }

    f64 now = NowSeconds();
    f32 delta = (f32)std::min(0.1, std::max(0.0, now - last));
    last = now;
    frame++;

    platform::InputState* input = window ? &window->Input() : nullptr;
    if (input) {
      // Escape toggles the pause menu, F5 quick saves, R respawns a dead player
      if (input->WasKeyPressed(platform::Key::Escape)) {
        paused = !paused;
        if (window) window->SetMouseCaptured(!paused && args.captureMouse);
      }
#if NF_PLATFORM_WINDOWS
      if (input->WasKeyPressed(platform::Key::F11) && window && settings.allowWindowedToggle) {
        static bool fullscreen = settings.fullscreen;
        fullscreen = !fullscreen;
        window->SetFullscreen(fullscreen);
      }
#endif
      if (input->WasKeyPressed(platform::Key::F1)) args.hudVisible = !args.hudVisible;
      if (input->WasKeyPressed(platform::Key::F5)) {
        std::string saveError;
        if (runtime.SaveCurrentScene(&saveError)) {
          runtime.PushMessage("Game saved", 2, 2.5f);
        } else {
          runtime.PushMessage("Save failed: " + saveError, 1, 4.0f);
        }
      }
      if (paused) {
        if (input->WasKeyPressed(platform::Key::Escape)) paused = false;
        if (!runtime.IsPaused()) runtime.Pause();
        if (input->WasMousePressed(platform::MouseButton::Left) && window && !window->IsMouseCaptured()) {
          // clicking the (ImGui) pause menu must not re-capture the cursor
        }
      } else {
        if (runtime.IsPaused()) runtime.Resume();
        if (window && args.captureMouse && !window->IsMouseCaptured() &&
            input->WasMousePressed(platform::MouseButton::Left)) {
          window->SetMouseCaptured(true);
        }
      }
      if (!paused) runtime.Tick(delta);
    } else {
      runtime.Tick(delta);
    }

    // ------------------------------------------------------------- rendering
    if (renderer && window) {
      RenderSettings renderSettings = runtime.Settings();
      renderSettings.width = window->Width();
      renderSettings.height = window->Height();
      renderSettings.vsync = settings.vsync;
      renderSettings.quality = settings.quality;

      RenderView view = runtime.MakeGameView((f32)renderSettings.width / (f32)std::max(1, renderSettings.height));
      RenderScene renderScene;
      runtime.ExtractRenderScene(view, renderScene, renderSettings);

      if (imguiReady) {
#if NF_PLATFORM_WINDOWS
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplWin32_NewFrame();
#endif
        ImGui::GetIO().DeltaTime = delta > 0.0f ? delta : 1.0f / 60.0f;
        ImGui::NewFrame();
      }

      renderer->BeginFrame(renderSettings);
      renderer->RenderScene(renderScene, view, renderSettings, runtime.DebugDraw());
      if (imguiReady) {
        if (args.hudVisible) DrawHud(runtime, settings, paused);
        ImGui::Render();
        gl::glBindFramebuffer(gl::GL_FRAMEBUFFER, 0);
        gl::glViewport(0, 0, renderSettings.width, renderSettings.height);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
      }
      renderer->EndFrame(settings.vsync);
      window->SwapBuffers();
    } else {
      // head-less: keep the simulation at a stable 60 Hz
      platform::SleepMs(16);
    }

    if (args.frames > 0 && (i32)frame >= args.frames) running = false;
  }

  // ------------------------------------------------------------------- shutdown
  if (!args.screenshot.empty()) {
    bool ok = false;
    if (renderer && window && haveGpu) {
      // GPU capture: read the window backbuffer and write it as a PNG
      FrameCapture capture = renderer->CaptureFrame();
      if (capture.valid) {
        ok = SoftwareRasterizer::WritePng(args.screenshot, capture.rgba, capture.width,
                                          capture.height);
      }
    }
    if (!ok) ok = runtime.SaveSoftwareFrame(args.screenshot);
    Log::Get().Write(ok ? LogLevel::Info : LogLevel::Error, LogCategory::Runtime,
                     ok ? "screenshot written to %s" : "could not write the screenshot %s",
                     args.screenshot.c_str());
  }

  runtime.Shutdown();
  if (imguiReady) {
#if NF_PLATFORM_WINDOWS
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplWin32_Shutdown();
#endif
    ImGui::DestroyContext();
  }
  if (renderer) {
    renderer->Shutdown();
    delete renderer;
  }
  if (window) {
    window->Destroy();
    window.reset();
  }
  if (!args.headless) platform::PlatformShutdown();
  Log::Get().Write(LogLevel::Info, LogCategory::Runtime, "Game runtime stopped after %llu frames",
                   (unsigned long long)frame);
  Log::Get().CloseFile();
  return 0;
}

} // namespace
} // namespace nf

#if NF_PLATFORM_WINDOWS
int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR commandLine, int) {
  return nf::RunGame(nf::SplitCommandLine(commandLine ? commandLine : ""));
}
#endif

int main(int argc, char** argv) {
  std::vector<std::string> arguments;
  for (int i = 1; i < argc; i++) arguments.push_back(argv[i]);
  return nf::RunGame(arguments);
}
