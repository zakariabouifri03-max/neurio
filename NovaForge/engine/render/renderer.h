// NovaForge Engine - renderer interface
//
// V1 ships ONE renderer: SoftwareRenderer (engine/render/pipe_software.cpp), a
// multithreaded CPU rasterizer with shadow maps, fog, post grading, particles
// and a 2D overlay. It runs identically on Windows, Linux and headless CI, so
// the editor, PLAY mode and the exported game all show the same image and the
// renderer is covered by automated tests.
//
// IRenderer is the seam a GPU backend would plug into (docs/RENDERING.md
// explains the trade-off and what a DX12/Vulkan backend would have to provide).
// No GPU backend is compiled or advertised in V1.
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
void setSoftwareImGuiBackend(SoftImGuiDrawFn fn);

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

// Factory for the V1 renderer.
IRenderer* createSoftwareRenderer();

}  // namespace nf
