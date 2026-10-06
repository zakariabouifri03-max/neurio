// NovaForge Engine - software rasterizer primitives
//
// A compact, deterministic tile based rasterizer. It is the engine's
// guaranteed-available renderer: no GPU or driver needed, so it powers the
// headless tests, the documentation screenshots, the video capture and the
// automatic fallback when a machine has no OpenGL 3.3 support.
#pragma once
#include "core/math.h"

#include <cstdint>
#include <vector>

namespace nf {

struct SoftTarget {
    uint32_t* color = nullptr;   // RGBA8 packed as 0xAABBGGRR (little endian byte order R,G,B,A)
    float* depth = nullptr;
    int width = 0;
    int height = 0;

    bool valid() const { return color && depth && width > 0 && height > 0; }
    inline uint32_t* pixel(int x, int y) { return color + (size_t)y * width + x; }
};

struct SoftBuffer {
    std::vector<uint32_t> color;
    std::vector<float> depth;
    int width = 0, height = 0;

    void resize(int w, int h);
    void clear(const Vec4& rgba, float depthValue = 1.0f);
    // Vertical sky gradient fill (used as the default background).
    void clearGradient(const Vec3& top, const Vec3& horizon, float depthValue = 1.0f);
    SoftTarget target() { return SoftTarget{color.data(), depth.data(), width, height}; }
    bool valid() const { return width > 0 && height > 0 && !color.empty(); }
    // Nearest/bilinear down/up-scale copy of `src` into this buffer.
    void blitScaled(const SoftBuffer& src, int dstW, int dstH, bool bilinear = true);
    void copyFrom(const SoftBuffer& src);
    void vignette(float strength);
};

// Clip space line drawing with depth test and optional thickness of 1 px.
void drawLine3D(SoftTarget& t, const Mat4& viewProjection, const Vec3& a, const Vec3& b,
                const Vec4& color, bool depthTest, int viewportW, int viewportH);
// Screen space (pixel) line drawing - used for gizmos and HUD.
void drawLine2D(SoftTarget& t, float x0, float y0, float x1, float y1, const Vec4& color,
                bool depthTest = false);
void fillRect2D(SoftTarget& t, float x, float y, float w, float h, const Vec4& color);
void drawText2D(SoftTarget& t, float x, float y, const char* text, const Vec4& color,
                int scale = 1);

inline uint32_t packRGBA(float r, float g, float b, float a = 1.0f) {
    uint32_t ri = (uint32_t)(clampf(r, 0.0f, 1.0f) * 255.0f + 0.5f);
    uint32_t gi = (uint32_t)(clampf(g, 0.0f, 1.0f) * 255.0f + 0.5f);
    uint32_t bi = (uint32_t)(clampf(b, 0.0f, 1.0f) * 255.0f + 0.5f);
    uint32_t ai = (uint32_t)(clampf(a, 0.0f, 1.0f) * 255.0f + 0.5f);
    return ri | (gi << 8) | (bi << 16) | (ai << 24);
}

// Blends a colour into the target (src alpha over dst), honouring depth.
inline void blendPixel(SoftTarget& t, int x, int y, const Vec4& c) {
    if (x < 0 || y < 0 || x >= t.width || y >= t.height) return;
    uint32_t* p = t.color + (size_t)y * t.width + x;
    uint32_t dst = *p;
    float dr = (float)(dst & 0xFF) / 255.0f;
    float dg = (float)((dst >> 8) & 0xFF) / 255.0f;
    float db = (float)((dst >> 16) & 0xFF) / 255.0f;
    float r = dr + (clampf(c.x, 0, 1) - dr) * clampf(c.w, 0, 1);
    float g = dg + (clampf(c.y, 0, 1) - dg) * clampf(c.w, 0, 1);
    float b = db + (clampf(c.z, 0, 1) - db) * clampf(c.w, 0, 1);
    *p = packRGBA(r, g, b, 1.0f);
}

}  // namespace nf
