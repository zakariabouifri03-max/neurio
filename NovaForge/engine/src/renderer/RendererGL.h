// NovaForge Engine - renderer/RendererGL.h
// OpenGL 3.3 core forward renderer: instanced draws, directional shadow mapping,
// PBR-inspired shading, texture cache, GPU mesh cache, debug line overlay.
#pragma once

#include "renderer/Renderer.h"
#include "renderer/GLFunctions.h"

#include <unordered_map>

namespace nf {

class AssetDatabase;

class RendererGL : public Renderer {
public:
  RendererGL();
  ~RendererGL() override;

  bool Initialize(void* nativeWindowHandle, int width, int height, std::string* outError) override;
  void Shutdown() override;
  void Resize(int width, int height) override;

  void BeginFrame(const RenderSettings& settings) override;
  void RenderScene(const ::nf::RenderScene& scene, const RenderView& view,
                   const RenderSettings& settings, const DebugDrawList* debug) override;
  void EndFrame(bool vsync) override;

  FrameCapture CaptureFrame() override;
  const RendererStats& Stats() const override { return stats_; }
  const char* BackendName() const override { return "OpenGL 3.3 core"; }
  const char* DriverInfo() const override { return driverInfo_.c_str(); }

  void SetAssetDatabase(AssetDatabase* assets) override { assets_ = assets; }
  bool BeginTarget(int width, int height) override;
  u64 EndTarget() override;
  u64 AssetTextureHandle(const std::string& assetPath) override;
  void PurgeAssetCache() override;

private:
  struct GpuMesh {
    gl::GLuint vao = 0;
    gl::GLuint vbo = 0;
    gl::GLuint ebo = 0;
    gl::GLuint boneVbo = 0;
    gl::GLuint indexCount = 0;
    gl::GLuint vertexCount = 0;
    bool skinned = false;
    u64 version = 0;
  };
  struct GpuTexture {
    gl::GLuint handle = 0;
    int width = 0;
    int height = 0;
    u64 lastUsedFrame = 0;
  };

  struct DrawBatch {
    const RenderItem* item = nullptr;
    std::vector<const RenderItem*> instances;
    std::shared_ptr<const std::vector<Mat4>> boneMatrices;
    bool skinned = false;
  };

  bool CreateShaders(std::string* outError);
  bool CreateShadowResources(std::string* outError);
  gl::GLuint CompileProgram(const char* vertexSource, const char* fragmentSource,
                            std::string* outError);
  GpuMesh* GetOrCreateMesh(const std::shared_ptr<Mesh>& mesh);
  gl::GLuint GetTexture(const std::string& assetPath, bool srgb);
  void UploadSceneUniforms(const ::nf::RenderScene& scene, const RenderView& view,
                           const RenderSettings& settings);
  void BindMaterial(const Material& material);
  void DrawItems(const std::vector<RenderItem>& items, const RenderSettings& settings,
                 bool transparentPass);
  void RenderShadowMap(const ::nf::RenderScene& scene, const RenderView& view,
                       const RenderSettings& settings);
  void DrawDebug(const DebugDrawList& debug, const RenderView& view,
                 const RenderSettings& settings);
  void ReleaseGpuResources();

  int width_ = 1600;
  int height_ = 900;
  AssetDatabase* assets_ = nullptr;
  RendererStats stats_;
  std::string driverInfo_ = "OpenGL (unknown)";

  gl::GLuint forwardProgram_ = 0;
  gl::GLuint shadowProgram_ = 0;
  gl::GLuint lineProgram_ = 0;

  gl::GLuint instanceVbo_ = 0;
  std::vector<f32> instanceScratch_;

  gl::GLuint shadowFbo_ = 0;
  gl::GLuint shadowTexture_ = 0;
  int shadowResolution_ = 2048;
  Mat4 shadowMatrix_ = Mat4::Identity();

  gl::GLuint lineVao_ = 0;
  gl::GLuint lineVbo_ = 0;
  usize lineCapacity_ = 0;

  gl::GLuint dummyTexture_ = 0;
  gl::GLuint targetFbo_ = 0;
  gl::GLuint targetColor_ = 0;
  gl::GLuint targetDepth_ = 0;
  int targetWidth_ = 0;
  int targetHeight_ = 0;
  bool targetBound_ = false;

  std::unordered_map<const Mesh*, GpuMesh> meshes_;
  std::unordered_map<std::string, GpuTexture> textures_;
  bool initialized_ = false;
};

} // namespace nf
