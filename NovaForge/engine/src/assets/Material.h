// NovaForge Engine - assets/Material.h
#pragma once

#include "core/Base.h"
#include "core/Math.h"
#include "core/Json.h"

namespace nf {

// A physically-inspired PBR material. Values map 1:1 onto the runtime shader.
struct Material {
  std::string name = "Material";
  Vec4 baseColor{0.82f, 0.82f, 0.86f, 1.0f};
  Vec3 emissiveColor{0, 0, 0};
  f32 metallic = 0.0f;
  f32 roughness = 0.6f;
  f32 emissiveStrength = 0.0f;
  f32 opacity = 1.0f;
  f32 normalStrength = 1.0f;

  std::string baseColorTexture;    // asset-relative path ("" = none)
  std::string normalTexture;
  std::string metallicRoughnessTexture;
  std::string emissiveTexture;

  bool doubleSided = false;
  bool unlit = false;
  bool castShadows = true;
  bool receiveShadows = true;

  // runtime GPU state (filled by the renderer)
  u32 gpuBaseColorTex = 0;
  u32 gpuNormalTex = 0;
  u32 gpuMetallicRoughnessTex = 0;
  u32 gpuEmissiveTex = 0;
  u64 gpuVersion = 0;

  static Material Default() { return Material(); }
  static Material Unlit(const Vec4& color) {
    Material m;
    m.unlit = true;
    m.baseColor = color;
    return m;
  }
  JsonValue Serialize() const;
  static Material Deserialize(const JsonValue& v);
  bool LoadFromFile(const std::string& path, std::string* error = nullptr);
  bool SaveToFile(const std::string& path) const;
};

} // namespace nf
