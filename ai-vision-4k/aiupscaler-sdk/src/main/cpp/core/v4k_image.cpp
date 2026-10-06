#include "v4k_image.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

#include "v4k_log.h"
#include "v4k_metrics.h"

namespace v4k {
namespace {

inline float clamp01(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

// Catmull-Rom weights for fractional position t.
inline void cubicWeights(float t, float w[4]) {
    const float t2 = t * t;
    const float t3 = t2 * t;
    w[0] = -0.5f * t3 + t2 - 0.5f * t;
    w[1] = 1.5f * t3 - 2.5f * t2 + 1.0f;
    w[2] = -1.5f * t3 + 2.0f * t2 + 0.5f * t;
    w[3] = 0.5f * t3 - 0.5f * t2;
}

}  // namespace

std::vector<float> imageToPlanar(const Image& image) {
    std::vector<float> out(static_cast<size_t>(image.width) * image.height * image.channels, 0.0f);
    if (image.width <= 0 || image.height <= 0 || image.channels <= 0) return out;
    if (image.data.size() != out.size()) return out;   // refuses to guess at a mismatched buffer
    const size_t plane = static_cast<size_t>(image.width) * image.height;
    for (int c = 0; c < image.channels; ++c) {
        for (int y = 0; y < image.height; ++y) {
            for (int x = 0; x < image.width; ++x) {
                out[c * plane + static_cast<size_t>(y) * image.width + x] = image.pixel(x, y)[c];
            }
        }
    }
    return out;
}

Image imageFromPlanar(const float* planar, int width, int height, int channels) {
    Image image(width, height, channels);
    if (planar == nullptr || width <= 0 || height <= 0 || channels <= 0) return image;
    const size_t plane = static_cast<size_t>(width) * height;
    for (int c = 0; c < channels; ++c) {
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                image.pixel(x, y)[c] = planar[c * plane + static_cast<size_t>(y) * width + x];
            }
        }
    }
    return image;
}

Image rgba8ToImage(const uint8_t* rgba, int width, int height) {
    Image img(width, height, 4);
    const size_t n = static_cast<size_t>(width) * height * 4;
    for (size_t i = 0; i < n; ++i) img.data[i] = static_cast<float>(rgba[i]) / 255.0f;
    return img;
}

void imageToRgba8(const Image& img, uint8_t* out) {
    const size_t n = img.pixelCount();
    if (img.channels == 4) {
        for (size_t i = 0; i < n * 4; ++i) {
            out[i] = static_cast<uint8_t>(clamp01(img.data[i]) * 255.0f + 0.5f);
        }
    } else {
        for (size_t i = 0; i < n; ++i) {
            const uint8_t v = static_cast<uint8_t>(clamp01(img.data[i]) * 255.0f + 0.5f);
            out[i * 4 + 0] = v;
            out[i * 4 + 1] = v;
            out[i * 4 + 2] = v;
            out[i * 4 + 3] = 255;
        }
    }
}

Image toLuma(const Image& rgba) {
    if (rgba.channels != 4) return rgba;
    Image luma(rgba.width, rgba.height, 1);
    const size_t n = rgba.pixelCount();
    for (size_t i = 0; i < n; ++i) {
        const float* p = rgba.data.data() + i * 4;
        luma.data[i] = 0.2126f * p[0] + 0.7152f * p[1] + 0.0722f * p[2];
    }
    return luma;
}

Image resizeBilinear(const Image& src, int dstWidth, int dstHeight) {
    Image dst(dstWidth, dstHeight, src.channels);
    if (src.width <= 0 || src.height <= 0 || dstWidth <= 0 || dstHeight <= 0) return dst;

    const float sx = static_cast<float>(src.width) / static_cast<float>(dstWidth);
    const float sy = static_cast<float>(src.height) / static_cast<float>(dstHeight);

    for (int y = 0; y < dstHeight; ++y) {
        const float fy = (static_cast<float>(y) + 0.5f) * sy - 0.5f;
        const int y0 = static_cast<int>(std::floor(fy));
        const float wy = fy - static_cast<float>(y0);
        for (int x = 0; x < dstWidth; ++x) {
            const float fx = (static_cast<float>(x) + 0.5f) * sx - 0.5f;
            const int x0 = static_cast<int>(std::floor(fx));
            const float wx = fx - static_cast<float>(x0);
            float* out = dst.pixel(x, y);
            for (int c = 0; c < src.channels; ++c) {
                const float v00 = src.sampleClamped(x0, y0, c);
                const float v10 = src.sampleClamped(x0 + 1, y0, c);
                const float v01 = src.sampleClamped(x0, y0 + 1, c);
                const float v11 = src.sampleClamped(x0 + 1, y0 + 1, c);
                out[c] = (v00 * (1.0f - wx) + v10 * wx) * (1.0f - wy) +
                         (v01 * (1.0f - wx) + v11 * wx) * wy;
            }
        }
    }
    return dst;
}

Image resizeBicubic(const Image& src, int dstWidth, int dstHeight) {
    if (src.width <= 0 || src.height <= 0 || dstWidth <= 0 || dstHeight <= 0) {
        return Image(std::max(dstWidth, 0), std::max(dstHeight, 0), src.channels);
    }
    const int c = src.channels;

    // Pass 1: horizontal.
    Image tmp(dstWidth, src.height, c);
    const float sx = static_cast<float>(src.width) / static_cast<float>(dstWidth);
    for (int y = 0; y < src.height; ++y) {
        for (int x = 0; x < dstWidth; ++x) {
            const float fx = (static_cast<float>(x) + 0.5f) * sx - 0.5f;
            const int x0 = static_cast<int>(std::floor(fx));
            const float t = fx - static_cast<float>(x0);
            float w[4];
            cubicWeights(t, w);
            float* out = tmp.pixel(x, y);
            for (int ch = 0; ch < c; ++ch) {
                float acc = 0.0f;
                float wsum = 0.0f;
                for (int k = 0; k < 4; ++k) {
                    acc += src.sampleClamped(x0 - 1 + k, y, ch) * w[k];
                    wsum += w[k];
                }
                out[ch] = wsum != 0.0f ? acc / wsum : acc;
            }
        }
    }

    // Pass 2: vertical.
    Image dst(dstWidth, dstHeight, c);
    const float sy = static_cast<float>(src.height) / static_cast<float>(dstHeight);
    for (int y = 0; y < dstHeight; ++y) {
        const float fy = (static_cast<float>(y) + 0.5f) * sy - 0.5f;
        const int y0 = static_cast<int>(std::floor(fy));
        const float t = fy - static_cast<float>(y0);
        float w[4];
        cubicWeights(t, w);
        for (int x = 0; x < dstWidth; ++x) {
            float* out = dst.pixel(x, y);
            for (int ch = 0; ch < c; ++ch) {
                float acc = 0.0f;
                float wsum = 0.0f;
                for (int k = 0; k < 4; ++k) {
                    const int yy = y0 - 1 + k;
                    const int cy = yy < 0 ? 0 : (yy >= tmp.height ? tmp.height - 1 : yy);
                    acc += tmp.pixel(x, cy)[ch] * w[k];
                    wsum += w[k];
                }
                out[ch] = wsum != 0.0f ? acc / wsum : acc;
            }
        }
    }
    return dst;
}

Image unsharpMask(const Image& src, float amount, float radius) {
    if (amount <= 0.0f) return src;
    const float strength = std::min(1.5f, std::max(0.0f, amount) * 1.5f);
    const int r = std::max(1, static_cast<int>(std::lround(radius)));
    Image out = src;

    // Separable box blur (approximates a gaussian for the unsharp kernel).
    Image blurred(src.width, src.height, src.channels);
    for (int y = 0; y < src.height; ++y) {
        for (int x = 0; x < src.width; ++x) {
            float* dst = blurred.pixel(x, y);
            for (int c = 0; c < src.channels; ++c) {
                float acc = 0.0f;
                int n = 0;
                for (int dy = -r; dy <= r; ++dy) {
                    for (int dx = -r; dx <= r; ++dx) {
                        acc += src.sampleClamped(x + dx, y + dy, c);
                        ++n;
                    }
                }
                dst[c] = acc / static_cast<float>(n);
            }
        }
    }

    for (size_t i = 0; i < out.data.size(); ++i) {
        const float v = out.data[i];
        const float b = blurred.data[i];
        out.data[i] = clamp01(v + (v - b) * strength);
    }
    return out;
}

Image edgeDirectedUpscale(const Image& src, int dstWidth, int dstHeight, float sharpening) {
    // Bicubic base gives smooth gradients; the gradient-aware term adds back
    // the high frequencies that bilinear/bicubic lose on hard edges. This is a
    // classical (non-neural) filter chain and is always labelled as such.
    Image up = resizeBicubic(src, dstWidth, dstHeight);
    if (src.width < 2 || src.height < 2) return up;

    const int c = up.channels;
    const float sx = static_cast<float>(src.width) / static_cast<float>(dstWidth);
    const float sy = static_cast<float>(src.height) / static_cast<float>(dstHeight);

    for (int y = 0; y < dstHeight; ++y) {
        for (int x = 0; x < dstWidth; ++x) {
            const int srcX = std::min(src.width - 1, static_cast<int>((static_cast<float>(x) + 0.5f) * sx));
            const int srcY = std::min(src.height - 1, static_cast<int>((static_cast<float>(y) + 0.5f) * sy));

            // Local gradient magnitude on the luma of the source.
            float gradX = 0.0f;
            float gradY = 0.0f;
            for (int ch = 0; ch < c; ++ch) {
                const float l = src.sampleClamped(srcX - 1, srcY, ch);
                const float r = src.sampleClamped(srcX + 1, srcY, ch);
                const float t = src.sampleClamped(srcX, srcY - 1, ch);
                const float b = src.sampleClamped(srcX, srcY + 1, ch);
                gradX += r - l;
                gradY += b - t;
            }
            const float gradMag = std::sqrt(gradX * gradX + gradY * gradY) / static_cast<float>(c);
            const float blend = std::min(1.0f, gradMag * 4.0f);

            float* out = up.pixel(x, y);
            for (int ch = 0; ch < c; ++ch) {
                const float base = out[ch];
                const float nearest = src.pixel(srcX, srcY)[ch];
                out[ch] = clamp01(base + (nearest - base) * blend * 0.25f);
            }
        }
    }

    if (sharpening > 0.0f) {
        up = unsharpMask(up, sharpening, 1.0f);
    }
    return up;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------
double psnr(const Image& a, const Image& b, double peak) {
    if (a.width != b.width || a.height != b.height || a.channels != b.channels) return kUnavailable;
    if (a.data.empty()) return kUnavailable;
    double mse = 0.0;
    const size_t n = a.data.size();
    for (size_t i = 0; i < n; ++i) {
        const double d = static_cast<double>(a.data[i]) - static_cast<double>(b.data[i]);
        mse += d * d;
    }
    mse /= static_cast<double>(n);
    if (mse <= 0.0) return std::numeric_limits<double>::infinity();
    return 10.0 * std::log10((peak * peak) / mse);
}

double ssim(const Image& a, const Image& b) {
    if (a.width != b.width || a.height != b.height) return kUnavailable;
    const Image la = a.channels == 1 ? a : toLuma(a);
    const Image lb = b.channels == 1 ? b : toLuma(b);
    if (la.width < 8 || la.height < 8) return kUnavailable;

    constexpr double C1 = 6.5025e-2;   // (0.01 * 255)^2, scaled for [0,1] input
    constexpr double C2 = 5.8509e-1;   // (0.03 * 255)^2
    const int block = 8;
    double total = 0.0;
    int blocks = 0;

    for (int by = 0; by + block <= la.height; by += block) {
        for (int bx = 0; bx + block <= la.width; bx += block) {
            double sa = 0.0, sb = 0.0, saa = 0.0, sbb = 0.0, sab = 0.0;
            for (int y = 0; y < block; ++y) {
                for (int x = 0; x < block; ++x) {
                    const double va = la.pixel(bx + x, by + y)[0];
                    const double vb = lb.pixel(bx + x, by + y)[0];
                    sa += va;
                    sb += vb;
                    saa += va * va;
                    sbb += vb * vb;
                    sab += va * vb;
                }
            }
            constexpr double N = static_cast<double>(block * block);
            const double muA = sa / N;
            const double muB = sb / N;
            const double varA = saa / N - muA * muA;
            const double varB = sbb / N - muB * muB;
            const double cov = sab / N - muA * muB;
            const double num = (2.0 * muA * muB + C1) * (2.0 * cov + C2);
            const double den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
            total += den != 0.0 ? num / den : 1.0;
            ++blocks;
        }
    }
    if (blocks == 0) return kUnavailable;
    return total / static_cast<double>(blocks);
}

bool compareImages(const Image& reference, const Image& test, QualityReport& out) {
    if (reference.width != test.width || reference.height != test.height) return false;
    out.psnrDb = psnr(reference, test);
    out.ssimValue = ssim(reference, test);
    if (out.ssimValue < 0.0) {
        out.score = kUnavailable;
        out.verdict = "Unable to compare";
        return true;
    }
    // Display-only mapping: SSIM 0.90 -> ~75, 0.97 -> ~92, >=0.99 -> 100.
    const double clamped = std::min(1.0, std::max(0.0, out.ssimValue));
    out.score = std::min(100.0, std::max(0.0, (clamped - 0.85) / 0.15 * 100.0));
    if (clamped >= 0.995) {
        out.verdict = "Visually equivalent";
    } else if (clamped >= 0.97) {
        out.verdict = "Very high";
    } else if (clamped >= 0.93) {
        out.verdict = "High";
    } else if (clamped >= 0.85) {
        out.verdict = "Fair";
    } else {
        out.verdict = "Low - reconstruction is visibly softer or unstable";
    }
    return true;
}

}  // namespace v4k
