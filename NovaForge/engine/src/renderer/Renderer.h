// NovaForge Engine - renderer/Renderer.h
// Backend independent renderer interface. `Renderer::Create()` returns the OpenGL
// 3.3 core renderer used by the editor and by exported games; the head-less
// verification path uses SoftwareRasterizer with the very same RenderScene.
#pragma once

#include "renderer/RenderTypes.h"
#include "renderer/DebugDraw.h"

namespace nf {

struct RendererStats {
  usize drawCalls = 0;
  usize triangles = 0;
  usize instancedDraws = 0;
  usize instancesSaved = 0;      // triangles saved by instancing
  usize shadowDrawCalls = 0;
  usize texturesUploaded = 0;
  usize meshesUploaded = 0;
  usize uiVertices = 0;
  f64 cpuFrameMs = 0.0;
  u64 frameIndex = 0;
};

struct FrameCapture {
  int width = 0;
  int height = 0;
  std::vector<u8> rgba;          // flipped to top-left origin
  bool valid = false;
};

class Renderer {
public:
  virtual ~Renderer() = default;

  // nativeWindowHandle: HWND on Windows (unused on other platforms). The GL context
  // is created by the platform layer, this only wires up GL objects.
  virtual bool Initialize(void* nativeWindowHandle, int width, int height,
                          std::string* outError) = 0;
  virtual void Shutdown() = 0;
  virtual void Resize(int width, int height) = 0;
  virtual void OnWindowResized() {}

  virtual void BeginFrame(const RenderSettings& settings) = 0;
  virtual void RenderScene(const RenderScene& scene, const RenderView& view,
                           const RenderSettings& settings, const DebugDrawList* debug) = 0;
  // Renders the 2D UI of choice (the editor uses ImGui directly between Begin/End).
  virtual void EndFrame(bool vsync) = 0;

  virtual FrameCapture CaptureFrame() = 0;

  // ---- offscreen target used by the editor viewport (false = unsupported backend)
  virtual bool BeginTarget(int width, int height) { NF_UNUSED(width); NF_UNUSED(height); return false; }
  virtual u64 EndTarget() { return 0; }        // returns the colour texture handle
  // GPU texture handle for an asset path (asset browser thumbnails). 0 = unavailable.
  virtual u64 AssetTextureHandle(const std::string& assetPath) { NF_UNUSED(assetPath); return 0; }
  virtual void SetAssetDatabase(class AssetDatabase* assets) { NF_UNUSED(assets); }
  virtual const RendererStats& Stats() const = 0;
  virtual const char* BackendName() const = 0;
  virtual const char* DriverInfo() const = 0;

  // Drops GPU resources (for example after a project switch).
  virtual void PurgeAssetCache() {}

  static Renderer* Create();
};

} // namespace nf
