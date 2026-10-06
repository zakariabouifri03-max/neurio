// NovaForge Engine - scene/Properties.cpp
#include "scene/Properties.h"

namespace nf::prop {

Property Bool(const char* id, const char* display, bool* target, const char* category,
              const char* tooltip) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Bool;
  p.get = [target] { return JsonValue(*target); };
  p.set = [target](const JsonValue& v) { *target = v.AsBool(*target); return true; };
  return p;
}

Property Int(const char* id, const char* display, i32* target, i32 min, i32 max,
             const char* category, const char* tooltip) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Int;
  p.min = (f32)min;
  p.max = (f32)max;
  p.hasRange = true;
  p.get = [target] { return JsonValue(*target); };
  p.set = [target, min, max](const JsonValue& v) {
    *target = (i32)Clamp((f32)v.AsInt(*target), (f32)min, (f32)max);
    return true;
  };
  return p;
}

Property Float(const char* id, const char* display, f32* target, f32 min, f32 max,
               const char* category, const char* tooltip, f32 speed) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Float;
  p.min = min;
  p.max = max;
  p.speed = speed;
  p.hasRange = (max > min);
  p.get = [target] { return JsonValue(*target); };
  p.set = [target, min, max](const JsonValue& v) {
    f32 value = v.AsFloat(*target);
    if (max > min) value = Clamp(value, min, max);
    *target = value;
    return true;
  };
  return p;
}

Property Vec2(const char* id, const char* display, nf::Vec2* target, const char* category,
              const char* tooltip) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Vec2;
  p.get = [target] {
    JsonValue a = JsonValue::Array();
    a.Push(target->x);
    a.Push(target->y);
    return a;
  };
  p.set = [target](const JsonValue& v) { *target = nf::Vec2(v[0].AsFloat(target->x), v[1].AsFloat(target->y)); return true; };
  return p;
}

Property Vec3(const char* id, const char* display, nf::Vec3* target, const char* category,
              const char* tooltip, f32 speed) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Vec3;
  p.speed = speed;
  p.get = [target] { return JsonValue::Vec3Json(*target); };
  p.set = [target](const JsonValue& v) { *target = v.AsVec3(*target); return true; };
  return p;
}

Property Vec4(const char* id, const char* display, nf::Vec4* target, const char* category) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.type = PropType::Vec4;
  p.get = [target] { return JsonValue::Vec4Json(*target); };
  p.set = [target](const JsonValue& v) { *target = v.AsVec4(*target); return true; };
  return p;
}

Property Color(const char* id, const char* display, nf::Vec3* target, const char* category) {
  Property p = Vec3(id, display, target, category);
  p.type = PropType::Color;
  return p;
}

Property Color4(const char* id, const char* display, nf::Vec4* target, const char* category) {
  Property p = Vec4(id, display, target, category);
  p.type = PropType::Color4;
  return p;
}

Property String(const char* id, const char* display, std::string* target, const char* category,
                const char* tooltip) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::String;
  p.get = [target] { return JsonValue(*target); };
  p.set = [target](const JsonValue& v) { *target = v.AsString(*target); return true; };
  return p;
}

Property Text(const char* id, const char* display, std::string* target, const char* category) {
  Property p = String(id, display, target, category);
  p.type = PropType::MultilineString;
  return p;
}

Property Enum(const char* id, const char* display, i32* target, std::vector<std::string> labels,
              const char* category, const char* tooltip) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Enum;
  p.enumLabels = std::move(labels);
  p.get = [target] { return JsonValue(*target); };
  p.set = [target, count = p.enumLabels.size()](const JsonValue& v) {
    i32 index = v.AsInt(*target);
    if (count > 0) index = (i32)Clamp((f32)index, 0.0f, (f32)(count - 1));
    *target = index;
    return true;
  };
  return p;
}

Property Asset(const char* id, const char* display, std::string* target, AssetTypeHint hint,
               const char* extensionFilter, const char* category, const char* tooltip) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Asset;
  p.assetHint = hint;
  p.assetExtension = extensionFilter ? extensionFilter : "";
  p.get = [target] { return JsonValue(*target); };
  p.set = [target](const JsonValue& v) { *target = v.AsString(*target); return true; };
  return p;
}

Property ReadOnly(const char* id, const char* display, std::function<std::string()> text,
                  const char* category) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.type = PropType::ReadOnlyText;
  p.readOnly = true;
  p.serialize = false;
  p.get = [text] { return JsonValue(text ? text() : std::string()); };
  p.set = [](const JsonValue&) { return false; };
  return p;
}

Property Rotation(const char* id, const char* display, nf::Quat* target, const char* category) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = "Euler angles in degrees (pitch, yaw, roll)";
  p.type = PropType::Vec3;
  p.speed = 0.25f;
  p.get = [target] { return JsonValue::Vec3Json(target->EulerDegrees()); };
  p.set = [target](const JsonValue& v) {
    nf::Vec3 euler = v.AsVec3(target->EulerDegrees());
    *target = Quat::FromEuler(euler.x, euler.y, euler.z);
    return true;
  };
  return p;
}

Property EntityRef(const char* id, const char* display, u64* target, const char* category,
                   const char* tooltip) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.tooltip = tooltip;
  p.type = PropType::Entity;
  p.get = [target] { return JsonValue((u64)*target); };
  p.set = [target](const JsonValue& v) { *target = v.AsUInt64(*target); return true; };
  return p;
}

Property Vec3List(const char* id, const char* display, std::vector<nf::Vec3>* target,
                  const char* category) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.type = PropType::Vec3List;
  p.get = [target] {
    JsonValue a = JsonValue::Array();
    for (auto& v : *target) a.Push(JsonValue::Vec3Json(v));
    return a;
  };
  p.set = [target](const JsonValue& v) {
    target->clear();
    for (usize i = 0; i < v.Size(); i++) target->push_back(v[i].AsVec3());
    return true;
  };
  return p;
}

Property StringList(const char* id, const char* display, std::vector<std::string>* target,
                    const char* category) {
  Property p;
  p.id = id;
  p.display = display;
  p.category = category;
  p.type = PropType::StringList;
  p.get = [target] {
    JsonValue a = JsonValue::Array();
    for (auto& v : *target) a.Push(v);
    return a;
  };
  p.set = [target](const JsonValue& v) {
    target->clear();
    for (usize i = 0; i < v.Size(); i++) target->push_back(v[i].AsString());
    return true;
  };
  return p;
}

} // namespace nf::prop
