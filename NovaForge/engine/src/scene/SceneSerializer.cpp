// NovaForge Engine - scene/SceneSerializer.cpp
// .nfscene files are plain readable JSON: objects, hierarchy, components.
#include "scene/Scene.h"
#include "scene/Components.h"
#include "core/FileSystem.h"
#include "core/Log.h"

namespace nf {

static constexpr int kSceneFormatVersion = 1;

JsonValue Scene::Serialize() const {
  JsonValue root = JsonValue::Object();
  root["format"] = "NovaForge Scene";
  root["version"] = kSceneFormatVersion;
  root["name"] = name_;

  JsonValue environment = JsonValue::Object();
  environment["ambientColor"] = JsonValue::Vec3Json(environment_.ambientColor);
  environment["ambientIntensity"] = environment_.ambientIntensity;
  environment["skyTop"] = JsonValue::Vec3Json(environment_.skyTop);
  environment["skyBottom"] = JsonValue::Vec3Json(environment_.skyBottom);
  environment["fogColor"] = JsonValue::Vec3Json(environment_.fogColor);
  environment["fogEnabled"] = environment_.fogEnabled;
  environment["fogStart"] = environment_.fogStart;
  environment["fogEnd"] = environment_.fogEnd;
  environment["gravity"] = JsonValue::Vec3Json(environment_.gravity);
  environment["showSkybox"] = environment_.showSkybox;
  environment["showGrid"] = environment_.showGrid;
  environment["gridSpacing"] = environment_.gridSpacing;
  root["environment"] = environment;

  JsonValue objects = JsonValue::Array();
  for (auto& object : objects_) {
    if (object->runtimeOnly) continue;     // play-mode helpers are not persisted
    JsonValue json = JsonValue::Object();
    json["id"] = (u64)object->id;
    json["name"] = object->name;
    json["tag"] = object->tag;
    json["active"] = object->active;
    if (object->parent != 0) json["parent"] = (u64)object->parent;
    if (object->fromTemplate) {
      json["fromTemplate"] = true;
      json["templateSource"] = object->templateSource;
    }
    JsonValue components = JsonValue::Array();
    for (auto& component : object->components) components.Push(component->Serialize());
    json["components"] = components;
    objects.Push(json);
  }
  root["objects"] = objects;

  if (playerEntity_ != 0) {
    const GameObject* player = Get(playerEntity_);
    if (player) root["playerObject"] = player->name;
  }
  const GameObject* camera = Get(FindPrimaryCamera());
  if (camera) root["primaryCamera"] = camera->name;
  return root;
}

bool Scene::Deserialize(const JsonValue& doc, std::string* error) {
  if (!doc.IsObject()) {
    if (error) *error = "scene file is not a JSON object";
    return false;
  }
  std::string format = doc["format"].AsString();
  if (!format.empty() && format != "NovaForge Scene") {
    if (error) *error = "not a NovaForge scene (format = '" + format + "')";
    return false;
  }
  int version = doc["version"].AsInt(kSceneFormatVersion);
  if (version > kSceneFormatVersion) {
    if (error) *error = "scene was written by a newer engine version (" + std::to_string(version) + ")";
    return false;
  }

  Clear();
  name_ = doc["name"].AsString("Untitled");

  JsonValue environment = doc["environment"];
  if (environment.IsObject()) {
    environment_.ambientColor = environment["ambientColor"].AsVec3(environment_.ambientColor);
    environment_.ambientIntensity = environment["ambientIntensity"].AsFloat(1.0f);
    environment_.skyTop = environment["skyTop"].AsVec3(environment_.skyTop);
    environment_.skyBottom = environment["skyBottom"].AsVec3(environment_.skyBottom);
    environment_.fogColor = environment["fogColor"].AsVec3(environment_.fogColor);
    environment_.fogEnabled = environment["fogEnabled"].AsBool(false);
    environment_.fogStart = environment["fogStart"].AsFloat(30.0f);
    environment_.fogEnd = environment["fogEnd"].AsFloat(180.0f);
    environment_.gravity = environment["gravity"].AsVec3(Vec3(0, -20.0f, 0));
    environment_.showSkybox = environment["showSkybox"].AsBool(true);
    environment_.showGrid = environment["showGrid"].AsBool(true);
    environment_.gridSpacing = environment["gridSpacing"].AsFloat(1.0f);
  }

  JsonValue objects = doc["objects"];
  std::unordered_map<u64, EntityId> idMap;
  // pass 1: create objects (ids are re-mapped so they are always unique)
  for (usize i = 0; i < objects.Size(); i++) {
    JsonValue json = objects[i];
    std::string objectName = json["name"].AsString("Object");
    auto object = std::make_unique<GameObject>();
    object->id = nextId_++;
    object->name = objectName;
    object->tag = json["tag"].AsString("Untagged");
    object->active = json["active"].AsBool(true);
    object->fromTemplate = json["fromTemplate"].AsBool(false);
    object->templateSource = json["templateSource"].AsString();
    GameObject* raw = object.get();
    objects_.push_back(std::move(object));
    index_[raw->id] = raw;

    JsonValue components = json["components"];
    bool hasTransform = false;
    for (usize c = 0; c < components.Size(); c++) {
      JsonValue componentJson = components[c];
      std::string typeName = componentJson["type"].AsString();
      if (typeName.empty()) continue;
      std::unique_ptr<ComponentBase> component(ComponentRegistry::Get().Create(typeName));
      if (!component) {
        NF_WARN(LogCategory::Scene,
                "Scene '%s': object '%s' has component '%s' which is not registered - skipped",
                name_.c_str(), objectName.c_str(), typeName.c_str());
        continue;
      }
      component->owner = raw->id;
      component->Deserialize(componentJson);
      if (strcmp(component->TypeName(), "Transform") == 0) hasTransform = true;
      component->OnAttach(*this);
      raw->components.push_back(std::move(component));
    }
    if (!hasTransform) {
      auto transform = std::make_unique<TransformComponent>();
      transform->owner = raw->id;
      raw->components.insert(raw->components.begin(), std::move(transform));
    }
    idMap[json["id"].AsUInt64(0)] = raw->id;
  }
  // pass 2: hierarchy
  for (usize i = 0; i < objects.Size(); i++) {
    JsonValue json = objects[i];
    u64 parentKey = json["parent"].AsUInt64(0);
    if (parentKey == 0) continue;
    auto it = idMap.find(parentKey);
    if (it == idMap.end()) continue;
    auto childIt = idMap.find(json["id"].AsUInt64(0));
    if (childIt == idMap.end()) continue;
    GameObject* child = Get(childIt->second);
    GameObject* parent = Get(it->second);
    if (child && parent) {
      child->parent = parent->id;
      parent->children.push_back(child->id);
    }
  }

  // resolve convenience references by name
  std::string playerName = doc["playerObject"].AsString();
  if (!playerName.empty()) playerEntity_ = FindByName(playerName);
  std::string cameraName = doc["primaryCamera"].AsString();
  if (!cameraName.empty()) {
    EntityId camera = FindByName(cameraName);
    if (camera != 0) {
      for (auto& object : objects_) {
        if (auto* cam = object->Get<CameraComponent>()) cam->isPrimary = (object->id == camera);
      }
    }
  }
  if (playerEntity_ == 0) {
    for (auto& object : objects_) {
      if (object->Has("CharacterController")) { playerEntity_ = object->id; break; }
    }
  }

  allTransformsDirty_ = true;
  UpdateTransforms();
  dirty_ = false;
  return true;
}

bool Scene::SaveToFile(const std::string& path, std::string* error) {
  JsonValue doc = Serialize();
  if (!doc.WriteFile(path)) {
    if (error) *error = "could not write " + path;
    NF_ERROR(LogCategory::Scene, "Failed to save scene: %s", path.c_str());
    return false;
  }
  filePath_ = path;
  dirty_ = false;
  NF_INFO(LogCategory::Scene, "Saved scene '%s' (%zu objects) -> %s", name_.c_str(),
          objects_.size(), path.c_str());
  return true;
}

bool Scene::LoadFromFile(const std::string& path, std::string* error) {
  JsonValue doc;
  std::string parseError;
  if (!JsonValue::ParseFile(path, &doc, &parseError)) {
    if (error) *error = parseError;
    NF_ERROR(LogCategory::Scene, "Failed to open scene %s: %s", path.c_str(), parseError.c_str());
    return false;
  }
  if (!Deserialize(doc, error)) return false;
  filePath_ = path;
  if (name_.empty() || name_ == "Untitled") name_ = fs::Stem(path);
  NF_INFO(LogCategory::Scene, "Loaded scene '%s' (%zu objects) from %s", name_.c_str(),
          objects_.size(), path.c_str());
  return true;
}

} // namespace nf
