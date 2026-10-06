// NovaForge Engine - buildsystem/BuildSystem.h
// Packages a project into a standalone Windows game:
//
//   Builds/Windows/<Game>/<Game>.exe      real compiled runtime (never a renamed editor)
//   Builds/Windows/<Game>/project.json    build-stamped project settings
//   Builds/Windows/<Game>/Assets/...      content (models, textures, scenes, scripts)
//   Builds/Windows/<Game>/Engine/Source/  engine + compiler driver used for the build
//   Builds/Windows/<Game>/Build.bat       one-click rebuild on any Windows machine
//   Builds/Windows/<Game>/BuildReport.txt verification result
#pragma once

#include "core/Base.h"
#include "projectsystem/Project.h"

namespace nf {

struct BuildRequest {
  std::string projectRoot;                  // absolute project directory
  std::string outputDir;                    // "" = <project>/Builds/Windows
  std::string config = "Release";           // Debug | Release
  std::string configuration = "Release";
  std::string targetPlatform = "Windows";
  bool copyEngineSources = true;            // ship the engine sources + rebuild scripts
  bool compileExecutable = true;            // false = package only (asset/content build)
  bool verbose = false;
  bool stripDebugInfo = true;
  std::string executableName;               // "" = project name
  std::string engineSourceDir;              // "" = autodetect (editor knows its own tree)
  int parallelJobs = 2;
};

struct BuildStep {
  std::string name;
  bool success = true;
  std::string detail;
  f64 seconds = 0.0;
};

struct BuildResult {
  bool success = false;
  std::string message;                      // human readable summary
  std::string outputDirectory;
  std::string outputExe;
  int fileCount = 0;
  long long totalBytes = 0;
  std::vector<BuildStep> steps;
  std::vector<std::string> warnings;
  std::vector<std::string> errors;
  std::string reportPath;
  std::string toolchainUsed;
  bool executableCompiled = false;          // false when only sources+scripts were packaged
};

using BuildProgressFn = std::function<void(const std::string& step, f32 progress)>;

class BuildSystem {
public:
  BuildSystem();
  ~BuildSystem();

  BuildResult Build(const BuildRequest& request, BuildProgressFn onProgress = nullptr);

  // Verifies an already built package (used by the editor's "Verify Build" action and CI).
  struct VerificationResult {
    bool valid = false;
    bool exeExists = false;
    bool exeIsWindowsBinary = false;
    bool executableFormatValid = false;
    bool is64Bit = false;
    bool projectJsonPresent = false;
    bool startScenePresent = false;
    bool assetsPresent = false;
    long long exeBytes = 0;
    std::string machineType;
    std::string subsystem;
    std::string report;
    std::vector<std::string> problems;
  };
  // `requireExecutable` = false for package-only builds (no compiler requested).
  static VerificationResult VerifyPackage(const std::string& packageDirectory,
                                          bool requireExecutable = true);

  // Locates the engine source tree (works from the editor, the repo or the packaged build).
  static std::string DetectEngineSourceDirectory();
  static std::string DetectToolchain(std::string* compilerPath = nullptr);

private:
  bool CompileGameExecutable(const BuildRequest& request, const Project& project,
                             const std::string& stageDir, const std::string& exeName,
                             BuildResult& result, BuildProgressFn onProgress);
  bool WriteRebuildScripts(const BuildRequest& request, const std::string& stageDir,
                          const std::string& exeName, BuildResult& result);
  bool WriteBuildConfigHeader(const std::string& stageDir, const Project& project,
                              const BuildRequest& request, BuildResult& result);
  BuildResult* current_ = nullptr;
};

} // namespace nf
