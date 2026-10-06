#include "render/ui_overlay.h"

#include "render/soft_raster.h"

#include <algorithm>

namespace nf {

void UIBatch::quad(float x0, float y0, float x1, float y1, float u0, float v0, float u1, float v1,
                   const Vec4& c) {
    uint32_t base = (uint32_t)vertices_.size();
    vertices_.push_back({{x0, y0}, {u0, v0}, c});
    vertices_.push_back({{x1, y0}, {u1, v0}, c});
    vertices_.push_back({{x1, y1}, {u1, v1}, c});
    vertices_.push_back({{x0, y1}, {u0, v1}, c});
    indices_.push_back(base + 0);
    indices_.push_back(base + 1);
    indices_.push_back(base + 2);
    indices_.push_back(base + 0);
    indices_.push_back(base + 2);
    indices_.push_back(base + 3);
    drawCalls_++;
}

void UIBatch::rect(float x, float y, float w, float h, const Vec4& color) {
    quad(x, y, x + w, y + h, 0, 0, 0, 0, color);
}

void UIBatch::rectOutline(float x, float y, float w, float h, const Vec4& color, float t) {
    rect(x, y, w, t, color);
    rect(x, y + h - t, w, t, color);
    rect(x, y + t, t, h - 2 * t, color);
    rect(x + w - t, y + t, t, h - 2 * t, color);
}

void UIBatch::line(float x0, float y0, float x1, float y1, const Vec4& color, float thickness) {
    float dx = x1 - x0, dy = y1 - y0;
    float len = std::sqrt(dx * dx + dy * dy);
    if (len < 0.0001f) return;
    float nx = -dy / len * thickness * 0.5f, ny = dx / len * thickness * 0.5f;
    uint32_t base = (uint32_t)vertices_.size();
    vertices_.push_back({{x0 + nx, y0 + ny}, {0, 0}, color});
    vertices_.push_back({{x1 + nx, y1 + ny}, {0, 0}, color});
    vertices_.push_back({{x1 - nx, y1 - ny}, {0, 0}, color});
    vertices_.push_back({{x0 - nx, y0 - ny}, {0, 0}, color});
    indices_.push_back(base + 0);
    indices_.push_back(base + 1);
    indices_.push_back(base + 2);
    indices_.push_back(base + 0);
    indices_.push_back(base + 2);
    indices_.push_back(base + 3);
    drawCalls_++;
}

// Font atlas: 95 glyphs of 5x7 laid out in a 16 x 6 grid, cell 8x8 pixels.
static const uint8_t kGlyphs[95][5] = {
    {0x00,0x00,0x00,0x00,0x00},{0x00,0x00,0x5F,0x00,0x00},{0x00,0x07,0x00,0x07,0x00},
    {0x14,0x7F,0x14,0x7F,0x14},{0x24,0x2A,0x7F,0x2A,0x12},{0x23,0x13,0x08,0x64,0x62},
    {0x36,0x49,0x55,0x22,0x50},{0x00,0x05,0x03,0x00,0x00},{0x00,0x1C,0x22,0x41,0x00},
    {0x00,0x41,0x22,0x1C,0x00},{0x14,0x08,0x3E,0x08,0x14},{0x08,0x08,0x3E,0x08,0x08},
    {0x00,0x50,0x30,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},{0x00,0x60,0x60,0x00,0x00},
    {0x20,0x10,0x08,0x04,0x02},{0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},
    {0x42,0x61,0x51,0x49,0x46},{0x21,0x41,0x45,0x4B,0x31},{0x18,0x14,0x12,0x7F,0x10},
    {0x27,0x45,0x45,0x45,0x39},{0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36},{0x06,0x49,0x49,0x29,0x1E},{0x00,0x36,0x36,0x00,0x00},
    {0x00,0x56,0x36,0x00,0x00},{0x08,0x14,0x22,0x41,0x00},{0x14,0x14,0x14,0x14,0x14},
    {0x00,0x41,0x22,0x14,0x08},{0x02,0x01,0x51,0x09,0x06},{0x32,0x49,0x79,0x41,0x3E},
    {0x7E,0x11,0x11,0x11,0x7E},{0x7F,0x49,0x49,0x49,0x36},{0x3E,0x41,0x41,0x41,0x22},
    {0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},{0x7F,0x09,0x09,0x09,0x01},
    {0x3E,0x41,0x49,0x49,0x7A},{0x7F,0x08,0x08,0x08,0x7F},{0x00,0x41,0x7F,0x41,0x00},
    {0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},{0x7F,0x40,0x40,0x40,0x40},
    {0x7F,0x02,0x0C,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},{0x3E,0x41,0x41,0x41,0x3E},
    {0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},{0x7F,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7F,0x01,0x01},{0x3F,0x40,0x40,0x40,0x3F},
    {0x1F,0x20,0x40,0x20,0x1F},{0x7F,0x20,0x18,0x20,0x7F},{0x63,0x14,0x08,0x14,0x63},
    {0x03,0x04,0x78,0x04,0x03},{0x61,0x51,0x49,0x45,0x43},{0x00,0x7F,0x41,0x41,0x00},
    {0x02,0x04,0x08,0x10,0x20},{0x00,0x41,0x41,0x7F,0x00},{0x04,0x02,0x01,0x02,0x04},
    {0x40,0x40,0x40,0x40,0x40},{0x00,0x01,0x02,0x04,0x00},{0x20,0x54,0x54,0x54,0x78},
    {0x7F,0x48,0x44,0x44,0x38},{0x38,0x44,0x44,0x44,0x20},{0x38,0x44,0x44,0x48,0x7F},
    {0x38,0x54,0x54,0x54,0x18},{0x08,0x7E,0x09,0x01,0x02},{0x0C,0x52,0x52,0x52,0x3E},
    {0x7F,0x08,0x04,0x04,0x78},{0x00,0x44,0x7D,0x40,0x00},{0x20,0x40,0x44,0x3D,0x00},
    {0x7F,0x10,0x28,0x44,0x00},{0x00,0x41,0x7F,0x40,0x00},{0x7C,0x04,0x18,0x04,0x78},
    {0x7C,0x08,0x04,0x04,0x78},{0x38,0x44,0x44,0x44,0x38},{0x7C,0x14,0x14,0x14,0x08},
    {0x08,0x14,0x14,0x18,0x7C},{0x7C,0x08,0x04,0x04,0x08},{0x48,0x54,0x54,0x54,0x20},
    {0x04,0x3F,0x44,0x40,0x20},{0x3C,0x40,0x40,0x20,0x7C},{0x1C,0x20,0x40,0x20,0x1C},
    {0x3C,0x40,0x30,0x40,0x3C},{0x44,0x28,0x10,0x28,0x44},{0x0C,0x50,0x50,0x50,0x3C},
    {0x44,0x64,0x54,0x4C,0x44},{0x00,0x08,0x36,0x41,0x00},{0x00,0x00,0x7F,0x00,0x00},
    {0x00,0x41,0x36,0x08,0x00},{0x08,0x04,0x08,0x10,0x08},
};

constexpr int kCell = 8;      // 6x8 glyph cell inside an 8x8 atlas cell
constexpr int kCols = 16;
constexpr int kRows = 6;

std::shared_ptr<Texture> UIBatch::createFontAtlas() {
    static std::shared_ptr<Texture> atlas = [] {
        auto tex = std::make_shared<Texture>();
        tex->name = "NovaForgeFontAtlas";
        tex->width = kCols * kCell;
        tex->height = kRows * kCell;
        tex->filter = TextureFilter::Nearest;
        tex->wrap = TextureWrap::Clamp;
        tex->pixels.assign((size_t)tex->width * tex->height * 4, 0);
        for (int g = 0; g < 95; ++g) {
            int cx = (g % kCols) * kCell;
            int cy = (g / kCols) * kCell;
            for (int col = 0; col < 5; ++col) {
                uint8_t bits = kGlyphs[g][col];
                for (int row = 0; row < 7; ++row) {
                    if (!(bits & (1 << row))) continue;
                    int px = cx + col;
                    int py = cy + row;
                    size_t i = ((size_t)py * tex->width + px) * 4;
                    tex->pixels[i + 0] = 255;
                    tex->pixels[i + 1] = 255;
                    tex->pixels[i + 2] = 255;
                    tex->pixels[i + 3] = 255;
                }
            }
        }
        return tex;
    }();
    return atlas;
}

float UIBatch::textWidth(const std::string& s, int scale) const {
    return (float)s.size() * 6.0f * scale;
}

void UIBatch::text(float x, float y, const std::string& s, const Vec4& color, int scale) {
    if (!atlas_) atlas_ = createFontAtlas();
    float cursor = x;
    for (char raw : s) {
        unsigned char ch = (unsigned char)raw;
        if (ch == '\n') {
            cursor = x;
            y += 8.0f * scale;
            continue;
        }
        if (ch < 32 || ch > 126) ch = '?';
        int g = ch - 32;
        int col = g % kCols, row = g / kCols;
        float u0 = (float)(col * kCell) / atlas_->width;
        float v0 = (float)(row * kCell) / atlas_->height;
        float u1 = (float)(col * kCell + 6) / atlas_->width;
        float v1 = (float)(row * kCell + 8) / atlas_->height;
        quad(cursor, y, cursor + 6.0f * scale, y + 8.0f * scale, u0, v0, u1, v1, color);
        cursor += 6.0f * scale;
    }
}

void UIBatch::textCentered(float x, float y, const std::string& s, const Vec4& color, int scale) {
    text(x - textWidth(s, scale) * 0.5f, y, s, color, scale);
}

void UIBatch::crosshair(float cx, float cy, float size, const Vec4& color) {
    rect(cx - size, cy - 1, size * 2, 2, color);
    rect(cx - 1, cy - size, 2, size * 2, color);
}

void UIBatch::bar(float x, float y, float w, float h, float fill, const Vec4& fg, const Vec4& bg,
                  const Vec4& border) {
    fill = clampf(fill, 0.0f, 1.0f);
    rect(x, y, w, h, bg);
    rect(x + 2, y + 2, (w - 4) * fill, h - 4, fg);
    rectOutline(x, y, w, h, border, 2.0f);
}

void rasterizeUI(SoftTarget& target, const UIBatch& ui) {
    if (ui.empty()) return;
    const std::vector<UIVertex>& verts = ui.vertices();
    const std::vector<uint32_t>& idx = ui.indices();
    const Texture* tex = ui.atlas().get();
    for (size_t i = 0; i + 2 < idx.size(); i += 3) {
        const UIVertex& v0 = verts[idx[i]];
        const UIVertex& v1 = verts[idx[i + 1]];
        const UIVertex& v2 = verts[idx[i + 2]];
        float minX = std::min(v0.pos.x, std::min(v1.pos.x, v2.pos.x));
        float maxX = std::max(v0.pos.x, std::max(v1.pos.x, v2.pos.x));
        float minY = std::min(v0.pos.y, std::min(v1.pos.y, v2.pos.y));
        float maxY = std::max(v0.pos.y, std::max(v1.pos.y, v2.pos.y));
        int x0 = std::max(0, (int)std::floor(minX));
        int x1 = std::min(target.width - 1, (int)std::ceil(maxX));
        int y0 = std::max(0, (int)std::floor(minY));
        int y1 = std::min(target.height - 1, (int)std::ceil(maxY));
        if (x0 > x1 || y0 > y1) continue;
        float area = (v1.pos.x - v0.pos.x) * (v2.pos.y - v0.pos.y) -
                     (v2.pos.x - v0.pos.x) * (v1.pos.y - v0.pos.y);
        if (std::fabs(area) < 1e-6f) continue;
        for (int y = y0; y <= y1; ++y) {
            for (int x = x0; x <= x1; ++x) {
                float px = x + 0.5f, py = y + 0.5f;
                float w0 = ((v1.pos.x - v0.pos.x) * (py - v0.pos.y) - (px - v0.pos.x) * (v1.pos.y - v0.pos.y));
                float w1 = ((v2.pos.x - v1.pos.x) * (py - v1.pos.y) - (px - v1.pos.x) * (v2.pos.y - v1.pos.y));
                float w2 = ((v0.pos.x - v2.pos.x) * (py - v2.pos.y) - (px - v2.pos.x) * (v0.pos.y - v2.pos.y));
                float l0 = w1 / area, l1 = w2 / area, l2 = w0 / area;
                if (l0 < 0 || l1 < 0 || l2 < 0) continue;
                Vec4 c = v0.color * l0 + v1.color * l1 + v2.color * l2;
                Vec2 uv = v0.uv * l0 + v1.uv * l1 + v2.uv * l2;
                if (tex && tex->valid() && (c.w > 0.999f ? (uv.x != 0 || uv.y != 0) : true)) {
                    Vec4 t = tex->sample(uv.x, uv.y);
                    c = c * t;
                }
                blendPixel(target, x, y, c);
            }
        }
    }
}

}  // namespace nf
