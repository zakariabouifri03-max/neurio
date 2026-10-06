// NovaForge Engine - projectsystem/Project.h
// Project layout and settings. A project is a plain folder on disk:
//
//   MyGame/
//     project.json
//     Assets/{Models,Textures,Materials,Audio,Scenes,Scripts}
//     Settings/{input.json,graphics.json}
//     Builds/
//     Logs/
#pragma once

#include "core/Base.h"
#include "core/Json.h"

namespace nf {

struct InputBinding {
  std::string action;                 // "MoveForward"
  std::vector<std::string> keys;      // {"W", "Up"}
  std::string mouseButton;            // optional ("Left", "Right")
};

struct ProjectSettings {
  std::string name = "MyGame";
  std::string version = "1.0.0";
  std::string description = "Created with NovaForge Engine";
  std::string company = "Independent";
  int width = 1600;
  int height = 900;
  bool fullscreen = false;
  bool vsync = true;
  int quality = 2;                    // 0 low .. 3 ultra
  int targetFps = 0;                  // 0 = uncapped
  std::string startScene = "Assets/Scenes/Main.nfscene";
  f32 gravity = -20.0f;
  f32 masterVolume = 0.8f;
  f32 fieldOfView = 60.0f;
  std::string iconPath;               // optional .png (converted to .ico for the exe icon at build time)
  bool showConsoleWindow = false;     // exported game: keep the console for logs
  bool showFpsInGame = true;
  bool allowWindowedToggle = true;
  std::vector<InputBinding> inputBindings;
  std::vector<std::string> tags = {"Untagged", "Player", "Enemy", "Ground", "Pickup", "Door", "Trigger"};

  JsonValue Serialize() const;
  static ProjectSettings Deserialize(const JsonValue& v);
  void ApplyDefaults();
};

struct ProjectValidation {
  bool valid = false;
  std::vector<std::string> errors;
  std::vector<std::string> warnings;
  std::string Summary() const;
};

class Project {
public:
  Project();

  // Creates the folder structure, settings, a starter scene and a sample script.
  bool CreateNew(const std::string& rootDirectory, const std::string& projectName,
                 std::string* error = nullptr);
  bool Load(const std::string& rootDirectory, std::string* error = nullptr);
  bool Save(std::string* error = nullptr);
  void Close();
  bool IsOpen() const { return open_; }

  ProjectSettings& Settings() { return settings_; }
  const ProjectSettings& Settings() const { return settings_; }
  void SetName(const std::string& name) { settings_.name = name; }

  std::string RootPath() const { return root_; }
  std::string ProjectFilePath() const;
  std::string AssetsPath() const;
  std::string ScenesPath() const;
  std::string ScriptsPath() const;
  std::string ModelsPath() const;
  std::string TexturesPath() const;
  std::string MaterialsPath() const;
  std::string AudioPath() const;
  std::string SettingsPath() const;
  std::string BuildsPath() const;
  std::string LogsPath() const;
  std::string StartScenePath() const;

  std::vector<std::string> ListScenes() const;         // project-relative paths
  std::vector<std::string> ListScripts() const;
  bool CreateScene(const std::string& sceneName, bool starterContent, std::string* outRelativePath,
                   std::string* error = nullptr);
  bool DeleteScene(const std::string& relativePath, std::string* error = nullptr);
  bool CreateScript(const std::string& scriptName, const std::string& behavior,
                    std::string* outRelativePath = nullptr);

  ProjectValidation Validate() const;
  void RecordOpenedScene(const std::string& relativePath);

private:
  void EnsureLayout() const;

  bool open_ = false;
  std::string root_;
  ProjectSettings settings_;
};

} // namespace nf
