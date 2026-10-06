#include "v4k_metrics.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstring>

namespace v4k {

// ---------------------------------------------------------------------------
// FrameTimeWindow
// ---------------------------------------------------------------------------
FrameTimeWindow::FrameTimeWindow(size_t capacity) : capacity_(capacity == 0 ? 1 : capacity) {
    ring_.assign(capacity_, 0.0);
    sortedScratch_.reserve(capacity_);
}

void FrameTimeWindow::add(double frameTimeMs, int64_t timestampMs) {
    if (!(frameTimeMs > 0.0) || !std::isfinite(frameTimeMs)) {
        // A non-positive or NaN frame time means "no frame completed" (e.g. the
        // session was paused). Record nothing rather than poisoning the stats.
        return;
    }
    ring_[head_] = frameTimeMs;
    head_ = (head_ + 1) % capacity_;
    if (count_ < capacity_) ++count_;
    lastTimestampMs_ = timestampMs;
}

void FrameTimeWindow::clear() {
    std::fill(ring_.begin(), ring_.end(), 0.0);
    count_ = 0;
    head_ = 0;
    lastTimestampMs_ = 0;
}

std::vector<double> FrameTimeWindow::samples() const {
    std::vector<double> out;
    out.reserve(count_);
    const size_t start = (head_ + capacity_ - count_) % capacity_;
    for (size_t i = 0; i < count_; ++i) {
        out.push_back(ring_[(start + i) % capacity_]);
    }
    return out;
}

double FrameTimeWindow::meanMs() const {
    if (count_ == 0) return kUnavailable;
    double sum = 0.0;
    const size_t start = (head_ + capacity_ - count_) % capacity_;
    for (size_t i = 0; i < count_; ++i) sum += ring_[(start + i) % capacity_];
    return sum / static_cast<double>(count_);
}

double FrameTimeWindow::medianMs() const { return percentileMs(0.5); }

double FrameTimeWindow::percentileMs(double p) const {
    if (count_ == 0) return kUnavailable;
    sortedScratch_.clear();
    const size_t start = (head_ + capacity_ - count_) % capacity_;
    for (size_t i = 0; i < count_; ++i) sortedScratch_.push_back(ring_[(start + i) % capacity_]);
    std::sort(sortedScratch_.begin(), sortedScratch_.end());
    if (p <= 0.0) return sortedScratch_.front();
    if (p >= 1.0) return sortedScratch_.back();
    const double idx = p * static_cast<double>(sortedScratch_.size() - 1);
    const size_t lo = static_cast<size_t>(std::floor(idx));
    const size_t hi = static_cast<size_t>(std::ceil(idx));
    const double t = idx - static_cast<double>(lo);
    return sortedScratch_[lo] * (1.0 - t) + sortedScratch_[hi] * t;
}

double FrameTimeWindow::minMs() const {
    if (count_ == 0) return kUnavailable;
    double m = ring_[0];
    const size_t start = (head_ + capacity_ - count_) % capacity_;
    for (size_t i = 0; i < count_; ++i) m = std::min(m, ring_[(start + i) % capacity_]);
    return m;
}

double FrameTimeWindow::maxMs() const {
    if (count_ == 0) return kUnavailable;
    double m = 0.0;
    const size_t start = (head_ + capacity_ - count_) % capacity_;
    for (size_t i = 0; i < count_; ++i) m = std::max(m, ring_[(start + i) % capacity_]);
    return m;
}

double FrameTimeWindow::stdDevMs() const {
    if (count_ < 2) return kUnavailable;
    const double mean = meanMs();
    double acc = 0.0;
    const size_t start = (head_ + capacity_ - count_) % capacity_;
    for (size_t i = 0; i < count_; ++i) {
        const double d = ring_[(start + i) % capacity_] - mean;
        acc += d * d;
    }
    return std::sqrt(acc / static_cast<double>(count_ - 1));
}

double FrameTimeWindow::instantFps() const {
    const double last = lastFrameTimeMs();
    if (last <= 0.0) return kUnavailable;
    return 1000.0 / last;
}

double FrameTimeWindow::averageFps() const {
    const double mean = meanMs();
    if (mean <= 0.0) return kUnavailable;
    return 1000.0 / mean;
}

double FrameTimeWindow::onePercentLowFps() const {
    const double p99 = percentileMs(0.99);
    if (p99 <= 0.0) return kUnavailable;
    return 1000.0 / p99;
}

double FrameTimeWindow::jitterMs() const {
    if (count_ < 2) return kUnavailable;
    const size_t start = (head_ + capacity_ - count_) % capacity_;
    double acc = 0.0;
    double prev = ring_[start];
    for (size_t i = 1; i < count_; ++i) {
        const double cur = ring_[(start + i) % capacity_];
        acc += std::fabs(cur - prev);
        prev = cur;
    }
    return acc / static_cast<double>(count_ - 1);
}

// ---------------------------------------------------------------------------
// StageTimers
// ---------------------------------------------------------------------------
StageTimers::StageTimers() { reset(); }

void StageTimers::reset() {
    for (auto& e : entries_) e = Entry{};
}

void StageTimers::record(Stage stage, double micros) {
    const int idx = static_cast<int>(stage);
    if (idx < 0 || idx >= kStageCount) return;
    if (!std::isfinite(micros) || micros < 0.0) return;
    Entry& e = entries_[idx];
    e.last = micros;
    e.ema = e.seen ? (alpha_ * micros + (1.0 - alpha_) * e.ema) : micros;
    e.max = e.seen ? std::max(e.max, micros) : micros;
    e.seen = true;
}

double StageTimers::lastUs(Stage stage) const {
    const int idx = static_cast<int>(stage);
    if (idx < 0 || idx >= kStageCount || !entries_[idx].seen) return kUnavailable;
    return entries_[idx].last;
}

double StageTimers::emaUs(Stage stage) const {
    const int idx = static_cast<int>(stage);
    if (idx < 0 || idx >= kStageCount || !entries_[idx].seen) return kUnavailable;
    return entries_[idx].ema;
}

double StageTimers::maxUs(Stage stage) const {
    const int idx = static_cast<int>(stage);
    if (idx < 0 || idx >= kStageCount || !entries_[idx].seen) return kUnavailable;
    return entries_[idx].max;
}

bool StageTimers::hasData(Stage stage) const {
    const int idx = static_cast<int>(stage);
    return idx >= 0 && idx < kStageCount && entries_[idx].seen;
}

double StageTimers::totalLastUs() const {
    double sum = 0.0;
    for (const auto& e : entries_) {
        if (e.seen) sum += e.last;
    }
    return sum;
}

double StageTimers::upscalerLastUs() const {
    double sum = 0.0;
    const Stage stages[] = {Stage::Preprocess, Stage::MotionEstimation, Stage::Inference,
                            Stage::TemporalReconstruction, Stage::AntiAliasing, Stage::Sharpening,
                            Stage::Composite};
    for (Stage s : stages) {
        const double v = lastUs(s);
        if (v > 0.0) sum += v;
    }
    return sum;
}

// ---------------------------------------------------------------------------
// GpuLoadEstimator
// ---------------------------------------------------------------------------
void GpuLoadEstimator::recordFrame(uint64_t busyNs, uint64_t periodNs) {
    if (periodNs == 0) return;
    const double u = static_cast<double>(busyNs) / static_cast<double>(periodNs);
    const double clamped = std::min(1.0, std::max(0.0, u));
    ema_ = samples_ == 0 ? clamped : (0.1 * clamped + 0.9 * ema_);
    lastBusyMs_ = static_cast<double>(busyNs) / 1e6;
    ++samples_;
}

void GpuLoadEstimator::reset() {
    ema_ = 0.0;
    lastBusyMs_ = kUnavailable;
    samples_ = 0;
}

double GpuLoadEstimator::utilization() const { return samples_ == 0 ? kUnavailable : ema_; }
double GpuLoadEstimator::busyMs() const { return lastBusyMs_; }

// ---------------------------------------------------------------------------
// CpuLoadSampler
// ---------------------------------------------------------------------------
double CpuLoadSampler::update(uint64_t totalJiffies, uint64_t idleJiffies) {
    if (lastTotal_ == 0) {
        lastTotal_ = totalJiffies;
        lastIdle_ = idleJiffies;
        return kUnavailable;
    }
    const uint64_t dTotal = totalJiffies - lastTotal_;
    const uint64_t dIdle = idleJiffies - lastIdle_;
    lastTotal_ = totalJiffies;
    lastIdle_ = idleJiffies;
    if (dTotal == 0) return lastUtil_;
    const double busy = static_cast<double>(dTotal - std::min(dIdle, dTotal));
    lastUtil_ = std::min(1.0, std::max(0.0, busy / static_cast<double>(dTotal)));
    return lastUtil_;
}

// ---------------------------------------------------------------------------
// /proc parsers
// ---------------------------------------------------------------------------
bool parseMemInfo(const std::string& text, RamSample& out) {
    bool haveTotal = false;
    bool haveAvailable = false;
    size_t pos = 0;
    while (pos < text.size()) {
        const size_t eol = text.find('\n', pos);
        const std::string line = text.substr(pos, eol == std::string::npos ? std::string::npos : eol - pos);
        pos = (eol == std::string::npos) ? text.size() : eol + 1;

        auto parseKb = [&](const char* key, uint64_t& target) -> bool {
            const size_t k = line.find(key);
            if (k != 0) return false;
            const char* p = line.c_str() + std::strlen(key);
            while (*p == ' ' || *p == ':') ++p;
            char* end = nullptr;
            const unsigned long long value = std::strtoull(p, &end, 10);
            if (end == p) return false;
            target = static_cast<uint64_t>(value) * 1024ull;
            return true;
        };

        if (parseKb("MemTotal", out.totalBytes)) haveTotal = true;
        if (parseKb("MemAvailable", out.availableBytes)) haveAvailable = true;
    }
    return haveTotal && haveAvailable;
}

bool parseProcStat(const std::string& text, uint64_t& totalJiffies, uint64_t& idleJiffies) {
    if (text.compare(0, 4, "cpu ") != 0) {
        const size_t nl = text.find('\n');
        if (nl == std::string::npos) return false;
        return parseProcStat(text.substr(nl + 1), totalJiffies, idleJiffies);
    }
    const size_t eol = text.find('\n');
    const std::string line = text.substr(0, eol == std::string::npos ? std::string::npos : eol);
    const char* p = line.c_str() + 4;
    uint64_t values[10] = {0};
    int n = 0;
    while (n < 10) {
        while (*p == ' ') ++p;
        if (*p == '\0') break;
        char* end = nullptr;
        values[n++] = std::strtoull(p, &end, 10);
        if (end == p) break;
        p = end;
    }
    if (n < 4) return false;
    // user nice system idle iowait irq softirq steal guest guest_nice
    totalJiffies = 0;
    for (int i = 0; i < n; ++i) totalJiffies += values[i];
    idleJiffies = values[3] + (n > 4 ? values[4] : 0);
    return true;
}

}  // namespace v4k
