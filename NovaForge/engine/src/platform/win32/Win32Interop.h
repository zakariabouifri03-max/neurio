// NovaForge Engine - platform/win32/Win32Interop.h
// Small escape hatch used by the editor to forward window messages to Dear ImGui.
#pragma once

#include "core/Base.h"

namespace nf::platform::win32 {

// Hook called from the window procedure before the engine handles a message.
// Return true when the message was consumed. `handler` receives
// (HWND hwnd, unsigned message, unsigned long long wparam, long long lparam).
using MessageHook = long long (*)(void*, unsigned, unsigned long long, long long);
void SetMessageHook(MessageHook hook);

// DPI aware window bounds helper (monitor work area).
void GetMonitorWorkArea(int* outX, int* outY, int* outWidth, int* outHeight);

} // namespace nf::platform::win32
