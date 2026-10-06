#include "assets/material.h"
#include "core/fs.h"
#include "core/guid.h"
#include "core/image.h"
#include "core/log.h"

namespace nf {

Json Material::toJson() const {
    Json j = Json::object();
    j.set("name", name);
    j.set("id", id);
    Json& color = j.arrayAt("baseColor");
    color.push(baseColor.x); color.push(baseColor.y); color.push(baseColor.z);
    j.set("metallic", metallic);
    j.set("roughness", roughness);
    j.set("opacity", opacity);
    Json& em = j.arrayAt("emissive");
    em.push(emissive.x); em.push(emissive.y); em.push(emissive.z);
    j.set("emissiveStrength", emissiveStrength);
    j.set("albedoTexture", albedoTexture);
    Json& tiling = j.arrayAt("uvTiling");
    tiling.push(uvTiling.x); tiling.push(uvTiling.y);
    Json& offset = j.arrayAt("uvOffset");
    offset.push(uvOffset.x); offset.push(uvOffset.y);
    j.set("doubleSided", doubleSided);
    j.set("unlit", unlit);
    j.set("castShadow", castShadow);
    j.set("alphaCutoff", alphaCutoff);
    return j;
}

static Vec3 vec3FromJson(const Json& j, const Vec3& fallback) {
    if (!j.isArray() || j.size() < 3) return fallback;
    return Vec3(j[0].asFloat(fallback.x), j[1].asFloat(fallback.y), j[2].asFloat(fallback.z));
}

Material Material::fromJson(const Json& j, const std::string& fallbackName) {
    Material m;
    m.name = j["name"].asString(fallbackName);
    m.id = j["id"].asString(generateGuid());
    m.baseColor = vec3FromJson(j["baseColor"], m.baseColor);
    m.metallic = j["metallic"].asFloat(0.0f);
    m.roughness = j["roughness"].asFloat(0.65f);
    m.opacity = j["opacity"].asFloat(1.0f);
    m.emissive = vec3FromJson(j["emissive"], Vec3(0, 0, 0));
    m.emissiveStrength = j["emissiveStrength"].asFloat(0.0f);
    m.albedoTexture = j["albedoTexture"].asString("");
    m.uvTiling = Vec2(j["uvTiling"][0].asFloat(1.0f), j["uvTiling"][1].asFloat(1.0f));
    m.uvOffset = Vec2(j["uvOffset"][0].asFloat(0.0f), j["uvOffset"][1].asFloat(0.0f));
    m.doubleSided = j["doubleSided"].asBool(false);
    m.unlit = j["unlit"].asBool(false);
    m.castShadow = j["castShadow"].asBool(true);
    m.alphaCutoff = j["alphaCutoff"].asFloat(0.5f);
    if (m.id.empty()) m.id = generateGuid();
    return m;
}

bool Material::save(const std::string& path) const {
    return toJson().saveFile(path, 2);
}

bool Material::load(const std::string& path, std::string* error) {
    Json j;
    if (!Json::parseFile(path, j, error)) return false;
    *this = fromJson(j, fs::stem(path));
    return true;
}

Material Material::defaultMaterial() { return Material(); }

Material Material::colored(const std::string& name, const Vec3& color) {
    Material m;
    m.name = name;
    m.baseColor = color;
    return m;
}

Material Material::defaultGround() {
    Material m;
    m.name = "Ground";
    m.baseColor = Vec3(0.45f, 0.52f, 0.40f);
    m.roughness = 0.9f;
    return m;
}

Material Material::glass() {
    Material m;
    m.name = "Glass";
    m.baseColor = Vec3(0.75f, 0.85f, 0.95f);
    m.opacity = 0.35f;
    m.roughness = 0.05f;
    m.metallic = 0.0f;
    return m;
}

void generateCheckerImage(ImageData& out, int size, int checks, Vec3 c1, Vec3 c2) {
    out.width = size;
    out.height = size;
    out.channels = 4;
    out.pixels.resize((size_t)size * size * 4);
    int cell = size / (checks > 0 ? checks : 8);
    if (cell < 1) cell = 1;
    for (int y = 0; y < size; ++y) {
        for (int x = 0; x < size; ++x) {
            bool odd = ((x / cell) + (y / cell)) % 2 == 1;
            Vec3 c = odd ? c1 : c2;
            size_t i = ((size_t)y * size + x) * 4;
            out.pixels[i + 0] = (uint8_t)clampf(c.x * 255.0f, 0, 255);
            out.pixels[i + 1] = (uint8_t)clampf(c.y * 255.0f, 0, 255);
            out.pixels[i + 2] = (uint8_t)clampf(c.z * 255.0f, 0, 255);
            out.pixels[i + 3] = 255;
        }
    }
}

}  // namespace nf
