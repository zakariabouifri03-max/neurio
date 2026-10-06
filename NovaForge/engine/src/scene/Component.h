// NovaForge Engine - scene/Component.h
// Component base class + registry. Components are pure data + behaviour and are
// shared by the editor, play mode and the exported game.
#pragma once

#include "core/Base.h"
#include "core/Json.h"
#include "scene/Properties.h"

namespace nf {

class Scene;

enum class ComponentCategory : int { Core = 0, Rendering, Physics, Gameplay, Audio, AI, Scripting, Count };
const char* ComponentCategoryName(ComponentCategory c);

class ComponentBase {
public:
  virtual ~ComponentBase() = default;

  virtual const char* TypeName() const = 0;
  virtual ComponentCategory Category() const { return ComponentCategory::Core; }
  virtual const char* Description() const { return ""; }

  EntityId owner = 0;
  bool enabled = true;

  // ---- reflection
  const PropertyList& Properties() const {
    if (!propsBuilt_) {
      BuildProperties(props_);
      propsBuilt_ = true;
    }
    return props_;
  }
  PropertyList& PropertiesMutable() const { const_cast<ComponentBase*>(this)->Properties(); return props_; }
  JsonValue Serialize() const;
  void Deserialize(const JsonValue& v);
  // Copies serialisable state (used by duplicate + copy/paste).
  void CopyStateFrom(const ComponentBase& other);

  // ---- lifecycle (called by the runtime; the editor only calls OnAttach/OnDetach)
  virtual void OnAttach(Scene&) {}
  virtual void OnDetach(Scene&) {}
  virtual void OnStart(Scene&) {}
  virtual void OnUpdate(Scene&, f32) {}
  virtual void OnFixedUpdate(Scene&, f32) {}
  virtual void OnTriggerEnter(Scene&, EntityId) {}
  virtual void OnTriggerExit(Scene&, EntityId) {}
  virtual void OnCollisionEnter(Scene&, EntityId) {}
  virtual void OnCollisionExit(Scene&, EntityId) {}
  virtual void OnDamage(Scene&, f32 amount, EntityId source) {}
  virtual void OnReset(Scene&) {}    // called when play mode starts/stops

  // ---- editor helpers
  virtual void DrawGizmos(Scene&) {}    // optional wireframe overlay in the viewport
  // Public entry point so the editor can draw gizmos through a ComponentBase pointer
  // (derived classes may declare their DrawGizmos override protected).
  void DrawEditorGizmos(Scene& scene) { DrawGizmos(scene); }

protected:
  virtual void BuildProperties(PropertyList&) const {}
  mutable PropertyList props_;
  mutable bool propsBuilt_ = false;
};

// ------------------------------------------------------------------- registry
struct ComponentMeta {
  std::string name;
  ComponentCategory category = ComponentCategory::Core;
  std::string description;
  std::string sourceModule;     // "" = built-in, otherwise the script DLL that registered it
  std::function<std::unique_ptr<ComponentBase>()> create;
};

// Registers every built-in component type (implemented in Components.cpp). Idempotent;
// called automatically the first time the registry is touched.
void RegisterBuiltinComponents();

class ComponentRegistry {
public:
  static ComponentRegistry& Get();

  void Register(const ComponentMeta& meta);
  void UnregisterModule(const std::string& module);
  ComponentBase* Create(const std::string& name) const;   // nullptr when unknown
  const ComponentMeta* Find(const std::string& name) const;
  std::vector<const ComponentMeta*> All() const;
  std::vector<const ComponentMeta*> ByCategory(ComponentCategory category) const;
  bool Exists(const std::string& name) const { return Find(name) != nullptr; }

private:
  std::vector<ComponentMeta> metas_;
};

// Helper used by the built-in table and by script modules.
template <typename T>
void RegisterComponent(const char* name, ComponentCategory category, const char* description,
                       const char* sourceModule = "") {
  ComponentMeta meta;
  meta.name = name;
  meta.category = category;
  meta.description = description ? description : "";
  meta.sourceModule = sourceModule ? sourceModule : "";
  meta.create = []() -> std::unique_ptr<ComponentBase> { return std::make_unique<T>(); };
  ComponentRegistry::Get().Register(meta);
}

} // namespace nf
