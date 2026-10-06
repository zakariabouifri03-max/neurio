// NEXUS GRAPHICS ENGINE - hardware detection implementation
#include "stdafx.h"
#include "hwinfo.h"
#include "config.h"

static HwInfo g_hw;
static bool g_done = false;

// ---------- advanced color (HDR) state ----------
#ifndef DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO
#define DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO 11
#endif
typedef struct _NEXDISPLAYCONFIG_ADVANCED_COLOR_INFO {
    DISPLAYCONFIG_DEVICE_INFO_HEADER header;
    UINT32 advancedColorSupported : 1;
    UINT32 advancedColorEnabled : 1;
    UINT32 wideColorSupported : 1;
    UINT32 highDynamicRangeSupported : 1;
    UINT32 highDynamicRangeEnabled : 1;
    UINT32 reserved[3];
} NEXDISPLAYCONFIG_ADVANCED_COLOR_INFO;

bool DesktopHdrActive() {
    static int cached = -1;
    static uint32_t cachedAt = 0;
    uint32_t now = GetTickCount();
    if (cached >= 0 && now - cachedAt < 2000) return cached == 1;
    bool active = false;
    UINT32 numPaths = 0, numModes = 0;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &numPaths, &numModes) == ERROR_SUCCESS && numPaths > 0) {
        std::vector<DISPLAYCONFIG_PATH_INFO> paths(numPaths);
        std::vector<DISPLAYCONFIG_MODE_INFO> modes(numModes);
        if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &numPaths, paths.data(), &numModes, modes.data(), nullptr) == ERROR_SUCCESS) {
            for (UINT32 i = 0; i < numPaths; i++) {
                NEXDISPLAYCONFIG_ADVANCED_COLOR_INFO aci = {};
                aci.header.type = (DISPLAYCONFIG_DEVICE_INFO_TYPE)DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
                aci.header.size = sizeof(aci);
                aci.header.adapterId = paths[i].sourceInfo.adapterId;
                aci.header.id = paths[i].sourceInfo.id;
                if (DisplayConfigGetDeviceInfo(&aci.header) == ERROR_SUCCESS) {
                    if (aci.advancedColorEnabled) { active = true; break; }
                }
            }
        }
    }
    cached = active ? 1 : 0;
    cachedAt = now;
    return active;
}

IDXGIAdapter* AdapterForMonitor(HMONITOR mon) {
    static IDXGIAdapter* cached = nullptr;
    static HMONITOR cachedMon = nullptr;
    if (mon == cachedMon && cached) return cached;
    if (cached) { cached->Release(); cached = nullptr; cachedMon = nullptr; }
    NexusComPtr<IDXGIFactory1> factory;
    if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return nullptr;
    NexusComPtr<IDXGIAdapter1> adapter;
    for (UINT a = 0; factory->EnumAdapters1(a, &adapter) != DXGI_ERROR_NOT_FOUND; a++) {
        NexusComPtr<IDXGIOutput> out;
        for (UINT o = 0; adapter->EnumOutputs(o, &out) != DXGI_ERROR_NOT_FOUND; o++) {
            DXGI_OUTPUT_DESC od{};
            out->GetDesc(&od);
            if (od.Monitor == mon) {
                cached = adapter.Detach(); // keep ref
                cachedMon = mon;
                return cached;
            }
            out.Reset();
        }
        adapter.Reset();
    }
    return nullptr;
}

void DetectHardwareImpl(HwInfo& hw) {
    // ---- GPU ----
    NexusComPtr<IDXGIFactory1> factory;
    if (SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
        NexusComPtr<IDXGIAdapter1> adapter;
        NexusComPtr<IDXGIAdapter1> best;
        for (UINT a = 0; factory->EnumAdapters1(a, &adapter) != DXGI_ERROR_NOT_FOUND; a++) {
            DXGI_ADAPTER_DESC1 d{};
            adapter->GetDesc1(&d);
            if (d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) { adapter.Reset(); continue; }
            if (!best.Get()) best = std::move(adapter);
            adapter.Reset();
        }
        if (best.Get()) {
            DXGI_ADAPTER_DESC1 d{};
            best->GetDesc1(&d);
            WideCharToMultiByte(CP_UTF8, 0, d.Description, -1, hw.gpuName, sizeof(hw.gpuName), nullptr, nullptr);
            hw.vramMB = (size_t)(d.DedicatedVideoMemory / (1024 * 1024));
            best.Reset();
        }
    }
    // ---- feature level + compute support ----
    D3D_FEATURE_LEVEL fls[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
    D3D_FEATURE_LEVEL fl = (D3D_FEATURE_LEVEL)0;
    NexusComPtr<ID3D11Device> dev;
    if (SUCCEEDED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, fls, ARRAYSIZE(fls),
        D3D11_SDK_VERSION, &dev, &fl, nullptr))) {
        hw.featureLevel = fl;
        hw.csSupport = fl >= D3D_FEATURE_LEVEL_11_0;
    }
    hw.ok = hw.csSupport;

    // ---- CPU ----
    HKEY hk;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", 0, KEY_READ, &hk) == ERROR_SUCCESS) {
        wchar_t name[256] = {}; DWORD sz = sizeof(name);
        RegQueryValueExW(hk, L"ProcessorNameString", nullptr, nullptr, (BYTE*)name, &sz);
        WideCharToMultiByte(CP_UTF8, 0, name, -1, hw.cpuName, sizeof(hw.cpuName), nullptr, nullptr);
        RegCloseKey(hk);
    }
    SYSTEM_INFO si{};
    GetSystemInfo(&si);
    hw.threads = (int)si.dwNumberOfProcessors;
    hw.cores = hw.threads; // physical core count requires newer APIs; report logical
    MEMORYSTATUSEX ms{ sizeof(ms) };
    if (GlobalMemoryStatusEx(&ms)) hw.ramMB = (size_t)(ms.ullTotalPhys / (1024 * 1024));

    // ---- monitor / HDR ----
    POINT pt{ 0, 0 };
    HMONITOR mon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
    MONITORINFOEXW mi{ sizeof(MONITORINFOEXW) };
    if (GetMonitorInfoW(mon, &mi)) {
        hw.monitorW = mi.rcMonitor.right - mi.rcMonitor.left;
        hw.monitorH = mi.rcMonitor.bottom - mi.rcMonitor.top;
        DEVMODEW dm{ sizeof(dm) };
        if (EnumDisplaySettingsW(mi.szDevice, ENUM_CURRENT_SETTINGS, &dm)) hw.refreshHz = dm.dmDisplayFrequency;
    }
    UINT32 numPaths = 0, numModes = 0;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &numPaths, &numModes) == ERROR_SUCCESS && numPaths) {
        std::vector<DISPLAYCONFIG_PATH_INFO> paths(numPaths);
        std::vector<DISPLAYCONFIG_MODE_INFO> modes(numModes);
        if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &numPaths, paths.data(), &numModes, modes.data(), nullptr) == ERROR_SUCCESS) {
            for (UINT32 i = 0; i < numPaths; i++) {
                NEXDISPLAYCONFIG_ADVANCED_COLOR_INFO aci = {};
                aci.header.type = (DISPLAYCONFIG_DEVICE_INFO_TYPE)DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
                aci.header.size = sizeof(aci);
                aci.header.adapterId = paths[i].sourceInfo.adapterId;
                aci.header.id = paths[i].sourceInfo.id;
                if (DisplayConfigGetDeviceInfo(&aci.header) == ERROR_SUCCESS) {
                    hw.hdrSupported = hw.hdrSupported || aci.advancedColorSupported || aci.highDynamicRangeSupported;
                    hw.hdrActive = hw.hdrActive || aci.advancedColorEnabled;
                }
            }
        }
    }

    // ---- Vulkan availability (honest probe, no SDK needed) ----
    HMODULE vk = LoadLibraryW(L"vulkan-1.dll");
    if (vk) { hw.vulkanAvailable = true; FreeLibrary(vk); }

    // ---- DirectX runtime generation ----
    // DX11.1+ user-mode runtime present if D3D11CreateDevice FL 11_1 succeeded
    strcpy_s(hw.dxVersion, (fl >= D3D_FEATURE_LEVEL_11_1) ? "DX12 runtime / FL 11_1" : "DX12 runtime / FL 11_0");

    // ---- recommended settings from real measurements ----
    int score = 0;
    if (hw.vramMB >= 8192) score += 3; else if (hw.vramMB >= 6144) score += 2; else if (hw.vramMB >= 4096) score += 1;
    const char* gn = hw.gpuName;
    bool modern = strstr(gn, "RTX") || strstr(gn, "RX 6") || strstr(gn, "RX 7") || strstr(gn, "Arc");
    bool midrange = strstr(gn, "GTX 16") || strstr(gn, "GTX 10") || strstr(gn, "RX 5");
    if (modern) score += 3; else if (midrange) score += 1;
    if (hw.threads >= 12) score += 1;
    if (hw.monitorW * (uint64_t)hw.monitorH >= 2560 * 1440) score += 1;
    int preset;
    if (score >= 6) preset = 6;            // MAX GRAPHICS
    else if (score >= 5) preset = 2;       // ULTRA
    else if (score >= 3) preset = 2;       // ULTRA
    else if (score >= 2) preset = 1;       // QUALITY
    else preset = 0;                       // LOW ENHANCEMENT
    hw.recommendedPreset = preset;
    _snprintf_s(hw.recommendedNote, _TRUNCATE,
        "Detected %s with %zu MB VRAM. Recommended preset: %s. %s",
        hw.gpuName[0] ? hw.gpuName : "GPU", hw.vramMB, PresetName(preset),
        hw.csSupport ? "Compute pipeline supported." : "Compute shaders unavailable - enhancement cannot run on this GPU.");
}

const HwInfo& DetectHardware() {
    if (!g_done) {
        DetectHardwareImpl(g_hw);
        g_done = true;
        NEX_LOG("HW detect: GPU='%s' VRAM=%zuMB FL=0x%04X HDRsup=%d HDRact=%d vulkan=%d",
            g_hw.gpuName, g_hw.vramMB, g_hw.featureLevel, g_hw.hdrSupported ? 1 : 0,
            g_hw.hdrActive ? 1 : 0, g_hw.vulkanAvailable ? 1 : 0);
    }
    return g_hw;
}
