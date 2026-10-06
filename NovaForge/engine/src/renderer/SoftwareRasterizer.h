// NovaForge Engine - renderer/SoftwareRasterizer.h
// A real CPU rasteriser that consumes the exact same RenderScene the GPU renderer
// does. It exists so the render pipeline (culling, materials, lighting, skinning,
// transparency, debug lines) can be executed and verified on a machine without a
// GPU - `nftool render` writes PNG reference frames with it.
#pragma once

#include "renderer/RenderTypes.h"
#include "renderer/DebugDraw.h"

namespace nf {

class SoftwareRasterizer {
public:
  bool Render(const RenderScene& scene, const RenderView& view, const RenderSettings& settings,
              const DebugDrawList* debug = nullptr);

  int Width() const { return width_; }
  int Height() const { return height_; }
  const std::vector<u8>& Pixels() const { return color_; }

  struct Stats {
    usize triangles = 0;
    usize rasterized = 0;
    usize shadedPixels = 0;
    usize backfaceCulled = 0;
    usize depthRejected = 0;
    usize drawCalls = 0;
  };
  const Stats& LastStats() const { return stats_; }

  static bool WritePng(const std::string& path, const std::vector<u8>& rgba, int width, int height);

private:
  struct VSOut {
    Vec4 clip{0, 0, 0, 0};
    Vec3 world{0, 0, 0};
    Vec3 normal{0, 1, 0};
    Vec2 uv{0, 0};
    Vec3 color{1, 1, 1};
    f32 viewDepth = 0.0f;
  };

  void RasterizeTriangle(const VSOut& a, const VSOut& b, const VSOut& c, const Material& material,
                         bool doubleSided, bool depthWrite);
  void ShadePixel(int x, int y, const VSOut& interpolated, const Vec3& faceNormal,
                  const Material& material, bool depthWrite);
  Vec4 SampleTexture(const std::string& assetPath, const Vec2& uv, const Vec4& fallback);
  Vec3 ShadeLighting(const Vec3& worldPosition, const Vec3& normal, const Vec3& albedo,
                     const Material& material) const;
  void DrawDebugLines(const DebugDrawList& debug, const RenderView& view, const RenderSettings& settings);
  void ProjectLine(const Vec3& world, Vec3* outScreen, f32* outDepth) const;
  void Clear(const RenderScene& scene, const RenderView& view);
  void DrawSky(const RenderScene& scene, const RenderView& view, const RenderSettings& settings);

  int width_ = 0;
  int height_ = 0;
  std::vector<u8> color_;
  std::vector<f32> depth_;
  RenderScene scene_;
  RenderView view_;
  Stats stats_;
  class AssetDatabase* assets_ = nullptr;
};

} // namespace nf
