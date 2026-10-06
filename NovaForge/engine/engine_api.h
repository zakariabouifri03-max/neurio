// NovaForge Engine - engine facade
//
// One object that owns the whole runtime: window, renderer, project, scene,
// asset library, physics, audio, AI, scripting, effects and the gameplay layer.
// The editor and the exported game both drive *this*, which is why PLAY mode
// and the shipped EXE behave identically.
//
// Typical loop (runtime/main.cpp):
//     engine.init(cfg);
//     engine.openProject(dir);  engine.loadScene("Assets/Scenes/Island.nfscene.json");
//     engine.play();
//     while (!engine.shouldClose()) { engine.pumpEvents(); engine.frame(dt); }
#pragma once
#include "ai/npc_ai.h"
#include "assets/asset_library.h"
#include "audio/audio.h"
#include "buildsys/build_system.h"
#include "core/thread_pool.h"
#include "game/gameplay.h"
#include "physics/physics.h"
#include "platform/platform.h"
#include "project/project.h"
#include "render/effects.h"
#include "render/renderer.h"
#include "render/ui_overlay.h"
#include "scene/scene.h"
#include "scene/scene_render.h"
#include "script/script_host.h"

#include <memory>
#include <string>

namespace nf {

struct EngineConfig {
    WindowDesc window;
    RenderSettings render;
    PhysicsSettings physics;
    AudioSettings audio;
    bool enableAudio = true;
    bool enableScripts = true;
    bool enablePhysics = true;
    std::string projectRoot;        // open this project during init (optional)
    std::string startScene;         // override the manifest's start scene
    bool playOnStart = false;       // start in play mode (the game runtime does)
};

enum class EngineMode { Edit, Play, Paused };

struct FrameStats {
    float fps = 0.0f;
    float frameMs = 0.0f;
    float updateMs = 0.0f;
    float renderMs = 0.0f;
    float physicsMs = 0.0f;
    int bodies = 0;
    size_t drawItems = 0;
    size_t triangles = 0;
    size_t particles = 0;
    double totalFrames = 0;
};

class Engine {
public:
    Engine();
    ~Engine();
    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;

    // ---- lifecycle ------------------------------------------------------
    bool init(const EngineConfig& config, std::string* error = nullptr);
    void shutdown();
    bool isInitialised() const { return initialised_; }
    const EngineConfig& config() const { return config_; }

    // ---- project ---------------------------------------------------------
    Project& project() { return project_; }
    const Project& project() const { return project_; }
    bool createProject(const std::string& directory, const std::string& name,
                       std::string* error = nullptr);
    bool openProject(const std::string& directory, std::string* error = nullptr);
    bool saveProject(std::string* error = nullptr);
    // Creates and switches to an empty scene (camera + sun).
    bool newScene(const std::string& name = "Untitled Scene", std::string* error = nullptr);
    bool loadScene(const std::string& projectRelative, std::string* error = nullptr);
    bool saveScene(std::string* error = nullptr);
    bool saveSceneAs(const std::string& projectRelative, std::string* error = nullptr);
    const std::string& scenePath() const { return scenePath_; }

    // ---- scene / subsystems ---------------------------------------------
    Scene& scene() { return scene_; }
    AssetLibrary& assets() { return AssetLibrary::get(); }
    PhysicsWorld& physics() { return *physics_; }
    AudioSystem& audio() { return *audio_; }
    AISystem& ai() { return *ai_; }
    ScriptHost& scripts() { return *scripts_; }
    EffectsQueue& effects() { return *effects_; }
    SceneEffectState& effectState() { return effectState_; }
    IRenderer* renderer() { return renderer_.get(); }
    Window* window() { return window_.get(); }
    ThreadPool& threads() { return *threads_; }

    // ---- play mode --------------------------------------------------------
    bool play(std::string* error = nullptr);      // snapshots the scene, runs onStart
    void pause(bool paused);
    void stop();                                  // restores the pre-play snapshot
    void stepOnce(float dt = 1.0f / 60.0f);
    EngineMode mode() const { return mode_; }
    bool isPlaying() const { return mode_ != EngineMode::Edit; }
    GameplaySystem& gameplay() { return gameplay_; }
    PlayerController& controller() { return playerController_; }
    EntityId playerEntity() const { return playerEntity_; }
    float playTime() const { return playTime_; }

    // ---- frame ------------------------------------------------------------
    void pumpEvents();                            // window events -> input
    bool shouldClose() const;
    void update(float dt);                        // gameplay + physics (play mode)
    // Builds the draw list for `camera` and renders it into the target.
    void render(const RenderCamera& camera, const SceneRenderOptions& options = SceneRenderOptions());
    void present();                               // blit to the window + swap
    // pump + update + render + present, using the game camera.
    bool frame(float dt);
    // The camera the game/editor viewport should use right now.
    RenderCamera gameCamera(int width, int height);
    RenderCamera sceneCamera(int width, int height);   // the scene's active camera

    // ---- input ------------------------------------------------------------
    InputState& input() { return window_ ? window_->input() : nullInput_; }
    // Key/action mapping for gameplay input (WASD + arrows, mouse look, ...).
    PlayerInputState readPlayerInput();
    bool keyDown(Key k) const;
    bool keyPressed(Key k) const;
    float actionValue(const std::string& action) const;
    bool actionPressed(const std::string& action) const;
    void setActionBindings(const std::vector<InputActionBinding>& bindings) { bindings_ = bindings; }

    // ---- diagnostics / editor helpers --------------------------------------
    const FrameStats& stats() const { return stats_; }
    void updateFrameStats(float dt);
    // HUD text (health, prompt, messages) drawn by the runtime; the editor draws
    // the same information inside its panels instead.
    void buildHudBatch(UIBatch& ui, int width, int height) const;
    // Immediate one-shot gameplay helpers used by the editor toolbar/AI actions.
    void notifyScriptsChanged();
    void requestScreenshot(const std::string& path) { screenshotPath_ = path; }
    const std::string& lastError() const { return lastError_; }

private:
    void wireScriptContext();
    void applyProjectSettings();
    void snapshotScene();
    void restoreSceneSnapshot();
    std::string resolveProjectPath(const std::string& projectRelative) const;

    EngineConfig config_;
    bool initialised_ = false;
    std::string lastError_;

    std::unique_ptr<Window> window_;
    std::unique_ptr<IRenderer> renderer_;
    std::unique_ptr<ThreadPool> threads_;
    std::unique_ptr<PhysicsWorld> physics_;
    std::unique_ptr<AudioSystem> audio_;
    std::unique_ptr<AISystem> ai_;
    std::unique_ptr<ScriptHost> scripts_;
    std::unique_ptr<EffectsQueue> effects_;

    Project project_;
    Scene scene_;
    Scene sceneSnapshot_;               // pre-play state, restored by stop()
    SceneEffectState effectState_;
    GameplaySystem gameplay_;
    PlayerController playerController_;
    EntityId playerEntity_ = kInvalidEntity;
    std::string scenePath_;
    std::vector<InputActionBinding> bindings_;
    InputState nullInput_;

    // script binding hooks: raw key/action lookups by name
    bool actionDownRaw(const std::string& name) const;
    bool actionPressedRaw(const std::string& name) const;

    EngineMode mode_ = EngineMode::Edit;
    float playTime_ = 0.0f;
    float lastEffectDt_ = 0.0f;
    float forcedStepDt_ = 0.0f;      // set by stepOnce() while paused
    bool paused_ = false;
    FrameStats stats_;
    std::string screenshotPath_;
};

// Convenience used by tools/tests: the engine version string.
const char* engineVersion();
// Human readable name of a render quality level (editor status bar).
const char* qualityName(QualityLevel q);

}  // namespace nf
