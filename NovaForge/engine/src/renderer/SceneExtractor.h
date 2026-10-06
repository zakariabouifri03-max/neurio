// NovaForge Engine - renderer/SceneExtractor.h
// Turns a Scene into a RenderScene: resolves meshes/materials, evaluates animation
// poses, performs frustum culling and groups draw calls for instancing.
#pragma once

#include "renderer/RenderTypes.h"
#include "animation/AnimationSystem.h"

namespace nf {

class Scene;

// Extraction options (namespace scope so it can be used as a default argument).
struct ExtractOptions {
  bool includeGizmos = true;
  bool editorMode = false;
  bool updateAnimationPoses = true;
  RenderSettings settings;
};

class SceneExtractor {
public:
  using Options = ExtractOptions;

  static void Extract(Scene& scene, const RenderView& view, RenderScene& out, ExtractionStats& stats,
                      const Options& options = {});

  // Builds a render view from a camera component transform.
  static RenderView MakeView(const Transform& cameraTransform, f32 fovDegrees, f32 nearZ, f32 farZ,
                             bool orthographic, f32 orthoSize, f32 aspect, const Vec3& clearColor);

  // Collects every light in the scene into `out` (respecting the light budget).
  static void ExtractLights(Scene& scene, RenderScene& out, const Vec3& cameraPosition,
                            int maxDynamicLights);
};

} // namespace nf
