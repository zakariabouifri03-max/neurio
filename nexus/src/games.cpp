// NEXUS GRAPHICS ENGINE - game detection / launching implementation
#include "stdafx.h"
#include "games.h"

static std::wstring ProcessImageName(DWORD pid) {
    std::wstring out;
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (h) {
        wchar_t buf[MAX_PATH * 2];
        DWORD size = MAX_PATH * 2;
        if (QueryFullProcessImageNameW(h, 0, buf, &size)) out.assign(buf, size);
        CloseHandle(h);
    }
    return out;
}

struct ScanCtx {
    std::vector<RunningGame>* out;
    DWORD selfPid;
};

static BOOL CALLBACK EnumWndProc(HWND hwnd, LPARAM lp) {
    ScanCtx* ctx = (ScanCtx*)lp;
    if (!IsWindowVisible(hwnd)) return TRUE;
    if (GetWindow(hwnd, GW_OWNER)) return TRUE;
    LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    if (ex & WS_EX_TOOLWINDOW) return TRUE;
    // skip cloaked UWP ghosts
    DWORD cloaked = 0;
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked) return TRUE;
    RECT rc{};
    if (!GetClientRect(hwnd, &rc) || rc.right - rc.left < 64 || rc.bottom - rc.top < 64) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (!pid || pid == ctx->selfPid) return TRUE;
    std::wstring path = ProcessImageName(pid);
    if (path.empty()) return TRUE;
    RunningGame g;
    g.pid = pid;
    g.hwnd = hwnd;
    g.rect = rc;
    size_t slash = path.find_last_of(L"\\/");
    g.exeName = path.substr(slash + 1);
    g.exePath = path;
    wchar_t title[256];
    GetWindowTextW(hwnd, title, 256);
    g.title = title;
    ctx->out->push_back(g);
    return TRUE;
}

std::vector<RunningGame> ScanRunningGames() {
    std::vector<RunningGame> out;
    ScanCtx ctx{ &out, GetCurrentProcessId() };
    EnumWindows(EnumWndProc, (LPARAM)&ctx);
    return out;
}

struct FindCtx {
    const char* exeLower;
    HWND best = nullptr;
    long bestArea = 0;
};

static BOOL CALLBACK EnumFindProc(HWND hwnd, LPARAM lp) {
    FindCtx* ctx = (FindCtx*)lp;
    if (!IsWindowVisible(hwnd)) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    std::wstring path = ProcessImageName(pid);
    if (path.empty()) return TRUE;
    size_t slash = path.find_last_of(L"\\/");
    std::wstring exe = path.substr(slash + 1);
    std::string exeU = WideToUtf8(exe);
    for (auto& c : exeU) c = (char)tolower((unsigned char)c);
    if (strcmp(exeU.c_str(), ctx->exeLower) != 0) return TRUE;
    RECT rc{};
    GetClientRect(hwnd, &rc);
    long area = (rc.right - rc.left) * (rc.bottom - rc.top);
    DWORD cloaked = 0;
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked) area = 0;
    if (area > ctx->bestArea) { ctx->bestArea = area; ctx->best = hwnd; }
    return TRUE;
}

HWND FindWindowForExeName(const char* exeNameLower) {
    if (!exeNameLower || !exeNameLower[0]) return nullptr;
    FindCtx ctx{ exeNameLower };
    EnumWindows(EnumFindProc, (LPARAM)&ctx);
    return ctx.best;
}

bool LaunchGame(const std::wstring& exePath, std::wstring* errOut) {
    if (!FileExistsW(exePath)) {
        if (errOut) *errOut = L"Executable not found: " + exePath;
        return false;
    }
    std::wstring dir = exePath.substr(0, exePath.find_last_of(L"\\/"));
    SHELLEXECUTEINFOW sei = { sizeof(sei) };
    sei.fMask = SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS;
    sei.lpVerb = L"open";
    sei.lpFile = exePath.c_str();
    sei.lpDirectory = dir.c_str();
    sei.nShow = SW_SHOWNORMAL;
    if (!ShellExecuteExW(&sei)) {
        if (errOut) *errOut = L"ShellExecuteEx failed (error " + std::to_wstring(GetLastError()) + L")";
        return false;
    }
    return true;
}

std::wstring BrowseForExe(HWND owner) {
    wchar_t buf[MAX_PATH] = {};
    OPENFILENAMEW ofn = { sizeof(ofn) };
    ofn.hwndOwner = owner;
    ofn.lpstrFilter = L"Programs (*.exe)\0*.exe\0All files (*.*)\0*.*\0";
    ofn.lpstrFile = buf;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = L"Select game executable";
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_HIDEREADONLY;
    if (!GetOpenFileNameW(&ofn)) return L"";
    return buf;
}
