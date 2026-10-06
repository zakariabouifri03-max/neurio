// NovaForge Engine - standalone game runtime
//
// This is what an exported game *is*: a real executable that links the engine
// and nothing from the editor. It reads game.json (written by BUILD GAME),
// opens the project next to itself, loads the start scene and runs the engine's
// play loop - the same loop the editor uses for PLAY mode.
#pragma once
#include "engine_api.h"

#include <string>

namespace nf {

struct RuntimeOptions {
    std::string projectDir;              // "" = auto detect (see resolve below)
    std::string scenePath;               // "" = game.json / project start scene
    std::string screenshotPath;          // headless capture target (".png")
    std::string title;                   // window title (defaults to game.json name)
    int width = 1280;
    int height = 720;
    bool fullscreen = false;
    bool headless = false;               // no window: fixed step simulation
    bool enableAudio = true;
    bool enableScripts = true;
    bool showDebugOverlay = false;       // -debug
    float maxSeconds = 0.0f;             // >0 = stop after N seconds (capture/CI)
    float fixedDelta = 1.0f / 60.0f;
};

// Result of the startup discovery (also reported to the console).
struct StartupInfo {
    std::string projectDir;
    std::string scenePath;
    std::string gameName;
    std::string executable;
    std::string builtUtc;
    std::string source;                  // "game.json" | "--project" | "folder search"
};

class GameRuntime {
public:
    bool init(const RuntimeOptions& options, std::string* error = nullptr);
    // Blocking windowed loop. Returns the process exit code.
    int run();
    // No window loop: steps the simulation deterministically (used by the
    // automated tests and by `--headless --screenshot`).
    bool runHeadless(float seconds);
    void shutdown();

    Engine& engine() { return engine_; }
    const StartupInfo& startup() const { return startup_; }
    const RuntimeOptions& options() const { return options_; }
    // Finds the project a standalone game exe should load.
    static bool resolveStartup(const RuntimeOptions& options, StartupInfo* out, std::string* error);

private:
    void drawOverlay(UIBatch& ui, int width, int height);
    void handleGlobalKeys(float dt);

    RuntimeOptions options_;
    StartupInfo startup_;
    Engine engine_;
    std::string lastError_;
    bool initialised_ = false;
    bool paused_ = false;
    bool showStats_ = false;
    bool fullscreenRequested_ = false;
    float frameTime_ = 0.0f;
    int frameCount_ = 0;
};

// Fills RuntimeOptions from a command line (--project, --scene, --width, ...).
// Returns false when the arguments ask for --help (help text is printed).
bool parseRuntimeArguments(int argc, char** argv, RuntimeOptions* options);

}  // namespace nf
