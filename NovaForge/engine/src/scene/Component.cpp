// NovaForge Engine - scene/Component.cpp
#include "scene/Component.h"
#include "core/Log.h"

namespace nf {

const char* ComponentCategoryName(ComponentCategory c) {
  switch (c) {
    case ComponentCategory::Core: return "Core";
    case ComponentCategory::Rendering: return "Rendering";
    case ComponentCategory::Physics: return "Physics";
    case ComponentCategory::Gameplay: return "Gameplay";
    case ComponentCategory::Audio: return "Audio";
    case ComponentCategory::AI: return "AI";
    case ComponentCategory::Scripting: return "Scripting";
    default: return "Other";
  }
}

JsonValue ComponentBase::Serialize() const {
  JsonValue obj = JsonValue::Object();
  obj["type"] = TypeName();
  obj["enabled"] = enabled;
  JsonValue props = JsonValue::Object();
  for (auto& p : Properties().items) {
    if (!p.serialize) continue;
    props[p.id] = p.Value();
  }
  obj["properties"] = props;
  return obj;
}

void ComponentBase::Deserialize(const JsonValue& v) {
  if (!v.IsObject()) return;
  enabled = v["enabled"].AsBool(true);
  JsonValue props = v["properties"];
  if (!props.IsObject()) {
    // tolerate flat layouts (older files / hand written scenes)
    for (const auto& p : Properties().items) {
      if (!p.serialize) continue;
      if (v.Has(p.id)) const_cast<Property&>(p).SetValue(v[p.id]);
    }
    return;
  }
  for (auto& key : props.Keys()) {
    Property* p = const_cast<PropertyList&>(Properties()).FindMutable(key);
    if (!p || !p->serialize) {
      if (!Properties().Find(key))
        NF_WARN(LogCategory::Scene, "%s: unknown property '%s' in scene file (ignored)",
                TypeName(), key.c_str());
      continue;
    }
    p->SetValue(props[key]);
  }
}

void ComponentBase::CopyStateFrom(const ComponentBase& other) {
  if (std::string(other.TypeName()) != TypeName()) return;
  Deserialize(other.Serialize());
}

ComponentRegistry& ComponentRegistry::Get() {
  // The built-in table registers itself lazily: any caller (editor, runtime, tools, tests)
  // that touches the registry gets a complete component set without an explicit init call.
  RegisterBuiltinComponents();
  static ComponentRegistry registry;
  return registry;
}

void ComponentRegistry::Register(const ComponentMeta& meta) {
  for (auto& m : metas_) {
    if (m.name == meta.name) {
      m = meta;   // module reload replaces its own entry
      return;
    }
  }
  metas_.push_back(meta);
  std::sort(metas_.begin(), metas_.end(),
            [](const ComponentMeta& a, const ComponentMeta& b) {
              if (a.category != b.category) return (int)a.category < (int)b.category;
              return a.name < b.name;
            });
}

void ComponentRegistry::UnregisterModule(const std::string& module) {
  if (module.empty()) return;
  metas_.erase(std::remove_if(metas_.begin(), metas_.end(),
                              [&](const ComponentMeta& m) { return m.sourceModule == module; }),
               metas_.end());
}

ComponentBase* ComponentRegistry::Create(const std::string& name) const {
  const ComponentMeta* meta = Find(name);
  if (!meta) {
    NF_ERROR(LogCategory::Scene, "Unknown component type '%s' - check the script module path",
             name.c_str());
    return nullptr;
  }
  return meta->create().release();
}

const ComponentMeta* ComponentRegistry::Find(const std::string& name) const {
  for (auto& m : metas_)
    if (m.name == name) return &m;
  return nullptr;
}

std::vector<const ComponentMeta*> ComponentRegistry::All() const {
  std::vector<const ComponentMeta*> out;
  for (auto& m : metas_) out.push_back(&m);
  return out;
}

std::vector<const ComponentMeta*> ComponentRegistry::ByCategory(ComponentCategory category) const {
  std::vector<const ComponentMeta*> out;
  for (auto& m : metas_)
    if (m.category == category) out.push_back(&m);
  return out;
}

} // namespace nf
