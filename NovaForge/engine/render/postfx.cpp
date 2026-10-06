#include "render/postfx.h"

#include <algorithm>
#include <cmath>

namespace nf {

GradeSettings GradeSettings::cinematic() {
    GradeSettings s;
    s.enabled = true;
    s.presetName = "Cinematic";
    s.contrast = 1.10f;
    s.saturation = 1.05f;
    s.warmth = 0.05f;
    s.bloom = 0.22f;
    s.vignette = 0.28f;
    s.grain = 0.02f;
    return s;
}

GradeSettings GradeSettings::bright() {
    GradeSettings s;
    s.enabled = true;
    s.presetName = "Bright";
    s.contrast = 1.02f;
    s.saturation = 1.15f;
    s.warmth = 0.02f;
    s.bloom = 0.10f;
    s.vignette = 0.10f;
    s.exposure = 1.1f;
    return s;
}

GradeSettings GradeSettings::noir() {
    GradeSettings s;
    s.enabled = true;
    s.presetName = "Noir";
    s.saturation = 0.0f;
    s.contrast = 1.25f;
    s.warmth = -0.05f;
    s.bloom = 0.15f;
    s.vignette = 0.4f;
    s.grain = 0.05f;
    return s;
}

GradeSettings GradeSettings::warmIsland() {
    GradeSettings s;
    s.enabled = true;
    s.presetName = "Warm Island";
    s.contrast = 1.06f;
    s.saturation = 1.12f;
    s.warmth = 0.10f;
    s.bloom = 0.25f;
    s.bloomThreshold = 0.68f;
    s.vignette = 0.20f;
    s.exposure = 1.05f;
    return s;
}

GradeSettings GradeSettings::fromName(const std::string& name) {
    if (name == "Cinematic") return cinematic();
    if (name == "Bright") return bright();
    if (name == "Noir") return noir();
    if (name == "Warm Island") return warmIsland();
    return neutral();
}

std::vector<std::string> GradeSettings::presetNames() {
    return {"None", "Cinematic", "Bright", "Warm Island", "Noir"};
}

void applyGrade(std::vector<uint8_t>& rgba, int width, int height, const GradeSettings& s) {
    if (!s.enabled || width <= 0 || height <= 0) return;
    const size_t pixels = (size_t)width * height;
    if (rgba.size() < pixels * 4) return;

    // --- bloom (cheap separable box blur over the bright pass) ------------
    std::vector<float> bright(pixels * 3, 0.0f);
    for (size_t i = 0; i < pixels; ++i) {
        float r = rgba[i * 4 + 0] / 255.0f, g = rgba[i * 4 + 1] / 255.0f, b = rgba[i * 4 + 2] / 255.0f;
        float l = std::max({r, g, b});
        float k = l > s.bloomThreshold ? (l - s.bloomThreshold) / std::max(1e-3f, 1.0f - s.bloomThreshold) : 0.0f;
        bright[i * 3 + 0] = r * k;
        bright[i * 3 + 1] = g * k;
        bright[i * 3 + 2] = b * k;
    }
    if (s.bloom > 0.001f) {
        std::vector<float> tmp(bright.size());
        const int radius = std::max(1, std::min(width, height) / 64);
        auto blurLine = [&](int y, bool horizontal) {
            for (int x = 0; x < width; ++x) {
                float sum[3] = {0, 0, 0};
                int count = 0;
                for (int k = -radius; k <= radius; ++k) {
                    int sx = horizontal ? std::clamp(x + k, 0, width - 1) : x;
                    int sy = horizontal ? y : std::clamp(y + k, 0, height - 1);
                    size_t idx = ((size_t)sy * width + sx) * 3;
                    sum[0] += bright[idx];
                    sum[1] += bright[idx + 1];
                    sum[2] += bright[idx + 2];
                    count++;
                }
                size_t out = ((size_t)y * width + x) * 3;
                tmp[out] = sum[0] / count;
                tmp[out + 1] = sum[1] / count;
                tmp[out + 2] = sum[2] / count;
            }
        };
        for (int y = 0; y < height; ++y) blurLine(y, true);
        bright.swap(tmp);
        for (int y = 0; y < height; ++y) blurLine(y, false);
        bright.swap(tmp);
    }

    // --- grade ------------------------------------------------------------
    float cx = width * 0.5f, cy = height * 0.5f;
    float maxR = std::sqrt(cx * cx + cy * cy);
    uint32_t grainState = 0x9E3779B9u;
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            size_t i = (size_t)y * width + x;
            float r = rgba[i * 4 + 0] / 255.0f, g = rgba[i * 4 + 1] / 255.0f, b = rgba[i * 4 + 2] / 255.0f;
            // exposure
            r *= s.exposure;
            g *= s.exposure;
            b *= s.exposure;
            // bloom
            if (s.bloom > 0.001f) {
                r += bright[i * 3 + 0] * s.bloom;
                g += bright[i * 3 + 1] * s.bloom;
                b += bright[i * 3 + 2] * s.bloom;
            }
            // contrast around 0.5
            r = (r - 0.5f) * s.contrast + 0.5f;
            g = (g - 0.5f) * s.contrast + 0.5f;
            b = (b - 0.5f) * s.contrast + 0.5f;
            // saturation
            float luma = 0.2126f * r + 0.7152f * g + 0.0722f * b;
            r = luma + (r - luma) * s.saturation;
            g = luma + (g - luma) * s.saturation;
            b = luma + (b - luma) * s.saturation;
            // warm/cool balance
            r *= 1.0f + s.warmth;
            b *= 1.0f - s.warmth;
            // vignette
            if (s.vignette > 0.001f) {
                float dx = (x - cx) / maxR, dy = (y - cy) / maxR;
                float d = std::sqrt(dx * dx + dy * dy);
                float f = 1.0f - s.vignette * std::clamp(d * d * 1.1f, 0.0f, 1.0f);
                r *= f;
                g *= f;
                b *= f;
            }
            // film grain
            if (s.grain > 0.0001f) {
                grainState ^= grainState << 13;
                grainState ^= grainState >> 17;
                grainState ^= grainState << 5;
                float n = ((float)(grainState % 1000) / 1000.0f - 0.5f) * s.grain;
                r += n;
                g += n;
                b += n;
            }
            rgba[i * 4 + 0] = (uint8_t)std::clamp(r * 255.0f + 0.5f, 0.0f, 255.0f);
            rgba[i * 4 + 1] = (uint8_t)std::clamp(g * 255.0f + 0.5f, 0.0f, 255.0f);
            rgba[i * 4 + 2] = (uint8_t)std::clamp(b * 255.0f + 0.5f, 0.0f, 255.0f);
        }
    }
}

}  // namespace nf
