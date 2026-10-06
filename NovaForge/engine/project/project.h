// NovaForge Engine - project system
//
// A NovaForge project is a plain folder on disk - no databases, no hidden
// state. Everything in it can be read (and edited) with a text editor:
//
//   MyGame/                          <- project root (chosen by the user)
//     Project/project.json           <- manifest: name, start scene, settings
//     Project/imports.json           <- import database (source -> asset)
//     Assets/Models/                 <- imported .nfmodel.json + .glb/.obj sources
//     Assets/Meshes/                 <- .nfmesh geometry
//     Assets/Materials/              <- .nfmat.json
//     Assets/Textures/               <- .png
//     Assets/Audio/                  <- .wav (decoded), .mp3/.ogg (stored)
//     Assets/Scenes/                 <- .nfscene.json
//     Assets/Scripts/                <- .lua
//     Assets/Prefabs/                <- .nfprefab.json
//     Settings/                      <- editor/input/render settings (JSON)
//     Logs/                          <- engine + editor logs
//     Builds/                        <- exported standalone games
#pragma once
#include "core/json.h"
#include "core/math.h"

#include <string>
#include <vector>

namespace nf {

class Scene;

// ------------------------------------------------------------------ settings
struct RenderProjectSettings {
    std::string quality = "Medium";     // Low | Medium | High | Ultra
    float resolutionScale = 1.0f;
    bool enableShadows = true;
    int shadowMapSize = 1024;
    float shadowDistance = 30.0f;
    bool enableFog = false;
    float fogDensity = 0.008f;
    Vec3 fogColor{0.6f, 0.7f, 0.8f};
    float exposure = 1.0f;
    bool enableParticles = true;
    bool vsync = true;
    std::string postGrade = "None";     // None | Cinematic | Bright | Warm Island | Noir
    bool debugDrawPhysics = false;
    bool showFps = true;
};

struct PhysicsProjectSettings {
    Vec3 gravity{0, -9.81f, 0};
    float fixedTimestep = 1.0f / 60.0f;
    int maxSubSteps = 4;
    bool enableCcd = false;
};

struct BuildProjectSettings {
    std::string gameName;               // defaults to the project name
    std::string executableName;         // defaults to <gameName>.exe
    std::string icon;                   // project relative .png (optional)
    bool copyAssets = true;
    bool includeEditorAssets = false;
    bool createZip = false;
    bool windowed = true;
    int windowWidth = 1280;
    int windowHeight = 720;
    bool fullscreen = false;
};

struct AIProjectSettings {
    // "templates" (offline generator, no network), "openai" (HTTP API)
    std::string provider = "templates";
    std::string model = "gpt-4o-mini";
    std::string endpoint = "https://api.openai.com/v1/chat/completions";
    std::string apiKeyEnv = "NOVAFORGE_AI_API_KEY";
    bool allowFileWrites = true;        // writes are still confirmed in the UI
    bool confirmDestructive = true;
    int maxTokens = 1200;
};

struct InputActionBinding {
    std::string action;                 // "MoveForward", "Jump", "Fire", ...
    std::vector<std::string> keys;      // "W", "Space", "Mouse0"
    float deadzone = 0.1f;
    bool isAxis = false;
};

struct ProjectSettings {
    RenderProjectSettings render;
    PhysicsProjectSettings physics;
    BuildProjectSettings build;
    AIProjectSettings ai;
    std::vector<InputActionBinding> inputActions;
    Json extra;                          // unknown keys survive a round trip
};

// ------------------------------------------------------------------- project
class Project {
public:
    // Creates the folder layout and writes project.json.
    static bool createProject(const std::string& rootDir, const std::string& name,
                              std::string* error = nullptr);
    // True when `dir` looks like a NovaForge project (project.json exists).
    static bool isProject(const std::string& dir);
    static std::string defaultProjectsDir();
    static const char* manifestRelativePath() { return "Project/project.json"; }

    bool create(const std::string& rootDir, const std::string& name, std::string* error = nullptr);
    bool open(const std::string& rootDir, std::string* error = nullptr);
    bool save(std::string* error = nullptr) const;
    void close();
    bool isOpen() const { return open_; }

    // ------------------------------------------------------------ paths
    const std::string& root() const { return root_; }
    const std::string& name() const { return name_; }
    std::string assetPath(const std::string& relative) const;   // root/Assets/<relative>
    std::string path(const std::string& relative) const;         // root/<relative>
    std::string relative(const std::string& absolute) const;     // strip the root
    std::string scenesDir() const { return "Assets/Scenes"; }
    std::string scriptsDir() const { return "Assets/Scripts"; }
    std::string soundDir() const { return "Assets/Audio"; }
    std::string buildsDir() const { return "Builds"; }
    std::string logsDir() const { return "Logs"; }
    std::string settingsDir() const { return "Settings"; }

    // ------------------------------------------------------------ scenes
    std::vector<std::string> listScenes() const;        // project relative
    std::string startSceneRelative() const { return startScene_; }
    void setStartScene(const std::string& projectRelative);
    // Creates a new scene file with a default camera + sun and returns its path.
    std::string createScene(const std::string& sceneName, std::string* error = nullptr);
    bool saveScene(const Scene& scene, const std::string& projectRelative,
                   std::string* error = nullptr) const;
    bool loadScene(Scene& scene, const std::string& projectRelative,
                   std::string* error = nullptr) const;

    // ------------------------------------------------------------ files
    std::string readTextFile(const std::string& projectRelative, bool* ok = nullptr) const;
    bool writeTextFile(const std::string& projectRelative, const std::string& contents,
                       std::string* error = nullptr) const;
    Json readJson(const std::string& projectRelative, bool* ok = nullptr) const;
    bool writeJson(const std::string& projectRelative, const Json& json, std::string* error = nullptr) const;
    bool deleteFile(const std::string& projectRelative) const;
    std::vector<std::string> listFiles(const std::string& projectRelativeDir,
                                       const std::string& extension = "") const;
    // Files touched by the current session (for the "changed files" list).
    const std::vector<std::string>& modifiedFiles() const { return modifiedFiles_; }
    void noteModified(const std::string& projectRelative) const {
        modifiedFiles_.push_back(projectRelative);
    }
    void clearModified() { modifiedFiles_.clear(); }

    ProjectSettings settings;
    std::vector<std::string> recentScenes;    // most recent first
    std::string engineVersion = "0.1.0";

private:
    bool open_ = false;
    std::string root_;
    std::string name_ = "Untitled";
    std::string startScene_ = "Assets/Scenes/Main.nfscene.json";
    mutable std::vector<std::string> modifiedFiles_;
};

}  // namespace nf
