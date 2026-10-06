// NovaForge Engine - buildsystem/BuildSystem.cpp
#include "buildsystem/BuildSystem.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"
#include "core/Time.h"
#include "core/ThreadPool.h"

#include <cstdio>
#include <cctype>
#include <functional>
#include <thread>
#include <atomic>
#include <mutex>

namespace nf {

namespace {

struct SourceList {
  std::vector<std::string> engine;      // absolute paths
  std::vector<std::string> vendor;
  std::vector<std::string> includes;    // -I directories
};

bool IsEditorSource(const std::string& path) {
  bool inEditor = path.find("src/editor/") != std::string::npos ||
                  path.find("src\\editor\\") != std::string::npos;
  if (!inEditor) return false;
  // EditorContext.cpp is the shared editor state hub: the AI assistant (which lives in the
  // engine library) plans against it, so exported games link it as well. The editor panels,
  // app and viewport are editor-only and stay out of a game build.
  if (path.find("EditorContext.cpp") != std::string::npos) return false;
  return true;
}

bool IsPlatformExcluded(const std::string& path, const std::string& targetPlatform) {
  bool onWindows = path.find("platform/win32") != std::string::npos ||
                   path.find("platform\\win32") != std::string::npos;
  bool nullPlatform = path.find("platform/null") != std::string::npos ||
                      path.find("platform\\null") != std::string::npos;
  // the platform name may arrive as "Windows", "windows" or "win64" - compare case-insensitively
  std::string lowered = targetPlatform;
  for (char& c : lowered) c = (char)tolower((unsigned char)c);
  bool windowsTarget = lowered.find("win") == 0;
  return windowsTarget ? nullPlatform : onWindows;
}

SourceList GatherSources(const std::string& engineRoot, const std::string& targetPlatform) {
  SourceList list;
  auto collect = [&](const std::string& directory, std::vector<std::string>* out, bool skipEditor) {
    for (auto& file : fs::ListDirectory(directory, true)) {
      if (file.isDirectory || file.extension != "cpp") continue;
      std::string path = file.path;
      if (skipEditor && IsEditorSource(path)) continue;
      if (IsPlatformExcluded(path, targetPlatform)) continue;
      out->push_back(path);
    }
  };
  collect(fs::Join(engineRoot, "engine/src"), &list.engine, true);
  // vendor sources the runtime needs (ImGui core + the platform backends for the in-game HUD)
  std::string imgui = fs::Join(engineRoot, "vendor/imgui");
  for (const char* file : {"imgui.cpp", "imgui_draw.cpp", "imgui_tables.cpp", "imgui_widgets.cpp"}) {
    std::string path = fs::Join(imgui, file);
    if (fs::Exists(path)) list.vendor.push_back(path);
  }
  for (const char* file : {"imgui_impl_win32.cpp", "imgui_impl_opengl3.cpp"}) {
    std::string path = fs::Join(imgui, "backends/" + std::string(file));
    if (fs::Exists(path)) list.vendor.push_back(path);
  }
  list.includes.push_back(fs::Join(engineRoot, "engine/src"));
  list.includes.push_back(imgui);
  list.includes.push_back(fs::Join(imgui, "backends"));
  list.includes.push_back(fs::Join(engineRoot, "vendor/miniaudio"));
  list.includes.push_back(fs::Join(engineRoot, "vendor/stb"));
  return list;
}

std::string Quote(const std::string& value) {
  if (value.find(' ') == std::string::npos) return value;
  return "\"" + value + "\"";
}

std::string ReadFileHeader(const std::string& path) {
  std::vector<u8> bytes = fs::ReadBinary(path);
  return std::string((const char*)bytes.data(), std::min<usize>(bytes.size(), 256));
}

} // namespace

// ---------------------------------------------------------------- constructor
BuildSystem::BuildSystem() {}
BuildSystem::~BuildSystem() {}

std::string BuildSystem::DetectEngineSourceDirectory() {
  // 1) next to the running executable
  std::string exeDir = fs::ExecutableDirectory();
  std::vector<std::string> candidates = {
      exeDir,
      fs::Join(exeDir, ".."),
      fs::Join(exeDir, "../.."),
      fs::Join(exeDir, "../../.."),
      fs::CurrentWorkingDirectory(),
      fs::Join(fs::CurrentWorkingDirectory(), ".."),
      fs::Join(fs::CurrentWorkingDirectory(), "../.."),
      fs::Join(fs::CurrentWorkingDirectory(), "NovaForge"),
  };
  for (auto& candidate : candidates) {
    std::string path = fs::Normalize(candidate);
    if (fs::IsDirectory(fs::Join(path, "engine/src")) &&
        fs::IsDirectory(fs::Join(path, "vendor/imgui"))) {
      return path;
    }
  }
  return {};
}

std::string BuildSystem::DetectToolchain(std::string* compilerPath) {
  auto exists = [](const std::string& path) { return fs::IsFile(path); };
  std::string exeDir = fs::ExecutableDirectory();
  // 0) explicit override: NOVAFORGE_ZIG=/path/to/zig
  if (const char* override = getenv("NOVAFORGE_ZIG")) {
    if (override[0] != '\0' && exists(override)) {
      if (compilerPath) *compilerPath = override;
      return "zig (NOVAFORGE_ZIG)";
    }
  }
  // 1) a bundled toolchain shipped next to the editor
  for (const char* name : {"zig.exe", "zig"}) {
    std::string path = fs::Join(exeDir, name);
    if (exists(path)) {
      if (compilerPath) *compilerPath = path;
      return "bundled zig";
    }
  }
  // 2) zig on PATH
  if (system("zig version > nul 2>&1") == 0 || system("zig version > /dev/null 2>&1") == 0) {
    if (compilerPath) *compilerPath = "zig";
    return "zig";
  }
  // 3) python-provided ziglang wheel
  if (system("python -m ziglang version > nul 2>&1") == 0 ||
      system("python3 -m ziglang version > /dev/null 2>&1") == 0) {
    if (compilerPath) *compilerPath = "python -m ziglang";
    return "ziglang (python)";
  }
  // 4) MSVC
  if (system("cl > nul 2>&1") == 0 || system("cl > /dev/null 2>&1") == 0) {
    if (compilerPath) *compilerPath = "cl";
    return "MSVC";
  }
  // 5) mingw
  if (system("g++ --version > nul 2>&1") == 0 || system("g++ --version > /dev/null 2>&1") == 0) {
    if (compilerPath) *compilerPath = "g++";
    return "g++ (mingw)";
  }
  return {};
}

// ------------------------------------------------------------------ build
BuildResult BuildSystem::Build(const BuildRequest& request, BuildProgressFn onProgress) {
  BuildResult result;
  auto step = [&](const std::string& name, f32 progress) {
    if (onProgress) onProgress(name, progress);
    Log::Get().Write(LogLevel::Info, LogCategory::Build, "%s", name.c_str());
  };
  auto fail = [&](const std::string& name, const std::string& error) {
    BuildStep buildStep;
    buildStep.name = name;
    buildStep.success = false;
    buildStep.detail = error;
    result.steps.push_back(buildStep);
    result.errors.push_back(error);
    result.success = false;
    result.message = "BUILD FAILED: " + error;
    NF_ERROR(LogCategory::Build, "Build failed at '%s': %s", name.c_str(), error.c_str());
    if (onProgress) onProgress("Failed: " + error, 1.0f);
  };

  // ---------------------------------------------------------- 1. validate
  step("Validating project", 0.02f);
  Project project;
  std::string projectError;
  if (!project.Load(request.projectRoot, &projectError)) {
    fail("Validating project", projectError);
    return result;
  }
  ProjectValidation validation = project.Validate();
  result.warnings = validation.warnings;
  if (!validation.valid) {
    std::string message = "The project cannot be built:";
    for (const auto& error : validation.errors) message += "\n  - " + error;
    fail("Validating project", message);
    return result;
  }

  ProjectSettings& settings = project.Settings();
  std::string exeName = request.executableName.empty() ? settings.name : request.executableName;
  std::string safeName;
  for (char c : exeName) {
    if (std::isalnum((unsigned char)c) || c == '_' || c == '-' || c == ' ') safeName.push_back(c);
  }
  if (safeName.empty()) safeName = "NovaForgeGame";
  exeName = safeName;

  std::string outputRoot = request.outputDir.empty()
                               ? fs::Join(project.BuildsPath(), request.targetPlatform)
                               : request.outputDir;
  std::string stageDir = fs::Join(outputRoot, exeName);
  result.outputDirectory = stageDir;

  // ------------------------------------------------------- 2. stage folder
  step("Preparing build directory", 0.06f);
  fs::RemoveRecursive(stageDir);
  if (!fs::CreateDirectories(stageDir)) {
    fail("Preparing build directory", "could not create " + stageDir);
    return result;
  }
  fs::CreateDirectories(fs::Join(stageDir, "Logs"));

  // ------------------------------------------------------------- 3. content
  step("Copying assets", 0.12f);
  size_t copiedAssets = 0;
  for (auto& entry : fs::ListDirectory(fs::Join(project.RootPath(), "Assets"), true)) {
    if (entry.isDirectory) continue;
    std::string relative = fs::Relative(entry.path, project.RootPath());
    if (!fs::Copy(entry.path, fs::Join(stageDir, relative))) {
      result.warnings.push_back("could not copy asset: " + relative);
      continue;
    }
    copiedAssets++;
  }
  if (copiedAssets == 0)
    result.warnings.push_back("The project contains no assets - the game will start with an empty scene.");
  fs::CopyRecursive(fs::Join(project.RootPath(), "Settings"), fs::Join(stageDir, "Settings"));

  // start scene must exist inside the package
  std::string packagedScene = fs::Join(stageDir, settings.startScene);
  if (!fs::Exists(packagedScene)) {
    fail("Copying assets", "start scene is missing from the package: " + settings.startScene);
    return result;
  }

  // ------------------------------------------------- 4. build-stamped settings
  step("Writing project metadata", 0.2f);
  {
    JsonValue doc = settings.Serialize();
    doc["build"] = JsonValue::Object();
    doc["build"]["gameName"] = exeName;
    doc["build"]["engineVersion"] = "0.1.0";
    doc["build"]["configuration"] = request.config;
    doc["build"]["platform"] = request.targetPlatform;
    doc["build"]["builtOn"] = TimestampString();
    doc["format"]["generator"] = "NovaForge Engine BuildSystem";
    if (!doc.WriteFile(fs::Join(stageDir, "project.json"))) {
      fail("Writing project metadata", "could not write project.json in the package");
      return result;
    }
  }

  if (!WriteBuildConfigHeader(stageDir, project, request, result)) return result;

  // ------------------------------------------------------- 5. rebuild scripts
  step("Writing rebuild scripts", 0.26f);
  if (request.copyEngineSources) {
    std::string engineRoot = request.engineSourceDir.empty() ? DetectEngineSourceDirectory()
                                                            : request.engineSourceDir;
    if (engineRoot.empty()) {
      result.warnings.push_back(
          "Engine sources were not found on disk - the package can be played but not rebuilt "
          "without a NovaForge installation.");
    } else {
      fs::CreateDirectories(fs::Join(stageDir, "Engine/Source"));
      fs::CopyRecursive(fs::Join(engineRoot, "engine"), fs::Join(stageDir, "Engine/Source/engine"));
      fs::CopyRecursive(fs::Join(engineRoot, "vendor"), fs::Join(stageDir, "Engine/Source/vendor"));
      fs::CopyRecursive(fs::Join(engineRoot, "tools"), fs::Join(stageDir, "Engine/Source/tools"));
      // the rebuild scripts compile Engine/Source/... with Engine/Generated/BuildConfig.h
      // (already written above), so nothing else has to be mirrored
    }
  }
  if (!WriteRebuildScripts(request, stageDir, exeName, result)) return result;

  // --------------------------------------------------- 6. compile the runtime
  if (request.compileExecutable) {
    if (!CompileGameExecutable(request, project, stageDir, exeName, result, onProgress)) {
      // the package is still written, but the build failed: no fake success
      result.reportPath = fs::Join(stageDir, "BuildReport.txt");
      std::string report = "NovaForge build FAILED\n=======================\n" + result.message;
      for (const auto& error : result.errors) report += "\nERROR: " + error;
      report += "\n\nThe content package and the rebuild scripts were still written to:\n  " + stageDir +
                "\nRun Build.bat inside that folder after fixing the problem.\n";
      fs::WriteText(result.reportPath, report);
      return result;
    }
  } else {
    result.warnings.push_back("Executable compilation was skipped (package-only build).");
  }

  // ------------------------------------------------------------ 7. verify
  step("Verifying package", 0.9f);
  VerificationResult verification = VerifyPackage(stageDir, request.compileExecutable);
  if (!verification.valid) {
    std::string message = "Build verification failed:";
    for (const auto& problem : verification.problems) message += "\n  - " + problem;
    fail("Verifying package", message);
    return result;
  }
  if (!request.compileExecutable) {
    // package-only builds are intentionally not marked as successful builds
    result.executableCompiled = false;
  }
  result.outputExe = verification.exeExists ? fs::Join(stageDir, exeName + ".exe") : std::string();

  // ------------------------------------------------------------ 8. report
  std::string engineVersion = "0.1.0";
  std::string report;
  report += "NovaForge Engine build report\n=============================\n";
  report += "Game            : " + exeName + "\n";
  report += "Project         : " + settings.name + " " + settings.version + "\n";
  report += "Configuration   : " + request.config + "\n";
  report += "Platform        : " + request.targetPlatform + "\n";
  report += "Toolchain       : " + (result.toolchainUsed.empty() ? "(none - package only)" : result.toolchainUsed) + "\n";
  report += "Output          : " + stageDir + "\n";
  report += "Executable      : " + (result.outputExe.empty() ? "(not compiled)" : result.outputExe) + "\n";
  report += "Executable size : " + std::to_string(verification.exeBytes / 1024) + " KB\n";
  report += "Binary format   : " + verification.machineType + " / " + verification.subsystem + "\n";
  report += "Assets copied   : " + std::to_string(copiedAssets) + "\n";
  report += "Start scene     : " + settings.startScene + "\n";
  report += "Engine version  : " + engineVersion + "\n";
  report += "\nVerification:\n";
  report += std::string("  project.json present : ") + (verification.projectJsonPresent ? "yes" : "NO") + "\n";
  report += std::string("  start scene present  : ") + (verification.startScenePresent ? "yes" : "NO") + "\n";
  report += std::string("  assets present       : ") + (verification.assetsPresent ? "yes" : "NO") + "\n";
  report += std::string("  executable built     : ") + (verification.exeExists ? "yes" : "NO") + "\n";
  report += std::string("  valid PE image       : ") + (verification.executableFormatValid ? "yes" : "NO") + "\n";
  report += std::string("  64-bit executable    : ") + (verification.is64Bit ? "yes" : "NO") + "\n";
  for (const auto& warning : result.warnings) report += "WARNING: " + warning + "\n";
  report += "\nHow to run:\n  " + (exeName) + ".exe  (double click, or run from this folder)\n";
  report += "The executable loads project.json and Assets/ from its own directory - no editor required.\n";

  usize fileCount = 0;
  long long totalBytes = 0;
  for (auto& entry : fs::ListDirectory(stageDir, true)) {
    if (entry.isDirectory) continue;
    fileCount++;
    totalBytes += (long long)entry.size;
  }
  report += "\nPackage contents: " + std::to_string(fileCount) + " files, " +
            std::to_string(totalBytes / 1024 / 1024) + " MB\n";
  result.fileCount = (int)fileCount;
  result.totalBytes = totalBytes;
  result.reportPath = fs::Join(stageDir, "BuildReport.txt");
  fs::WriteText(result.reportPath, report);

  step("Build complete", 1.0f);
  BuildStep finalStep;
  finalStep.name = "Build complete";
  finalStep.detail = result.outputExe;
  result.steps.push_back(finalStep);
  result.success = request.compileExecutable ? verification.exeExists : true;
  result.executableCompiled = verification.exeExists;
  result.message = result.success
                       ? ("BUILD SUCCEEDED\n  Game    : " + exeName + ".exe\n  Folder  : " + stageDir +
                          "\n  Report  : " + result.reportPath)
                       : "BUILD FAILED";
  NF_INFO(LogCategory::Build, "%s", result.message.c_str());
  return result;
}

// ------------------------------------------------------------------ parts
bool BuildSystem::WriteBuildConfigHeader(const std::string& stageDir, const Project& project,
                                         const BuildRequest& request, BuildResult& result) {
  fs::CreateDirectories(fs::Join(stageDir, "Engine/Generated"));
  std::string header;
  header += "// Generated by NovaForge BuildSystem - do not edit.\n";
  header += "#pragma once\n";
  header += "#define NF_BUILD_GAME_NAME \"" + project.Settings().name + "\"\n";
  header += "#define NF_BUILD_GAME_VERSION \"" + project.Settings().version + "\"\n";
  header += "#define NF_BUILD_START_SCENE \"" + project.Settings().startScene + "\"\n";
  header += "#define NF_BUILD_CONFIGURATION \"" + request.config + "\"\n";
  header += "#define NF_BUILD_PLATFORM \"" + request.targetPlatform + "\"\n";
  header += "#define NF_BUILD_ENGINE_VERSION \"0.1.0\"\n";
  header += "#define NF_BUILD_TIMESTAMP \"" + TimestampString() + "\"\n";
  header += "#define NF_BUILD_EDITOR 0\n";
  if (!fs::WriteText(fs::Join(stageDir, "Engine/Generated/BuildConfig.h"), header)) {
    result.errors.push_back("could not write BuildConfig.h");
    result.message = "BUILD FAILED: could not write BuildConfig.h";
    return false;
  }
  return true;
}

bool BuildSystem::WriteRebuildScripts(const BuildRequest& request, const std::string& stageDir,
                                      const std::string& exeName, BuildResult& result) {
  std::string common =
      "Builds the standalone game executable from the sources shipped in Engine/Source.\n"
      "Requires either the Zig toolchain (pip install ziglang / winget install zig.zig) or a\n"
      "Visual Studio developer prompt (MSVC).\n";
  NF_UNUSED(common);

  std::string configLower = request.config;
  for (char& c : configLower) c = (char)tolower((unsigned char)c);

  std::string bat;
  bat += "@echo off\r\n";
  bat += "rem NovaForge Engine - rebuild " + exeName + ".exe\r\n";
  bat += "setlocal\r\n";
  bat += "cd /d \"%~dp0\"\r\n";
  bat += "echo Building " + exeName + ".exe ...\r\n";
  bat += "python Engine\\Source\\tools\\build.py --target windows --config " + configLower +
         " --stage . --exe-name " + exeName + "\r\n";
  bat += "if errorlevel 1 (\r\n";
  bat += "  echo.\r\n";
  bat += "  echo Build failed. Install Python and the Zig toolchain with:\r\n";
  bat += "  echo    python -m pip install ziglang\r\n";
  bat += "  pause\r\n";
  bat += "  exit /b 1\r\n";
  bat += ")\r\n";
  bat += "echo Done: " + exeName + ".exe\r\n";
  bat += "pause\r\n";
  if (!fs::WriteText(fs::Join(stageDir, "Build.bat"), bat)) {
    result.warnings.push_back("could not write Build.bat");
  }

  std::string sh;
  sh += "#!/usr/bin/env sh\n";
  sh += "# NovaForge Engine - rebuild " + exeName + " (cross-compiles a real Windows PE exe)\n";
  sh += "set -e\n";
  sh += "cd \"$(dirname \"$0\")\"\n";
  sh += "python3 Engine/Source/tools/build.py --target windows --config " + configLower +
        " --stage . --exe-name " + exeName + "\n";
  sh += "echo \"Done: " + exeName + ".exe\"\n";
  fs::WriteText(fs::Join(stageDir, "build.sh"), sh);

  std::string readme;
  readme += exeName + " - built with NovaForge Engine\n";
  readme += "=======================================\n\n";
  readme += "Run the game:\n  " + exeName + ".exe\n\n";
  readme += "The executable is a standalone game runtime. It loads project.json, Assets/ and\n";
  readme += "Settings/ from its own folder. The NovaForge editor is NOT required and is not\n";
  readme += "part of this package.\n\n";
  readme += "Rebuild the executable:\n  Build.bat          (Windows)\n  ./build.sh         (Linux/macOS host, cross-compiles the same .exe)\n\n";
  readme += "Logs are written to Logs/ next to the executable.\n";
  readme += "See BuildReport.txt for the verification result of this build.\n";
  fs::WriteText(fs::Join(stageDir, "README.txt"), readme);
  return true;
}

bool BuildSystem::CompileGameExecutable(const BuildRequest& request, const Project& project,
                                        const std::string& stageDir, const std::string& exeName,
                                        BuildResult& result, BuildProgressFn onProgress) {
  if (onProgress) onProgress("Compiling game runtime", 0.35f);
  std::string projectRoot = request.projectRoot;

  std::string engineRoot = request.engineSourceDir.empty() ? DetectEngineSourceDirectory()
                                                           : request.engineSourceDir;
  if (engineRoot.empty()) {
    result.errors.push_back(
        "Engine sources not found. Point the build system at the NovaForge installation "
        "(Build > Build Settings > Engine source folder).");
    result.message = "BUILD FAILED: engine sources not found";
    return false;
  }
  SourceList sources = GatherSources(engineRoot, request.targetPlatform);
  if (sources.engine.empty()) {
    result.errors.push_back("No engine sources were found in " + engineRoot);
    result.message = "BUILD FAILED: no sources";
    return false;
  }

  std::string compilerPath;
  std::string toolchain = DetectToolchain(&compilerPath);
  result.toolchainUsed = toolchain;
  if (toolchain.empty()) {
    result.errors.push_back(
        "No C++ toolchain found. Install one of:\n"
        "  * Zig   :  python -m pip install ziglang\n"
        "  * MSVC  :  run Build.bat from a 'x64 Native Tools Command Prompt for VS'\n"
        "  * MinGW :  install w64devkit and put g++ on PATH");
    result.message = "BUILD FAILED: no compiler";
    return false;
  }

  // build directory for objects, inside the package so it stays self-contained
  std::string objectDir = fs::Join(stageDir, "Engine/Obj");
  fs::CreateDirectories(objectDir);

  // The compiler command may itself be several tokens ("zig c++", "python -m ziglang c++"),
  // so split it once and reuse the exact same prefix for compiling and linking.
  std::vector<std::string> compilerTokens;
  {
    std::string base = compilerPath.empty() ? "g++" : compilerPath;
    std::string token;
    for (usize i = 0; i <= base.size(); i++) {
      char c = i < base.size() ? base[i] : ' ';
      if (c == ' ') {
        if (!token.empty()) {
          compilerTokens.push_back(token);
          token.clear();
        }
      } else {
        token.push_back(c);
      }
    }
    if (compilerTokens.empty()) compilerTokens.push_back("g++");
  }
  const bool isZig = toolchain.find("zig") != std::string::npos;
  const bool isMsvc = toolchain == "MSVC" || (!compilerTokens.empty() && compilerTokens[0] == "cl");
  if (isZig) compilerTokens.push_back("c++");    // zig's drop-in C++ driver

  std::vector<std::string> baseArgs = compilerTokens;
  if (isMsvc) {
    for (const char* flag : {"/nologo", "/std:c++20", "/EHsc", "/O2", "/MT", "/DNDEBUG",
                             "/DNF_PLATFORM_WINDOWS=1", "/DNF_RUNTIME=1", "/DNOMINMAX",
                             "/DWIN32_LEAN_AND_MEAN"}) {
      baseArgs.push_back(flag);
    }
    for (auto& include : sources.includes) baseArgs.push_back("/I" + include);
    baseArgs.push_back("/I" + fs::Join(stageDir, "Engine/Source"));
    baseArgs.push_back("/I" + fs::Join(stageDir, "Engine/Generated"));
  } else {
    for (const char* flag : {"-std=c++20", "-O2", "-DNDEBUG", "-DNF_PLATFORM_WINDOWS=1",
                             "-DNF_RUNTIME=1", "-Wno-unused-parameter",
                             "-Wno-missing-field-initializers", "-Wno-deprecated-declarations",
                             "-Wno-unused-variable", "-Wno-unused-function",
                             "-Wno-unused-but-set-variable"}) {
      baseArgs.push_back(flag);
    }
    if (isZig) {
      baseArgs.push_back("-target");
      baseArgs.push_back("x86_64-windows-gnu");
    }
    for (auto& include : sources.includes) baseArgs.push_back("-I" + include);
    baseArgs.push_back("-I" + fs::Join(stageDir, "Engine/Source"));
    baseArgs.push_back("-I" + fs::Join(stageDir, "Engine/Generated"));
  }

  // compile file-by-file with a small worker pool: predictable memory, good CPU use
  std::vector<std::string> allSources = sources.engine;
  allSources.insert(allSources.end(), sources.vendor.begin(), sources.vendor.end());
  struct Job {
    std::string source;
    std::string object;
  };
  std::vector<Job> jobs;
  jobs.reserve(allSources.size());
  for (usize i = 0; i < allSources.size(); i++) {
    std::string objectName = Format("obj_%03zu.o", i);
    jobs.push_back({allSources[i], fs::Join(objectDir, objectName)});
  }

  std::atomic<int> completed{0};
  std::atomic<bool> failed{false};
  std::mutex errorMutex;
  std::vector<std::string> errors;
  int jobCount = std::max(1, request.parallelJobs);
  std::vector<std::thread> workers;
  std::atomic<usize> nextJob{0};

  for (int w = 0; w < jobCount; w++) {
    workers.emplace_back([&] {
      while (!failed.load()) {
        usize index = nextJob.fetch_add(1);
        if (index >= jobs.size()) break;
        const Job& job = jobs[index];
        std::string command;
        for (auto& arg : baseArgs) command += Quote(arg) + " ";
        if (isMsvc) {
          command += "/c " + Quote(job.source) + " /Fo" + Quote(job.object) + " 2>&1";
        } else {
          command += "-c " + Quote(job.source) + " -o " + Quote(job.object) + " 2>&1";
        }
        int status = system(command.c_str());
        completed.fetch_add(1);
        if (onProgress) {
          f32 progress = 0.35f + 0.5f * ((f32)completed.load() / (f32)jobs.size());
          onProgress("Compiling " + fs::FileName(job.source) + " (" +
                         std::to_string(completed.load()) + "/" + std::to_string(jobs.size()) + ")",
                     progress);
        }
        if (status != 0) {
          std::lock_guard<std::mutex> lock(errorMutex);
          errors.push_back("compilation failed: " + fs::FileName(job.source));
          failed.store(true);
          break;
        }
      }
    });
  }
  for (auto& worker : workers) worker.join();

  if (failed.load() || !errors.empty()) {
    for (auto& error : errors) result.errors.push_back(error);
    result.errors.push_back(
        "The full compile command is reproduced in Build.bat - run it in a developer prompt to "
        "see the compiler diagnostics.");
    result.message = "BUILD FAILED: compilation errors";
    return false;
  }

  // ------------------------------------------------------------------ link
  if (onProgress) onProgress("Linking " + exeName + ".exe", 0.88f);
  std::string exePath = fs::Join(stageDir, exeName + ".exe");
  std::string linkCommand;
  if (isMsvc) {
    linkCommand = "link /nologo /SUBSYSTEM:CONSOLE /OUT:" + Quote(exePath) + " ";
    for (auto& job : jobs) linkCommand += Quote(job.object) + " ";
    linkCommand += "user32.lib gdi32.lib opengl32.lib winmm.lib ole32.lib shell32.lib comdlg32.lib "
                   "imm32.lib ws2_32.lib winhttp.lib dwmapi.lib ";
  } else {
    for (auto& token : compilerTokens) linkCommand += Quote(token) + " ";
    if (isZig) linkCommand += "-target x86_64-windows-gnu ";
    linkCommand += "-static -static-libgcc -Wl,--stack,16777216 -o " + Quote(exePath) + " ";
    for (auto& job : jobs) linkCommand += Quote(job.object) + " ";
    linkCommand += "-luser32 -lgdi32 -lopengl32 -lwinmm -lole32 -lshell32 -lcomdlg32 -limm32 -lws2_32 -lwinhttp -ldwmapi ";
    if (request.stripDebugInfo) linkCommand += "&& strip --strip-all " + Quote(exePath) + " 2>/dev/null || true";
  }
  linkCommand += " 2>&1";
  NF_INFO(LogCategory::Build, "Link: %s", linkCommand.substr(0, 400).c_str());
  int status = system(linkCommand.c_str());
  if (status != 0 || !fs::Exists(exePath)) {
    result.errors.push_back("linking failed - see Build.bat for the exact command");
    result.message = "BUILD FAILED: link error";
    return false;
  }

  // Copy the runtime binary as the canonical engine binary too (helps users keep both names).
  fs::Copy(exePath, fs::Join(stageDir, "NovaForgeGame.exe"));
  result.outputExe = exePath;

  // Keep shipped packages lean: drop the intermediate objects and the debug database.
  // They are only useful for a developer rebuilding inside this folder.
  {
    fs::RemoveRecursive(objectDir);
    std::string pdb = fs::Join(stageDir, exeName + ".pdb");
    if (fs::Exists(pdb)) fs::Remove(pdb);
    NF_INFO(LogCategory::Build, "Cleaned intermediate objects and debug database from the package");
  }
  NF_INFO(LogCategory::Build, "Compiled %s (%lld KB)", fs::FileName(exePath).c_str(),
          (long long)(fs::FileSize(exePath) / 1024));
  return true;
}

// ------------------------------------------------------------------ verify
BuildSystem::VerificationResult BuildSystem::VerifyPackage(const std::string& packageDirectory,
                                                          bool requireExecutable) {
  VerificationResult result;
  result.report.clear();

  std::vector<u8> exeBytes;
  std::string exePath;
  for (auto& entry : fs::ListDirectory(packageDirectory, false)) {
    if (entry.isDirectory || entry.extension != "exe") continue;
    if (entry.name == "NovaForgeGame.exe" && !exePath.empty()) continue;
    exePath = entry.path;
    if (entry.name != "NovaForgeGame.exe") break;   // prefer the game-named exe
  }
  if (!exePath.empty()) {
    exeBytes = fs::ReadBinary(exePath);
    result.exeExists = !exeBytes.empty();
    result.exeBytes = (long long)exeBytes.size();
  }

  if (result.exeExists && exeBytes.size() > 0x40) {
    bool mz = exeBytes[0] == 'M' && exeBytes[1] == 'Z';
    result.exeIsWindowsBinary = mz;
    u32 peOffset = *(const u32*)(exeBytes.data() + 0x3C);
    if (mz && peOffset + 0x60 < exeBytes.size()) {
      const u8* pe = exeBytes.data() + peOffset;
      bool peSignature = pe[0] == 'P' && pe[1] == 'E' && pe[2] == 0 && pe[3] == 0;
      if (peSignature) {
        u16 machine = *(const u16*)(pe + 4);
        u16 subsystem = *(const u16*)(pe + 0x5C);
        result.executableFormatValid = true;
        result.is64Bit = machine == 0x8664;
        result.machineType = machine == 0x8664 ? "x86-64" : (machine == 0x014C ? "x86" : Format("0x%04X", machine));
        switch (subsystem) {
          case 2: result.subsystem = "Windows GUI"; break;
          case 3: result.subsystem = "Windows Console"; break;
          default: result.subsystem = Format("subsystem %d", subsystem); break;
        }
      }
    }
  }
  if (!result.exeExists) {
    if (requireExecutable) result.problems.push_back("no .exe in the package");
    else result.report += "note             : package-only build (no executable was requested)\n";
  } else if (!result.executableFormatValid) {
    result.problems.push_back("the .exe is not a valid PE image");
  } else if (!result.is64Bit) {
    result.problems.push_back("the .exe is not 64-bit");
  }

  JsonValue doc;
  std::string parseError;
  std::string projectFile = fs::Join(packageDirectory, "project.json");
  result.projectJsonPresent = fs::Exists(projectFile);
  if (result.projectJsonPresent && JsonValue::ParseFile(projectFile, &doc, &parseError)) {
    std::string startScene = doc["gameplay"]["startScene"].AsString();
    result.startScenePresent = !startScene.empty() && fs::Exists(fs::Join(packageDirectory, startScene));
    if (!result.startScenePresent)
      result.problems.push_back("start scene missing from the package: " + startScene);
  } else {
    result.problems.push_back("project.json missing or invalid");
  }
  result.assetsPresent = fs::IsDirectory(fs::Join(packageDirectory, "Assets"));

  result.report = "package          : " + packageDirectory + "\n";
  result.report += "executable       : " + (result.exeExists ? fs::FileName(exePath) : std::string("(none)")) + "\n";
  result.report += "binary format    : " + result.machineType + " / " + result.subsystem + "\n";
  result.report += "size             : " + std::to_string(result.exeBytes / 1024) + " KB\n";
  result.report += "project.json     : " + std::string(result.projectJsonPresent ? "yes" : "no") + "\n";
  result.report += "start scene      : " + std::string(result.startScenePresent ? "yes" : "no") + "\n";
  result.report += "assets folder    : " + std::string(result.assetsPresent ? "yes" : "no") + "\n";

  result.valid = result.problems.empty();
  return result;
}

} // namespace nf
