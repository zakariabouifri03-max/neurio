// NovaForge Engine - projectsystem/Project.cpp
#include "projectsystem/Project.h"
#include "scene/Scene.h"
#include "scene/SceneFactory.h"
#include "scripting/ScriptSystem.h"
#include "core/FileSystem.h"
#include "core/StringUtil.h"
#include "core/Log.h"

namespace nf {

// ------------------------------------------------------------------ settings
void ProjectSettings::ApplyDefaults() {
  if (inputBindings.empty()) {
    inputBindings = {
        {"MoveForward", {"W", "Up"}, ""},   {"MoveBackward", {"S", "Down"}, ""},
        {"MoveLeft", {"A", "Left"}, ""},    {"MoveRight", {"D", "Right"}, ""},
        {"Jump", {"Space"}, ""},            {"Sprint", {"LeftShift"}, ""},
        {"Interact", {"E"}, ""},            {"Pause", {"Escape"}, ""},
        {"Fire", {}, "Left"},
    };
  }
  if (tags.empty()) tags = {"Untagged", "Player", "Enemy", "Ground", "Pickup", "Door", "Trigger"};
}

JsonValue ProjectSettings::Serialize() const {
  JsonValue doc = JsonValue::Object();
  doc["name"] = name;
  doc["version"] = version;
  doc["description"] = description;
  doc["company"] = company;

  JsonValue window = JsonValue::Object();
  window["width"] = width;
  window["height"] = height;
  window["fullscreen"] = fullscreen;
  window["vsync"] = vsync;
  window["targetFps"] = targetFps;
  window["showConsoleWindow"] = showConsoleWindow;
  window["icon"] = iconPath;
  doc["window"] = window;

  JsonValue graphics = JsonValue::Object();
  graphics["quality"] = quality;
  graphics["fieldOfView"] = fieldOfView;
  graphics["showFpsInGame"] = showFpsInGame;
  graphics["allowWindowedToggle"] = allowWindowedToggle;
  doc["graphics"] = graphics;

  JsonValue gameplay = JsonValue::Object();
  gameplay["gravity"] = gravity;
  gameplay["masterVolume"] = masterVolume;
  gameplay["startScene"] = startScene;
  doc["gameplay"] = gameplay;

  JsonValue input = JsonValue::Array();
  for (const auto& binding : inputBindings) {
    JsonValue entry = JsonValue::Object();
    entry["action"] = binding.action;
    JsonValue keys = JsonValue::Array();
    for (const auto& key : binding.keys) keys.Push(key);
    entry["keys"] = keys;
    if (!binding.mouseButton.empty()) entry["mouseButton"] = binding.mouseButton;
    input.Push(entry);
  }
  doc["input"] = input;

  JsonValue tagList = JsonValue::Array();
  for (const auto& tag : tags) tagList.Push(tag);
  doc["tags"] = tagList;

  JsonValue format = JsonValue::Object();
  format["generator"] = "NovaForge Engine";
  format["formatVersion"] = 1;
  doc["format"] = format;
  return doc;
}

ProjectSettings ProjectSettings::Deserialize(const JsonValue& v) {
  ProjectSettings settings;
  if (!v.IsObject()) return settings;
  settings.name = v["name"].AsString("MyGame");
  settings.version = v["version"].AsString("1.0.0");
  settings.description = v["description"].AsString("Created with NovaForge Engine");
  settings.company = v["company"].AsString("Independent");
  JsonValue window = v["window"];
  settings.width = window["width"].AsInt(1600);
  settings.height = window["height"].AsInt(900);
  settings.fullscreen = window["fullscreen"].AsBool(false);
  settings.vsync = window["vsync"].AsBool(true);
  settings.targetFps = window["targetFps"].AsInt(0);
  settings.showConsoleWindow = window["showConsoleWindow"].AsBool(false);
  settings.iconPath = window["icon"].AsString();
  JsonValue graphics = v["graphics"];
  settings.quality = graphics["quality"].AsInt(2);
  settings.fieldOfView = graphics["fieldOfView"].AsFloat(60.0f);
  settings.showFpsInGame = graphics["showFpsInGame"].AsBool(true);
  settings.allowWindowedToggle = graphics["allowWindowedToggle"].AsBool(true);
  JsonValue gameplay = v["gameplay"];
  settings.gravity = gameplay["gravity"].AsFloat(-20.0f);
  settings.masterVolume = gameplay["masterVolume"].AsFloat(0.8f);
  settings.startScene = gameplay["startScene"].AsString("Assets/Scenes/Main.nfscene");
  JsonValue input = v["input"];
  settings.inputBindings.clear();
  for (usize i = 0; i < input.Size(); i++) {
    InputBinding binding;
    binding.action = input[i]["action"].AsString();
    JsonValue keys = input[i]["keys"];
    for (usize k = 0; k < keys.Size(); k++) binding.keys.push_back(keys[k].AsString());
    binding.mouseButton = input[i]["mouseButton"].AsString();
    if (!binding.action.empty()) settings.inputBindings.push_back(binding);
  }
  settings.tags.clear();
  JsonValue tags = v["tags"];
  for (usize i = 0; i < tags.Size(); i++) settings.tags.push_back(tags[i].AsString());
  settings.ApplyDefaults();
  return settings;
}

// ------------------------------------------------------------------- project
Project::Project() { settings_.ApplyDefaults(); }

void Project::EnsureLayout() const {
  fs::CreateDirectories(AssetsPath());
  fs::CreateDirectories(ModelsPath());
  fs::CreateDirectories(TexturesPath());
  fs::CreateDirectories(MaterialsPath());
  fs::CreateDirectories(AudioPath());
  fs::CreateDirectories(ScenesPath());
  fs::CreateDirectories(ScriptsPath());
  fs::CreateDirectories(SettingsPath());
  fs::CreateDirectories(BuildsPath());
  fs::CreateDirectories(LogsPath());
}

std::string Project::ProjectFilePath() const { return fs::Join(root_, "project.json"); }
std::string Project::AssetsPath() const { return fs::Join(root_, "Assets"); }
std::string Project::ScenesPath() const { return fs::Join(AssetsPath(), "Scenes"); }
std::string Project::ScriptsPath() const { return fs::Join(AssetsPath(), "Scripts"); }
std::string Project::ModelsPath() const { return fs::Join(AssetsPath(), "Models"); }
std::string Project::TexturesPath() const { return fs::Join(AssetsPath(), "Textures"); }
std::string Project::MaterialsPath() const { return fs::Join(AssetsPath(), "Materials"); }
std::string Project::AudioPath() const { return fs::Join(AssetsPath(), "Audio"); }
std::string Project::SettingsPath() const { return fs::Join(root_, "Settings"); }
std::string Project::BuildsPath() const { return fs::Join(root_, "Builds"); }
std::string Project::LogsPath() const { return fs::Join(root_, "Logs"); }
std::string Project::StartScenePath() const {
  return settings_.startScene.empty() ? std::string() : fs::Join(root_, settings_.startScene);
}

bool Project::CreateNew(const std::string& rootDirectory, const std::string& projectName,
                        std::string* error) {
  if (projectName.empty()) {
    if (error) *error = "Project name cannot be empty";
    return false;
  }
  std::string path = rootDirectory;
  if (fs::FileName(path) != projectName) path = fs::Join(rootDirectory, projectName);
  root_ = fs::Normalize(path);
  if (fs::Exists(fs::Join(root_, "project.json"))) {
    if (error) *error = "A project already exists in " + root_;
    return false;
  }
  if (!fs::CreateDirectories(root_)) {
    if (error) *error = "Could not create project directory: " + root_;
    return false;
  }
  EnsureLayout();

  settings_ = ProjectSettings{};
  settings_.name = projectName;
  settings_.startScene = "Assets/Scenes/Main.nfscene";
  settings_.ApplyDefaults();

  // starter scene: ground, sun, player, a crate, an NPC and a pickup
  Scene scene;
  AssetDatabase assets;
  assets.SetProjectRoot(root_);
  scene.SetAssets(&assets);
  Scene::PopulateStarterScene(scene);
  scene.SetName("Main");

  SpawnOptions crateOptions;
  crateOptions.name = "Crate";
  crateOptions.position = Vec3(-4.0f, 0.5f, 2.0f);
  EntityId crate = SceneFactory::SpawnPrimitive(scene, "Box", crateOptions);
  auto* crateCollider = scene.AddComponent<ColliderComponent>(crate);
  crateCollider->shape = (i32)ColliderShape::Box;
  crateCollider->size = Vec3(0.8f, 0.8f, 0.8f);
  scene.AddComponent<RigidbodyComponent>(crate);
  if (auto* renderer = scene.Get(crate)->Get<MeshRendererComponent>())
    renderer->baseColor = Vec4(0.62f, 0.42f, 0.24f, 1.0f);

  SpawnOptions npcOptions;
  npcOptions.position = Vec3(5.0f, 0.9f, -5.0f);
  npcOptions.name = "Enemy";
  npcOptions.tag = "Enemy";
  SceneFactory::SpawnNpc(scene, npcOptions, NpcBehavior::Patrol);

  SpawnOptions pickupOptions;
  pickupOptions.position = Vec3(2.5f, 0.8f, 3.5f);
  SceneFactory::SpawnPickup(scene, PickupKind::Health, pickupOptions);

  std::string sceneError;
  if (!scene.SaveToFile(fs::Join(ScenesPath(), "Main.nfscene"), &sceneError)) {
    if (error) *error = "Could not write the starter scene: " + sceneError;
    return false;
  }

  // sample script + a readme so the project is self-documenting
  ScriptSystem::WriteTemplateScript(fs::Join(ScriptsPath(), "RotatingCrate.nfscript"), "RotatingCrate",
                                    "Rotator");
  std::string readme =
      "# " + projectName + "\n\n"
      "Created with NovaForge Engine.\n\n"
      "Layout:\n"
      "  Assets/Models      imported meshes (glb, gltf, obj, fbx)\n"
      "  Assets/Textures    imported images\n"
      "  Assets/Materials   .nfmat material assets\n"
      "  Assets/Scenes      .nfscene levels (readable JSON)\n"
      "  Assets/Scripts     .nfscript gameplay scripts\n"
      "  Assets/Audio       sound clips\n"
      "  Settings/          input + graphics settings\n"
      "  Builds/            exported games\n"
      "  Logs/              engine logs\n";
  fs::WriteText(fs::Join(root_, "README.md"), readme);

  open_ = true;
  return Save(error);
}

bool Project::Load(const std::string& rootDirectory, std::string* error) {
  root_ = fs::Normalize(rootDirectory);
  // accept either the project folder or a file inside it
  if (fs::IsFile(root_) && fs::Extension(root_) == "json") root_ = fs::Parent(root_);
  std::string projectFile = fs::Join(root_, "project.json");
  if (!fs::Exists(projectFile)) {
    // walk up a couple of levels (the exported game lives in <build>/<Game>/)
    std::string parent = fs::Parent(root_);
    if (fs::Exists(fs::Join(parent, "project.json"))) {
      root_ = parent;
      projectFile = fs::Join(root_, "project.json");
    } else if (fs::Exists(fs::Join(fs::Parent(parent), "project.json"))) {
      root_ = fs::Parent(parent);
      projectFile = fs::Join(root_, "project.json");
    }
  }
  if (!fs::Exists(projectFile)) {
    if (error) *error = "project.json not found in " + root_;
    open_ = false;
    return false;
  }
  JsonValue doc;
  std::string parseError;
  if (!JsonValue::ParseFile(projectFile, &doc, &parseError)) {
    if (error) *error = parseError;
    open_ = false;
    return false;
  }
  settings_ = ProjectSettings::Deserialize(doc);
  if (doc.Has("lastScene")) settings_.startScene = doc["lastScene"].AsString(settings_.startScene);
  EnsureLayout();
  open_ = true;
  NF_INFO(LogCategory::Project, "Loaded project '%s' (%s)", settings_.name.c_str(),
          settings_.version.c_str());
  return true;
}

bool Project::Save(std::string* error) {
  if (root_.empty()) {
    if (error) *error = "no project directory";
    return false;
  }
  EnsureLayout();
  JsonValue doc = settings_.Serialize();
  if (!doc.WriteFile(ProjectFilePath())) {
    if (error) *error = "could not write project.json";
    return false;
  }
  // separate, human editable sub-settings files
  JsonValue inputDoc = JsonValue::Object();
  JsonValue bindings = JsonValue::Array();
  for (const auto& binding : settings_.inputBindings) {
    JsonValue entry = JsonValue::Object();
    entry["action"] = binding.action;
    JsonValue keys = JsonValue::Array();
    for (const auto& key : binding.keys) keys.Push(key);
    entry["keys"] = keys;
    if (!binding.mouseButton.empty()) entry["mouseButton"] = binding.mouseButton;
    bindings.Push(entry);
  }
  inputDoc["bindings"] = bindings;
  inputDoc.WriteFile(fs::Join(SettingsPath(), "input.json"));

  JsonValue graphicsDoc = JsonValue::Object();
  graphicsDoc["width"] = settings_.width;
  graphicsDoc["height"] = settings_.height;
  graphicsDoc["fullscreen"] = settings_.fullscreen;
  graphicsDoc["vsync"] = settings_.vsync;
  graphicsDoc["quality"] = settings_.quality;
  graphicsDoc["fov"] = settings_.fieldOfView;
  graphicsDoc.WriteFile(fs::Join(SettingsPath(), "graphics.json"));
  return true;
}

void Project::Close() {
  open_ = false;
  root_.clear();
}

std::vector<std::string> Project::ListScenes() const {
  std::vector<std::string> scenes;
  if (root_.empty()) return scenes;
  for (auto& file : fs::ListFilesWithExtension(ScenesPath(), "nfscene", false))
    scenes.push_back(fs::Relative(file, root_));
  return scenes;
}

std::vector<std::string> Project::ListScripts() const {
  std::vector<std::string> scripts;
  if (root_.empty()) return scripts;
  for (auto& file : fs::ListFilesWithExtension(ScriptsPath(), "nfscript", true))
    scripts.push_back(fs::Relative(file, root_));
  return scripts;
}

bool Project::CreateScene(const std::string& sceneName, bool starterContent,
                          std::string* outRelativePath, std::string* error) {
  if (root_.empty()) {
    if (error) *error = "no project open";
    return false;
  }
  std::string fileName = SanitizeIdentifier(sceneName);
  if (fileName.empty()) fileName = "Scene";
  std::string relative = fs::Join("Assets/Scenes", fileName + ".nfscene");
  std::string absolute = fs::Join(root_, relative);
  for (int i = 1; fs::Exists(absolute) && i < 500; i++) {
    relative = fs::Join("Assets/Scenes", fileName + "_" + std::to_string(i) + ".nfscene");
    absolute = fs::Join(root_, relative);
  }
  Scene scene;
  AssetDatabase assets;
  assets.SetProjectRoot(root_);
  scene.SetAssets(&assets);
  if (starterContent) Scene::PopulateStarterScene(scene);
  scene.SetName(fs::Stem(relative));
  std::string saveError;
  if (!scene.SaveToFile(absolute, &saveError)) {
    if (error) *error = "could not write scene: " + saveError;
    return false;
  }
  if (outRelativePath) *outRelativePath = relative;
  NF_INFO(LogCategory::Project, "Created scene %s", relative.c_str());
  return true;
}

bool Project::DeleteScene(const std::string& relativePath, std::string* error) {
  std::string absolute = fs::Join(root_, relativePath);
  if (!fs::Exists(absolute)) {
    if (error) *error = "scene not found: " + relativePath;
    return false;
  }
  if (!fs::Remove(absolute)) {
    if (error) *error = "could not delete " + relativePath;
    return false;
  }
  return true;
}

bool Project::CreateScript(const std::string& scriptName, const std::string& behavior,
                           std::string* outRelativePath) {
  std::string fileName = SanitizeIdentifier(scriptName);
  if (fileName.empty()) fileName = "NewScript";
  std::string relative = fs::Join("Assets/Scripts", fileName + ".nfscript");
  std::string absolute = fs::Join(root_, relative);
  for (int i = 1; fs::Exists(absolute) && i < 500; i++) {
    relative = fs::Join("Assets/Scripts", fileName + "_" + std::to_string(i) + ".nfscript");
    absolute = fs::Join(root_, relative);
  }
  if (!ScriptSystem::WriteTemplateScript(absolute, fileName, behavior)) return false;
  if (outRelativePath) *outRelativePath = relative;
  return true;
}

void Project::RecordOpenedScene(const std::string& relativePath) {
  if (!open_ || relativePath.empty()) return;
  JsonValue doc;
  std::string error;
  if (JsonValue::ParseFile(ProjectFilePath(), &doc, &error)) {
    doc["lastScene"] = relativePath;
    doc.WriteFile(ProjectFilePath());
  }
}

ProjectValidation Project::Validate() const {
  ProjectValidation validation;
  if (root_.empty() || !fs::Exists(ProjectFilePath())) {
    validation.errors.push_back("project.json is missing");
    return validation;
  }
  validation.valid = true;

  if (settings_.startScene.empty()) {
    validation.errors.push_back("No start scene configured (Project > Project Settings).");
    validation.valid = false;
  } else {
    std::string startScene = fs::Join(root_, settings_.startScene);
    if (!fs::Exists(startScene)) {
      validation.errors.push_back("Start scene does not exist: " + settings_.startScene);
      validation.valid = false;
    }
  }
  if (settings_.width < 640 || settings_.height < 480) {
    validation.warnings.push_back("Window resolution is smaller than 640x480.");
  }
  // scenes must parse
  for (auto& scenePath : ListScenes()) {
    std::string absolute = fs::Join(root_, scenePath);
    JsonValue doc;
    std::string error;
    if (!JsonValue::ParseFile(absolute, &doc, &error)) {
      validation.errors.push_back("Scene could not be parsed: " + scenePath + " (" + error + ")");
      validation.valid = false;
      continue;
    }
    if (doc["format"].AsString() != "NovaForge Scene") {
      validation.warnings.push_back("Scene has an unexpected format field: " + scenePath);
    }
  }
  // scripts must parse
  for (auto& scriptPath : ListScripts()) {
    JsonValue doc;
    std::string error;
    if (!JsonValue::ParseFile(fs::Join(root_, scriptPath), &doc, &error)) {
      validation.errors.push_back("Script could not be parsed: " + scriptPath + " (" + error + ")");
      validation.valid = false;
    }
  }
  // missing model / texture references are warnings (the engine falls back gracefully)
  for (auto& scenePath : ListScenes()) {
    JsonValue doc;
    std::string error;
    if (!JsonValue::ParseFile(fs::Join(root_, scenePath), &doc, &error)) continue;
    JsonValue objects = doc["objects"];
    for (usize i = 0; i < objects.Size(); i++) {
      JsonValue components = objects[i]["components"];
      for (usize c = 0; c < components.Size(); c++) {
        JsonValue properties = components[c]["properties"];
        if (!properties.IsObject()) continue;
        for (const auto& key : properties.Keys()) {
          if (key != "meshAsset" && key != "baseColorTexture" && key != "normalTexture" &&
              key != "clipPath" && key != "materialAsset")
            continue;
          std::string value = properties[key].AsString();
          if (value.empty()) continue;
          if (!fs::Exists(fs::Join(root_, value))) {
            validation.warnings.push_back("Missing asset referenced by " +
                                          objects[i]["name"].AsString() + ": " + value);
          }
        }
      }
    }
  }
  return validation;
}

std::string ProjectValidation::Summary() const {
  std::string text;
  text += valid ? "Project is valid." : "Project has errors.";
  for (const auto& error : errors) text += "\n  ERROR: " + error;
  for (const auto& warning : warnings) text += "\n  WARNING: " + warning;
  return text;
}

} // namespace nf
