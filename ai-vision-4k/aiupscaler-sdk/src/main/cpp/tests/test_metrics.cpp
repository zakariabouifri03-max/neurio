#include <cmath>

#include "core/v4k_metrics.h"
#include "v4k_test.h"

using namespace v4k;

V4K_TEST(metrics_frame_window_fps_and_percentiles) {
    FrameTimeWindow w(120);
    CHECK(w.empty());
    CHECK(w.meanMs() < 0.0);   // unavailable, never a fake 0

    // 60 frames at exactly 16 ms plus one 40 ms hitch: 61 frames in ~1000 ms.
    for (int i = 0; i < 60; ++i) w.add(16.0, i * 16);
    w.add(40.0, 61 * 16);

    CHECK_EQ_INT(w.size(), 61u);
    CHECK_NEAR(w.instantFps(), 25.0, 1e-6);
    CHECK_NEAR(w.medianMs(), 16.0, 1e-6);
    CHECK_NEAR(w.minMs(), 16.0, 1e-6);
    CHECK_NEAR(w.maxMs(), 40.0, 1e-6);
    CHECK(w.percentileMs(0.99) >= 16.0);
    CHECK(w.stdDevMs() > 0.0);
    // Average FPS counts the hitch: 61 frames over ~1000 ms.
    CHECK(w.averageFps() > 55.0);
    CHECK(w.averageFps() < 65.0);

    // A sustained stutter (10 of 61 frames at 40 ms) is what the "1% low"
    // figure is supposed to expose.
    FrameTimeWindow stutter(120);
    for (int i = 0; i < 51; ++i) stutter.add(16.0);
    for (int i = 0; i < 10; ++i) stutter.add(40.0);
    CHECK_GT(stutter.percentileMs(0.99), 30.0);
    CHECK_NEAR(stutter.onePercentLowFps(), 25.0, 0.2);
    CHECK_GT(stutter.jitterMs(), 0.0);
}

V4K_TEST(metrics_frame_window_ignores_invalid_samples) {
    FrameTimeWindow w(16);
    w.add(0.0, 0);
    w.add(-5.0, 1);
    w.add(std::nan(""), 2);
    CHECK(w.empty());
    w.add(20.0, 3);
    CHECK_EQ_INT(w.size(), 1u);
    CHECK_NEAR(w.meanMs(), 20.0, 1e-9);
}

V4K_TEST(metrics_frame_window_ring_wraps) {
    FrameTimeWindow w(4);
    for (int i = 1; i <= 6; ++i) w.add(static_cast<double>(i));
    CHECK_EQ_INT(w.size(), 4u);
    const std::vector<double> samples = w.samples();
    CHECK_EQ_INT(samples.size(), 4u);
    CHECK_NEAR(samples[0], 3.0, 1e-9);
    CHECK_NEAR(samples[3], 6.0, 1e-9);
    CHECK_NEAR(w.meanMs(), 4.5, 1e-9);
}

V4K_TEST(metrics_stage_timers) {
    StageTimers timers;
    CHECK(!timers.hasData(Stage::Inference));
    CHECK(timers.lastUs(Stage::Inference) < 0.0);

    timers.record(Stage::Inference, 2000.0);
    timers.record(Stage::Inference, 3000.0);
    CHECK(timers.hasData(Stage::Inference));
    CHECK_NEAR(timers.lastUs(Stage::Inference), 3000.0, 1e-9);
    CHECK_NEAR(timers.maxUs(Stage::Inference), 3000.0, 1e-9);
    CHECK(timers.emaUs(Stage::Inference) > 2000.0);
    CHECK(timers.emaUs(Stage::Inference) < 3000.0);

    timers.record(Stage::Sharpening, 150.0);
    CHECK_NEAR(timers.upscalerLastUs(), 3150.0, 1e-9);
    CHECK_NEAR(timers.totalLastUs(), 3150.0, 1e-9);

    // Negative samples are ignored rather than corrupting the averages.
    timers.record(Stage::Inference, -1.0);
    CHECK_NEAR(timers.lastUs(Stage::Inference), 3000.0, 1e-9);
}

V4K_TEST(metrics_gpu_load_estimator) {
    GpuLoadEstimator gpu;
    CHECK(!gpu.available());
    CHECK(gpu.utilization() < 0.0);

    gpu.recordFrame(8000000ull, 16000000ull);   // 8 ms busy in a 16 ms frame
    CHECK(gpu.available());
    CHECK_NEAR(gpu.utilization(), 0.5, 1e-6);
    CHECK_NEAR(gpu.busyMs(), 8.0, 1e-6);

    // Clamps nonsense input instead of reporting >100%.
    gpu.recordFrame(32000000ull, 16000000ull);
    CHECK(gpu.utilization() <= 1.0);
    gpu.recordFrame(1000, 0);
    CHECK(gpu.available());
}

V4K_TEST(metrics_cpu_load_sampler) {
    CpuLoadSampler cpu;
    CHECK(cpu.update(1000, 500) < 0.0);            // first sample: no baseline
    CHECK_NEAR(cpu.update(2000, 600), 0.9, 1e-9);  // 900 busy of 1000 jiffies
    CHECK_NEAR(cpu.update(3000, 1500), 0.1, 1e-9);
    // Counter regression must not produce a negative utilisation.
    const double v = cpu.update(100, 50);
    CHECK(v >= 0.0);
}

V4K_TEST(metrics_proc_parsers) {
    const std::string meminfo =
        "MemTotal:       12345678 kB\n"
        "MemFree:          123456 kB\n"
        "MemAvailable:    4000000 kB\n"
        "Buffers:           10000 kB\n";
    RamSample ram;
    CHECK(parseMemInfo(meminfo, ram));
    CHECK_EQ_INT(ram.totalBytes, 12345678ull * 1024ull);
    CHECK_EQ_INT(ram.availableBytes, 4000000ull * 1024ull);
    CHECK(ram.usedFraction() > 0.6);
    CHECK(ram.usedFraction() < 0.8);

    const std::string stat =
        "cpu  100 20 30 400 50 5 5 0 0 0\n"
        "cpu0 10 2 3 40 5 0 0 0 0 0\n";
    uint64_t total = 0;
    uint64_t idle = 0;
    CHECK(parseProcStat(stat, total, idle));
    CHECK_EQ_INT(total, 610ull);   // user+nice+system+idle+iowait+irq+softirq
    CHECK_EQ_INT(idle, 450ull);

    RamSample unused;
    CHECK(!parseMemInfo("nonsense\n", unused));
    CHECK(!parseProcStat("nonsense\n", total, idle));
}
