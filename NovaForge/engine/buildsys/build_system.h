// NovaForge Engine - build system (game export)
//
// "BUILD GAME" produces a *standalone* game folder - not a renamed editor:
//
//   Builds/<Game>/
//     <Game>.exe            <- the NovaForge runtime executable, renamed
//     game.json             <- what the runtime loads (start scene, window...)
//     Assets/               <- only the assets the project actually needs
//     Project/project.json  <- the project manifest (so the game is a project)
//     BUILD_INFO.txt        <- exactly what was exported, byte counts, versions
//
// Every step is real file I/O with progress callbacks; nothing is simulated.
// On Windows the exported executable runs on its own: the runtime links the
// engine and loads game.json, with no editor code inside.
#pragma once
#include "project/project.h"

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace nf {

struct BuildOptions {
    std::string outputDirectory;          // absolute; default <project>/Builds/<game>
    std::string gameName;                 // defaults to project.build.gameName
    std::string executableName;           // defaults to <gameName>.exe
    std::string runtimeExecutable;        // the NovaForge runtime to copy ("" = auto find)
    bool copyAssets = true;
    bool copySourceAssets = false;        // also copy the original .glb/.obj sources
    bool createZip = false;
    bool includeReadme = true;
    bool verbose = true;
};

struct BuildProgress {
    int step = 0;
    int totalSteps = 1;
    std::string stepName;
    std::string currentFile;
    float fraction = 0.0f;
};

struct BuildResult {
    bool success = false;
    std::string error;
    std::string outputDirectory;
    std::string executablePath;
    std::string manifestPath;
    std::string zipPath;
    std::vector<std::string> copiedFiles;
    int64_t totalBytes = 0;
    double seconds = 0.0;
    std::string summary() const;
};

class BuildSystem {
public:
    using ProgressFn = std::function<void(const BuildProgress&)>;

    // Exports the project. `progress` is called before each step and after each
    // file copy, so the editor can show real progress (never a fake bar).
    BuildResult build(const Project& project, const BuildOptions& options,
                      ProgressFn progress = nullptr);

    // What the build would copy (used for the pre-build summary in the editor).
    std::vector<std::pair<std::string, int64_t>> planFiles(const Project& project,
                                                           const BuildOptions& options) const;

    // Name of the standalone runtime binary for this platform.
    static std::string runtimeExecutableName();
    // Search order used when `runtimeExecutable` is empty.
    static std::string findRuntimeExecutable();

    // Minimal ZIP writer (deflate via miniz) used for "create a .zip" builds.
    static bool writeZip(const std::string& zipPath,
                         const std::vector<std::pair<std::string, std::string>>& filesInZipToDisk,
                         std::string* error = nullptr);
};

}  // namespace nf
