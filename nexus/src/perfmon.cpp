// NEXUS GRAPHICS ENGINE - performance monitor implementation
#include "stdafx.h"
#include "perfmon.h"
#include "hwinfo.h"

bool PerfMon::Start() {
    if (PdhOpenQueryW(nullptr, 0, &query_) != ERROR_SUCCESS) return false;
    // CPU: total processor time
    if (PdhAddEnglishCounterW(query_, L"\\Processor(_Total)\\% Processor Time", 0, &cpuCounter_) != ERROR_SUCCESS)
        cpuCounter_ = nullptr;
    // GPU: sum of all engine utilizations (Win10+; may be absent on some drivers)
    if (PdhAddEnglishCounterW(query_, L"\\GPU Engine(*)\\Utilization Percentage", 0, &gpuCounter_) == ERROR_SUCCESS)
        gpuCounters_ = true;
    PdhCollectQueryData(query_);
    // VRAM via DXGI adapter memory query
    NexusComPtr<IDXGIFactory4> f4;
    if (SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&f4)))) {
        NexusComPtr<IDXGIAdapter1> ad;
        if (SUCCEEDED(f4->EnumAdapters1(0, &ad))) {
            ad->QueryInterface(IID_PPV_ARGS(&adapter3_));
        }
    }
    return true;
}

void PerfMon::Stop() {
    if (query_) { PdhCloseQuery(query_); query_ = nullptr; }
    adapter3_.Reset();
}

PerfSample PerfMon::Sample() {
    uint32_t now = GetTickCount();
    if (now - lastSample_ < 500) return last_;
    lastSample_ = now;
    PerfSample s;
    if (query_) {
        PdhCollectQueryData(query_);
        PDH_FMT_COUNTERVALUE v;
        if (cpuCounter_ && PdhGetFormattedCounterValue(cpuCounter_, PDH_FMT_DOUBLE, nullptr, &v) == ERROR_SUCCESS)
            s.cpuPct = (float)std::min(100.0, std::max(0.0, v.doubleValue));
        if (gpuCounters_ && gpuCounter_) {
            DWORD count = 0, size = 0;
            // two-pass: get buffer size then values
            PdhGetFormattedCounterArrayW(gpuCounter_, PDH_FMT_DOUBLE, &size, &count, nullptr);
            std::vector<BYTE> buf(size ? size : 1);
            if (PdhGetFormattedCounterArrayW(gpuCounter_, PDH_FMT_DOUBLE, &size, &count,
                (PDH_FMT_COUNTERVALUE_ITEM_W*)buf.data()) == ERROR_SUCCESS) {
                double total = 0;
                auto* items = (PDH_FMT_COUNTERVALUE_ITEM_W*)buf.data();
                for (DWORD i = 0; i < count; i++) {
                    // only sum physical engines, not copy engines
                    if (wcsstr(items[i].szName, L"engtype_3D")) total += items[i].FmtValue.doubleValue;
                }
                s.gpuPct = (float)std::min(100.0, total);
                s.gpuCountersOk = true;
            }
        }
    }
    MEMORYSTATUSEX ms{ sizeof(ms) };
    if (GlobalMemoryStatusEx(&ms)) s.ramUsedMB = (ms.ullTotalPhys - ms.ullAvailPhys) / (1024 * 1024);
    if (adapter3_.Get()) {
        DXGI_QUERY_VIDEO_MEMORY_INFO q{};
        if (SUCCEEDED(adapter3_->QueryVideoMemoryInfo(0, DXGI_MEMORY_SEGMENT_GROUP_LOCAL, &q)))
            s.vramUsedMB = q.CurrentUsage / (1024 * 1024);
    }
    last_ = s;
    return s;
}
