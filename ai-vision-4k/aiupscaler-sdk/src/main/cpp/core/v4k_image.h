// CPU image utilities.
//
// Two users:
//   1. the analytical (non-neural) reconstruction path and its host-side tests,
//   2. the benchmark's image-quality metrics (PSNR/SSIM against a ground-truth
//      frame rendered at the *output* resolution).
//
// These routines are deliberately simple and slow: they are the reference, not
// the hot path. The real-time path is the Vulkan compute pipeline.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace v4k {

// Planar float image, 1 or 4 channels, values in [0,1] for colour data.
struct Image {
    int width = 0;
    int height = 0;
    int channels = 1;
    std::vector<float> data;

    Image() = default;
    Image(int w, int h, int c, float fill = 0.0f) { resize(w, h, c, fill); }

    void resize(int w, int h, int c, float fill = 0.0f) {
        width = w;
        height = h;
        channels = c;
        data.assign(static_cast<size_t>(w) * h * c, fill);
    }
    bool empty() const { return data.empty(); }
    size_t pixelCount() const { return static_cast<size_t>(width) * height; }
    float* pixel(int x, int y) { return data.data() + (static_cast<size_t>(y) * width + x) * channels; }
    const float* pixel(int x, int y) const {
        return data.data() + (static_cast<size_t>(y) * width + x) * channels;
    }
    float sampleClamped(int x, int y, int c) const {
        const int cx = x < 0 ? 0 : (x >= width ? width - 1 : x);
        const int cy = y < 0 ? 0 : (y >= height ? height - 1 : y);
        return pixel(cx, cy)[c];
    }
};

// RGBA8 <-> interleaved float helpers (used by the JNI boundaries and tests).
//
// NB: `Image` is *interleaved* (HWC): pixel(x, y)[c]. The inference interpreter
// (ai/v4k_cpu_infer.h) and the GPU dispatch buffers are *planar* (CHW). Feeding
// an Image's buffer straight into `CpuInference::run()` therefore does not fail,
// it silently scrambles the channels -- it produced a plausible-looking but
// wrong image when the model exporter was first written. Use the conversions
// below at every boundary; assigning planar data to Image::data is a bug.
Image rgba8ToImage(const uint8_t* rgba, int width, int height);

// Interleaved (HWC) -> planar (CHW).
std::vector<float> imageToPlanar(const Image& image);

// Planar (CHW) -> interleaved (HWC). `planar` must hold
// width * height * channels floats in channel-plane order.
Image imageFromPlanar(const float* planar, int width, int height, int channels);
void imageToRgba8(const Image& img, uint8_t* out);   // expects channels == 4

// Grayscale conversion using Rec.709 luma.
Image toLuma(const Image& rgba);

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------
Image resizeBilinear(const Image& src, int dstWidth, int dstHeight);
// Catmull-Rom (a = -0.5) bicubic resample, separable two-pass.
Image resizeBicubic(const Image& src, int dstWidth, int dstHeight);

// Contrast-adaptive unsharp mask. `amount` in [0,1] maps to [0,1.5] strength.
Image unsharpMask(const Image& src, float amount, float radius);
// Edge-directed reconstruction baseline: bicubic + gradient-aware blending of
// the nearest coarse sample to suppress stair-stepping on hard edges.
Image edgeDirectedUpscale(const Image& src, int dstWidth, int dstHeight, float sharpening);

// ---------------------------------------------------------------------------
// Quality metrics
// ---------------------------------------------------------------------------
// Peak signal-to-noise ratio in dB over all channels. Returns +inf for
// identical images and a negative value when the inputs cannot be compared.
double psnr(const Image& a, const Image& b, double peak = 1.0);

// Mean structural similarity (Wang et al. 2004) over 8x8 blocks of the luma
// plane. Result in [-1,1], 1.0 == identical.
double ssim(const Image& a, const Image& b);

// Convenience: both metrics plus a 0..100 "quality score" derived from SSIM,
// used only for display. Returns false if the images are incompatible.
struct QualityReport {
    double psnrDb = -1.0;
    double ssimValue = -1.0;
    double score = -1.0;      // 0..100, display only (ssim -> score mapping)
    std::string verdict;      // "Native reference", "Visually equivalent", ...
};
bool compareImages(const Image& reference, const Image& test, QualityReport& out);

}  // namespace v4k
