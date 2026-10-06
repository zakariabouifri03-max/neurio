// Hardware detection, performance counters, process/window enumeration.
#pragma once
#include "common.h"
#include "engine.h"

struct HwInfo {
    char gpu[128];
    int vramMB;
    char cpu[160];
    int ramMB;
    bool dx11, dx12, vulkan, directml, cuda, onnx;
    int monW, monH;
    double refresh;
    int nMonitors;
    bool hdrCapable;
    char detail[256];
};

HwInfo DetectHardware(IDXGIFactory1* fac, ID3D11Device* dev, HWND focusWnd);

struct PerfSample {
    double gpuPct;    // -1 = unavailable
    double cpuPct;
    double vramUsedMB; // -1 = unavailable
    bool gpuOk, vramOk;
};

class PerfMon {
public:
    PerfMon();
    void Start();
    void Stop();
    PerfSample Sample();
private:
    void* pdh;
    void* hq;
    void* counterGpu;
    void* counterVram;
    bool gpuLoaded;
    ULARGE_INTEGER cpuIdle0, cpuKern0, cpuUser0;
    double cpuT0;
};

// ----------------------------------------------------------------
struct ProcInfo {
    DWORD pid;
    char exe[260];   // utf8
    char name[80];
};
int EnumProcesses_(ProcInfo* arr, int max);
bool ProcessAlive_(DWORD pid);
bool FindWindowForPid_(DWORD pid, HWND* out);   // largest visible window of the pid

struct WinInfo {
    HWND h;
    DWORD pid;
    char title[160];
    char exe[260];
    int x, y, w, hh;
    int likelyGame;   // 0 no, 1 possible, 2 selected
};
int EnumGameWindows_(WinInfo* arr, int max);

// profile persistence
bool ProfileSave(const char* gameName, const char* exePath, int inW, int inH,
                 const NexusSettings* s);
bool ProfileLoad(const char* gameName, NexusSettings* s);
void ProfilePath(const char* gameName, wchar_t* out, int n);
