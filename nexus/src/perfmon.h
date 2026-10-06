// NEXUS GRAPHICS ENGINE - performance monitor (real measurements via PDH / DXGI)
#pragma once
#include "stdafx.h"
#include <pdh.h>

struct PerfSample {
    float cpuPct = 0;        // total processor time (PDH)
    float gpuPct = 0;        // GPU engine utilization (PDH, when counters available)
    uint64_t ramUsedMB = 0;
    uint64_t vramUsedMB = 0; // dedicated VRAM in use (DXGI adapter memory)
    bool gpuCountersOk = false;
};

class PerfMon {
public:
    bool Start();
    void Stop();
    PerfSample Sample();
private:
    bool gpuCounters_ = false;
    PDH_HQUERY query_ = nullptr;
    PDH_HCOUNTER cpuCounter_ = nullptr;
    PDH_HCOUNTER gpuCounter_ = nullptr;
    NexusComPtr<IDXGIAdapter3> adapter3_;
    uint32_t lastSample_ = 0;
    PerfSample last_;
};
