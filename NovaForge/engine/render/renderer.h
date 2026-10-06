// NovaForge Engine - renderer interface
//
// Two implementations ship in V1:
//   * SoftwareRenderer  (engine/render/pipe_software.cpp) - always available,
//     deterministic, used by tests, captures and as a compatibility fallback.
//   * GLRenderer        (engine/render/pipe_gl.cpp)       - OpenGL 3.3 core,
//     the default on Windows.
// Both consume the same DrawList, so a scene looks the same in the editor, in
// PLAY mode and in the exported game.
#pragma once
#include "assets/texture.h"
#include "platform/platform.h"
#include "render/draw_list.h"

#include <memory>
#include <string>
#include <vector>

namespace nf {

class UIBatch;
struct SoftTarget;

// ImGui rendering hooks. The ImGui backends live in their own translation
// units (editor builds only); main() registers them so that the renderers do
// not have to link ImGui at all (the exported game ships without it).
using SoftImGuiDrawFn = void (*)(SoftTarget& target, void* drawData, const RenderCamera& camera,
                                 float scale);
using GLImGuiDrawFn = void (*)(void* drawData, int framebufferWidth, int framebufferHeight,
                              float scale);
void setSoftwareImGuiBackend(SoftImGuiDrawFn fn);
void setGLImGuiBackend(GLImGuiDrawFn fn);

class IRenderer {
public:
    virtual ~IRenderer() = default;

    virtual bool init(Window* window, const RenderSettings& settings) = 0;
    virtual void shutdown() = 0;
    virtual void setSettings(const RenderSettings& s) { settings_ = s; }
    const RenderSettings& settings() const { return settings_; }

    // The scene is rendered into an offscreen target of `width` x `height`
    // virtual pixels (the editor viewport size, or the window size in a game).
    virtual void beginFrame(const RenderCamera& camera) = 0;
    virtual void drawScene(const DrawList& list) = 0;
    virtual void drawLines(const LineBatch& batch, bool depthTest) = 0;
    virtual void drawUI(const UIBatch& ui) = 0;
    // ImGui draw data (editor only). `drawData` is an ImDrawData*.
    virtual void drawImGui(void* drawData) {}
    // Uploads the offscreen target to the window and swaps buffers.
    virtual void endFrame() = 0;

    virtual bool captureFrame(std::vector<uint8_t>& rgba, int& w, int& h) = 0;
    // Texture used by the editor's viewport panel (and by ImGui image widgets).
    virtual std::shared_ptr<Texture> viewportTexture() = 0;
    // ImGui texture id for an engine texture (GL name or CPU pointer).
    virtual void* imguiTextureId(const Texture* texture) = 0;
    virtual void releaseImGuiTexture(const Texture* texture) {}

    virtual const char* name() const = 0;
    virtual bool isHardware() const { return false; }
    virtual bool hasShadows() const { return true; }
    virtual RenderStats stats() const { return stats_; }
    virtual size_t vramEstimateBytes() const { return 0; }

    Window* window() { return window_; }
    void setTargetSize(int w, int h) {
        targetWidth_ = w;
        targetHeight_ = h;
    }
    int targetWidth() const { return targetWidth_; }
    int targetHeight() const { return targetHeight_; }

protected:
    Window* window_ = nullptr;
    RenderSettings settings_;
    RenderStats stats_;
    int targetWidth_ = 1280;
    int targetHeight_ = 720;
};

// Factories. `createGLRenderer` returns nullptr when the build has no GL
// backend or the driver does not expose the required functions.
IRenderer* createSoftwareRenderer();
IRenderer* createGLRenderer(Window* window);

}  // namespace nf
