// NovaForge Engine - material asset (.nfmat.json)
#pragma once
#include "core/json.h"
#include "core/math.h"

#include <string>

namespace nf {

struct Material {
    std::string id;            // guid (informational)
    std::string name = "Material";
    Vec3 baseColor{0.82f, 0.82f, 0.85f};
    float metallic = 0.0f;
    float roughness = 0.65f;
    float opacity = 1.0f;
    Vec3 emissive{0, 0, 0};
    float emissiveStrength = 0.0f;
    std::string albedoTexture;     // project relative path, empty = none
    Vec2 uvTiling{1, 1};
    Vec2 uvOffset{0, 0};
    bool doubleSided = false;
    bool unlit = false;
    bool castShadow = true;
    float alphaCutoff = 0.5f;

    bool isTransparent() const { return opacity < 0.999f; }

    Json toJson() const;
    static Material fromJson(const Json& j, const std::string& fallbackName = "Material");
    bool save(const std::string& path) const;
    bool load(const std::string& path, std::string* error = nullptr);

    static Material defaultMaterial();
    static Material defaultGround();
    static Material glass();
    // A palette used by "Create > Object" so a fresh scene is not all grey.
    static Material colored(const std::string& name, const Vec3& color);
};

// Simple procedural checker texture used for the ground plane and for
// placeholder materials of imported meshes without textures.
struct ImageData;
void generateCheckerImage(ImageData& out, int size = 256, int checks = 8,
                          Vec3 c1 = Vec3(0.55f, 0.60f, 0.62f), Vec3 c2 = Vec3(0.35f, 0.40f, 0.42f));

}  // namespace nf
