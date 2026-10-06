#include "v4k_demo_metrics.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace v4k {
namespace demo {
namespace {

std::string numberOrNull(double value, int decimals = 2) {
    if (value == kUnavailable) return "null";
    char buffer[64];
    std::snprintf(buffer, sizeof(buffer), "%.*f", decimals, value);
    return buffer;
}

std::string quote(const std::string& text) {
    std::string out = "\"";
    for (char c : text) {
        if (c == '"' || c == '\\') out += '\\';
        out += c;
    }
    out += "\"";
    return out;
}

}  // namespace

// ---------------------------------------------------------------------------
// Configuration -> session
// ---------------------------------------------------------------------------

SessionPlan planSession(const DemoConfig& config, uint32_t engineWorkingBytes) {
    (void)engineWorkingBytes;
    const Resolution* rungs = demoResolutions();
    SessionPlan plan;
    plan.inputWidth = rungs[config.renderIndex].width;
    plan.inputHeight = rungs[config.renderIndex].height;
    plan.outputWidth = rungs[config.outputIndex].width;
    plan.outputHeight = rungs[config.outputIndex].height;

    // Native mode draws the scene at the output resolution itself: nothing is
    // reconstructed and no session is started. `upscales` therefore cannot be
    // inferred from the ladder indices here -- in Native mode they are allowed to
    // differ (that is how the benchmark compares a full-resolution render with an
    // upscaled one) and the flag still has to be false.
    if (config.mode == DemoMode::Native) {
        plan.upscales = false;
        plan.neural = false;
        plan.temporal = false;
        plan.antiAliasing = false;
        plan.denoise = false;
        return plan;
    }

    // Equal resolutions are not upscaling either.
    plan.upscales = plan.outputWidth > plan.inputWidth || plan.outputHeight > plan.inputHeight;
    if (!plan.upscales) {
        plan.neural = false;
        plan.temporal = false;
        plan.antiAliasing = false;
        plan.denoise = false;
        return plan;
    }

    // How far the output is from the input decides how much machinery is worth
    // running: a 720p -> 900p step does not need temporal reconstruction, a
    // 720p -> 4K step does.
    const double scale = static_cast<double>(plan.outputWidth) / static_cast<double>(plan.inputWidth);
    plan.neural = true;
    plan.temporal = config.allowTemporal && scale >= 1.4;
    plan.antiAliasing = scale >= 1.4;
    plan.denoise = scale >= 2.5 && config.quality != DemoQuality::Low;

    switch (config.quality) {
        case DemoQuality::Low:
            plan.sharpening = 0.18f;
            plan.noiseReduction = 0.10f;
            break;
        case DemoQuality::High:
            plan.sharpening = 0.34f;
            plan.noiseReduction = 0.22f;
            break;
        case DemoQuality::Medium:
        default:
            plan.sharpening = 0.25f;
            plan.noiseReduction = 0.15f;
            break;
    }
    return plan;
}

// ---------------------------------------------------------------------------
// FrameStats
// ---------------------------------------------------------------------------

double FrameStats::onePercentLowFrameMs() const {
    if (filled_ == 0) return kUnavailable;
    std::vector<double> sorted(times_.begin(), times_.begin() + filled_);
    std::sort(sorted.begin(), sorted.end());
    // The slowest 1 %: for a 240-frame window that is the worst ~2.4 frames, so
    // take the 99th percentile by index and never round down to "zero frames".
    const size_t index = static_cast<size_t>(std::ceil(static_cast<double>(sorted.size()) * 0.99)) - 1;
    return sorted[std::min(index, sorted.size() - 1)];
}

std::string FrameStats::toJson() const {
    std::string out = "{";
    out += "\"frames\":" + std::to_string(count_);
    out += ",\"windowFrames\":" + std::to_string(filled_);
    out += ",\"meanFrameMs\":" + numberOrNull(meanMs(), 3);
    out += ",\"fps\":" + numberOrNull(fps(), 2);
    out += ",\"worstFrameMs\":" + numberOrNull(maximumMs(), 3);
    out += ",\"onePercentLowMs\":" + numberOrNull(onePercentLowFrameMs(), 3);
    out += "}";
    return out;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

std::string ModeReport::toJson() const {
    std::string out = "{";
    out += "\"mode\":" + quote(mode);
    out += ",\"renderWidth\":" + std::to_string(renderWidth);
    out += ",\"renderHeight\":" + std::to_string(renderHeight);
    out += ",\"outputWidth\":" + std::to_string(outputWidth);
    out += ",\"outputHeight\":" + std::to_string(outputHeight);
    out += ",\"frames\":" + std::to_string(frames);
    out += ",\"meanFrameMs\":" + numberOrNull(meanFrameMs, 3);
    out += ",\"fps\":" + numberOrNull(fps, 2);
    out += ",\"worstFrameMs\":" + numberOrNull(worstFrameMs, 3);
    out += ",\"onePercentLowMs\":" + numberOrNull(onePercentLowMs, 3);
    out += ",\"aiStageMs\":" + numberOrNull(aiStageMs, 3);
    out += ",\"neural\":" + std::string(neural ? "true" : "false");
    out += ",\"measured\":" + std::string(measured() ? "true" : "false");
    out += "}";
    return out;
}

void AbComparison::reset() {
    native_ = ModeReport{};
    ai_ = ModeReport{};
    activeStats_.reset();
    active_ = false;
    lastAiStageMs_ = kUnavailable;
}

void AbComparison::beginMode(DemoMode mode, const SessionPlan& plan) {
    active_ = true;
    activeMode_ = mode;
    activePlan_ = plan;
    activeStats_.reset();
    lastAiStageMs_ = kUnavailable;

    ModeReport& report = (mode == DemoMode::Native) ? native_ : ai_;
    report = ModeReport{};
    report.mode = demoModeName(mode);
    report.renderWidth = plan.inputWidth;
    report.renderHeight = plan.inputHeight;
    report.outputWidth = plan.outputWidth;
    report.outputHeight = plan.outputHeight;
}

void AbComparison::recordFrame(double frameTimeMs, double aiStageMs) {
    if (!active_) return;
    activeStats_.record(frameTimeMs);
    if (aiStageMs != kUnavailable) lastAiStageMs_ = aiStageMs;
}

void AbComparison::finish(ModeReport& report, const FrameStats& stats) const {
    report.frames = stats.count();
    report.meanFrameMs = stats.meanMs();
    report.fps = stats.fps();
    report.worstFrameMs = stats.maximumMs();
    report.onePercentLowMs = stats.onePercentLowFrameMs();
    report.aiStageMs = lastAiStageMs_;
}

void AbComparison::endMode() {
    if (!active_) return;
    ModeReport& report = (activeMode_ == DemoMode::Native) ? native_ : ai_;
    report.neural = activePlan_.neural;
    finish(report, activeStats_);
    active_ = false;
}

std::string AbComparison::toJson() const {
    std::string out = "{";
    out += "\"minFrames\":" + std::to_string(kBenchmarkMinFrames);
    out += ",\"native\":";
    out += native_.frames > 0 ? native_.toJson() : "null";
    out += ",\"ai\":";
    out += ai_.frames > 0 ? ai_.toJson() : "null";
    out += ",\"comparison\":";
    out += comparisonJson();
    out += "}";
    return out;
}

std::string AbComparison::comparisonJson() const {
    const bool nativeReady = native_.frames >= kBenchmarkMinFrames && native_.meanFrameMs != kUnavailable;
    const bool aiReady = ai_.frames >= kBenchmarkMinFrames && ai_.meanFrameMs != kUnavailable;
    if (!nativeReady || !aiReady) {
        // Say exactly what is missing instead of publishing a partial result.
        std::string missing;
        if (!nativeReady) missing += "native";
        if (!aiReady) {
            if (!missing.empty()) missing += " and ";
            missing += "AI upscaling";
        }
        return "{\"ready\":false,\"missing\":" + quote(missing) + "}";
    }

    const double nativeMs = native_.meanFrameMs;
    const double aiMs = ai_.meanFrameMs;
    // Positive means the AI path is *slower* per frame, which is the honest
    // framing: the upscaler trades frame time for image quality, and a demo that
    // hid that would be selling something.
    const double deltaMs = aiMs - nativeMs;
    const double deltaPercent = nativeMs > 0.0 ? (deltaMs / nativeMs) * 100.0 : kUnavailable;

    std::string out = "{";
    out += "\"ready\":true";
    out += ",\"nativeFps\":" + numberOrNull(native_.fps, 2);
    out += ",\"aiFps\":" + numberOrNull(ai_.fps, 2);
    out += ",\"nativeMeanFrameMs\":" + numberOrNull(nativeMs, 3);
    out += ",\"aiMeanFrameMs\":" + numberOrNull(aiMs, 3);
    out += ",\"frameTimeDeltaMs\":" + numberOrNull(deltaMs, 3);
    out += ",\"frameTimeDeltaPercent\":" + numberOrNull(deltaPercent, 2);
    out += ",\"aiStageMs\":" + numberOrNull(ai_.aiStageMs, 3);
    out += ",\"nativeRenderWidth\":" + std::to_string(native_.renderWidth);
    out += ",\"aiRenderWidth\":" + std::to_string(ai_.renderWidth);
    out += ",\"note\":";
    out += quote("both sides measured on this device; the AI column includes the upscaling stage, "
                 "the native column renders at the output resolution");
    out += "}";
    return out;
}

// ---------------------------------------------------------------------------
// Scene statistics
// ---------------------------------------------------------------------------

std::string SceneStats::toJson() const {
    std::string out = "{";
    out += "\"terrainTriangles\":" + std::to_string(terrainTriangles);
    out += ",\"buildingInstances\":" + std::to_string(buildingInstances);
    out += ",\"propInstances\":" + std::to_string(propInstances);
    out += ",\"movingInstances\":" + std::to_string(movingInstances);
    out += ",\"particleCount\":" + std::to_string(particleCount);
    out += ",\"totalTriangles\":" + std::to_string(totalTriangles);
    out += "}";
    return out;
}

SceneStats sceneStats(const SceneBuild& scene) {
    SceneStats stats;
    stats.terrainTriangles = scene.terrain.triangleCount();
    stats.buildingInstances = scene.buildingInstances.count();
    stats.propInstances = scene.propInstances.count();
    stats.movingInstances = scene.movingObjectCount;
    stats.particleCount = scene.particleCount;

    // Instance-weighted triangle count: what the vertex stage actually sees.
    const uint64_t terrain = static_cast<uint64_t>(scene.terrain.triangleCount()) *
                            std::max<uint64_t>(1, scene.terrainInstances.count());
    const uint64_t buildings = static_cast<uint64_t>(scene.box.triangleCount()) * stats.buildingInstances;
    const uint64_t props = static_cast<uint64_t>(scene.sphere.triangleCount()) * stats.propInstances;
    const uint64_t moving = static_cast<uint64_t>(scene.sphere.triangleCount()) * stats.movingInstances;
    const uint64_t particles = static_cast<uint64_t>(2) * stats.particleCount;   // a quad each
    const uint64_t total = terrain + buildings + props + moving + particles;
    stats.totalTriangles = static_cast<uint32_t>(std::min<uint64_t>(total, 0xFFFFFFFFull));
    return stats;
}

}  // namespace demo
}  // namespace v4k
