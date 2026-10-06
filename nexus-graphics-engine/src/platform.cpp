#include "platform.h"
#include "json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tlhelp32.h>

// ================================================================ hardware
static bool FileExists_(const wchar_t* p){
    DWORD a = GetFileAttributesW(p);
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static wchar_t g_monDevOut[64];
static HMONITOR g_monDevFind;
static BOOL CALLBACK MonEnumCb_(HMONITOR hmon, HDC, RECT*, LPARAM){
    if (hmon == (HMONITOR)g_monDevFind){
        MONITORINFOEXW mi;
        mi.cbSize = sizeof mi;
        if (GetMonitorInfoW(hmon, (LPMONITORINFO)&mi))
            lstrcpynW(g_monDevOut, mi.szDevice, 64);
    }
    return TRUE;
}
typedef WINBOOL (WINAPI *MonEnumFn)(HDC, LPCRECT, MONITORENUMPROC, LPARAM);
static MonEnumFn p_MonEnum = 0;
static void MonitorDevName_(HMONITOR mon, wchar_t* out, int n){
    out[0] = 0;
    g_monDevFind = (HMONITOR)mon;
    if (!p_MonEnum)
        p_MonEnum = (MonEnumFn)GetProcAddress(GetModuleHandleW(L"user32"), "EnumDisplayMonitorsW");
    if (p_MonEnum) p_MonEnum(0, 0, MonEnumCb_, 0);
    lstrcpynW(out, g_monDevOut, n);
}

HwInfo DetectHardware(IDXGIFactory1* fac, ID3D11Device* dev, HWND focusWnd){
    HwInfo h;
    memset(&h, 0, sizeof h);
    // GPU
    IDXGIAdapter1* adp = 0;
    if (SUCCEEDED(fac->EnumAdapters1(0, &adp))){
        DXGI_ADAPTER_DESC d;
        if (SUCCEEDED(adp->GetDesc(&d))){
            WToUtf8_(h.gpu, 128, d.Description);
            h.vramMB = (int)(d.DedicatedVideoMemory / (1024 * 1024));
        }
        adp->Release();
    } else {
        strcpy(h.gpu, "unknown");
    }
    // CPU name
    wchar_t cpuw[192] = {0};
    {
        HKEY k;
        if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0",
                          0, KEY_READ, &k) == ERROR_SUCCESS){
            DWORD sz = sizeof cpuw, ty = 0;
            RegQueryValueExW(k, L"ProcessorNameString", 0, &ty, (LPBYTE)cpuw, &sz);
            // RegCloseHandle is missing from this toolchain's winreg.h
            typedef BOOL (WINAPI *RCHFn)(HKEY);
            static RCHFn p_regclose = 0;
            if (!p_regclose)
                p_regclose = (RCHFn)GetProcAddress(GetModuleHandleW(L"advapi32"), "RegCloseHandle");
            if (p_regclose) p_regclose(k);
        }
        WToUtf8_(h.cpu, 160, cpuw);
        if (!h.cpu[0]) strcpy(h.cpu, "unknown");
    }
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    // RAM
    MEMORYSTATUSEX ms; ms.dwLength = sizeof ms;
    if (GlobalMemoryStatusEx(&ms)) h.ramMB = (int)(ms.ullTotalPhys / (1024 * 1024));
    // monitors
    h.nMonitors = GetSystemMetrics(SM_CMONITORS);
    HMONITOR mon = MonitorFromWindow(focusWnd, MONITOR_DEFAULTTONEAREST);
    if (!mon) mon = MonitorFromPoint({0, 0}, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO mi; mi.cbSize = sizeof mi;
    if (mon && GetMonitorInfoW(mon, &mi)){
        h.monW = mi.rcMonitor.right - mi.rcMonitor.left;
        h.monH = mi.rcMonitor.bottom - mi.rcMonitor.top;
        wchar_t devname[64] = {0};
        MonitorDevName_(mon, devname, 64);
        DEVMODEW dm; memset(&dm, 0, sizeof dm);
        dm.dmSize = sizeof dm;
        if (EnumDisplaySettingsW(devname, ENUM_CURRENT_SETTINGS, &dm))
            h.refresh = (double)dm.dmDisplayFrequency;
        else h.refresh = 60.0;
    }
    // APIs
    h.dx11 = true;
    h.dx12 = FileExists_(L"C:\\Windows\\System32\\d3d12.dll");
    h.vulkan = (GetModuleHandleW(L"vulkan-1.dll") != 0) || FileExists_(L"C:\\Windows\\System32\\vulkan-1.dll");
    h.directml = FileExists_(L"C:\\Windows\\System32\\DML.dll");
    h.cuda = FileExists_(L"C:\\Windows\\System32\\nvcuda.dll");
    h.onnx = FileExists_(L"C:\\Windows\\System32\\onnxruntime.dll");
    // HDR: reported by the engine after init (IsWindowedColorSpaceSupported)
    snprintf(h.detail, 256, "%s | %d MB VRAM | %d core | %d MB RAM",
             h.gpu, h.vramMB, si.dwNumberOfProcessors, h.ramMB);
    return h;
}

// ================================================================ performance
// zig's pdh.h is partial - minimal local definitions for the dynamic API
#ifndef PDH_FMT_DOUBLE
#define PDH_FMT_DOUBLE 0x00000002
#endif
#ifndef PDH_FMT_KBYTE
#define PDH_FMT_KBYTE 0x00000400
#endif
struct PDH_FORMAT_DATA_M { DWORD dwTypeSize; DWORD dwReserved; DWORD dwReserved2; double doubleValue; };
struct PDH_COUNTERITEM_M { struct PDH_COUNTERITEM_M* Next; DWORD cbItemName; PDH_FMT_COUNTERVALUE FmtValue; };

// PDH is loaded dynamically (documented counters; Task Manager uses the same).
typedef HRESULT (WINAPI *fn_PdhOpenQueryW)(LPCWSTR, DWORD, void*, void**);
typedef HRESULT (WINAPI *fn_PdhAddEnglishCounterW)(void*, LPCWSTR, DWORD, void**);
typedef HRESULT (WINAPI *fn_PdhCollectQueryDataW)(void*, DWORD);
typedef HRESULT (WINAPI *fn_PdhGetFormattedCounterValueW)(void*, DWORD, LPWSTR, LPWSTR, void*);
typedef HRESULT (WINAPI *fn_PdhCloseQuery)(void*);
typedef HRESULT (WINAPI *fn_PdhGetFormattedCounterArrayW)(void*, DWORD, LPDWORD, LPWSTR, void*);

static fn_PdhOpenQueryW p_PdhOpenQueryW;
static fn_PdhAddEnglishCounterW p_PdhAddEnglishCounterW;
static fn_PdhCollectQueryDataW p_PdhCollectQueryDataW;
static fn_PdhGetFormattedCounterValueW p_PdhGetFormattedCounterValueW;
static fn_PdhCloseQuery p_PdhCloseQuery;
static fn_PdhGetFormattedCounterArrayW p_PdhGetFormattedCounterArrayW;

static int LoadPdh_(void){
    HMODULE m = LoadLibraryW(L"pdh.dll");
    if (!m) return -1;
    p_PdhOpenQueryW = (fn_PdhOpenQueryW)GetProcAddress(m, "PdhOpenQueryW");
    p_PdhAddEnglishCounterW = (fn_PdhAddEnglishCounterW)GetProcAddress(m, "PdhAddEnglishCounterW");
    p_PdhCollectQueryDataW = (fn_PdhCollectQueryDataW)GetProcAddress(m, "PdhCollectQueryDataW");
    p_PdhGetFormattedCounterValueW = (fn_PdhGetFormattedCounterValueW)GetProcAddress(m, "PdhGetFormattedCounterValueW");
    p_PdhCloseQuery = (fn_PdhCloseQuery)GetProcAddress(m, "PdhCloseQuery");
    p_PdhGetFormattedCounterArrayW = (fn_PdhGetFormattedCounterArrayW)GetProcAddress(m, "PdhGetFormattedCounterArrayW");
    if (!p_PdhOpenQueryW || !p_PdhAddEnglishCounterW || !p_PdhCollectQueryDataW ||
        !p_PdhGetFormattedCounterValueW || !p_PdhCloseQuery) return -1;
    return 0;
}

PerfMon::PerfMon() : pdh(0), hq(0), counterGpu(0), counterVram(0), gpuLoaded(false),
                     cpuT0(0)
{
    memset(&cpuIdle0, 0, sizeof cpuIdle0);
}

void PerfMon::Start(){
    if (LoadPdh_() == 0){
        if (SUCCEEDED(p_PdhOpenQueryW(0, 0, 0, &hq))){
            if (SUCCEEDED(p_PdhAddEnglishCounterW(hq, L"\\GPU Engine(_Total)\\Utilization Percentage", 0, &counterGpu)))
                gpuLoaded = true;
            if (SUCCEEDED(p_PdhAddEnglishCounterW(hq, L"\\GPU Process Memory(*)\\Dedicated Usage", 0, &counterVram)))
                ;
        }
    }
    GetSystemTimes((FILETIME*)&cpuIdle0, (FILETIME*)&cpuKern0, (FILETIME*)&cpuUser0);
    cpuT0 = NowMs_();
}

void PerfMon::Stop(){
    if (hq && p_PdhCloseQuery) p_PdhCloseQuery(hq);
    hq = 0;
}

PerfSample PerfMon::Sample(){
    PerfSample s;
    s.gpuPct = -1; s.cpuPct = 0; s.vramUsedMB = -1;
    s.gpuOk = false; s.vramOk = false;
    if (hq && p_PdhCollectQueryDataW){
        p_PdhCollectQueryDataW(hq, 0);
        if (counterGpu){
            PDH_FORMAT_DATA_M d;
            ZeroMemory(&d, sizeof d);
            d.dwTypeSize = sizeof d;
            HRESULT hr = p_PdhGetFormattedCounterValueW(counterGpu, PDH_FMT_DOUBLE, 0, 0, (void*)&d);
            if (SUCCEEDED(hr)){
                s.gpuPct = (double)d.doubleValue;
                if (s.gpuPct > 100) s.gpuPct = 100;
                s.gpuOk = true;
            }
        }
    }
    // VRAM: sum of dedicated usage across GPU process memory instances
    if (hq && counterVram && p_PdhGetFormattedCounterArrayW){
        static union { wchar_t w[65536]; PDH_COUNTERITEM_M v; } bu;
        DWORD len = sizeof bu;
        if (SUCCEEDED(p_PdhGetFormattedCounterArrayW(counterVram, PDH_FMT_KBYTE, &len, 0, (void*)&bu.v))){
            double kb = 0;
            int insts = 0;
            PDH_COUNTERITEM_M* p = &bu.v;
            while (p && insts < 512){
                kb += (double)p->FmtValue.longValue;
                insts++;
                p = p->Next;
            }
            if (insts > 0){
                s.vramUsedMB = kb / 1024.0;
                s.vramOk = true;
            }
        }
    }
    // CPU usage (documented: GetSystemTimes)
    ULARGE_INTEGER i1, k1, u1;
    double now = NowMs_();
    GetSystemTimes((FILETIME*)&i1, (FILETIME*)&k1, (FILETIME*)&u1);
    ULARGE_INTEGER idleD, totalD;
    idleD.QuadPart = i1.QuadPart - cpuIdle0.QuadPart;
    totalD.QuadPart = (k1.QuadPart - cpuKern0.QuadPart) + (u1.QuadPart - cpuUser0.QuadPart) + idleD.QuadPart;
    if (totalD.QuadPart > 0)
        s.cpuPct = 100.0 * (1.0 - (double)idleD.QuadPart / (double)totalD.QuadPart);
    cpuIdle0 = i1; cpuKern0 = k1; cpuUser0 = u1;
    cpuT0 = now;
    return s;
}

// ================================================================ processes
int EnumProcesses_(ProcInfo* arr, int max){
    int n = 0;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return 0;
    PROCESSENTRY32W pe;
    pe.dwSize = sizeof pe;
    if (Process32FirstW(snap, &pe)){
        do {
            if (n >= max) break;
            arr[n].pid = pe.th32ProcessID;
            WToUtf8_(arr[n].name, 80, pe.szExeFile);
            arr[n].exe[0] = 0;
            if (pe.th32ProcessID){
                HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID);
                if (h){
                    wchar_t path[MAX_PATH * 2] = {0};
                    DWORD sz = sizeof path / 2;
                    if (QueryFullProcessImageNameW(h, 0, path, &sz)){
                        WToUtf8_(arr[n].exe, 260, path);
                    }
                    CloseHandle(h);
                }
            }
            n++;
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    return n;
}

bool ProcessAlive_(DWORD pid){
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!h) return false;
    DWORD code = 12345;
    bool ok = GetExitCodeProcess(h, &code) && code == STILL_ACTIVE;
    CloseHandle(h);
    return ok;
}

static int g_winCbPid;
static HWND g_winBest;
static int g_winBestArea;
static BOOL CALLBACK WinEnumCb_(HWND h, LPARAM lp){
    (void)lp;
    if (!IsWindowVisible(h)) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(h, &pid);
    if (pid != (DWORD)g_winCbPid) return TRUE;
    if (GetWindow(h, GW_OWNER)) return TRUE; // skip dialogs
    LONG len = GetWindowTextLengthW(h);
    if (len <= 0) return TRUE;
    RECT r;
    if (!GetWindowRect(h, &r)) return TRUE;
    int area = (r.right - r.left) * (r.bottom - r.top);
    if (area > g_winBestArea){
        g_winBestArea = area;
        g_winBest = h;
    }
    return TRUE;
}
bool FindWindowForPid_(DWORD pid, HWND* out){
    g_winCbPid = (int)pid;
    g_winBest = 0;
    g_winBestArea = 0;
    EnumWindows(WinEnumCb_, 0);
    if (g_winBest){ *out = g_winBest; return true; }
    return false;
}

static bool LooksLikeGame_(const char* exe){
    const char* dirs[] = {
        "steamapps", "steam", "epic", "games", "gog", "ea apps", "ubisoft",
        "battlenet", "riot", "prime gaming", "playstation", "xbox games",
        "kingsoft", "pc game", 0
    };
    char low[300];
    for (int i = 0; exe[i] && i < 299; i++) low[i] = (char)((exe[i] >= 'A' && exe[i] <= 'Z') ? exe[i] + 32 : exe[i]);
    low[299] = 0;
    for (int i = 0; dirs[i]; i++)
        if (strstr(low, dirs[i])) return true;
    return false;
}

static int g_gwMax;
static int g_gwLimit;
static WinInfo* g_gwArr;
static BOOL CALLBACK GwEnumCb_(HWND h, LPARAM lp){
    (void)lp;
    if (!IsWindowVisible(h)) return TRUE;
    DWORD style = GetWindowLongW(h, GWL_STYLE);
    if (!(style & WS_VISIBLE)) return TRUE;
    LONG len = GetWindowTextLengthW(h);
    if (len <= 0) return TRUE;
    DWORD ex = GetWindowLongW(h, GWL_EXSTYLE);
    if (ex & WS_EX_TOOLWINDOW) return TRUE;
    if (GetWindow(h, GW_OWNER)) return TRUE;
    if (g_gwMax >= g_gwLimit) return TRUE;
    WinInfo* w = &g_gwArr[g_gwMax];
    if (!w) return TRUE;
    w->h = h;
    GetWindowThreadProcessId(h, &w->pid);
    wchar_t t[128] = {0};
    GetWindowTextW(h, t, 128);
    WToUtf8_(w->title, 160, t);
    w->exe[0] = 0;
    {
        HANDLE ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, w->pid);
        if (ph){
            wchar_t path[520] = {0};
            DWORD sz = sizeof path / 2;
            if (QueryFullProcessImageNameW(ph, 0, path, &sz)) WToUtf8_(w->exe, 260, path);
            CloseHandle(ph);
        }
    }
    RECT r;
    GetWindowRect(h, &r);
    w->x = r.left; w->y = r.top;
    w->w = r.right - r.left;
    w->hh = r.bottom - r.top;
    w->likelyGame = 0;
    if (LooksLikeGame_(w->exe)) w->likelyGame = 1;
    else if (w->w >= 1024 && w->hh >= 576 && w->exe[0]) w->likelyGame = 1;
    g_gwMax++;
    return TRUE;
}

int EnumGameWindows_(WinInfo* arr, int max){
    g_gwMax = 0;
    g_gwLimit = max;
    g_gwArr = arr;
    EnumWindows(GwEnumCb_, 0);
    return g_gwMax;
}

// ================================================================ profiles
void ProfilePath(const char* gameName, wchar_t* out, int n){
    wchar_t base[320] = {0};
    int bl = AppDataPath_(base, 320);
    if (!bl){ out[0] = 0; return; }
    char nameUtf[160];
    // sanitize
    for (int i = 0; gameName[i] && i < 159; i++){
        char c = gameName[i];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
            c == '.' || c == '-' || c == '_') nameUtf[i] = c;
        else nameUtf[i] = '_';
    }
    nameUtf[159] = 0;
    wchar_t nameW[160] = {0};
    Utf8ToW_(nameW, 160, nameUtf);
    lstrcpynW(out, base, n);
    lstrcatW(out, L"\\profiles\\");
    lstrcatW(out, nameW);
    lstrcatW(out, L".json");
}

bool ProfileSave(const char* gameName, const char* exePath, int inW, int inH,
                 const NexusSettings* s){
    wchar_t path[512] = {0};
    ProfilePath(gameName, path, 512);
    if (!path[0]) return false;
    wchar_t dir[320] = {0};
    lstrcpynW(dir, path, 320);
    wchar_t* sl = wcsrchr(dir, L'\\');
    if (sl){ *sl = 0; CreateDirectoryW(dir, 0); }
    JVal* o = JVNew(J_OBJ, 0);
    JVObjPutStr(o, "name", gameName);
    JVObjPutStr(o, "exe", exePath);
    JVObjPutInt(o, "inW", inW);
    JVObjPutInt(o, "inH", inH);
    SettingsToJson_((NexusSettings*)s, o);
    char buf[8192];
    int n = JVDump(o, buf, sizeof buf, 1);
    JVFree(o);
    return WriteFileW_(path, buf, n);
}

bool ProfileLoad(const char* gameName, NexusSettings* s){
    wchar_t path[512] = {0};
    ProfilePath(gameName, path, 512);
    if (!path[0]) return false;
    int len = 0;
    char* data = ReadFileAlloc_(path, &len);
    if (!data) return false;
    JVal* o = JVParse(data, len);
    free(data);
    if (!o) return false;
    SettingsFromJson_(s, o);
    JVFree(o);
    return true;
}
