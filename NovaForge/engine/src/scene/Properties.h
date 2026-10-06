// NovaForge Engine - scene/Properties.h
// Tiny reflection layer. Every component describes its fields once; the same
// description drives serialisation, the Inspector UI, undo-able editing and the
// AI assistant's ability to read/modify gameplay values.
#pragma once

#include "core/Base.h"
#include "core/Json.h"
#include "core/Math.h"

namespace nf {

enum class AssetTypeHint : int { Any = 0, Mesh, Texture, Material, Audio, Scene, Script, Animation };

enum class PropType : int {
  Bool = 0, Int, Float, Vec2, Vec3, Vec4, Color, Color4, String, MultilineString, Enum,
  Asset, Entity, EntityList, Vec3List, StringList, Flags, ReadOnlyText
};

struct Property {
  std::string id;             // stable serialisation key ("moveSpeed")
  std::string display;        // inspector label ("Move Speed")
  std::string category;       // inspector group ("Movement")
  std::string tooltip;
  PropType type = PropType::Float;
  std::function<JsonValue()> get;
  std::function<bool(const JsonValue&)> set;

  // presentation + validation
  f32 min = 0.0f;
  f32 max = 1.0f;
  f32 speed = 0.01f;
  bool hasRange = false;
  bool readOnly = false;
  bool serialize = true;              // runtime-only fields set this to false
  bool hidden = false;                // serialised but not shown in the Inspector
  std::vector<std::string> enumLabels;   // PropType::Enum
  std::string assetExtension;            // PropType::Asset ("glb;gltf;obj;fbx")
  AssetTypeHint assetHint = AssetTypeHint::Any;
  std::function<bool()> visibleIf;       // conditional display

  JsonValue Value() const { return get ? get() : JsonValue(); }
  bool SetValue(const JsonValue& v) { return set ? set(v) : false; }
};

class PropertyList {
public:
  std::vector<Property> items;

  Property& Add(Property p) {
    items.push_back(std::move(p));
    return items.back();
  }
  const Property* Find(const std::string& id) const {
    for (auto& p : items) if (p.id == id) return &p;
    return nullptr;
  }
  Property* FindMutable(const std::string& id) {
    for (auto& p : items) if (p.id == id) return &p;
    return nullptr;
  }
  bool SetValue(const std::string& id, const JsonValue& v) {
    Property* p = FindMutable(id);
    return p ? p->SetValue(v) : false;
  }
  JsonValue GetValue(const std::string& id) const {
    const Property* p = Find(id);
    return p ? p->Value() : JsonValue();
  }
};

// ------------------------------------------------------------------ builders
// Raw member pointers are safe here: components are heap allocated and never moved.
namespace prop {

Property Bool(const char* id, const char* display, bool* target, const char* category = "",
              const char* tooltip = "");
Property Int(const char* id, const char* display, i32* target, i32 min, i32 max,
             const char* category = "", const char* tooltip = "");
Property Float(const char* id, const char* display, f32* target, f32 min, f32 max,
               const char* category = "", const char* tooltip = "", f32 speed = 0.01f);
Property Vec2(const char* id, const char* display, nf::Vec2* target, const char* category = "",
              const char* tooltip = "");
Property Vec3(const char* id, const char* display, nf::Vec3* target, const char* category = "",
              const char* tooltip = "", f32 speed = 0.05f);
Property Vec4(const char* id, const char* display, nf::Vec4* target, const char* category = "");
Property Color(const char* id, const char* display, nf::Vec3* target, const char* category = "");
Property Color4(const char* id, const char* display, nf::Vec4* target, const char* category = "");
Property String(const char* id, const char* display, std::string* target, const char* category = "",
                const char* tooltip = "");
Property Text(const char* id, const char* display, std::string* target, const char* category = "");
Property Enum(const char* id, const char* display, i32* target, std::vector<std::string> labels,
              const char* category = "", const char* tooltip = "");
Property Asset(const char* id, const char* display, std::string* target, AssetTypeHint hint,
               const char* extensionFilter, const char* category = "", const char* tooltip = "");
Property ReadOnly(const char* id, const char* display, std::function<std::string()> text,
                  const char* category = "");
// Euler-angle facade over a quaternion member (stored as quaternion, edited as degrees).
Property Rotation(const char* id, const char* display, nf::Quat* target, const char* category = "Transform");
// Entity reference (0 = none).
Property EntityRef(const char* id, const char* display, u64* target, const char* category = "",
                   const char* tooltip = "");
// Vector of Vec3 (patrol routes, teleport targets...).
Property Vec3List(const char* id, const char* display, std::vector<nf::Vec3>* target,
                  const char* category = "");
Property StringList(const char* id, const char* display, std::vector<std::string>* target,
                    const char* category = "");

} // namespace prop
} // namespace nf
