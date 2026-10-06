// Measurement primitives.
//
// Rule for the whole product: every number shown to the user comes from here,
// and every value that cannot be measured is reported as "unavailable" (-1)
// rather than being invented.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "v4k_common.h"

namespace v4k {

// Pipeline stages that get individually timed.
enum class Stage : int32_t {
    Preprocess = 0,
    MotionEstimation = 1,
    Inference = 2,
    TemporalReconstruction = 3,
    AntiAliasing = 4,
    Sharpening = 5,
    Composite = 6,
    Present = 7,
    Count = 8,
};

inline const char* toString(Stage s) {
    switch (s) {
        case Stage::Preprocess: return "preprocess";
        case Stage::MotionEstimation: return "motionEstimation";
        case Stage::Inference: return "inference";
        case Stage::TemporalReconstruction: return "temporalReconstruction";
        case Stage::AntiAliasing: return "antiAliasing";
        case Stage::Sharpening: return "sharpening";
        case Stage::Composite: return "composite";
        case Stage::Present: return "present";
        case Stage::Count: return "count";
    }
    return "unknown";
}

constexpr int kStageCount = static_cast<int>(Stage::Count);
// kUnavailable is declared in v4k_common.h (every backend reports the same
// sentinel for "the device did not tell us").

// ---------------------------------------------------------------------------
// Rolling frame-time window (FPS, frame time, percentiles, jitter).
// ---------------------------------------------------------------------------
class FrameTimeWindow {
public:
    explicit FrameTimeWindow(size_t capacity = 240);

    void add(double frameTimeMs, int64_t timestampMs = 0);
    void clear();

    size_t size() const { return count_; }
    bool empty() const { return count_ == 0; }

    double meanMs() const;
    double medianMs() const;
    double percentileMs(double p) const;   // p in [0,1]
    double minMs() const;
    double maxMs() const;
    double stdDevMs() const;

    double instantFps() const;             // from the newest sample
    double averageFps() const;             // 1000 / mean
    double onePercentLowFps() const;       // 1000 / p99 — the number gamers care about
    double jitterMs() const;               // mean absolute delta between frames

    int64_t lastTimestampMs() const { return lastTimestampMs_; }
    double lastFrameTimeMs() const { return count_ == 0 ? kUnavailable : ring_[(head_ + capacity_ - 1) % capacity_]; }

    // Copy of the window, oldest first (used by the UI graph).
    std::vector<double> samples() const;

private:
    std::vector<double> ring_;
    // Scratch buffer for percentile(): kept as a member to avoid allocating on
    // every overlay refresh. 'mutable' so the const query methods stay const.
    mutable std::vector<double> sortedScratch_;
    size_t capacity_ = 0;
    size_t count_ = 0;
    size_t head_ = 0;   // next write position
    int64_t lastTimestampMs_ = 0;
};

// ---------------------------------------------------------------------------
// Per-stage timing (microseconds). EMA keeps the overlay readable, `last` is
// the raw sample and `max` is the worst case over the session.
// ---------------------------------------------------------------------------
class StageTimers {
public:
    StageTimers();

    void record(Stage stage, double micros);
    void reset();

    double lastUs(Stage stage) const;
    double emaUs(Stage stage) const;
    double maxUs(Stage stage) const;
    bool hasData(Stage stage) const;

    // Sum of the last samples of all stages ("AI processing time" in the UI is
    // the inference + reconstruction part; see reconstructionUs()).
    double totalLastUs() const;
    // Everything the upscaler does for a frame, excluding the game itself.
    double upscalerLastUs() const;

    void setEmaAlpha(double alpha) { alpha_ = alpha; }

private:
    struct Entry {
        double last = 0.0;
        double ema = 0.0;
        double max = 0.0;
        bool seen = false;
    };
    Entry entries_[kStageCount];
    double alpha_ = 0.15;
};

// ---------------------------------------------------------------------------
// GPU busy estimate.
//
// Android exposes no direct "GPU utilisation %" to normal apps. What we *can*
// measure honestly is how much wall time the GPU spent inside our own compute
// and draw passes (Vulkan timestamp queries) relative to the frame period.
// The UI labels it "GPU busy (AI Vision passes)" precisely because it is not a
// whole-device GPU utilisation figure.
// ---------------------------------------------------------------------------
class GpuLoadEstimator {
public:
    void recordFrame(uint64_t busyNs, uint64_t periodNs);
    void reset();

    bool available() const { return samples_ > 0; }
    double utilization() const;      // 0..1, or kUnavailable
    double busyMs() const;           // last frame busy time in ms, or kUnavailable

private:
    double ema_ = 0.0;
    double lastBusyMs_ = kUnavailable;
    int samples_ = 0;
};

// ---------------------------------------------------------------------------
// CPU utilisation from /proc/stat deltas (real measurement, no permissions).
// Returns kUnavailable when the first sample has not been taken yet.
// ---------------------------------------------------------------------------
class CpuLoadSampler {
public:
    // Feed jiffies from /proc/stat (total and idle). Returns utilisation 0..1.
    double update(uint64_t totalJiffies, uint64_t idleJiffies);

private:
    uint64_t lastTotal_ = 0;
    uint64_t lastIdle_ = 0;
    double lastUtil_ = kUnavailable;
};

// Ram usage from /proc/meminfo (MemTotal/MemAvailable) — available on Android
// without any permission.
struct RamSample {
    uint64_t totalBytes = 0;
    uint64_t availableBytes = 0;
    double usedFraction() const {
        if (totalBytes == 0) return kUnavailable;
        return static_cast<double>(totalBytes - availableBytes) / static_cast<double>(totalBytes);
    }
};

// Parses the two relevant lines of /proc/meminfo. Returns false if not found.
bool parseMemInfo(const std::string& text, RamSample& out);

// Parses the first "cpu " line of /proc/stat. Returns false if not found.
bool parseProcStat(const std::string& text, uint64_t& totalJiffies, uint64_t& idleJiffies);

}  // namespace v4k
