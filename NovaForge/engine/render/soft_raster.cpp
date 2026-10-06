#include "render/soft_raster.h"

#include <algorithm>
#include <cstring>

namespace nf {

void SoftBuffer::resize(int w, int h) {
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    width = w;
    height = h;
    color.resize((size_t)w * h);
    depth.resize((size_t)w * h);
}

void SoftBuffer::clear(const Vec4& rgba, float depthValue) {
    uint32_t c = packRGBA(rgba.x, rgba.y, rgba.z, rgba.w);
    std::fill(color.begin(), color.end(), c);
    std::fill(depth.begin(), depth.end(), depthValue);
}

void SoftBuffer::clearGradient(const Vec3& top, const Vec3& horizon, float depthValue) {
    for (int y = 0; y < height; ++y) {
        float t = height > 1 ? (float)y / (float)(height - 1) : 0.0f;
        // sky gradient with a haze band near the horizon
        float k = t * 1.4f;
        Vec3 c = lerp(top, horizon, clampf(k, 0.0f, 1.0f));
        uint32_t packed = packRGBA(c.x, c.y, c.z, 1.0f);
        std::fill(color.begin() + (size_t)y * width, color.begin() + (size_t)(y + 1) * width,
                  packed);
    }
    std::fill(depth.begin(), depth.end(), depthValue);
}

void SoftBuffer::copyFrom(const SoftBuffer& src) {
    if (src.width != width || src.height != height) resize(src.width, src.height);
    color = src.color;
    depth = src.depth;
}

void SoftBuffer::blitScaled(const SoftBuffer& src, int dstW, int dstH, bool bilinear) {
    if (!src.valid() || dstW < 1 || dstH < 1) return;
    if (width != dstW || height != dstH) resize(dstW, dstH);
    for (int y = 0; y < dstH; ++y) {
        float sy = (float)y / dstH * src.height;
        for (int x = 0; x < dstW; ++x) {
            float sx = (float)x / dstW * src.width;
            uint32_t c;
            if (bilinear) {
                int x0 = (int)sx, y0 = (int)sy;
                int x1 = std::min(x0 + 1, src.width - 1), y1 = std::min(y0 + 1, src.height - 1);
                float fx = sx - x0, fy = sy - y0;
                auto get = [&](int xx, int yy) { return src.color[(size_t)yy * src.width + xx]; };
                uint32_t c00 = get(x0, y0), c10 = get(x1, y0), c01 = get(x0, y1), c11 = get(x1, y1);
                auto mix = [&](int shift) {
                    float a = (float)((c00 >> shift) & 0xFF), b = (float)((c10 >> shift) & 0xFF);
                    float cc = (float)((c01 >> shift) & 0xFF), d = (float)((c11 >> shift) & 0xFF);
                    float top = a + (b - a) * fx, bot = cc + (d - cc) * fx;
                    return (uint32_t)clampf(top + (bot - top) * fy, 0.0f, 255.0f);
                };
                c = mix(0) | (mix(8) << 8) | (mix(16) << 16) | (0xFFu << 24);
            } else {
                c = src.color[std::min((size_t)src.height - 1,
                                       (size_t)sy) * src.width + std::min((size_t)src.width - 1, (size_t)sx)];
                c |= 0xFFu << 24;
            }
            color[(size_t)y * width + x] = c;
        }
    }
}

void SoftBuffer::vignette(float strength) {
    if (!valid() || strength <= 0.0f) return;
    float cx = width * 0.5f, cy = height * 0.5f;
    float maxR = std::sqrt(cx * cx + cy * cy);
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            float dx = (x - cx) / maxR, dy = (y - cy) / maxR;
            float r = std::sqrt(dx * dx + dy * dy);
            float f = 1.0f - strength * clampf(r * r * 1.2f, 0.0f, 1.0f);
            uint32_t c = color[(size_t)y * width + x];
            float cr = (float)(c & 0xFF) * f, cg = (float)((c >> 8) & 0xFF) * f,
                  cb = (float)((c >> 16) & 0xFF) * f;
            color[(size_t)y * width + x] = packRGBA(cr / 255.0f, cg / 255.0f, cb / 255.0f, 1.0f);
        }
    }
}

void drawLine2D(SoftTarget& t, float x0, float y0, float x1, float y1, const Vec4& color,
                bool depthTest) {
    float dx = x1 - x0, dy = y1 - y0;
    float len = std::max(std::fabs(dx), std::fabs(dy));
    if (len < 0.5f) {
        if (x0 >= 0 && y0 >= 0 && x0 < t.width && y0 < t.height)
            blendPixel(t, (int)x0, (int)y0, color);
        return;
    }
    int steps = (int)len + 1;
    dx /= steps;
    dy /= steps;
    float x = x0, y = y0;
    for (int i = 0; i <= steps; ++i) {
        int ix = (int)(x + 0.5f), iy = (int)(y + 0.5f);
        if (ix >= 0 && iy >= 0 && ix < t.width && iy < t.height) {
            bool ok = true;
            if (depthTest) {
                float d = t.depth[(size_t)iy * t.width + ix];
                ok = d > 1e-6f;
            }
            if (ok) blendPixel(t, ix, iy, color);
        }
        x += dx;
        y += dy;
    }
}

void drawLine3D(SoftTarget& t, const Mat4& vp, const Vec3& a, const Vec3& b, const Vec4& color,
                bool depthTest, int viewportW, int viewportH) {
    Vec4 ca = vp * Vec4(a, 1.0f);
    Vec4 cb = vp * Vec4(b, 1.0f);
    const float eps = 1e-5f;
    if (ca.w <= eps && cb.w <= eps) return;
    auto toScreen = [&](const Vec4& c) {
        float invW = 1.0f / c.w;
        float x = (c.x * invW * 0.5f + 0.5f) * viewportW;
        float y = (0.5f - c.y * invW * 0.5f) * viewportH;
        float z = c.z * invW;
        return Vec3(x, y, z);
    };
    Vec4 a2 = ca, b2 = cb;
    if (a2.w <= eps) {
        float t2 = (eps - ca.w) / (cb.w - ca.w);
        a2 = ca + (cb - ca) * t2;
    }
    if (b2.w <= eps) {
        float t2 = (eps - cb.w) / (ca.w - cb.w);
        b2 = cb + (ca - cb) * t2;
    }
    Vec3 sa = toScreen(a2), sb = toScreen(b2);
    // simple clipping to the viewport rectangle
    float x0 = sa.x, y0 = sa.y, x1 = sb.x, y1 = sb.y;
    if ((x0 < 0 && x1 < 0) || (y0 < 0 && y1 < 0) || (x0 >= t.width && x1 >= t.width) ||
        (y0 >= t.height && y1 >= t.height))
        return;
    drawLine2D(t, x0, y0, x1, y1, color, depthTest);
}

void fillRect2D(SoftTarget& t, float x, float y, float w, float h, const Vec4& color) {
    int x0 = std::max(0, (int)x), y0 = std::max(0, (int)y);
    int x1 = std::min(t.width, (int)(x + w)), y1 = std::min(t.height, (int)(y + h));
    for (int py = y0; py < y1; ++py)
        for (int px = x0; px < x1; ++px) blendPixel(t, px, py, color);
}

// -------------------------------------------------------------- tiny font
// 5x7 bitmap font (ASCII 32..126). Kept in the engine so the exported game can
// draw HUD text without any font file or extra dependency.
static const uint8_t kFont5x7[95][5] = {
    {0x00,0x00,0x00,0x00,0x00}, {0x00,0x00,0x5F,0x00,0x00}, {0x00,0x07,0x00,0x07,0x00},
    {0x14,0x7F,0x14,0x7F,0x14}, {0x24,0x2A,0x7F,0x2A,0x12}, {0x23,0x13,0x08,0x64,0x62},
    {0x36,0x49,0x55,0x22,0x50}, {0x00,0x05,0x03,0x00,0x00}, {0x00,0x1C,0x22,0x41,0x00},
    {0x00,0x41,0x22,0x1C,0x00}, {0x14,0x08,0x3E,0x08,0x14}, {0x08,0x08,0x3E,0x08,0x08},
    {0x00,0x50,0x30,0x00,0x00}, {0x08,0x08,0x08,0x08,0x08}, {0x00,0x60,0x60,0x00,0x00},
    {0x20,0x10,0x08,0x04,0x02}, {0x3E,0x51,0x49,0x45,0x3E}, {0x00,0x42,0x7F,0x40,0x00},
    {0x42,0x61,0x51,0x49,0x46}, {0x21,0x41,0x45,0x4B,0x31}, {0x18,0x14,0x12,0x7F,0x10},
    {0x27,0x45,0x45,0x45,0x39}, {0x3C,0x4A,0x49,0x49,0x30}, {0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36}, {0x06,0x49,0x49,0x29,0x1E}, {0x00,0x36,0x36,0x00,0x00},
    {0x00,0x56,0x36,0x00,0x00}, {0x08,0x14,0x22,0x41,0x00}, {0x14,0x14,0x14,0x14,0x14},
    {0x00,0x41,0x22,0x14,0x08}, {0x02,0x01,0x51,0x09,0x06}, {0x32,0x49,0x79,0x41,0x3E},
    {0x7E,0x11,0x11,0x11,0x7E}, {0x7F,0x49,0x49,0x49,0x36}, {0x3E,0x41,0x41,0x41,0x22},
    {0x7F,0x41,0x41,0x22,0x1C}, {0x7F,0x49,0x49,0x49,0x41}, {0x7F,0x09,0x09,0x09,0x01},
    {0x3E,0x41,0x49,0x49,0x7A}, {0x7F,0x08,0x08,0x08,0x7F}, {0x00,0x41,0x7F,0x41,0x00},
    {0x20,0x40,0x41,0x3F,0x01}, {0x7F,0x08,0x14,0x22,0x41}, {0x7F,0x40,0x40,0x40,0x40},
    {0x7F,0x02,0x0C,0x02,0x7F}, {0x7F,0x04,0x08,0x10,0x7F}, {0x3E,0x41,0x41,0x41,0x3E},
    {0x7F,0x09,0x09,0x09,0x06}, {0x3E,0x41,0x51,0x21,0x5E}, {0x7F,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31}, {0x01,0x01,0x7F,0x01,0x01}, {0x3F,0x40,0x40,0x40,0x3F},
    {0x1F,0x20,0x40,0x20,0x1F}, {0x7F,0x20,0x18,0x20,0x7F}, {0x63,0x14,0x08,0x14,0x63},
    {0x03,0x04,0x78,0x04,0x03}, {0x61,0x51,0x49,0x45,0x43}, {0x00,0x7F,0x41,0x41,0x00},
    {0x02,0x04,0x08,0x10,0x20}, {0x00,0x41,0x41,0x7F,0x00}, {0x04,0x02,0x01,0x02,0x04},
    {0x40,0x40,0x40,0x40,0x40}, {0x00,0x01,0x02,0x04,0x00}, {0x20,0x54,0x54,0x54,0x78},
    {0x7F,0x48,0x44,0x44,0x38}, {0x38,0x44,0x44,0x44,0x20}, {0x38,0x44,0x44,0x48,0x7F},
    {0x38,0x54,0x54,0x54,0x18}, {0x08,0x7E,0x09,0x01,0x02}, {0x0C,0x52,0x52,0x52,0x3E},
    {0x7F,0x08,0x04,0x04,0x78}, {0x00,0x44,0x7D,0x40,0x00}, {0x20,0x40,0x44,0x3D,0x00},
    {0x7F,0x10,0x28,0x44,0x00}, {0x00,0x41,0x7F,0x40,0x00}, {0x7C,0x04,0x18,0x04,0x78},
    {0x7C,0x08,0x04,0x04,0x78}, {0x38,0x44,0x44,0x44,0x38}, {0x7C,0x14,0x14,0x14,0x08},
    {0x08,0x14,0x14,0x18,0x7C}, {0x7C,0x08,0x04,0x04,0x08}, {0x48,0x54,0x54,0x54,0x20},
    {0x04,0x3F,0x44,0x40,0x20}, {0x3C,0x40,0x40,0x20,0x7C}, {0x1C,0x20,0x40,0x20,0x1C},
    {0x3C,0x40,0x30,0x40,0x3C}, {0x44,0x28,0x10,0x28,0x44}, {0x0C,0x50,0x50,0x50,0x3C},
    {0x44,0x64,0x54,0x4C,0x44}, {0x00,0x08,0x36,0x41,0x00}, {0x00,0x00,0x7F,0x00,0x00},
    {0x00,0x41,0x36,0x08,0x00}, {0x08,0x04,0x08,0x10,0x08},
};

void drawText2D(SoftTarget& t, float x, float y, const char* text, const Vec4& color, int scale) {
    if (!text || scale < 1) return;
    float cursorX = x;
    for (const char* c = text; *c; ++c) {
        unsigned char ch = (unsigned char)*c;
        if (ch == '\n') {
            cursorX = x;
            y += 8.0f * scale;
            continue;
        }
        if (ch < 32 || ch > 126) ch = '?';
        const uint8_t* glyph = kFont5x7[ch - 32];
        for (int col = 0; col < 5; ++col) {
            uint8_t bits = glyph[col];
            for (int row = 0; row < 7; ++row) {
                if (bits & (1 << row)) {
                    fillRect2D(t, cursorX + col * scale, y + row * scale, (float)scale,
                               (float)scale, color);
                }
            }
        }
        cursorX += 6.0f * scale;
    }
}

}  // namespace nf
