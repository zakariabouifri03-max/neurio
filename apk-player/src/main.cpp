// Neurio APK Player — play Android web games / HTML5 APKs on Windows without an emulator.
//
// How it works: an APK is a zip. Games made with web technology (Cordova, Capacitor,
// Construct, Phaser, Three.js, plain WebView shells...) keep their real content as
// HTML/JS files inside assets/. We extract those files and run them in Microsoft Edge
// WebView2 (the Chromium engine already shipped with Windows 10/11), served from a
// stable https:// origin so saves (localStorage / IndexedDB) persist between sessions.
// Native APKs (Unity, Unreal, Java/Kotlin UI...) are detected and explained instead.
//
// Single file, no installer, ~1 MB. Requires the WebView2 Runtime (preinstalled on
// Windows 11 and on up-to-date Windows 10).
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commdlg.h>
#include <objbase.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <wrl.h>

#include <WebView2.h>

#include <algorithm>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "apk.h"
#include "resource.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

#define APP_TITLE L"Neurio APK Player"
#define APP_VERSION "1.0.0"

static const wchar_t* kHomeHost = L"player.example";
static const UINT WM_APP_LAUNCHED = WM_APP + 1;
static const UINT_PTR TIMER_SMOKE = 1, TIMER_WATCHDOG = 2, TIMER_HINT = 3;

// ============================================================ small helpers
static std::wstring W(const std::string& s) {
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0);
    std::wstring w(size_t(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), &w[0], n);
    return w;
}
static std::string U(const std::wstring& w) {
    if (w.empty()) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), int(w.size()), nullptr, 0, nullptr, nullptr);
    std::string s(size_t(n), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), int(w.size()), &s[0], n, nullptr, nullptr);
    return s;
}
static std::string U(const wchar_t* w) { return w ? U(std::wstring(w)) : std::string(); }
static std::wstring lowerW(std::wstring s) {
    if (!s.empty()) CharLowerBuffW(&s[0], DWORD(s.size()));
    return s;
}
static std::string lowerA(std::string s) {
    for (auto& c : s)
        if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
    return s;
}
static bool endsWithI(const std::wstring& s, const std::wstring& suf) {
    if (s.size() < suf.size()) return false;
    return lowerW(s.substr(s.size() - suf.size())) == lowerW(suf);
}
static bool startsWith(const std::string& s, const std::string& p) { return s.compare(0, p.size(), p) == 0; }
static std::string q(const std::string& s) { return "\"" + apk::jsonEscape(s) + "\""; }
static std::string qw(const std::wstring& s) { return q(U(s)); }

static uint64_t fnv1a(const std::string& s) {
    uint64_t h = 1469598103934665603ull;
    for (unsigned char c : s) {
        h ^= c;
        h *= 1099511628211ull;
    }
    return h;
}
static std::string hex8(uint64_t v) {
    char b[24];
    snprintf(b, sizeof b, "%08llx", (unsigned long long)(v & 0xffffffffull));
    return b;
}
static bool isApkPath(const std::wstring& p) {
    return endsWithI(p, L".apk") || endsWithI(p, L".xapk") || endsWithI(p, L".apks") || endsWithI(p, L".apkm");
}

// ============================================================ files
static std::wstring longPath(const std::wstring& p) {
    if (p.compare(0, 4, L"\\\\?\\") == 0) return p;
    if (p.compare(0, 2, L"\\\\") == 0) return L"\\\\?\\UNC\\" + p.substr(2);
    return L"\\\\?\\" + p;
}
static bool dirExists(const std::wstring& d) {
    DWORD a = GetFileAttributesW(longPath(d).c_str());
    return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}
static bool fileExists(const std::wstring& f) {
    DWORD a = GetFileAttributesW(longPath(f).c_str());
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}
static bool ensureDir(const std::wstring& dir) {
    if (dir.empty()) return false;
    if (dirExists(dir)) return true;
    size_t cut = dir.find_last_of(L"\\/");
    if (cut != std::wstring::npos && cut > 2) ensureDir(dir.substr(0, cut));
    if (CreateDirectoryW(longPath(dir).c_str(), nullptr)) return true;
    return dirExists(dir);
}
static bool writeFile(const std::wstring& path, const void* data, size_t n) {
    HANDLE h = CreateFileW(longPath(path).c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    const char* p = static_cast<const char*>(data);
    bool ok = true;
    while (n) {
        DWORD chunk = DWORD(std::min<size_t>(n, 1u << 30)), wr = 0;
        if (!WriteFile(h, p, chunk, &wr, nullptr) || !wr) {
            ok = false;
            break;
        }
        p += wr;
        n -= wr;
    }
    CloseHandle(h);
    return ok;
}
static bool writeText(const std::wstring& path, const std::string& s) { return writeFile(path, s.data(), s.size()); }
static bool readFileAll(const std::wstring& path, std::string& out, size_t maxBytes = 64u << 20) {
    out.clear();
    HANDLE h = CreateFileW(longPath(path).c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER sz;
    if (!GetFileSizeEx(h, &sz) || sz.QuadPart > (LONGLONG)maxBytes) {
        CloseHandle(h);
        return false;
    }
    out.resize(size_t(sz.QuadPart));
    DWORD rd = 0;
    bool ok = out.empty() || (ReadFile(h, &out[0], DWORD(out.size()), &rd, nullptr) && rd == out.size());
    CloseHandle(h);
    return ok;
}
static void deleteTree(const std::wstring& dir) {
    std::wstring base = longPath(dir);
    WIN32_FIND_DATAW fd;
    HANDLE f = FindFirstFileW((base + L"\\*").c_str(), &fd);
    if (f != INVALID_HANDLE_VALUE) {
        do {
            std::wstring n = fd.cFileName;
            if (n == L"." || n == L"..") continue;
            std::wstring p = dir + L"\\" + n;
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                deleteTree(p);
            } else {
                SetFileAttributesW(longPath(p).c_str(), FILE_ATTRIBUTE_NORMAL);
                DeleteFileW(longPath(p).c_str());
            }
        } while (FindNextFileW(f, &fd));
        FindClose(f);
    }
    RemoveDirectoryW(base.c_str());
}
static std::wstring knownFolder(REFKNOWNFOLDERID id) {
    PWSTR p = nullptr;
    std::wstring r;
    if (SUCCEEDED(SHGetKnownFolderPath(id, KF_FLAG_CREATE, nullptr, &p)) && p) r = p;
    CoTaskMemFree(p);
    return r;
}
static std::wstring exePath() {
    std::wstring b(32768, L'\0');
    DWORD n = GetModuleFileNameW(nullptr, &b[0], DWORD(b.size()));
    b.resize(n);
    return b;
}
static std::wstring parentDir(const std::wstring& p) {
    size_t i = p.find_last_of(L"\\/");
    return i == std::wstring::npos ? std::wstring() : p.substr(0, i);
}
static std::wstring fileNameOf(const std::wstring& p) {
    size_t i = p.find_last_of(L"\\/");
    return i == std::wstring::npos ? p : p.substr(i + 1);
}
static std::wstring fullPath(const std::wstring& p) {
    wchar_t buf[32768];
    DWORD n = GetFullPathNameW(p.c_str(), 32768, buf, nullptr);
    return (n && n < 32768) ? std::wstring(buf, n) : p;
}

// ============================================================ app state
enum class Mode { Starting, Home, Game };

struct LibItem {
    std::wstring path;
    std::string pkg, name, kind, framework, version, icon, iconFg, iconBg, iconBgColor, orientation;
    long long last = 0;
    int touch = -1;  // -1 = automatic, 0 = mouse/keyboard (PC), 1 = touch emulation
    bool keyboard = false;
};

struct LaunchResult {
    std::wstring path;
    bool ok = false;
    std::string error;
    apk::Info info;
    std::wstring root;  // extracted web root on disk
    std::wstring host;  // virtual host name (per package => stable origin)
    std::string icon, iconFg, iconBg;
    std::wstring iconPng;  // icon as PNG file (for the window icon / shortcuts)
    double seconds = 0;
};

static struct App {
    HINSTANCE inst = nullptr;
    HWND hwnd = nullptr;
    ComPtr<ICoreWebView2Environment> env;
    ComPtr<ICoreWebView2Controller> ctrl;
    ComPtr<ICoreWebView2> wv;
    Mode mode = Mode::Starting;
    std::wstring dataDir, uiDir, iconsDir, appsDir, logPath;
    std::wstring defaultUA;
    std::wstring appHost;       // currently mapped app host
    std::wstring pendingLaunch; // from the command line
    std::vector<std::string> pendingHome;  // messages for the launcher page, sent once it is ready
    bool busy = false;
    bool homeReady = false;
    bool fullscreen = false;
    DWORD savedStyle = 0;
    WINDOWPLACEMENT savedPlacement{sizeof(WINDOWPLACEMENT)};
    bool touch = false;
    std::unique_ptr<LaunchResult> current;
    std::vector<LibItem> lib;
    HICON appIconBig = nullptr, appIconSmall = nullptr, gameIconBig = nullptr, gameIconSmall = nullptr;
    // smoke test (CI): --smoke-test <apk> <outdir> [native.apk]
    bool smoke = false;
    std::wstring smokeApk, smokeOut, smokeNative;
    int smokeStep = 0;
    int exitCode = 0;
    ComPtr<IStream> captureStream;
    bool devtools = false;
} g;

// ============================================================ logging
static void plog(const char* fmt, ...) {
    char msg[4096];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    SYSTEMTIME st;
    GetLocalTime(&st);
    char line[4300];
    int n = snprintf(line, sizeof line, "%02d:%02d:%02d.%03d  %s\r\n", st.wHour, st.wMinute, st.wSecond, st.wMilliseconds, msg);
    OutputDebugStringA(line);
    if (g.logPath.empty()) return;
    HANDLE h = CreateFileW(g.logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    DWORD wr;
    WriteFile(h, line, DWORD(std::max(0, std::min(n, int(sizeof line) - 1))), &wr, nullptr);
    CloseHandle(h);
}

// ============================================================ library (recent APKs)
static std::vector<std::string> split(const std::string& s, char sep) {
    std::vector<std::string> out;
    size_t a = 0;
    for (;;) {
        size_t b = s.find(sep, a);
        out.push_back(s.substr(a, b == std::string::npos ? std::string::npos : b - a));
        if (b == std::string::npos) break;
        a = b + 1;
    }
    return out;
}
static std::string clean(std::string s) {
    for (auto& c : s)
        if (c == '\t' || c == '\r' || c == '\n') c = ' ';
    return s;
}
static void loadLibrary() {
    g.lib.clear();
    std::string txt;
    if (!readFileAll(g.dataDir + L"\\library.tsv", txt)) return;
    for (const auto& line : split(txt, '\n')) {
        auto f = split(line, '\t');
        if (f.size() < 13 || f[0].empty()) continue;
        LibItem it;
        it.path = W(f[0]);
        it.pkg = f[1];
        it.name = f[2];
        it.kind = f[3];
        it.framework = f[4];
        it.version = f[5];
        it.icon = f[6];
        it.iconFg = f[7];
        it.iconBg = f[8];
        it.iconBgColor = f[9];
        it.last = atoll(f[10].c_str());
        it.touch = atoi(f[11].c_str());
        it.keyboard = f[12] == "1";
        if (f.size() > 13) it.orientation = f[13];
        g.lib.push_back(it);
    }
}
static void saveLibrary() {
    std::sort(g.lib.begin(), g.lib.end(), [](const LibItem& a, const LibItem& b) { return a.last > b.last; });
    if (g.lib.size() > 60) g.lib.resize(60);
    std::string out;
    for (const auto& it : g.lib) {
        out += clean(U(it.path)) + "\t" + clean(it.pkg) + "\t" + clean(it.name) + "\t" + it.kind + "\t" + clean(it.framework) +
               "\t" + clean(it.version) + "\t" + it.icon + "\t" + it.iconFg + "\t" + it.iconBg + "\t" + it.iconBgColor + "\t" +
               std::to_string(it.last) + "\t" + std::to_string(it.touch) + "\t" + (it.keyboard ? "1" : "0") + "\t" +
               it.orientation + "\n";
    }
    writeText(g.dataDir + L"\\library.tsv", out);
}
static LibItem* findItem(const std::wstring& path) {
    for (auto& it : g.lib)
        if (lowerW(it.path) == lowerW(path)) return &it;
    return nullptr;
}
static std::string itemJson(const LibItem& it) {
    std::string o = "{";
    o += "\"path\":" + qw(it.path);
    o += ",\"file\":" + qw(fileNameOf(it.path));
    o += ",\"pkg\":" + q(it.pkg);
    o += ",\"name\":" + q(it.name);
    o += ",\"kind\":" + q(it.kind);
    o += ",\"framework\":" + q(it.framework);
    o += ",\"version\":" + q(it.version);
    o += ",\"icon\":" + q(it.icon);
    o += ",\"iconFg\":" + q(it.iconFg);
    o += ",\"iconBg\":" + q(it.iconBg);
    o += ",\"iconBgColor\":" + q(it.iconBgColor);
    o += ",\"orientation\":" + q(it.orientation);
    o += ",\"touch\":" + std::to_string(it.touch);
    o += std::string(",\"keyboard\":") + (it.keyboard ? "true" : "false");
    o += std::string(",\"exists\":") + (fileExists(it.path) ? "true" : "false");
    o += ",\"last\":" + std::to_string(it.last);
    return o + "}";
}
static std::string libraryJson() {
    std::string o = "{\"type\":\"library\",\"version\":\"" APP_VERSION "\",\"items\":[";
    for (size_t i = 0; i < g.lib.size(); i++) o += (i ? "," : "") + itemJson(g.lib[i]);
    o += "],\"busy\":";
    o += (g.busy || !g.pendingLaunch.empty()) ? "true" : "false";
    return o + "}";
}

// ============================================================ messaging with the home page
static void postJson(const std::string& json) {
    if (g.wv && g.mode == Mode::Home) g.wv->PostWebMessageAsJson(W(json).c_str());
}
// like postJson, but if the launcher is not showing yet the message waits until it is
static void postHome(const std::string& json) {
    if (g.wv && g.mode == Mode::Home) g.wv->PostWebMessageAsJson(W(json).c_str());
    else g.pendingHome.push_back(json);
}
static void postToast(const std::string& text) { postJson("{\"type\":\"toast\",\"text\":" + q(text) + "}"); }

// Floating message on top of any page (used while a game is running).
static void pageToast(const std::wstring& text, int ms = 2600) {
    if (!g.wv) return;
    std::string js =
        "(function(t,ms){try{var d=document.getElementById('__neurio_toast');if(!d){d=document.createElement('div');"
        "d.id='__neurio_toast';d.style.cssText='position:fixed;left:50%;top:16px;transform:translateX(-50%);"
        "z-index:2147483647;background:rgba(10,14,30,.88);color:#fff;font:600 14px/1.35 Segoe UI,system-ui,sans-serif;"
        "padding:10px 18px;border-radius:12px;pointer-events:none;box-shadow:0 8px 28px rgba(0,0,0,.4);transition:opacity "
        ".35s;white-space:pre-line;text-align:center;max-width:90vw';(document.body||document.documentElement)."
        "appendChild(d);}d.textContent=t;d.style.opacity='1';clearTimeout(window.__neurioToastT);window.__neurioToastT="
        "setTimeout(function(){d.style.opacity='0'},ms);}catch(e){}})(" +
        q(U(text)) + "," + std::to_string(ms) + ")";
    g.wv->ExecuteScript(W(js).c_str(), nullptr);
}

// ============================================================ window helpers
typedef UINT(WINAPI* GetDpiForWindowFn)(HWND);
static UINT dpiOf(HWND h) {
    static GetDpiForWindowFn fn =
        reinterpret_cast<GetDpiForWindowFn>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow"));
    UINT d = fn ? fn(h) : 96;
    return d ? d : 96;
}
static void resizeWebView() {
    if (!g.ctrl || !g.hwnd) return;
    RECT rc;
    GetClientRect(g.hwnd, &rc);
    g.ctrl->put_Bounds(rc);
}
// Resize the window so the client area fits the app's orientation (in DIPs scaled by DPI).
static void sizeForOrientation(const std::string& orientation) {
    if (g.fullscreen || !g.hwnd || IsZoomed(g.hwnd)) return;
    HMONITOR mon = MonitorFromWindow(g.hwnd, MONITOR_DEFAULTTONEAREST);
    MONITORINFO mi{sizeof mi};
    GetMonitorInfoW(mon, &mi);
    int workW = mi.rcWork.right - mi.rcWork.left, workH = mi.rcWork.bottom - mi.rcWork.top;
    double s = dpiOf(g.hwnd) / 96.0;
    int cw, ch;
    if (orientation == "portrait") {
        ch = int(std::min(workH * 0.88, 900 * s));
        cw = ch * 9 / 16;
    } else {
        cw = int(std::min(workW * 0.86, 1280 * s));
        ch = cw * 9 / 16;
        if (ch > workH * 0.86) {
            ch = int(workH * 0.86);
            cw = ch * 16 / 9;
        }
    }
    RECT r{0, 0, cw, ch};
    AdjustWindowRectEx(&r, DWORD(GetWindowLongW(g.hwnd, GWL_STYLE)), FALSE, DWORD(GetWindowLongW(g.hwnd, GWL_EXSTYLE)));
    int w = r.right - r.left, h = r.bottom - r.top;
    int x = mi.rcWork.left + (workW - w) / 2, y = mi.rcWork.top + (workH - h) / 2;
    SetWindowPos(g.hwnd, nullptr, x, std::max<int>(y, mi.rcWork.top), w, h, SWP_NOZORDER | SWP_NOACTIVATE);
}
static void setFullscreen(bool on) {
    if (on == g.fullscreen || !g.hwnd) return;
    if (on) {
        g.savedStyle = DWORD(GetWindowLongW(g.hwnd, GWL_STYLE));
        g.savedPlacement.length = sizeof(WINDOWPLACEMENT);
        GetWindowPlacement(g.hwnd, &g.savedPlacement);
        MONITORINFO mi{sizeof mi};
        GetMonitorInfoW(MonitorFromWindow(g.hwnd, MONITOR_DEFAULTTONEAREST), &mi);
        SetWindowLongW(g.hwnd, GWL_STYLE, LONG(g.savedStyle & ~WS_OVERLAPPEDWINDOW));
        SetWindowPos(g.hwnd, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right - mi.rcMonitor.left,
                     mi.rcMonitor.bottom - mi.rcMonitor.top, SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    } else {
        SetWindowLongW(g.hwnd, GWL_STYLE, LONG(g.savedStyle));
        SetWindowPlacement(g.hwnd, &g.savedPlacement);
        SetWindowPos(g.hwnd, nullptr, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    }
    g.fullscreen = on;
    resizeWebView();
}
static void toggleFullscreen() {
    bool on = !g.fullscreen;
    if (!on && g.wv) g.wv->ExecuteScript(L"document.fullscreenElement&&document.exitFullscreen&&document.exitFullscreen()", nullptr);
    setFullscreen(on);
    if (on && g.mode == Mode::Game) pageToast(L"F11 = exit fullscreen", 1800);
}
static HICON iconFromPng(const std::string& png, int size) {
    if (png.size() < 24) return nullptr;
    return CreateIconFromResourceEx(reinterpret_cast<PBYTE>(const_cast<char*>(png.data())), DWORD(png.size()), TRUE,
                                    0x00030000, size, size, LR_DEFAULTCOLOR);
}
static void setWindowIcons(HICON bigIcon, HICON smallIcon) {
    SendMessageW(g.hwnd, WM_SETICON, ICON_BIG, LPARAM(bigIcon ? bigIcon : g.appIconBig));
    SendMessageW(g.hwnd, WM_SETICON, ICON_SMALL, LPARAM(smallIcon ? smallIcon : g.appIconSmall));
}

// ============================================================ launching an APK (worker thread)
static std::wstring hostFor(const std::string& pkg, const std::wstring& path) {
    std::string h;
    for (char c : lowerA(pkg)) {
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.') h += c;
        else h += '-';
    }
    std::string out;
    for (auto& label : split(h, '.')) {
        while (!label.empty() && label.front() == '-') label.erase(0, 1);
        while (!label.empty() && label.back() == '-') label.pop_back();
        if (label.empty()) continue;
        if (label.size() > 40) label.resize(40);
        out += (out.empty() ? "" : ".") + label;
    }
    if (out.empty() || out.size() > 150) out = "app-" + hex8(fnv1a(lowerA(U(path))));
    return W(out + ".apk.example");
}

static bool safeRelPath(const std::string& rel, std::wstring& out) {
    out.clear();
    if (rel.empty()) return false;
    for (const auto& part : split(rel, '/')) {
        if (part.empty() || part == ".") continue;
        if (part == "..") return false;
        for (unsigned char c : part)
            if (c < 32 || c == '<' || c == '>' || c == ':' || c == '"' || c == '|' || c == '?' || c == '*' || c == '\\')
                return false;
        out += (out.empty() ? L"" : L"\\") + W(part);
    }
    return !out.empty();
}

static std::string iconExt(const std::string& p) {
    std::string l = lowerA(p);
    size_t d = l.find_last_of('.');
    return d == std::string::npos ? ".png" : l.substr(d);
}

static void launchWorker(std::wstring path, HWND hwnd, std::wstring dataDir, std::wstring uiIcons, std::wstring appsDir) {
    auto r = std::make_unique<LaunchResult>();
    r->path = path;
    DWORD t0 = GetTickCount();
    [&]() {
        WIN32_FILE_ATTRIBUTE_DATA fa;
        if (!GetFileAttributesExW(longPath(path).c_str(), GetFileExInfoStandard, &fa)) {
            r->error = "File not found: " + U(path);
            return;
        }
        unsigned long long fsize = ((unsigned long long)fa.nFileSizeHigh << 32) | fa.nFileSizeLow;
        unsigned long long mtime = ((unsigned long long)fa.ftLastWriteTime.dwHighDateTime << 32) | fa.ftLastWriteTime.dwLowDateTime;

        apk::Archive outer, inner;
        if (!outer.openFile(U(path))) {
            r->error = outer.lastError();
            return;
        }
        const apk::Archive* arc = &outer;
        std::string innerName = apk::findInnerApk(outer);
        if (!innerName.empty()) {  // .xapk / .apks / .apkm bundle: use the base APK inside
            const apk::Entry* e = outer.find(innerName);
            std::wstring dir = dataDir + L"\\bundles";
            ensureDir(dir);
            std::wstring tmp = dir + L"\\" + W(hex8(fnv1a(lowerA(U(path)) + std::to_string(fsize) + std::to_string(mtime)))) + L".apk";
            if (!fileExists(tmp)) {
                HANDLE h = CreateFileW(longPath(tmp + L".part").c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
                bool ok = h != INVALID_HANDLE_VALUE && e && outer.extract(*e, [&](const void* b, size_t n) {
                    DWORD wr = 0;
                    return WriteFile(h, b, DWORD(n), &wr, nullptr) && wr == n;
                });
                if (h != INVALID_HANDLE_VALUE) CloseHandle(h);
                if (!ok || !MoveFileExW(longPath(tmp + L".part").c_str(), longPath(tmp).c_str(), MOVEFILE_REPLACE_EXISTING)) {
                    r->error = "Cannot unpack the bundle (" + innerName + ")";
                    return;
                }
            }
            if (!inner.openFile(U(tmp))) {
                r->error = inner.lastError();
                return;
            }
            arc = &inner;
        }

        std::string err;
        if (!apk::inspect(*arc, r->info, &err)) {
            r->error = err;
            return;
        }
        if (r->info.label.empty()) r->info.label = U(fileNameOf(path));
        r->host = hostFor(r->info.package, path);
        std::string id = U(r->host);
        std::string ver = hex8(fsize ^ mtime);

        // icons -> ui\icons (served by the launcher page)
        auto saveIcon = [&](const std::string& entry, const std::string& suffix, std::string& url) {
            if (entry.empty()) return;
            const apk::Entry* e = arc->find(entry);
            std::string data;
            if (!e || !arc->read(*e, data, 8u << 20)) return;
            std::string fname = id + suffix + iconExt(entry);
            if (writeFile(uiIcons + L"\\" + W(fname), data.data(), data.size())) {
                url = "https://player.example/icons/" + fname + "?v=" + ver;
                if (suffix.empty() && iconExt(entry) == ".png") r->iconPng = uiIcons + L"\\" + W(fname);
            }
        };
        saveIcon(r->info.icon, "", r->icon);
        saveIcon(r->info.iconFg, "-fg", r->iconFg);
        saveIcon(r->info.iconBg, "-bg", r->iconBg);

        if (r->info.kind == apk::Kind::Web) {
            std::wstring appDir = appsDir + L"\\" + r->host;
            std::wstring root = appDir + L"\\www";
            std::wstring stampPath = appDir + L"\\stamp.txt";
            std::string stamp = "v1|" + U(lowerW(path)) + "|" + std::to_string(fsize) + "|" + std::to_string(mtime) + "|" +
                                r->info.webRoot + "|" + r->info.entry;
            std::string old;
            readFileAll(stampPath, old);
            if (old != stamp || !dirExists(root)) {
                deleteTree(root);
                DeleteFileW(longPath(stampPath).c_str());
                if (!ensureDir(root)) {
                    r->error = "Cannot create the folder " + U(root);
                    return;
                }
                std::string prefix = r->info.webRoot + "/";
                size_t count = 0;
                for (const auto& e : arc->entries()) {
                    if (!startsWith(e.name, prefix)) continue;
                    std::wstring rel;
                    if (!safeRelPath(e.name.substr(prefix.size()), rel)) continue;
                    std::wstring dest = root + L"\\" + rel;
                    ensureDir(parentDir(dest));
                    HANDLE h = CreateFileW(longPath(dest).c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
                    if (h == INVALID_HANDLE_VALUE) continue;
                    bool ok = arc->extract(e, [&](const void* b, size_t n) {
                        DWORD wr = 0;
                        return WriteFile(h, b, DWORD(n), &wr, nullptr) && wr == n;
                    });
                    CloseHandle(h);
                    if (ok) count++;
                }
                if (!count) {
                    r->error = "Could not unpack the game files";
                    return;
                }
                writeText(stampPath, stamp);
                plog("extracted %zu files to %s", count, U(root).c_str());
            } else {
                plog("using cached files in %s", U(root).c_str());
            }
            r->root = root;
        }
        r->ok = true;
    }();
    r->seconds = (GetTickCount() - t0) / 1000.0;
    LaunchResult* raw = r.release();
    if (!PostMessageW(hwnd, WM_APP_LAUNCHED, 0, LPARAM(raw))) delete raw;
}

static void launchApk(const std::wstring& pathIn) {
    if (pathIn.empty()) return;
    std::wstring path = fullPath(pathIn);
    if (g.busy) {
        postToast("Please wait…");
        return;
    }
    if (!g.wv) {
        g.pendingLaunch = path;
        return;
    }
    plog("launch %s", U(path).c_str());
    g.busy = true;
    if (g.mode == Mode::Home) {
        std::string name = U(fileNameOf(path));
        if (LibItem* it = findItem(path)) name = it->name;
        postJson("{\"type\":\"status\",\"text\":" + q("Opening " + name + "…") + "}");
    }
    std::thread(launchWorker, path, g.hwnd, g.dataDir, g.iconsDir, g.appsDir).detach();
}

static void applyInputMode(bool touch, std::function<void()> done);

static void goHome() {
    if (!g.wv) return;
    if (g.fullscreen) setFullscreen(false);
    g.mode = Mode::Starting;  // becomes Home when the page says "ready"
    g.homeReady = false;
    SetWindowTextW(g.hwnd, APP_TITLE);
    setWindowIcons(nullptr, nullptr);
    if (ComPtr<ICoreWebView2_8> w8; SUCCEEDED(g.wv.As(&w8))) w8->put_IsMuted(FALSE);
    applyInputMode(false, [] {
        if (g.wv) g.wv->Navigate(L"https://player.example/home.html");
    });
}

// ---- input mode: PC (mouse + keyboard) or Touch (mouse acts as a finger, Android user agent)
static void applyInputMode(bool touch, std::function<void()> done) {
    g.touch = touch;
    if (!g.wv) return;
    ComPtr<ICoreWebView2Settings> s;
    ComPtr<ICoreWebView2Settings2> s2;
    if (SUCCEEDED(g.wv->get_Settings(&s)) && SUCCEEDED(s.As(&s2))) {
        if (touch) {
            std::wstring chrome = L"120.0.0.0";
            size_t p = g.defaultUA.find(L"Chrome/");
            if (p != std::wstring::npos) {
                size_t e = g.defaultUA.find(L' ', p);
                chrome = g.defaultUA.substr(p + 7, e == std::wstring::npos ? std::wstring::npos : e - p - 7);
            }
            std::wstring ua = L"Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like "
                              L"Gecko) Version/4.0 Chrome/" + chrome + L" Mobile Safari/537.36";
            s2->put_UserAgent(ua.c_str());
        } else {
            s2->put_UserAgent(g.defaultUA.c_str());
        }
    }
    std::wstring t = touch ? L"true" : L"false";
    std::wstring p1 = L"{\"enabled\":" + t + L",\"maxTouchPoints\":" + (touch ? L"5" : L"1") + L"}";
    std::wstring p2 = L"{\"enabled\":" + t + L",\"configuration\":\"mobile\"}";
    g.wv->CallDevToolsProtocolMethod(
        L"Emulation.setTouchEmulationEnabled", p1.c_str(),
        Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>([p2, done](HRESULT hr, LPCWSTR) -> HRESULT {
            if (FAILED(hr)) plog("setTouchEmulationEnabled failed 0x%08lx", (unsigned long)hr);
            if (!g.wv) return S_OK;
            g.wv->CallDevToolsProtocolMethod(
                L"Emulation.setEmitTouchEventsForMouse", p2.c_str(),
                Callback<ICoreWebView2CallDevToolsProtocolMethodCompletedHandler>([done](HRESULT hr2, LPCWSTR) -> HRESULT {
                    if (FAILED(hr2)) plog("setEmitTouchEventsForMouse failed 0x%08lx", (unsigned long)hr2);
                    if (done) done();
                    return S_OK;
                }).Get());
            return S_OK;
        }).Get());
}

static void startApp(std::unique_ptr<LaunchResult> r) {
    LibItem* it = findItem(r->path);
    bool touch = it && it->touch >= 0 ? it->touch == 1 : !r->info.keyboard;
    ComPtr<ICoreWebView2_3> w3;
    std::wstring url;
    if (r->info.kind == apk::Kind::Web) {
        if (FAILED(g.wv.As(&w3))) {
            postJson("{\"type\":\"error\",\"text\":\"Your WebView2 Runtime is too old. Please update Microsoft Edge WebView2.\"}");
            return;
        }
        if (!g.appHost.empty() && g.appHost != r->host) w3->ClearVirtualHostNameToFolderMapping(g.appHost.c_str());
        HRESULT hr = w3->SetVirtualHostNameToFolderMapping(r->host.c_str(), r->root.c_str(),
                                                           COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
        if (FAILED(hr)) {
            postJson("{\"type\":\"error\",\"text\":\"Cannot map the game folder (0x" + hex8(uint64_t(hr)) + ")\"}");
            return;
        }
        g.appHost = r->host;
        // percent-encode spaces and non-ASCII characters of the entry path
        std::string enc;
        for (unsigned char c : r->info.entry) {
            if (c <= 0x20 || c >= 0x7f) {
                char b[4];
                snprintf(b, sizeof b, "%%%02X", c);
                enc += b;
            } else {
                enc += char(c);
            }
        }
        url = L"https://" + r->host + L"/" + W(enc);
    } else {
        url = W(r->info.remoteUrl);
    }
    g.mode = Mode::Game;
    SetWindowTextW(g.hwnd, (W(r->info.label) + L"  -  " APP_TITLE).c_str());
    if (g.gameIconBig) DestroyIcon(g.gameIconBig);
    if (g.gameIconSmall) DestroyIcon(g.gameIconSmall);
    g.gameIconBig = g.gameIconSmall = nullptr;
    std::string png;
    if (!r->iconPng.empty() && readFileAll(r->iconPng, png, 4u << 20)) {
        g.gameIconBig = iconFromPng(png, GetSystemMetrics(SM_CXICON));
        g.gameIconSmall = iconFromPng(png, GetSystemMetrics(SM_CXSMICON));
    }
    setWindowIcons(g.gameIconBig, g.gameIconSmall);
    sizeForOrientation(r->info.orientation);
    plog("navigate %s (touch=%d, %.2fs)", U(url).c_str(), int(touch), r->seconds);
    g.current = std::move(r);
    applyInputMode(touch, [url] {
        if (!g.wv || g.mode != Mode::Game) return;
        g.wv->Navigate(url.c_str());
        if (g.ctrl) g.ctrl->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    });
}

static void onLaunched(std::unique_ptr<LaunchResult> r) {
    g.busy = false;
    if (!r->ok) {
        plog("launch failed: %s", r->error.c_str());
        if (g.mode == Mode::Game) goHome();
        postHome("{\"type\":\"error\",\"text\":" + q(r->error) + ",\"path\":" + qw(r->path) + "}");
        if (g.smoke) {
            g.exitCode = 1;
            writeText(g.smokeOut + L"\\error.txt", r->error);
            PostQuitMessage(1);
        }
        return;
    }
    // remember in the library
    LibItem* it = findItem(r->path);
    if (!it) {
        g.lib.push_back(LibItem());
        it = &g.lib.back();
        it->path = r->path;
    }
    it->pkg = r->info.package;
    it->name = r->info.label;
    it->kind = apk::kindName(r->info.kind);
    it->framework = r->info.framework;
    it->version = r->info.versionName;
    it->icon = r->icon;
    it->iconFg = r->iconFg;
    it->iconBg = r->iconBg;
    it->iconBgColor.clear();
    if (r->info.hasIconBgColor) {
        char b[16];
        snprintf(b, sizeof b, "#%06x", (unsigned)(r->info.iconBgColor & 0xffffff));
        it->iconBgColor = b;
    }
    it->keyboard = r->info.keyboard;
    it->orientation = r->info.orientation;
    it->last = (long long)time(nullptr);
    std::string itJson = itemJson(*it);
    saveLibrary();
    plog("inspected: %s", apk::toJson(r->info).c_str());

    if (r->info.kind == apk::Kind::Web || r->info.kind == apk::Kind::Remote) {
        startApp(std::move(r));
        return;
    }
    // native app: explain on the launcher page
    if (g.mode == Mode::Game) goHome();
    postHome(libraryJson());
    postHome("{\"type\":\"native\",\"item\":" + itJson + ",\"info\":" + apk::toJson(r->info) + "}");
    if (g.smoke && g.smokeStep == 4) {
        g.smokeStep = 5;
        SetTimer(g.hwnd, TIMER_SMOKE, 1500, nullptr);
    }
}

// ============================================================ dialogs, shortcuts
static std::wstring pickApkFile() {
    std::wstring buf(32768, L'\0');
    OPENFILENAMEW ofn{};
    ofn.lStructSize = sizeof ofn;
    ofn.hwndOwner = g.hwnd;
    ofn.lpstrFilter = L"Android apps (*.apk, *.xapk, *.apks, *.apkm)\0*.apk;*.xapk;*.apks;*.apkm\0All files (*.*)\0*.*\0";
    ofn.lpstrFile = &buf[0];
    ofn.nMaxFile = DWORD(buf.size());
    ofn.lpstrTitle = L"Choose an APK to play";
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_EXPLORER | OFN_HIDEREADONLY;
    if (!GetOpenFileNameW(&ofn)) return std::wstring();
    buf.resize(wcslen(buf.c_str()));
    return buf;
}

static std::wstring pngToIco(const std::wstring& pngPath) {
    std::string png;
    if (!readFileAll(pngPath, png, 4u << 20) || png.size() < 24 || png.compare(1, 3, "PNG") != 0) return std::wstring();
    auto be32 = [&](size_t o) {
        return (uint32_t(uint8_t(png[o])) << 24) | (uint32_t(uint8_t(png[o + 1])) << 16) | (uint32_t(uint8_t(png[o + 2])) << 8) |
               uint32_t(uint8_t(png[o + 3]));
    };
    uint32_t w = be32(16), h = be32(20);
    std::string ico(22, '\0');
    ico[2] = 1;  // type: icon
    ico[4] = 1;  // count
    ico[6] = char(w >= 256 ? 0 : w);
    ico[7] = char(h >= 256 ? 0 : h);
    ico[10] = 1;   // planes
    ico[12] = 32;  // bpp
    uint32_t sz = uint32_t(png.size());
    memcpy(&ico[14], &sz, 4);
    uint32_t off = 22;
    memcpy(&ico[18], &off, 4);
    ico += png;
    std::wstring out = pngPath.substr(0, pngPath.size() - 4) + L".ico";
    return writeFile(out, ico.data(), ico.size()) ? out : std::wstring();
}

static void createShortcut(const std::wstring& apkPath) {
    LibItem* it = findItem(apkPath);
    if (!it) return;
    std::wstring desktop = knownFolder(FOLDERID_Desktop);
    std::wstring name = W(it->name);
    for (auto& c : name)
        if (wcschr(L"\\/:*?\"<>|", c) || c < 32) c = L'_';
    if (name.empty()) name = L"APK game";
    ComPtr<IShellLinkW> link;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(link.GetAddressOf())))) return;
    link->SetPath(exePath().c_str());
    link->SetArguments((L"\"" + apkPath + L"\"").c_str());
    link->SetWorkingDirectory(parentDir(apkPath).c_str());
    link->SetDescription((L"Play " + W(it->name) + L" with " APP_TITLE).c_str());
    // icon: <icons>\<host>.png -> .ico
    std::wstring ico;
    if (!it->icon.empty() && it->icon.find(".png") != std::string::npos) {
        std::string fname = it->icon.substr(it->icon.rfind('/') + 1);
        fname = fname.substr(0, fname.find('?'));
        ico = pngToIco(g.iconsDir + L"\\" + W(fname));
    }
    link->SetIconLocation(ico.empty() ? exePath().c_str() : ico.c_str(), 0);
    ComPtr<IPersistFile> pf;
    std::wstring lnk = desktop + L"\\" + name + L".lnk";
    bool ok = SUCCEEDED(link.As(&pf)) && SUCCEEDED(pf->Save(lnk.c_str(), TRUE));
    postToast(ok ? "Shortcut created on your Desktop: " + U(name) : "Could not create the shortcut");
}

static void openExternal(const std::wstring& url) {
    std::wstring l = lowerW(url);
    if (l.compare(0, 7, L"http://") == 0 || l.compare(0, 8, L"https://") == 0 || l.compare(0, 7, L"mailto:") == 0)
        ShellExecuteW(g.hwnd, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

// ============================================================ smoke test (used by CI)
static void capture(const std::wstring& file, std::function<void()> next) {
    if (!g.wv) return;
    g.captureStream.Reset();
    if (FAILED(SHCreateStreamOnFileEx(file.c_str(), STGM_READWRITE | STGM_CREATE | STGM_SHARE_DENY_WRITE, FILE_ATTRIBUTE_NORMAL,
                                      TRUE, nullptr, &g.captureStream))) {
        plog("capture: cannot create %s", U(file).c_str());
        next();
        return;
    }
    g.wv->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, g.captureStream.Get(),
                         Callback<ICoreWebView2CapturePreviewCompletedHandler>([file, next](HRESULT hr) -> HRESULT {
                             g.captureStream.Reset();
                             plog("capture %s -> 0x%08lx", U(file).c_str(), (unsigned long)hr);
                             next();
                             return S_OK;
                         }).Get());
}

static const wchar_t* kProbe =
    LR"JS((function(){var gl=null;try{var c=document.createElement('canvas');var x=c.getContext('webgl2')||c.getContext('webgl');
if(x){var d=x.getExtension('WEBGL_debug_renderer_info');gl=(x.getParameter(x.VERSION)+' / '+(d?x.getParameter(d.UNMASKED_RENDERER_WEBGL):''));}}catch(e){gl='error '+e}
var prev=null,st=null;try{prev=localStorage.getItem('__neurio_probe');localStorage.setItem('__neurio_probe','1');st=localStorage.getItem('__neurio_probe')==='1';}catch(e){st=String(e)}
return JSON.stringify({url:location.href,title:document.title,canvases:document.querySelectorAll('canvas').length,
size:[innerWidth,innerHeight],dpr:devicePixelRatio,ua:navigator.userAgent,maxTouchPoints:navigator.maxTouchPoints,ontouchstart:('ontouchstart' in window),
webgl:gl,storage:st,storagePrev:prev,errors:(window.__neurioErrors||[]).slice(0,20),
text:(document.body?document.body.innerText:'').replace(/\s+/g,' ').slice(0,400)});})())JS";

static void smokeAdvance() {
    KillTimer(g.hwnd, TIMER_SMOKE);
    switch (g.smokeStep) {
        case 2:  // game has been running for a while: probe + screenshot, then go home
            g.smokeStep = 3;
            g.wv->ExecuteScript(kProbe, Callback<ICoreWebView2ExecuteScriptCompletedHandler>([](HRESULT hr, LPCWSTR json) -> HRESULT {
                                    writeText(g.smokeOut + L"\\game.json", SUCCEEDED(hr) && json ? U(json) : std::string("null"));
                                    capture(g.smokeOut + L"\\game.png", [] {
                                        // also exercise the in-game hint toast + F2 style switch is not needed in CI
                                        goHome();
                                    });
                                    return S_OK;
                                }).Get());
            break;
        case 3:  // back on the launcher: screenshot it
            capture(g.smokeOut + L"\\home.png", [] {
                if (!g.smokeNative.empty()) {
                    g.smokeStep = 4;
                    launchApk(g.smokeNative);
                } else {
                    PostQuitMessage(0);
                }
            });
            break;
        case 5:  // native APK explanation dialog
            capture(g.smokeOut + L"\\native.png", [] { PostQuitMessage(0); });
            break;
    }
}

// ============================================================ WebView2 setup
static const wchar_t* kInjected = LR"JS(
(function(){
  if (location.hostname === 'player.example') return;
  try {
    window.__neurioErrors = [];
    addEventListener('error', function(e){ try { __neurioErrors.push(String(e.message || e)); } catch(_){} });
    addEventListener('unhandledrejection', function(e){ try { __neurioErrors.push('promise: ' + String(e.reason)); } catch(_){} });
    // Cordova's Android bridge talks to Java through prompt('...', 'gap:...'). There is no Java here:
    // answer silently so cordova.js boots and fires 'deviceready' instead of showing dialogs.
    var nativePrompt = window.prompt;
    window.prompt = function(msg, def){
      if (typeof def === 'string' && def.slice(0, 3) === 'gap') return '';
      return nativePrompt.apply(window, arguments);
    };
    window.NeurioPlayer = { version: '1.0.0', platform: 'windows' };
  } catch (e) {}
})();
)JS";

static void onWebMessage(const std::wstring& msg, ICoreWebView2WebMessageReceivedEventArgs* args) {
    size_t tab = msg.find(L'\t');
    std::wstring cmd = msg.substr(0, tab), arg = tab == std::wstring::npos ? std::wstring() : msg.substr(tab + 1);
    if (cmd == L"ready") {
        g.mode = Mode::Home;
        g.homeReady = true;
        postJson(libraryJson());
        for (const auto& pm : g.pendingHome) postJson(pm);
        g.pendingHome.clear();
        if (!g.pendingLaunch.empty()) {
            std::wstring p = g.pendingLaunch;
            g.pendingLaunch.clear();
            launchApk(p);
        }
        if (g.smoke && g.smokeStep == 3) SetTimer(g.hwnd, TIMER_SMOKE, 2000, nullptr);
    } else if (cmd == L"open") {
        std::wstring p = pickApkFile();
        if (!p.empty()) launchApk(p);
    } else if (cmd == L"launch") {
        launchApk(arg);
    } else if (cmd == L"remove") {
        g.lib.erase(std::remove_if(g.lib.begin(), g.lib.end(), [&](const LibItem& i) { return lowerW(i.path) == lowerW(arg); }),
                    g.lib.end());
        saveLibrary();
        postJson(libraryJson());
    } else if (cmd == L"shortcut") {
        createShortcut(arg);
    } else if (cmd == L"folder") {
        std::wstring p = L"/select,\"" + arg + L"\"";
        ShellExecuteW(g.hwnd, L"open", L"explorer.exe", p.c_str(), nullptr, SW_SHOWNORMAL);
    } else if (cmd == L"link") {
        openExternal(arg);
    } else if (cmd == L"touch") {  // set input mode for an item: "path\t0|1|-1"
        size_t t2 = arg.find(L'\t');
        if (t2 != std::wstring::npos)
            if (LibItem* it = findItem(arg.substr(0, t2))) {
                it->touch = _wtoi(arg.substr(t2 + 1).c_str());
                saveLibrary();
                postJson(libraryJson());
            }
    } else if (cmd == L"drop") {
        ComPtr<ICoreWebView2WebMessageReceivedEventArgs2> a2;
        ComPtr<ICoreWebView2ObjectCollectionView> objs;
        std::wstring found;
        if (args && SUCCEEDED(args->QueryInterface(IID_PPV_ARGS(a2.GetAddressOf()))) && SUCCEEDED(a2->get_AdditionalObjects(&objs)) && objs) {
            UINT32 n = 0;
            objs->get_Count(&n);
            for (UINT32 i = 0; i < n && found.empty(); i++) {
                ComPtr<IUnknown> obj;
                ComPtr<ICoreWebView2File> file;
                if (SUCCEEDED(objs->GetValueAtIndex(i, &obj)) && obj && SUCCEEDED(obj.As(&file))) {
                    LPWSTR p = nullptr;
                    if (SUCCEEDED(file->get_Path(&p)) && p) {
                        if (isApkPath(p)) found = p;
                        CoTaskMemFree(p);
                    }
                }
            }
        }
        if (!found.empty()) launchApk(found);
        else postToast("That is not an APK file (.apk / .xapk)");
    }
}

static void setupWebView() {
    ComPtr<ICoreWebView2Settings> s;
    g.wv->get_Settings(&s);
    s->put_IsScriptEnabled(TRUE);
    s->put_IsWebMessageEnabled(TRUE);
    s->put_AreDefaultScriptDialogsEnabled(TRUE);
    s->put_IsStatusBarEnabled(FALSE);
    s->put_AreDevToolsEnabled(TRUE);
    s->put_AreDefaultContextMenusEnabled(g.devtools ? TRUE : FALSE);
    s->put_IsZoomControlEnabled(FALSE);
    s->put_IsBuiltInErrorPageEnabled(TRUE);
    if (ComPtr<ICoreWebView2Settings2> s2; SUCCEEDED(s.As(&s2))) {
        LPWSTR ua = nullptr;
        if (SUCCEEDED(s2->get_UserAgent(&ua)) && ua) {
            g.defaultUA = ua;
            CoTaskMemFree(ua);
        }
    }
    if (ComPtr<ICoreWebView2Settings3> s3; SUCCEEDED(s.As(&s3))) s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
    if (ComPtr<ICoreWebView2Settings4> s4; SUCCEEDED(s.As(&s4))) {
        s4->put_IsPasswordAutosaveEnabled(FALSE);
        s4->put_IsGeneralAutofillEnabled(FALSE);
    }
    if (ComPtr<ICoreWebView2Settings5> s5; SUCCEEDED(s.As(&s5))) s5->put_IsPinchZoomEnabled(FALSE);
    if (ComPtr<ICoreWebView2Settings6> s6; SUCCEEDED(s.As(&s6))) s6->put_IsSwipeNavigationEnabled(FALSE);
    if (ComPtr<ICoreWebView2Controller2> c2; SUCCEEDED(g.ctrl.As(&c2))) c2->put_DefaultBackgroundColor(COREWEBVIEW2_COLOR{255, 11, 16, 32});

    ComPtr<ICoreWebView2_3> w3;
    if (FAILED(g.wv.As(&w3))) {
        MessageBoxW(g.hwnd, L"Your Microsoft Edge WebView2 Runtime is too old.\nPlease update it from https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                    APP_TITLE, MB_ICONERROR);
        PostQuitMessage(1);
        return;
    }
    w3->SetVirtualHostNameToFolderMapping(kHomeHost, g.uiDir.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
    g.wv->AddScriptToExecuteOnDocumentCreated(
        kInjected, Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>([](HRESULT hr, LPCWSTR) -> HRESULT {
                       if (FAILED(hr)) plog("AddScriptToExecuteOnDocumentCreated failed 0x%08lx", (unsigned long)hr);
                       return S_OK;
                   }).Get());

    EventRegistrationToken tok;
    g.wv->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                     [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                         LPWSTR src = nullptr;
                                         args->get_Source(&src);
                                         std::wstring source = src ? src : L"";
                                         CoTaskMemFree(src);
                                         // only the launcher page may control the player
                                         if (source.compare(0, 23, L"https://player.example/") != 0) return S_OK;
                                         LPWSTR m = nullptr;
                                         if (SUCCEEDED(args->TryGetWebMessageAsString(&m)) && m) {
                                             std::wstring msg = m;
                                             CoTaskMemFree(m);
                                             onWebMessage(msg, args);
                                         }
                                         return S_OK;
                                     })
                                     .Get(),
                                 &tok);

    g.wv->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
            LPWSTR u = nullptr;
            args->get_Uri(&u);
            std::wstring uri = u ? u : L"";
            CoTaskMemFree(u);
            std::wstring l = lowerW(uri);
            if (l.compare(0, 5, L"file:") == 0) {  // a file was dropped on the window
                args->put_Cancel(TRUE);
                wchar_t path[32768];
                DWORD n = 32768;
                if (SUCCEEDED(PathCreateFromUrlW(uri.c_str(), path, &n, 0)) && isApkPath(path)) launchApk(path);
                return S_OK;
            }
            if (l.compare(0, 9, L"market://") == 0) {
                args->put_Cancel(TRUE);
                size_t idp = uri.find(L"id=");
                if (idp != std::wstring::npos)
                    openExternal(L"https://play.google.com/store/apps/details?id=" + uri.substr(idp + 3, uri.find(L'&', idp) - idp - 3));
                return S_OK;
            }
            if (l.compare(0, 7, L"intent:") == 0 || l.compare(0, 4, L"tel:") == 0 || l.compare(0, 4, L"sms:") == 0 ||
                l.compare(0, 9, L"whatsapp:") == 0 || l.compare(0, 7, L"mailto:") == 0) {
                args->put_Cancel(TRUE);
                size_t fb = uri.find(L"S.browser_fallback_url=");
                if (fb != std::wstring::npos) {
                    std::wstring enc = uri.substr(fb + 23, uri.find(L';', fb) - fb - 23);
                    wchar_t dec[4096];
                    DWORD dn = 4096;
                    wcsncpy_s(dec, enc.c_str(), _TRUNCATE);
                    UrlUnescapeW(dec, nullptr, &dn, URL_UNESCAPE_INPLACE);
                    openExternal(dec);
                } else if (l.compare(0, 7, L"mailto:") == 0) {
                    openExternal(uri);
                }
                return S_OK;
            }
            // A local game that navigates the whole window to a web site ("more games", ads...):
            // open it in the normal browser and keep the game running.
            if (g.mode == Mode::Game && g.current && g.current->info.kind == apk::Kind::Web &&
                (l.compare(0, 7, L"http://") == 0 || l.compare(0, 8, L"https://") == 0)) {
                std::wstring host = l.substr(l.find(L"//") + 2);
                host = host.substr(0, host.find_first_of(L"/:?#"));
                if (host != lowerW(g.appHost) && host != L"player.example") {
                    args->put_Cancel(TRUE);
                    openExternal(uri);
                }
            }
            return S_OK;
        }).Get(),
        &tok);

    g.wv->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>([](ICoreWebView2* sender, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
            BOOL ok = FALSE;
            args->get_IsSuccess(&ok);
            COREWEBVIEW2_WEB_ERROR_STATUS st = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
            args->get_WebErrorStatus(&st);
            LPWSTR src = nullptr;
            sender->get_Source(&src);
            std::wstring source = src ? src : L"";
            CoTaskMemFree(src);
            plog("navigation completed: %s ok=%d status=%d", U(source).c_str(), int(ok), int(st));
            if (g.mode == Mode::Game && source.find(L"player.example") == std::wstring::npos) {
                if (ok) {
                    SetTimer(g.hwnd, TIMER_HINT, 900, nullptr);
                    if (g.smoke && g.smokeStep == 1) {
                        g.smokeStep = 2;
                        SetTimer(g.hwnd, TIMER_SMOKE, 12000, nullptr);
                    }
                }
            }
            return S_OK;
        }).Get(),
        &tok);

    g.wv->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            LPWSTR u = nullptr;
            args->get_Uri(&u);
            std::wstring uri = u ? u : L"";
            CoTaskMemFree(u);
            args->put_Handled(TRUE);  // never open extra WebView windows
            openExternal(uri);
            return S_OK;
        }).Get(),
        &tok);

    g.wv->add_ContainsFullScreenElementChanged(
        Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>([](ICoreWebView2* sender, IUnknown*) -> HRESULT {
            BOOL fs = FALSE;
            sender->get_ContainsFullScreenElement(&fs);
            setFullscreen(fs != FALSE);
            return S_OK;
        }).Get(),
        &tok);

    g.wv->add_ProcessFailed(
        Callback<ICoreWebView2ProcessFailedEventHandler>([](ICoreWebView2* sender, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_PROCESS_FAILED_KIND kind;
            args->get_ProcessFailedKind(&kind);
            plog("process failed: kind=%d", int(kind));
            if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED) {
                MessageBoxW(g.hwnd, L"The browser engine stopped unexpectedly. Please restart Neurio APK Player.", APP_TITLE, MB_ICONERROR);
                PostQuitMessage(2);
            } else if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED) {
                sender->Reload();
            }
            return S_OK;
        }).Get(),
        &tok);

    g.ctrl->add_AcceleratorKeyPressed(
        Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>([](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_KEY_EVENT_KIND kind;
            args->get_KeyEventKind(&kind);
            if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN) return S_OK;
            UINT key = 0;
            args->get_VirtualKey(&key);
            COREWEBVIEW2_PHYSICAL_KEY_STATUS ks{};
            args->get_PhysicalKeyStatus(&ks);
            bool ctrl = GetKeyState(VK_CONTROL) < 0, alt = GetKeyState(VK_MENU) < 0, shift = GetKeyState(VK_SHIFT) < 0;
            bool mine = key == VK_F11 || key == VK_F1 || key == VK_F2 || key == VK_F5 || key == VK_F12 || (alt && key == VK_RETURN) ||
                        (ctrl && (key == 'M' || key == 'R')) || (ctrl && shift && key == 'I');
            if (!mine) return S_OK;
            args->put_Handled(TRUE);
            if (ks.WasKeyDown) return S_OK;  // ignore auto-repeat
            if (key == VK_F11 || key == VK_RETURN) {
                toggleFullscreen();
            } else if (key == VK_F1) {
                if (g.mode == Mode::Game) goHome();
            } else if (key == VK_F2) {
                if (g.mode == Mode::Game && g.current) {
                    bool t = !g.touch;
                    if (LibItem* it = findItem(g.current->path)) {
                        it->touch = t ? 1 : 0;
                        saveLibrary();
                    }
                    applyInputMode(t, [] {
                        if (g.wv) g.wv->Reload();
                    });
                }
            } else if (key == VK_F5 || key == 'R') {
                g.wv->Reload();
            } else if (key == VK_F12 || key == 'I') {
                g.wv->OpenDevToolsWindow();
            } else if (key == 'M') {
                ComPtr<ICoreWebView2_8> w8;
                if (SUCCEEDED(g.wv.As(&w8))) {
                    BOOL m = FALSE;
                    w8->get_IsMuted(&m);
                    w8->put_IsMuted(!m);
                    pageToast(m ? L"Sound ON" : L"Sound OFF  (Ctrl+M)", 1500);
                }
            }
            return S_OK;
        }).Get(),
        &tok);

    resizeWebView();
    g.ctrl->put_IsVisible(TRUE);
    g.ctrl->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    g.wv->Navigate(L"https://player.example/home.html");
}

static void missingRuntime() {
    int r = MessageBoxW(g.hwnd,
                        L"Bach yekhdem had l-programme khassek \"Microsoft Edge WebView2 Runtime\" (bator, mn Microsoft).\n"
                        L"Clicki OK bach t-telechargih, installih, o 3awed 7el Neurio APK Player.\n\n"
                        L"This app needs the free Microsoft Edge WebView2 Runtime (already included in Windows 11).\n"
                        L"Click OK to download it, install it, then start Neurio APK Player again.",
                        APP_TITLE, MB_OKCANCEL | MB_ICONINFORMATION);
    if (r == IDOK) ShellExecuteW(nullptr, L"open", L"https://go.microsoft.com/fwlink/p/?LinkId=2124703", nullptr, nullptr, SW_SHOWNORMAL);
    PostQuitMessage(3);
}

static void initWebView() {
    LPWSTR ver = nullptr;
    HRESULT hv = GetAvailableCoreWebView2BrowserVersionString(nullptr, &ver);
    if (FAILED(hv) || !ver) {
        plog("WebView2 runtime not found (0x%08lx)", (unsigned long)hv);
        missingRuntime();
        return;
    }
    plog("WebView2 runtime %s", U(ver).c_str());
    CoTaskMemFree(ver);
    // Android WebViews let games start audio without a tap; use the GPU even on older (blocklisted) drivers,
    // and fall back to software WebGL (SwiftShader) on PCs without a usable GPU driver so 3D games still start.
    // (Passed through the documented environment variable so no minimum runtime version is imposed.)
    wchar_t existing[2048] = L"";
    GetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", existing, 2048);
    std::wstring argsW = L"--autoplay-policy=no-user-gesture-required --ignore-gpu-blocklist --enable-unsafe-swiftshader";
    if (existing[0]) argsW += L" " + std::wstring(existing);
    SetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", argsW.c_str());
    std::wstring udf = g.dataDir + L"\\WebView2";
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, udf.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([](HRESULT res, ICoreWebView2Environment* env) -> HRESULT {
            if (FAILED(res) || !env) {
                plog("CreateCoreWebView2Environment failed 0x%08lx", (unsigned long)res);
                if (res == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)) missingRuntime();
                else {
                    wchar_t b[256];
                    swprintf_s(b, L"Cannot start the WebView2 engine (error 0x%08lX).", (unsigned long)res);
                    MessageBoxW(g.hwnd, b, APP_TITLE, MB_ICONERROR);
                    PostQuitMessage(1);
                }
                return S_OK;
            }
            g.env = env;
            env->CreateCoreWebView2Controller(
                g.hwnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>([](HRESULT res2, ICoreWebView2Controller* c) -> HRESULT {
                            if (FAILED(res2) || !c) {
                                plog("CreateCoreWebView2Controller failed 0x%08lx", (unsigned long)res2);
                                wchar_t b[256];
                                swprintf_s(b, L"Cannot create the WebView2 window (error 0x%08lX).", (unsigned long)res2);
                                MessageBoxW(g.hwnd, b, APP_TITLE, MB_ICONERROR);
                                PostQuitMessage(1);
                                return S_OK;
                            }
                            g.ctrl = c;
                            g.ctrl->get_CoreWebView2(&g.wv);
                            setupWebView();
                            return S_OK;
                        }).Get());
            return S_OK;
        }).Get());
    if (FAILED(hr)) {
        plog("CreateCoreWebView2EnvironmentWithOptions returned 0x%08lx", (unsigned long)hr);
        if (hr == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)) missingRuntime();
    }
}

// ============================================================ window procedure
static bool handleKey(WPARAM vk) {
    bool alt = GetKeyState(VK_MENU) < 0;
    if (vk == VK_F11 || (alt && vk == VK_RETURN)) {
        toggleFullscreen();
        return true;
    }
    if (vk == VK_F1 && g.mode == Mode::Game) {
        goHome();
        return true;
    }
    return false;
}

static LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
        case WM_SIZE:
            if (g.ctrl) {
                if (wp == SIZE_MINIMIZED) {
                    g.ctrl->put_IsVisible(FALSE);  // pauses rendering + fires visibilitychange (games pause)
                } else {
                    g.ctrl->put_IsVisible(TRUE);
                    resizeWebView();
                }
            }
            return 0;
        case WM_MOVE:
        case WM_MOVING:
            if (g.ctrl) g.ctrl->NotifyParentWindowPositionChanged();
            break;
        case WM_SETFOCUS:
        case WM_ACTIVATE:
            if (g.ctrl && (msg == WM_SETFOCUS || LOWORD(wp) != WA_INACTIVE))
                g.ctrl->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            break;
        case WM_DPICHANGED: {
            RECT* r = reinterpret_cast<RECT*>(lp);
            SetWindowPos(h, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
            return 0;
        }
        case WM_GETMINMAXINFO: {
            auto* mm = reinterpret_cast<MINMAXINFO*>(lp);
            mm->ptMinTrackSize.x = 360;
            mm->ptMinTrackSize.y = 300;
            return 0;
        }
        case WM_KEYDOWN:
        case WM_SYSKEYDOWN:
            if (handleKey(wp)) return 0;
            break;
        case WM_TIMER:
            if (wp == TIMER_SMOKE) smokeAdvance();
            else if (wp == TIMER_WATCHDOG) {
                plog("smoke test timeout at step %d", g.smokeStep);
                writeText(g.smokeOut + L"\\error.txt", "timeout at step " + std::to_string(g.smokeStep));
                g.exitCode = 4;
                PostQuitMessage(4);
            } else if (wp == TIMER_HINT) {
                KillTimer(h, TIMER_HINT);
                if (g.mode == Mode::Game)
                    pageToast(std::wstring(L"F11 Fullscreen   \u2022   F2 ") + (g.touch ? L"Touch mode: ON (mouse = finger)" : L"Touch mode: OFF (keyboard + mouse)") +
                                  L"   \u2022   F1 Library",
                              4500);
            }
            return 0;
        case WM_APP_LAUNCHED:
            onLaunched(std::unique_ptr<LaunchResult>(reinterpret_cast<LaunchResult*>(lp)));
            if (g.smoke && g.smokeStep == 0 && g.mode == Mode::Game) g.smokeStep = 1;
            return 0;
        case WM_CLOSE:
            if (g.ctrl) {
                g.ctrl->Close();
                g.ctrl.Reset();
                g.wv.Reset();
            }
            DestroyWindow(h);
            return 0;
        case WM_DESTROY:
            PostQuitMessage(g.exitCode);
            return 0;
    }
    return DefWindowProcW(h, msg, wp, lp);
}

// ============================================================ entry point
static bool writeHomeUi() {
    HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(IDR_HOME_HTML), RT_RCDATA);
    if (!res) return false;
    HGLOBAL mem = LoadResource(nullptr, res);
    const void* data = mem ? LockResource(mem) : nullptr;
    DWORD size = SizeofResource(nullptr, res);
    if (!data || !size) return false;
    ensureDir(g.uiDir);
    ensureDir(g.iconsDir);
    return writeFile(g.uiDir + L"\\home.html", data, size);
}

static int runInspect(const std::wstring& apkPath, const std::wstring& outPath) {
    apk::Archive a, inner;
    std::string json;
    bool ok = false;
    if (!a.openFile(U(apkPath))) {
        json = "{\"error\":" + q(a.lastError()) + "}";
    } else {
        const apk::Archive* use = &a;
        std::string innerName = apk::findInnerApk(a), buf;
        if (!innerName.empty()) {
            const apk::Entry* e = a.find(innerName);
            if (e && a.read(*e, buf, 1ull << 31) && inner.openMemory(buf.data(), buf.size())) use = &inner;
        }
        apk::Info info;
        std::string err;
        ok = apk::inspect(*use, info, &err);
        json = ok ? apk::toJson(info) : "{\"error\":" + q(err) + "}";
    }
    if (outPath.empty()) {
        MessageBoxW(nullptr, W(json).c_str(), APP_TITLE, MB_OK);
        return 0;
    }
    if (!writeText(outPath, json + "\n")) return 1;
    return ok ? 0 : 3;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int show) {
    g.inst = inst;
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::vector<std::wstring> args;
    for (int i = 1; i < argc; i++) args.push_back(argv[i]);
    LocalFree(argv);

    if (args.size() >= 1 && args[0] == L"--inspect") return runInspect(args.size() > 1 ? args[1] : L"", args.size() > 2 ? args[2] : L"");

    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 1;

    for (size_t i = 0; i < args.size(); i++) {
        if (args[i] == L"--smoke-test" && i + 2 < args.size()) {
            g.smoke = true;
            g.smokeApk = fullPath(args[i + 1]);
            g.smokeOut = fullPath(args[i + 2]);
            if (i + 3 < args.size() && args[i + 3].compare(0, 2, L"--") != 0) g.smokeNative = fullPath(args[i + 3]);
            break;
        } else if (args[i] == L"--devtools") {
            g.devtools = true;
        } else if (args[i].compare(0, 2, L"--") != 0 && g.pendingLaunch.empty()) {
            g.pendingLaunch = fullPath(args[i]);
        }
    }

    // data folder: portable mode when "portable.txt" sits next to the exe
    std::wstring exeDir = parentDir(exePath());
    if (fileExists(exeDir + L"\\portable.txt")) g.dataDir = exeDir + L"\\NeurioApkPlayerData";
    else g.dataDir = knownFolder(FOLDERID_LocalAppData) + L"\\NeurioApkPlayer";
    if (g.smoke) {
        ensureDir(g.smokeOut);
        g.dataDir = parentDir(g.smokeOut) + L"\\smoke-data";
    }
    g.uiDir = g.dataDir + L"\\ui";
    g.iconsDir = g.uiDir + L"\\icons";
    g.appsDir = g.dataDir + L"\\apps";
    ensureDir(g.dataDir);
    ensureDir(g.appsDir);
    g.logPath = g.dataDir + L"\\player.log";
    DeleteFileW(g.logPath.c_str());
    plog("Neurio APK Player " APP_VERSION " starting, data=%s", U(g.dataDir).c_str());
    if (!writeHomeUi()) plog("warning: cannot write the launcher page");
    loadLibrary();
    if (g.smoke) g.pendingLaunch = g.smokeApk;

    g.appIconBig = static_cast<HICON>(LoadImageW(inst, MAKEINTRESOURCEW(IDI_APP), IMAGE_ICON, GetSystemMetrics(SM_CXICON),
                                                 GetSystemMetrics(SM_CYICON), 0));
    g.appIconSmall = static_cast<HICON>(LoadImageW(inst, MAKEINTRESOURCEW(IDI_APP), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON),
                                                   GetSystemMetrics(SM_CYSMICON), 0));
    WNDCLASSEXW wc{sizeof wc};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = inst;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(11, 16, 32));
    wc.lpszClassName = L"NeurioApkPlayerWindow";
    wc.hIcon = g.appIconBig;
    wc.hIconSm = g.appIconSmall;
    RegisterClassExW(&wc);

    g.hwnd = CreateWindowExW(0, wc.lpszClassName, APP_TITLE, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1100, 700, nullptr,
                             nullptr, inst, nullptr);
    if (!g.hwnd) return 1;
    {  // initial size: 1040x680 DIPs, centered
        double s = dpiOf(g.hwnd) / 96.0;
        MONITORINFO mi{sizeof mi};
        GetMonitorInfoW(MonitorFromWindow(g.hwnd, MONITOR_DEFAULTTOPRIMARY), &mi);
        int ww = std::min(int(1040 * s), int(mi.rcWork.right - mi.rcWork.left) - 40);
        int hh = std::min(int(680 * s), int(mi.rcWork.bottom - mi.rcWork.top) - 40);
        SetWindowPos(g.hwnd, nullptr, mi.rcWork.left + (mi.rcWork.right - mi.rcWork.left - ww) / 2,
                     mi.rcWork.top + (mi.rcWork.bottom - mi.rcWork.top - hh) / 2, ww, hh, SWP_NOZORDER);
    }
    ShowWindow(g.hwnd, g.smoke ? SW_SHOWNORMAL : show);
    UpdateWindow(g.hwnd);
    if (g.smoke) SetTimer(g.hwnd, TIMER_WATCHDOG, 150000, nullptr);

    initWebView();

    MSG m;
    while (GetMessageW(&m, nullptr, 0, 0) > 0) {
        TranslateMessage(&m);
        DispatchMessageW(&m);
    }
    int code = int(m.wParam);
    if (g.smoke) {
        plog("smoke test finished with code %d", code);
        CopyFileW(g.logPath.c_str(), (g.smokeOut + L"\\player.log").c_str(), FALSE);
    }
    g.ctrl.Reset();
    g.wv.Reset();
    g.env.Reset();
    CoUninitialize();
    return code ? code : g.exitCode;
}
