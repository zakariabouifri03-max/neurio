// NovaForge Engine - render data model (camera, draw items, lights)
//
// The engine never draws straight from the scene: the scene system fills a
// DrawList each frame, the renderer (software or OpenGL) consumes it. That is
// what makes "PLAY mode uses exactly the same systems as the exported game"
// true for rendering as well.
#pragma once
#include "assets/material.h"
#include "assets/mesh.h"
#include "assets/texture.h"
#include "core/math.h"
#include "scene/components.h"   // LightType (shared render/gameplay enum)

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace nf {

using EntityId = uint32_t;

// ---------------------------------------------------------------- settings
enum class QualityLevel { Low = 0, Medium = 1, High = 2, Ultra = 3 };

struct RenderSettings {
    int width = 1280;
    int height = 720;
    float resolutionScale = 1.0f;      // < 1 renders fewer pixels (faster)
    QualityLevel quality = QualityLevel::Medium;
    bool enableShadows = true;
    int shadowMapSize = 1024;          // directional light shadow map
    float shadowDistance = 30.0f;      // directional shadow draw distance (metres)
    int spotShadowMapSize = 512;
    int maxSpotShadows = 1;
    bool vsync = true;
    bool enableFog = false;
    float fogDensity = 0.008f;
    Vec3 fogColor{0.6f, 0.7f, 0.8f};
    int maxLights = 8;                 // per object light budget
    float ambientIntensity = 0.35f;
    Vec3 ambientColor{0.55f, 0.62f, 0.72f};
    bool wireframe = false;
    bool showGrid = true;
    bool showGizmos = true;
    float drawDistance = 500.0f;
    bool enableParticles = true;
    bool enableShadowsInEditor = true;
    bool softwareRenderer = false;

    static RenderSettings preset(QualityLevel q);
    std::string qualityName() const;
};

// ---------------------------------------------------------------- camera
struct RenderCamera {
    Mat4 view;
    Mat4 projection;
    Mat4 viewProjection;
    Vec3 position{0, 0, 0};
    Vec3 forward{0, 0, -1};
    Vec3 up{0, 1, 0};
    float fovYDegrees = 60.0f;
    float nearZ = 0.1f;
    float farZ = 600.0f;
    float aspect = 16.0f / 9.0f;
    bool orthographic = false;
    Vec3 clearColor{0.42f, 0.55f, 0.70f};
    float exposure = 1.0f;
    int viewportWidth = 1280, viewportHeight = 720;
    Frustum frustum;

    static RenderCamera perspective(const Vec3& eye, const Vec3& target, const Vec3& up, float fovY,
                                    float aspect, float nearZ, float farZ);
    void rebuild();
    // ray through a pixel in viewport space (0,0 = top-left)
    Ray screenRay(float x, float y) const;
    Vec3 worldToScreen(const Vec3& world) const;   // z is NDC depth (-1..1)
    bool projectPoint(const Vec3& world, Vec2& outScreen) const;
};

// ---------------------------------------------------------------- draw items
struct DrawItem {
    const Mesh* mesh = nullptr;
    const std::vector<Mat4>* skinning = nullptr;   // joint matrices when skinned
    Mat4 model;
    Mat4 normalMatrix;
    const Material* material = nullptr;
    const Texture* albedo = nullptr;
    Vec3 tint{1, 1, 1};
    int submeshIndex = 0;
    uint32_t indexOffset = 0;
    uint32_t indexCount = 0;
    int materialIndex = 0;
    bool castShadow = true;
    bool receiveShadow = true;
    bool doubleSided = false;
    bool unlit = false;
    bool highlighted = false;      // selection outline in the editor
    bool depthOnly = false;
    float sortDepth = 0;
    AABB worldBounds;
    EntityId entity = 0;
    const Material* subMaterial = nullptr;   // resolved material for this sub-mesh
};

struct LightItem {
    LightType type = LightType::Directional;
    Vec3 position{0, 10, 0};
    Vec3 direction{0, -1, 0};
    Vec3 color{1, 1, 1};
    float intensity = 1.0f;
    float range = 15.0f;
    float spotAngleDegrees = 40.0f;
    float spotSoftness = 0.25f;
    bool castShadow = false;
    int shadowSlot = -1;           // index into the renderer's shadow map array
    float shadowBias = 0.002f;
    EntityId entity = 0;
};

// Camera facing quads used for the V1 particle effects and sprite HUD markers.
// Kept out of the mesh pipeline because they need no mesh asset at all.
struct BillboardItem {
    Vec3 position;
    Vec2 size{0.2f, 0.2f};
    Vec4 color{1, 1, 1, 1};
    bool additive = false;
    bool softCircle = true;
    float rotation = 0.0f;
};

struct LineVertex {
    Vec3 pos;
    Vec4 color{1, 1, 1, 1};
};
struct LineBatch {
    std::vector<LineVertex> lines;   // pairs of vertices
    void add(const Vec3& a, const Vec3& b, const Vec4& color) {
        lines.push_back({a, color});
        lines.push_back({b, color});
    }
    void addAABB(const AABB& b, const Vec4& color) {
        Vec3 c[8] = {
            {b.min.x, b.min.y, b.min.z}, {b.max.x, b.min.y, b.min.z},
            {b.max.x, b.max.y, b.min.z}, {b.min.x, b.max.y, b.min.z},
            {b.min.x, b.min.y, b.max.z}, {b.max.x, b.min.y, b.max.z},
            {b.max.x, b.max.y, b.max.z}, {b.min.x, b.max.y, b.max.z}};
        static const int edges[12][2] = {{0, 1}, {1, 2}, {2, 3}, {3, 0}, {4, 5}, {5, 6},
                                         {6, 7}, {7, 4}, {0, 4}, {1, 5}, {2, 6}, {3, 7}};
        for (auto& e : edges) add(c[edges[0][0]] * 0 + c[e[0]], c[e[1]], color);
    }
    void addCircle(const Vec3& center, const Vec3& axis, const Vec3& start, float radius,
                   int segments, const Vec4& color) {
        Vec3 prev;
        for (int i = 0; i <= segments; ++i) {
            float a = (float)i / segments * 2.0f * PI;
            Vec3 p = center + start * (std::cos(a) * radius) + axis * (std::sin(a) * radius);
            if (i > 0) add(prev, p, color);
            prev = p;
        }
    }
    void clear() { lines.clear(); }
    bool empty() const { return lines.empty(); }
};

struct RenderStats {
    int drawItems = 0;
    int drawCalls = 0;
    int culledItems = 0;
    int triangles = 0;
    int vertices = 0;
    int shadowCasters = 0;
    double cpuFrameMs = 0;
    double rasterMs = 0;
    void reset() { *this = RenderStats(); }
};

// ---------------------------------------------------------------- draw list
class DrawList {
public:
    RenderCamera camera;
    RenderSettings settings;
    std::vector<DrawItem> items;
    std::vector<LightItem> lights;
    std::vector<BillboardItem> billboards;
    LineBatch overlayLines;      // drawn with depth test (gizmos, colliders)
    LineBatch overlayLinesNoDepth;
    Vec3 ambientColor{0.55f, 0.62f, 0.72f};
    float ambientIntensity = 0.35f;
    RenderStats stats;
    size_t particles = 0;
    // Materials created on the fly for this frame (e.g. translucency for
    // objects that are invisible at runtime). Keeps DrawItem pointers valid.
    std::vector<std::shared_ptr<Material>> ownedMaterials;

    void clear();

    void add(const Mesh& mesh, const Mat4& model, const Material& material, const Texture* albedo,
             const std::vector<Mat4>* skinning = nullptr, EntityId entity = 0);
    // Adds every sub-mesh of a mesh, resolving materials through the callback.
    void addMeshAll(
        const Mesh& mesh, const Mat4& model, EntityId entity,
        const std::function<const Material*(int submeshIndex, const Texture** albedoOut)>& resolve,
        const std::vector<Mat4>* skinning, bool castShadow, bool receiveShadow, bool highlighted,
        const Vec3& tint);

    // Frustum + distance culling. Returns the number of culled items.
    int cull();
    // Sorts opaque items front-to-back for early-z and transparent back-to-front.
    void sort();
    void computeStats();

    struct LightSummary {
        int directional = 0, point = 0, spot = 0, shadowCasters = 0;
    };
    LightSummary lightSummary() const;
};

// Picking: returns the closest entity hit by a ray, and the hit distance.
struct PickResult {
    EntityId entity = 0;
    float distance = 1e30f;
    Vec3 point;
    bool hit = false;
};
PickResult pickRay(const DrawList& list, const Ray& ray, bool includeInvisible = false);

}  // namespace nf
