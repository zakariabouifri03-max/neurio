// Demo A/B logic that needs no GPU.
//
// Two things live here because they have right and wrong answers and belong in
// the test suite rather than in a file that needs a device to run:
//
//   * how a DemoConfig becomes an upscaling SessionDesc (which features are on,
//     what the engine is asked for);
//   * the measurement bookkeeping behind "Native vs AI upscaling" -- frame
//     times per mode, the averages the UI shows, and the rule that a comparison
//     is only printed when *both* sides were actually measured.
//
// Nothing here invents a number: every value in the report either came from a
// measured frame time or is left unavailable.
#pragma once

#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

#include "v4k_scene.h"

#include "../core/v4k_common.h"

namespace v4k {
namespace demo {

// ---------------------------------------------------------------------------
// Configuration -> engine session
// ---------------------------------------------------------------------------

// The number of frames a native/AI comparison averages before it reports; below
// this the report says "measuring" instead of publishing noise.
constexpr uint32_t kBenchmarkMinFrames = 60;

struct SessionPlan {
    uint32_t inputWidth = 0;
    uint32_t inputHeight = 0;
    uint32_t outputWidth = 0;
    uint32_t outputHeight = 0;
    bool neural = false;        // a model graph is requested
    bool temporal = false;      // temporal reconstruction
    bool antiAliasing = false;
    bool denoise = false;
    float sharpening = 0.0f;
    float noiseReduction = 0.0f;
    // True when the plan upscales at all (input < output). A plan with equal
    // resolutions is a native render and must not start a session.
    bool upscales = false;
};

/**
 * Turns the demo's configuration into the session the engine should run.
 *
 * The feature flags follow the measured geometry rather than a mood: temporal
 * reconstruction and anti-aliasing both pay off most when the input is far below
 * the output, and sharpening is applied last, so a plan that does not upscale
 * asks for none of it. `quality` scales the analytical strength the way the
 * profiles screen does.
 */
SessionPlan planSession(const DemoConfig& config, uint32_t engineWorkingBytes = 0);

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** Rolling frame-time statistics for one mode. */
class FrameStats {
public:
    explicit FrameStats(uint32_t capacity = 240) : times_(capacity) {}

    void reset() {
        count_ = 0;
        index_ = 0;
        filled_ = 0;
        sum_ = 0.0;
        min_ = kUnavailable;
        max_ = kUnavailable;
    }

    void record(double frameTimeMs) {
        // Rejects NaN, both infinities and non-positive times: a frame time that
        // is not a finite positive number is not a measurement, and letting one
        // through would poison every average that follows.
        if (!std::isfinite(frameTimeMs) || frameTimeMs <= 0.0) return;
        if (filled_ == times_.size()) sum_ -= times_[index_];
        times_[index_] = frameTimeMs;
        index_ = (index_ + 1) % times_.size();
        if (filled_ < times_.size()) ++filled_;
        ++count_;
        sum_ += frameTimeMs;
        min_ = (min_ == kUnavailable) ? frameTimeMs : (frameTimeMs < min_ ? frameTimeMs : min_);
        max_ = (max_ == kUnavailable) ? frameTimeMs : (frameTimeMs > max_ ? frameTimeMs : max_);
    }

    uint64_t count() const { return count_; }
    uint32_t windowFrames() const { return filled_; }

    /** Mean of the frames still in the window; unavailable when empty. */
    double meanMs() const { return filled_ == 0 ? kUnavailable : sum_ / static_cast<double>(filled_); }

    double minimumMs() const { return min_; }
    double maximumMs() const { return max_; }

    /** Frame rate derived from the window mean; unavailable when empty. */
    double fps() const {
        const double mean = meanMs();
        return (mean == kUnavailable || mean <= 0.0) ? kUnavailable : 1000.0 / mean;
    }

    /**
     * The slowest 1 % of the window, as a frame time. This is the number that
     * catches a hitch that an average hides, and it is computed from the window
     * entries actually measured.
     */
    double onePercentLowFrameMs() const;

    std::string toJson() const;

private:
    std::vector<double> times_;
    uint32_t count_ = 0;
    uint32_t index_ = 0;
    uint32_t filled_ = 0;
    double sum_ = 0.0;
    double min_ = kUnavailable;
    double max_ = kUnavailable;
};

/** One side of the comparison. */
struct ModeReport {
    std::string mode;                 // "Native" / "AI upscaling"
    uint32_t renderWidth = 0;
    uint32_t renderHeight = 0;
    uint32_t outputWidth = 0;
    uint32_t outputHeight = 0;
    uint64_t frames = 0;
    double meanFrameMs = kUnavailable;
    double fps = kUnavailable;
    double worstFrameMs = kUnavailable;
    double onePercentLowMs = kUnavailable;
    // GPU time for the AI stage of the newest frame, straight from the driver's
    // timestamp queries (kUnavailable when the device did not report it).
    double aiStageMs = kUnavailable;
    bool neural = false;

    bool measured() const { return frames >= kBenchmarkMinFrames && meanFrameMs != kUnavailable; }
    std::string toJson() const;
};

/**
 * Collects one report per mode that has actually been run.
 *
 * The rule this type exists to enforce: `comparisonJson()` returns a comparison
 * only when both sides have been measured for at least kBenchmarkMinFrames
 * frames. Before that it says which side is still missing. It never extrapolates
 * a frame time, and it never reports a speedup from a single frame.
 */
class AbComparison {
public:
    void reset();
    void beginMode(DemoMode mode, const SessionPlan& plan);
    void recordFrame(double frameTimeMs, double aiStageMs);
    void endMode();

    const ModeReport* nativeReport() const { return native_.frames > 0 ? &native_ : nullptr; }
    const ModeReport* aiReport() const { return ai_.frames > 0 ? &ai_ : nullptr; }

    // Which mode a run is currently recording, and whether one is recording at
    // all. Two separate facts: the mode survives a finished run.
    DemoMode activeMode() const { return activeMode_; }
    bool active() const { return active_; }

    std::string toJson() const;
    // Human-readable summary for the on-screen panel; empty when not ready.
    std::string comparisonJson() const;

private:
    void finish(ModeReport& report, const FrameStats& stats) const;

    ModeReport native_{};
    ModeReport ai_{};
    FrameStats activeStats_{240};
    DemoMode activeMode_ = DemoMode::Native;
    bool active_ = false;
    SessionPlan activePlan_{};
    double lastAiStageMs_ = kUnavailable;
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Scene statistics that do not depend on the renderer being alive. */
struct SceneStats {
    uint32_t terrainTriangles = 0;
    uint32_t buildingInstances = 0;
    uint32_t propInstances = 0;
    uint32_t movingInstances = 0;
    uint32_t particleCount = 0;
    uint32_t totalTriangles = 0;

    std::string toJson() const;
};

SceneStats sceneStats(const SceneBuild& scene);

}  // namespace demo
}  // namespace v4k
