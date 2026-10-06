// NovaForge Engine - renderer/RenderTypes.h
// The data contract between the scene and any renderer backend (OpenGL for real
// windows, software rasteriser for head-less verification). Extraction performs
// frustum culling and batching; backends only draw.
#pragma once

#include "core/Base.h"
#include "core/Math.h"
#include "assets/Model.h"

namespace nf {

struct RenderView {
  Mat4 view = Mat4::Identity();
  Mat4 projection = Mat4::Identity();
  Mat4 viewProjection = Mat4::Identity();
  Vec3 position{0, 0, 0};
  Vec3 forward{0, 0, -1};
  Vec3 up{0, 1, 0};
  f32 nearZ = 0.1f;
  f32 farZ = 1000.0f;
  f32 fovY = 60.0f * kDegToRad;
  Frustum frustum;
  Vec3 clearColor{0.52f, 0.68f, 0.88f};
};

struct RenderLight {
  int type = 1;                    // 0 directional, 1 point, 2 spot
  Vec3 position{0, 0, 0};
  Vec3 direction{0, -1, 0};
  Vec3 color{1, 1, 1};
  f32 intensity = 1.0f;
  f32 range = 12.0f;
  f32 innerCos = 0.9f;
  f32 outerCos = 0.8f;
  bool castShadows = false;
  f32 shadowBias = 0.0015f;
  f32 shadowStrength = 0.85f;
  EntityId entity = 0;
};

struct RenderItem {
  EntityId entity = 0;
  Mat4 world = Mat4::Identity();
  Mat4 normalMatrix = Mat4::Identity();
  std::shared_ptr<Mesh> mesh;
  Material material;
  u32 subMeshIndex = 0;
  AABB worldBounds;
  f32 distanceToCamera = 0.0f;
  bool castShadows = true;
  bool receiveShadows = true;
  bool transparent = false;
  bool doubleSided = false;
  u32 batchKey = 0;                 // mesh + material hash for instancing groups
  bool visible = true;

  // skeletal animation (empty for static meshes)
  std::shared_ptr<const std::vector<Mat4>> boneMatrices;
};

struct RenderScene {
  std::vector<RenderItem> items;          // opaque, sorted front-to-back by material key
  std::vector<RenderItem> transparentItems;
  std::vector<RenderLight> lights;
  Vec3 ambientColor{0.3f, 0.32f, 0.38f};
  f32 ambientIntensity = 1.0f;
  Vec3 skyTop{0.35f, 0.55f, 0.90f};
  Vec3 skyBottom{0.80f, 0.85f, 0.95f};
  bool showSkybox = true;
  bool fogEnabled = false;
  Vec3 fogColor{0.62f, 0.7f, 0.82f};
  f32 fogStart = 30.0f;
  f32 fogEnd = 180.0f;
  void Clear() {
    items.clear();
    transparentItems.clear();
    lights.clear();
  }
};

struct ExtractionStats {
  usize totalObjects = 0;
  usize submitted = 0;
  usize culled = 0;            // frustum culled
  usize invisible = 0;         // hidden / disabled
  usize missingMesh = 0;
  usize instancedBatches = 0;
  usize instancedDraws = 0;
};

// Renderer-side feature switches that also affect extraction (shadows, quality).
struct RenderSettings {
  int width = 1600;
  int height = 900;
  bool shadowsEnabled = true;
  int shadowResolution = 2048;
  f32 shadowDistance = 60.0f;
  int shadowCascades = 1;
  bool instancingEnabled = true;
  bool wireframe = false;
  bool showGrid = true;
  bool showGizmos = true;
  bool vsync = true;
  int msaaSamples = 4;
  int quality = 2;               // 0 low, 1 medium, 2 high, 3 ultra (scales effects)
  f32 renderScale = 1.0f;
  f32 exposure = 1.0f;
  bool toneMapping = true;
  bool fogEnabled = true;
  int maxDynamicLights = 8;
  bool showSkeletalBounds = false;
};

} // namespace nf
