#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <objbase.h>
#include "App.h"

#ifndef DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
#define DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 ((HANDLE)(intptr_t)-4)
#endif

static void enableDpi() {
    HMODULE user = GetModuleHandleW(L"user32.dll");
    if (user) {
        using Fn = BOOL (WINAPI*)(HANDLE);
        auto setCtx = (Fn)GetProcAddress(user, "SetProcessDpiAwarenessContext");
        if (setCtx) {
            setCtx(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            return;
        }
    }
    HMODULE shc = LoadLibraryW(L"shcore.dll");
    if (shc) {
        using Fn2 = HRESULT (WINAPI*)(int);
        auto setAw = (Fn2)GetProcAddress(shc, "SetProcessDpiAwareness");
        if (setAw) setAw(2);
    }
    SetProcessDPIAware();
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE, LPSTR, int nCmdShow) {
    enableDpi();
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    INITCOMMONCONTROLSEX icc { sizeof(icc), ICC_WIN95_CLASSES };
    InitCommonControlsEx(&icc);
    int rc = App::instance().run(hInst, nCmdShow);
    CoUninitialize();
    return rc;
}

#endif
