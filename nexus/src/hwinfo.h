// NEXUS GRAPHICS ENGINE - hardware detection
#pragma once
#include "stdafx.h"

struct HwInfo {
    char gpuName[160] = "";
    size_t vramMB = 0;
    UINT featureLevel = 0;          // 0xB000 = 11_0, 0xB100 = 11_1
    bool csSupport = false;
    char cpuName[160] = "";
    int cores = 0, threads = 0;
    size_t ramMB = 0;
    int monitorW = 0, monitorH = 0, refreshHz = 0;
    bool hdrSupported = false;      // monitor can do HDR (advanced color capable)
    bool hdrActive = false;         // HDR currently enabled on the desktop
    bool vulkanAvailable = false;
    char dxVersion[24] = "DX12";    // runtime generation detected
    // recommendations (calculated from real measurements)
    int recommendedPreset = 0;
    char recommendedNote[240] = "";
    bool ok = false;
};

// Detection runs once and is cached.
const HwInfo& DetectHardware();
// Is HDR (advanced color) active on the desktop right now (live query, cheap)
bool DesktopHdrActive();
IDXGIAdapter* AdapterForMonitor(HMONITOR mon);
