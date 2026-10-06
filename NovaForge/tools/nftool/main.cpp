// NovaForge Engine - tools/nftool/main.cpp
// Head-less command line companion to the engine. It exercises the *same* engine
// modules the editor uses, which makes it the integration test harness:
//
//   nftool info  <project-dir>                     - dump project info
//   nftool build <project-dir> --out <dir>         - run the build system (no GUI)
//   nftool sim   <project-dir> [--frames N]        - simulate the scene head-less
//   nftool render <project-dir> --scenes <dir>     - software-rasterise reference frames
//   nftool test                                    - run self checks
#include "core/Base.h"
#include "core/Log.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "projectsystem/Project.h"
#include "scene/Scene.h"
#include "runtime/GameRuntime.h"
#include "buildsystem/BuildSystem.h"
#include "assets/AssetDatabase.h"

#include <cstdio>

using namespace nf;

namespace nf {
int RunSelfTest(bool windowsBuild, bool verbose);
int CreateSampleProject(const std::string& parentDir, const std::string& name,
                        std::string* outRoot);
}

static void PrintUsage() {
  printf(
      "NovaForge tool\n"
      "  nftool info   <project-dir>\n"
      "  nftool build  <project-dir> [--out <dir>]\n"
      "  nftool sim    <project-dir> [--frames N] [--scene name]\n"
      "  nftool render <project-dir> [--frames N] [--out <png-path>] [--scene name]\n"
      "  nftool new    <parent-dir> <ProjectName>       create a project on disk\n"
      "  nftool import <project-dir> --out <model.glb>  import a model into Assets/\n"
      "  nftool sample <parent-dir> [Name]              generate the bundled sample project\n"
      "  nftool test [--windows-build]                  integration self-test\n");
}

static int CmdInfo(const std::string& dir) {
  Project project;
  std::string err;
  if (!project.Load(dir, &err)) {
    printf("ERROR: %s\n", err.c_str());
    return 1;
  }
  const auto& s = project.Settings();
  printf("Project    : %s\n", s.name.c_str());
  printf("Directory  : %s\n", project.RootPath().c_str());
  printf("Version    : %s\n", s.version.c_str());
  printf("Resolution : %dx%d %s vsync=%s\n", s.width, s.height,
         s.fullscreen ? "fullscreen" : "windowed", s.vsync ? "on" : "off");
  printf("Start scene: %s\n", s.startScene.c_str());
  printf("Quality    : %d\n", s.quality);
  auto scenes = project.ListScenes();
  printf("Scenes (%zu):\n", scenes.size());
  for (auto& sc : scenes) printf("  - %s\n", sc.c_str());
  auto assets = fs::ListDirectory(project.AssetsPath(), true);
  usize assetCount = 0;
  for (auto& a : assets) if (!a.isDirectory) assetCount++;
  printf("Assets     : %zu files\n", assetCount);
  return 0;
}

static int CmdBuild(const std::string& dir, const std::string& out, bool compileExecutable = false) {
  Project project;
  std::string err;
  if (!project.Load(dir, &err)) {
    printf("ERROR: %s\n", err.c_str());
    return 1;
  }
  BuildRequest req;
  req.projectRoot = dir;
  req.outputDir = out.empty() ? fs::Join(dir, "Builds/Windows") : out;
  req.config = "Release";
  req.copyEngineSources = true;
  req.compileExecutable = compileExecutable;
  const std::string projectName = project.Settings().name;
  req.executableName = projectName.empty() ? "Game" : projectName;
  BuildSystem bs;
  BuildResult res = bs.Build(req, [](const std::string& step, f32 pct) {
    printf("[%3.0f%%] %s\n", pct * 100.0f, step.c_str());
    fflush(stdout);
  });
  printf("\n%s\n", res.message.c_str());
  if (res.success) {
    printf("Output: %s\n", res.outputExe.c_str());
    printf("Files : %d, bytes: %lld\n", res.fileCount, (long long)res.totalBytes);
  }
  return res.success ? 0 : 1;
}

static int CmdSim(const std::string& dir, int frames, const std::string& scene) {
  Project project;
  std::string err;
  if (!project.Load(dir, &err)) {
    printf("ERROR: %s\n", err.c_str());
    return 1;
  }
  GameRuntime rt;
  RuntimeConfig cfg;
  cfg.projectRoot = dir;
  cfg.headless = true;
  cfg.verbose = true;
  cfg.sceneToLoad = scene;
  if (!rt.Initialize(cfg, &err)) {
    printf("ERROR: %s\n", err.c_str());
    return 1;
  }
  rt.StartPlay();
  for (int i = 0; i < frames; i++) rt.Tick(1.0f / 60.0f);

  const RuntimeStats& stats = rt.Stats();
  const RuntimeHud& hud = rt.Hud();
  printf("\n--- simulation report after %d frames ---\n", frames);
  printf("objects        : %zu\n", rt.GameScene().ObjectCount());
  printf("physics bodies : %zu\n", rt.Physics().BodyCount());
  printf("runtime stats  : drawn %zu | culled %zu | triangles %zu | batches %zu\n",
         stats.drawnObjects, stats.culledObjects, stats.triangles, stats.instancedBatches);
  printf("physics stats  : bodies %u | sleeping %u | contacts %u | trigger events %u\n",
         stats.activeBodies, stats.sleepingBodies, stats.contacts, stats.triggerEvents);
  printf("simulation     : %.2f ms/frame, %.0f fps\n", stats.simulationMs,
         stats.fps > 0.0f ? stats.fps : 60.0f);
  printf("hud            : health %.0f/%.0f (%s) | messages %zu\n", hud.healthValue, hud.maxHealth,
         hud.showHealth ? "visible" : "hidden", hud.messages.size());
  EntityId player = rt.PlayerObject();
  if (player != 0) {
    Transform t = rt.GameScene().WorldTransform(player);
    printf("player pos     : %.3f %.3f %.3f  grounded=%s\n", t.position.x, t.position.y,
           t.position.z, rt.PlayerGrounded() ? "yes" : "no");
  } else {
    printf("player         : none in start scene\n");
  }
  for (auto& ev : rt.ConsumeEvents()) printf("event          : %s\n", ev.c_str());
  rt.Shutdown();
  return 0;
}

static int CmdRender(const std::string& dir, int frames, const std::string& out,
                     const std::string& scene) {
  Project project;
  std::string err;
  if (!project.Load(dir, &err)) { printf("ERROR: %s\n", err.c_str()); return 1; }
  GameRuntime rt;
  RuntimeConfig cfg;
  cfg.projectRoot = dir;
  cfg.headless = true;
  cfg.softwareRasterizer = true;
  cfg.sceneToLoad = scene;
  if (!rt.Initialize(cfg, &err)) { printf("ERROR: %s\n", err.c_str()); return 1; }
  rt.StartPlay();
  for (int i = 0; i < frames; i++) rt.Tick(1.0f / 60.0f);
  std::string path = out.empty() ? fs::Join(dir, "Logs/frame.png") : out;
  if (!rt.SaveSoftwareFrame(path)) { printf("ERROR: could not write %s\n", path.c_str()); return 1; }
  printf("wrote %s\n", path.c_str());
  rt.Shutdown();
  return 0;
}

// Creates a fresh project folder (same code path as the editor's New Project dialog).
static int CmdNew(const std::string& parentDir, const std::string& name) {
  if (name.empty()) {
    printf("ERROR: project name required (nftool new <parent-dir> <Name>)\n");
    return 1;
  }
  Project project;
  std::string err;
  std::string root = fs::Join(parentDir, name);
  if (!project.CreateNew(parentDir, name, &err)) {
    printf("ERROR: %s\n", err.c_str());
    return 1;
  }
  printf("Created project '%s' in %s\n", name.c_str(), root.c_str());
  for (const auto& scene : project.ListScenes()) printf("  scene  : %s\n", scene.c_str());
  for (const auto& script : project.ListScripts()) printf("  script : %s\n", script.c_str());
  return 0;
}

// Imports a model/texture through the real importer stack into the project's Assets folder.
static int CmdImport(const std::string& dir, const std::string& sourceFile) {
  Project project;
  std::string err;
  if (!project.Load(dir, &err)) {
    printf("ERROR: %s\n", err.c_str());
    return 1;
  }
  if (sourceFile.empty() || !fs::Exists(sourceFile)) {
    printf("ERROR: source file not found: %s\n", sourceFile.c_str());
    return 1;
  }
  std::string extension = ToLower(fs::Extension(sourceFile));
  bool isImage = (extension == "png" || extension == "jpg" || extension == "jpeg" ||
                  extension == "bmp" || extension == "tga");
  bool isAudio = (extension == "wav" || extension == "mp3" || extension == "ogg" ||
                  extension == "flac");
  AssetDatabase assets;
  assets.SetProjectRoot(project.RootPath());

  ImportedAsset imported;
  if (isImage) {
    imported = assets.ImportTextureFile(sourceFile);
  } else if (isAudio) {
    imported = assets.ImportAudioFile(sourceFile);
  } else {
    imported = assets.ImportMeshFile(sourceFile);
  }
  if (!imported.success) {
    printf("ERROR: import failed: %s\n", imported.error.c_str());
    return 1;
  }
  printf("Imported %s\n", imported.assetPath.c_str());
  printf("  vertices %d | triangles %d | materials %d | animations %d\n", imported.vertexCount,
         imported.triangleCount, imported.materialCount, imported.animationCount);
  for (const auto& file : imported.createdFiles) printf("  created: %s\n", file.c_str());
  if (!imported.warning.empty()) printf("  warning: %s\n", imported.warning.c_str());
  return 0;
}

int main(int argc, char** argv) {
  std::vector<std::string> args(argv + (argc > 0 ? 1 : 0), argv + argc);
  Log::Get().SetMinLevel(LogLevel::Info);
  if (args.empty()) { PrintUsage(); return 1; }

  std::string cmd = args[0];
  std::string dir = args.size() > 1 ? args[1] : ".";
  std::string out, sceneName;
  int frames = 120;
  for (usize i = 2; i < args.size(); i++) {
    if (args[i] == "--out" && i + 1 < args.size()) out = args[++i];
    else if (args[i] == "--frames" && i + 1 < args.size()) frames = atoi(args[++i].c_str());
    else if (args[i] == "--scene" && i + 1 < args.size()) sceneName = args[++i];
  }
  NF_UNUSED(sceneName);

  if (cmd == "info") return CmdInfo(dir);
  if (cmd == "build") {
    bool compileExecutable = false;
    for (const auto& a : args)
      if (a == "--compile") compileExecutable = true;
    return CmdBuild(dir, out, compileExecutable);
  }
  if (cmd == "sim") return CmdSim(dir, frames, sceneName);
  if (cmd == "render") return CmdRender(dir, frames, out, sceneName);
  if (cmd == "new") return CmdNew(dir, out);
  if (cmd == "import") return CmdImport(dir, out);
  if (cmd == "sample") return CreateSampleProject(dir, out, nullptr);
  if (cmd == "test") {
    bool windowsBuild = false;
    bool verbose = false;
    for (const auto& a : args) {
      if (a == "--windows-build") windowsBuild = true;
      if (a == "-v" || a == "--verbose") verbose = true;
    }
    return RunSelfTest(windowsBuild, verbose);
  }
  PrintUsage();
  return 1;
}
