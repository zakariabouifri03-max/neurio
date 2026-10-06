// NovaForge Engine - immediate mode 2D overlay (game HUD)
//
// Used by the exported game for the HUD (health bar, messages, crosshair,
// menus). Text is rendered from a built-in 5x7 bitmap font expanded into a
// texture atlas at start-up, so the runtime needs no font file and no UI
// toolkit. The editor uses ImGui instead (see IRenderer::drawImGui).
#pragma once
#include "assets/texture.h"
#include "core/math.h"

#include <memory>
#include <string>
#include <vector>

namespace nf {

struct UIVertex {
    Vec2 pos;
    Vec2 uv;
    Vec4 color{1, 1, 1, 1};
};

class UIBatch {
public:
    UIBatch() = default;

    void clear() { vertices_.clear(); indices_.clear(); drawCalls_ = 0; }
    bool empty() const { return indices_.empty(); }
    const std::vector<UIVertex>& vertices() const { return vertices_; }
    const std::vector<uint32_t>& indices() const { return indices_; }
    const std::shared_ptr<Texture>& atlas() const { return atlas_; }
    void setAtlas(std::shared_ptr<Texture> t) { atlas_ = std::move(t); }
    int drawCalls() const { return drawCalls_; }

    void setScreenSize(int w, int h) {
        screenW_ = (float)w;
        screenH_ = (float)h;
    }
    float screenWidth() const { return screenW_; }
    float screenHeight() const { return screenH_; }

    // All coordinates are in pixels, origin top-left.
    void rect(float x, float y, float w, float h, const Vec4& color);
    void rectOutline(float x, float y, float w, float h, const Vec4& color, float thickness = 1.0f);
    void text(float x, float y, const std::string& s, const Vec4& color, int scale = 2);
    void textCentered(float x, float y, const std::string& s, const Vec4& color, int scale = 2);
    float textWidth(const std::string& s, int scale = 2) const;
    void crosshair(float cx, float cy, float size, const Vec4& color);
    // A fillable progress bar (health, stamina, ...).
    void bar(float x, float y, float w, float h, float fill, const Vec4& fg, const Vec4& bg,
             const Vec4& border);
    void line(float x0, float y0, float x1, float y1, const Vec4& color, float thickness = 1.0f);

    static std::shared_ptr<Texture> createFontAtlas();

private:
    void quad(float x0, float y0, float x1, float y1, float u0, float v0, float u1, float v1,
              const Vec4& c);
    std::vector<UIVertex> vertices_;
    std::vector<uint32_t> indices_;
    std::shared_ptr<Texture> atlas_;
    float screenW_ = 1280, screenH_ = 720;
    int drawCalls_ = 0;
};

// Rasterizes a UIBatch into a software target (used by the software renderer).
struct SoftTarget;
void rasterizeUI(SoftTarget& target, const UIBatch& ui);

}  // namespace nf
