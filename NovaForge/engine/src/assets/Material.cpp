// NovaForge Engine - assets/Material.cpp
#include "assets/Material.h"
#include "core/FileSystem.h"
#include "core/Log.h"

namespace nf {

JsonValue Material::Serialize() const {
  JsonValue v = JsonValue::Object();
  v["name"] = name;
  v["baseColor"] = JsonValue::Vec4Json(baseColor);
  v["metallic"] = metallic;
  v["roughness"] = roughness;
  v["emissiveColor"] = JsonValue::Vec3Json(emissiveColor);
  v["emissiveStrength"] = emissiveStrength;
  v["opacity"] = opacity;
  v["normalStrength"] = normalStrength;
  v["baseColorTexture"] = baseColorTexture;
  v["normalTexture"] = normalTexture;
  v["metallicRoughnessTexture"] = metallicRoughnessTexture;
  v["emissiveTexture"] = emissiveTexture;
  v["doubleSided"] = doubleSided;
  v["unlit"] = unlit;
  v["castShadows"] = castShadows;
  v["receiveShadows"] = receiveShadows;
  return v;
}

Material Material::Deserialize(const JsonValue& v) {
  Material m;
  if (!v.IsObject()) return m;
  m.name = v["name"].AsString("Material");
  m.baseColor = v["baseColor"].AsVec4(m.baseColor);
  m.metallic = v["metallic"].AsFloat(0.0f);
  m.roughness = v["roughness"].AsFloat(0.6f);
  m.emissiveColor = v["emissiveColor"].AsVec3(Vec3(0, 0, 0));
  m.emissiveStrength = v["emissiveStrength"].AsFloat(0.0f);
  m.opacity = v["opacity"].AsFloat(1.0f);
  m.normalStrength = v["normalStrength"].AsFloat(1.0f);
  m.baseColorTexture = v["baseColorTexture"].AsString();
  m.normalTexture = v["normalTexture"].AsString();
  m.metallicRoughnessTexture = v["metallicRoughnessTexture"].AsString();
  m.emissiveTexture = v["emissiveTexture"].AsString();
  m.doubleSided = v["doubleSided"].AsBool(false);
  m.unlit = v["unlit"].AsBool(false);
  m.castShadows = v["castShadows"].AsBool(true);
  m.receiveShadows = v["receiveShadows"].AsBool(true);
  return m;
}

bool Material::LoadFromFile(const std::string& path, std::string* error) {
  JsonValue doc;
  std::string err;
  if (!JsonValue::ParseFile(path, &doc, &err)) {
    if (error) *error = err;
    return false;
  }
  Material loaded = Material::Deserialize(doc);
  if (loaded.name.empty()) loaded.name = fs::Stem(path);
  *this = loaded;
  return true;
}

bool Material::SaveToFile(const std::string& path) const {
  if (!Serialize().WriteFile(path)) {
    NF_ERROR(LogCategory::Asset, "Failed to save material: %s", path.c_str());
    return false;
  }
  return true;
}

} // namespace nf
