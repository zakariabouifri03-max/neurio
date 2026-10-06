// NEXUS GRAPHICS ENGINE - application entry
#include "stdafx.h"
#include "config.h"
#include "engine.h"
#include "ui.h"
#include "hwinfo.h"
#include "games.h"
#include "imgui.h"
#include "imgui_impl_win32.h"
#include "imgui_impl_dx11.h"
#include "d3d.h"

extern IMGUI_IMPL_API LRESULT ImGui_ImplWin32_WndProcHandler(HWND hWnd, UINT msg, WPARAM wParam, LPARAM lParam);

static const wchar_t K_APP_CLASS[] = L"NexusPanelWnd";
static const wchar_t K_MUTEX[] = L"NexusGraphicsEngine_SingleInstance";
static const UINT K_HOTKEY_COMPARE = 1;   // CTRL+F9
static const UINT K_HOTKEY_SPLIT = 2;     // CTRL+F10
static const UINT K_HOTKEY_HUD = 3;       // CTRL+F11
static const UINT K_HOTKEY_TOGGLE = 4;    // CTRL+F12

struct PanelCtx {
    ID3D11Device* dev = nullptr;
    ID3D11DeviceContext* ctx = nullptr;
    IDXGISwapChain1* swap = nullptr;
    ID3D11RenderTargetView* rtv = nullptr;
};
static PanelCtx g_panel;
static bool g_running = true;
static bool g_minimizedArg = false;

// ---------------------------------------------------------------- logging
static FILE* g_logFile = nullptr;
void LogOpen() {
    std::wstring path = NgeLogDir() + L"\\nexus.log";
    _wfopen_s(&g_logFile, path.c_str(), L"ab");
    if (g_logFile) {
        time_t t = time(nullptr);
        char tb[64];
        struct tm tmv;
        localtime_s(&tmv, &t);
        strftime(tb, sizeof(tb), "%Y-%m-%d %H:%M:%S", &tmv);
        fprintf(g_logFile, "\n==== NEXUS GRAPHICS ENGINE session %s ====\n", tb);
        fflush(g_logFile);
    }
}
void LogClose() { if (g_logFile) { fclose(g_logFile); g_logFile = nullptr; } }
void Logf(const char* fmt, ...) {
    char buf[2048];
    va_list ap; va_start(ap, fmt);
    _vsnprintf_s(buf, sizeof(buf), _TRUNCATE, fmt, ap);
    va_end(ap);
    OutputDebugStringA(buf);
    OutputDebugStringA("\n");
    if (g_logFile) { fprintf(g_logFile, "%s\n", buf); fflush(g_logFile); }
}

// ---------------------------------------------------------------- panel device
static bool CreatePanelRtv() {
    NexusComPtr<ID3D11Texture2D> back;
    if (FAILED(g_panel.swap->GetBuffer(0, IID_PPV_ARGS(&back))) || !back.Get()) return false;
    if (g_panel.rtv) { g_panel.rtv->Release(); g_panel.rtv = nullptr; }
    return SUCCEEDED(g_panel.dev->CreateRenderTargetView(back.Get(), nullptr, &g_panel.rtv));
}

static bool CreatePanelDevice(HWND hwnd) {
    D3D_FEATURE_LEVEL fl = (D3D_FEATURE_LEVEL)0;
    DXGI_SWAP_CHAIN_DESC1 sd = {};
    sd.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    sd.SampleDesc.Count = 1;
    sd.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    sd.BufferCount = 2;
    sd.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0,
        D3D11_SDK_VERSION, &g_panel.dev, &fl, &g_panel.ctx))) {
        MessageBoxW(hwnd, L"Direct3D 11 is required to run Nexus Graphics Engine.\nPlease update your GPU drivers.", L"Nexus", MB_ICONERROR);
        return false;
    }
    NexusComPtr<IDXGIFactory2> factory;
    if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;
    if (FAILED(factory->CreateSwapChainForHwnd(g_panel.dev, hwnd, &sd, nullptr, nullptr, &g_panel.swap))) {
        sd.SwapEffect = DXGI_SWAP_EFFECT_DISCARD; sd.BufferCount = 1;
        if (FAILED(factory->CreateSwapChainForHwnd(g_panel.dev, hwnd, &sd, nullptr, nullptr, &g_panel.swap))) return false;
    }
    factory->MakeWindowAssociation(hwnd, DXGI_MWA_NO_ALT_ENTER);
    return CreatePanelRtv();
}

static LRESULT CALLBACK PanelWndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (ImGui_ImplWin32_WndProcHandler(hwnd, msg, wp, lp)) return 1;
    switch (msg) {
    case WM_SIZE:
        if (g_panel.swap && wp != SIZE_MINIMIZED) {
            RECT rc; GetClientRect(hwnd, &rc);
            g_panel.swap->ResizeBuffers(2, std::max<LONG>(1, rc.right - rc.left), std::max<LONG>(1, rc.bottom - rc.top),
                DXGI_FORMAT_UNKNOWN, 0);
            CreatePanelRtv();
        }
        return 0;
    case WM_CLOSE:
        g_running = false;
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

static void SetWindowIcon(HWND hwnd) {
    std::wstring ico = GetExeDir() + L"\\nexus.ico";
    if (FileExistsW(ico)) {
        HICON big = (HICON)LoadImageW(nullptr, ico.c_str(), IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
        HICON small = (HICON)LoadImageW(nullptr, ico.c_str(), IMAGE_ICON, 16, 16, LR_LOADFROMFILE);
        if (big) SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM)big);
        if (small) SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)small);
    }
}

// ---------------------------------------------------------------- CLI self test
static int RunCliSelfTest() {
    const HwInfo& hw = DetectHardware();
    printf("Nexus self-test: GPU=%s VRAM=%zuMB FL=0x%04X\n", hw.gpuName, hw.vramMB, hw.featureLevel);
    NEX_LOG("self-test GPU: %s", hw.gpuName);
    if (!hw.csSupport) { printf("FAIL: no DX11 compute support\n"); return 2; }
    GameProfile test;
    test.displayName = "self-test"; test.exeName = "selftest.exe"; test.valid = true;
    ApplyPreset(test.params, P_MAX_GRAPHICS, 1.0f);
    Engine& e = Engine::Get();
    e.Activate(test, g_app, test.params, true);
    int waited = 0;
    bool done = false, ok = false;
    while (waited < 60000) {
        e.Snapshot([&](EngineStats& s) { done = s.selfTestDone; ok = s.selfTestOk; });
        if (done) break;
        Sleep(100); waited += 100;
    }
    float gpuMs = 0;
    e.Snapshot([&](EngineStats& s) { gpuMs = s.gpuMs; });
    printf("Nexus self-test: %s (pipeline GPU time %.2f ms/frame)\n", done ? (ok ? "PASS" : "WARN") : "TIMEOUT", gpuMs);
    e.Deactivate();
    return done && ok ? 0 : 2;
}

// ---------------------------------------------------------------- WinMain
int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, PWSTR cmdLine, int) {
    HANDLE mutex = CreateMutexW(nullptr, TRUE, K_MUTEX);
    if (mutex && GetLastError() == ERROR_ALREADY_EXISTS) {
        MessageBoxW(nullptr, L"Nexus Graphics Engine is already running.", L"Nexus", MB_ICONINFORMATION);
        return 0;
    }
    if (cmdLine) {
        std::wstring cl(cmdLine);
        if (cl.find(L"--smoke-test") != std::wstring::npos || cl.find(L"/smoke-test") != std::wstring::npos) {
            LogOpen();
            int rc = RunCliSelfTest();
            dxe::ShutdownCompiler();
            LogClose();
            return rc;
        }
        if (cl.find(L"/minimized") != std::wstring::npos) g_minimizedArg = true;
    }

    // DPI awareness (runtime; manifest also embedded when available)
    {
        HMODULE u32 = GetModuleHandleW(L"user32.dll");
        if (u32) {
            typedef BOOL(WINAPI* PFN_SPDAC)(DPI_AWARENESS_CONTEXT);
            PFN_SPDAC f = (PFN_SPDAC)GetProcAddress(u32, "SetProcessDpiAwarenessContext");
            if (f) f(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
    }
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    LogOpen();
    NEX_LOG("Nexus Graphics Engine starting");

    WNDCLASSEXW wc = { sizeof(wc) };
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = PanelWndProc;
    wc.hInstance = hInst;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr;
    wc.lpszClassName = K_APP_CLASS;
    RegisterClassExW(&wc);

    HWND hwnd = CreateWindowExW(0, K_APP_CLASS, L"NEXUS GRAPHICS ENGINE",
        WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1240, 800,
        nullptr, nullptr, hInst, nullptr);
    if (!hwnd) return 1;
    SetWindowIcon(hwnd);
    if (!CreatePanelDevice(hwnd)) { LogClose(); return 1; }
    if (!ui::Init(hwnd, g_panel.dev, g_panel.ctx)) { LogClose(); return 1; }
    ShowWindow(hwnd, g_minimizedArg ? SW_MINIMIZE : SW_SHOW);
    UpdateWindow(hwnd);

    RegisterHotKey(hwnd, K_HOTKEY_COMPARE, MOD_CONTROL, VK_F9);
    RegisterHotKey(hwnd, K_HOTKEY_SPLIT, MOD_CONTROL, VK_F10);
    RegisterHotKey(hwnd, K_HOTKEY_HUD, MOD_CONTROL, VK_F11);
    RegisterHotKey(hwnd, K_HOTKEY_TOGGLE, MOD_CONTROL, VK_F12);

    MSG msg = {};
    uint32_t lastTitleTick = GetTickCount();
    while (g_running) {
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT) g_running = false;
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            if (msg.message == WM_HOTKEY) {
                switch (msg.wParam) {
                case K_HOTKEY_COMPARE:
                    Engine::Get().ToggleBypass();
                    ui::Flash(Engine::Get().IsActive() ? "CTRL+F9: toggled ORIGINAL / NEXUS ENHANCED" : "Engine not active");
                    break;
                case K_HOTKEY_SPLIT:
                    Engine::Get().ToggleSplit();
                    ui::Flash(Engine::Get().IsActive() ? "CTRL+F10: toggled SPLIT VIEW (drag line with interaction mode)" : "Engine not active");
                    break;
                case K_HOTKEY_HUD:
                    ui::ToggleHud();
                    break;
                case K_HOTKEY_TOGGLE:
                    if (Engine::Get().IsActive()) Engine::Get().Deactivate();
                    else if (g_activeProfile.valid) {
                        Engine::Get().Activate(g_activeProfile, g_app, g_params);
                        ui::EnsureHud();
                    }
                    break;
                }
            }
        }
        if (!g_running) break;

        // frame
        ImGui_ImplDX11_NewFrame();
        ImGui_ImplWin32_NewFrame();
        ImGui::NewFrame();
        ui::Draw();                       // widgets + HUD tick (no render)
        ImGui::Render();
        const float clear[4] = { 0.02f, 0.03f, 0.04f, 1.0f };
        g_panel.ctx->OMSetRenderTargets(1, &g_panel.rtv, nullptr);
        g_panel.ctx->ClearRenderTargetView(g_panel.rtv, clear);
        ImGui_ImplDX11_RenderDrawData(ImGui::GetDrawData());
        g_panel.swap->Present(1, 0);

        uint32_t now = GetTickCount();
        if (now - lastTitleTick > 1000) {
            lastTitleTick = now;
            wchar_t t[256];
            Engine::Get().Snapshot([&](EngineStats& s) {
                if (s.active) _snwprintf_s(t, _TRUNCATE, L"NEXUS GRAPHICS ENGINE  -  %S  [%.0f FPS | %.1f ms GPU]", s.status, s.fps, s.gpuMs);
                else _snwprintf_s(t, _TRUNCATE, L"NEXUS GRAPHICS ENGINE");
            });
            SetWindowTextW(hwnd, t);
        }
        Sleep(1);
    }

    Engine::Get().Deactivate();
    ui::Shutdown();
    if (g_panel.rtv) g_panel.rtv->Release();
    if (g_panel.swap) g_panel.swap->Release();
    if (g_panel.ctx) g_panel.ctx->Release();
    if (g_panel.dev) g_panel.dev->Release();
    dxe::ShutdownCompiler();
    LogClose();
    CoUninitialize();
    return 0;
}
