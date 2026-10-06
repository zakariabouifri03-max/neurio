// NovaForge Engine - scene/GameObject.h
#pragma once

#include "core/Base.h"
#include "scene/Component.h"
#include "scene/Components.h"

namespace nf {

// An object in the scene: a name, a tag, a parent link and a list of components.
class GameObject {
public:
  EntityId id = 0;
  std::string name = "Object";
  std::string tag = "Untagged";
  bool active = true;
  EntityId parent = 0;
  std::vector<EntityId> children;
  std::vector<std::unique_ptr<ComponentBase>> components;

  // Instances created from a template (spawner / prefab) remember their source.
  bool fromTemplate = false;
  std::string templateSource;
  // Objects created by play mode (player camera, spawned props) are never saved.
  bool runtimeOnly = false;

  // ---- component access -------------------------------------------------
  ComponentBase* Get(const char* typeName) {
    for (auto& c : components)
      if (strcmp(c->TypeName(), typeName) == 0) return c.get();
    return nullptr;
  }
  const ComponentBase* Get(const char* typeName) const {
    for (auto& c : components)
      if (strcmp(c->TypeName(), typeName) == 0) return c.get();
    return nullptr;
  }
  template <typename T>
  T* Get() {
    return static_cast<T*>(Get(T::kTypeName));
  }
  template <typename T>
  const T* Get() const {
    return static_cast<const T*>(Get(T::kTypeName));
  }
  bool Has(const char* typeName) const { return Get(typeName) != nullptr; }

  TransformComponent* Transform() {
    auto* t = Get<TransformComponent>();
    return t ? t : nullptr;
  }
  const TransformComponent* Transform() const {
    auto* t = Get<TransformComponent>();
    return t ? t : nullptr;
  }

  bool IsRoot() const { return parent == 0; }
  usize ComponentCount() const { return components.size(); }
};

} // namespace nf
