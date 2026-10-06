// NEXUS GRAPHICS ENGINE - common precompiled header
// Real-time game graphics enhancement layer (capture -> GPU compute pipeline -> overlay output)
#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <windowsx.h>
#include <d3d11.h>
#include <dxgi1_6.h>
#include <d3dcompiler.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlwapi.h>
#include <commdlg.h>
#include <pdh.h>
#include <pdhmsg.h>

#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <ctime>
#include <cwchar>

#include <string>
#include <vector>
#include <map>
#include <deque>
#include <memory>
#include <algorithm>
#include <functional>
#include <mutex>
#include <atomic>
#include <thread>

// ----------------------------------------------------------------------------
// Minimal COM pointer (avoid WRL dependency differences across toolchains)
// ----------------------------------------------------------------------------
template <typename T>
class NexusComPtr {
    T* p_ = nullptr;
public:
    NexusComPtr() = default;
    ~NexusComPtr() { Reset(); }
    NexusComPtr(const NexusComPtr&) = delete;
    NexusComPtr& operator=(const NexusComPtr&) = delete;
    NexusComPtr(NexusComPtr&& o) noexcept : p_(o.p_) { o.p_ = nullptr; }
    NexusComPtr& operator=(NexusComPtr&& o) noexcept {
        if (this != std::addressof(o)) { Reset(); p_ = o.p_; o.p_ = nullptr; }
        return *this;
    }
    void Reset() { if (p_) { p_->Release(); p_ = nullptr; } }
    T** operator&() { Reset(); return &p_; }
    T* operator->() const { return p_; }
    operator T* () const { return p_; }
    T* Get() const { return p_; }
    T* Detach() { T* p = p_; p_ = nullptr; return p; }
    T** ReleaseAndGetAddressOf() { Reset(); return &p_; }
};

// ----------------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------------
void LogOpen();
void LogClose();
void Logf(const char* fmt, ...);

#define NEX_LOG(...)  Logf(__VA_ARGS__)

// Wide -> UTF-8
inline std::string WideToUtf8(const std::wstring& w) {
    if (w.empty()) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s((size_t)n, 0);
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, nullptr, nullptr);
    return s;
}
inline std::wstring Utf8ToWide(const std::string& u) {
    if (u.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, u.c_str(), (int)u.size(), nullptr, 0);
    std::wstring w((size_t)n, 0);
    MultiByteToWideChar(CP_UTF8, 0, u.c_str(), (int)u.size(), &w[0], 0);
    return w;
}

inline std::string Fmt(const char* fmt, ...) {
    char buf[2048];
    va_list ap; va_start(ap, fmt);
    _vsnprintf_s(buf, sizeof(buf), _TRUNCATE, fmt, ap);
    va_end(ap);
    return buf;
}

inline bool FileExistsW(const std::wstring& p) { return p.size() && PathFileExistsW(p.c_str()) == TRUE; }

inline std::wstring GetExeDir() {
    wchar_t buf[MAX_PATH]; DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
    std::wstring p(buf, n);
    size_t s = p.find_last_of(L"\\/");
    return (s == std::wstring::npos) ? L"." : p.substr(0, s);
}

// %APPDATA%\NexusGraphicsEngine
std::wstring NgeAppDataDir();
std::wstring NgeProfilesDir();
std::wstring NgeLogDir();
