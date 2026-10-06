// NovaForge Engine - platform/win32/PlatformWin32.cpp
// Real Win32 window + WGL OpenGL 3.3 core context + keyboard/mouse/raw-mouse input,
// native file dialogs and message boxes. No SDL, no GLFW: this is the whole platform
// layer the editor and the exported game use on Windows.
#include "core/Base.h"

#if NF_PLATFORM_WINDOWS

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <commdlg.h>
#include <shellapi.h>
#include <shlobj.h>
#include <timeapi.h>

// names that Windows defines as macros but NovaForge uses as identifiers
#ifdef CreateWindow
#  undef CreateWindow
#endif
#ifdef IsMinimized
#  undef IsMinimized
#endif
#ifdef MessageBox
#  undef MessageBox
#endif
#ifdef GetEnvironmentVariable
#  undef GetEnvironmentVariable
#endif

#include "platform/Platform.h"
#include "platform/win32/Win32Interop.h"
#include "core/Log.h"
#include "core/StringUtil.h"
#include "core/Time.h"

#include <vector>
#include <unordered_map>

namespace nf::platform {
namespace {

const char* kWindowClassName = "NovaForgeWindowClass";

win32::MessageHook g_messageHook = nullptr;
bool g_consoleAllocated = false;
bool g_timerRaised = false;
bool g_dpiAware = false;

// ------------------------------------------------------------------ key mapping
Key KeyFromVirtualKey(WPARAM vk, LPARAM lparam) {
  switch (vk) {
    case VK_ESCAPE: return Key::Escape;
    case VK_RETURN: return Key::Enter;
    case VK_TAB: return Key::Tab;
    case VK_BACK: return Key::Backspace;
    case VK_INSERT: return Key::Insert;
    case VK_DELETE: return Key::Delete;
    case VK_RIGHT: return Key::Right;
    case VK_LEFT: return Key::Left;
    case VK_DOWN: return Key::Down;
    case VK_UP: return Key::Up;
    case VK_PRIOR: return Key::PageUp;
    case VK_NEXT: return Key::PageDown;
    case VK_HOME: return Key::Home;
    case VK_END: return Key::End;
    case VK_CAPITAL: return Key::CapsLock;
    case VK_SCROLL: return Key::ScrollLock;
    case VK_NUMLOCK: return Key::NumLock;
    case VK_SNAPSHOT: return Key::PrintScreen;
    case VK_PAUSE: return Key::Pause;
    case VK_F1: return Key::F1;
    case VK_F2: return Key::F2;
    case VK_F3: return Key::F3;
    case VK_F4: return Key::F4;
    case VK_F5: return Key::F5;
    case VK_F6: return Key::F6;
    case VK_F7: return Key::F7;
    case VK_F8: return Key::F8;
    case VK_F9: return Key::F9;
    case VK_F10: return Key::F10;
    case VK_F11: return Key::F11;
    case VK_F12: return Key::F12;
    case VK_LSHIFT: return Key::LeftShift;
    case VK_RSHIFT: return Key::RightShift;
    case VK_LCONTROL: return Key::LeftCtrl;
    case VK_RCONTROL: return Key::RightCtrl;
    case VK_LMENU: return Key::LeftAlt;
    case VK_RMENU: return Key::RightAlt;
    case VK_LWIN: return Key::LeftSuper;
    case VK_RWIN: return Key::RightSuper;
    case VK_SPACE: return Key::Space;
    case VK_OEM_1: return Key::Semicolon;
    case VK_OEM_PLUS: return Key::Equal;
    case VK_OEM_COMMA: return Key::Comma;
    case VK_OEM_MINUS: return Key::Minus;
    case VK_OEM_PERIOD: return Key::Period;
    case VK_OEM_2: return Key::Slash;
    case VK_OEM_3: return Key::Grave;
    case VK_OEM_4: return Key::LeftBracket;
    case VK_OEM_5: return Key::Backslash;
    case VK_OEM_6: return Key::RightBracket;
    case VK_OEM_7: return Key::Apostrophe;
    default: break;
  }
  if (vk >= 'A' && vk <= 'Z') return (Key)(int)vk;
  if (vk >= '0' && vk <= '9') return (Key)(int)vk;
  NF_UNUSED(lparam);
  return Key::Unknown;
}

std::string WideToUtf8(const wchar_t* wide) {
  if (!wide) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string result((usize)(size - 1), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, result.data(), size, nullptr, nullptr);
  return result;
}

std::wstring Utf8ToWide(const std::string& text) {
  if (text.empty()) return {};
  int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, nullptr, 0);
  if (size <= 0) return {};
  std::wstring result((usize)(size - 1), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, result.data(), size);
  return result;
}

// --------------------------------------------------------------------- window
class Win32Window;

class Win32Window : public Window {
public:
  ~Win32Window() override { Destroy(); }

  bool Create(const WindowDesc& desc) override {
    if (!g_dpiAware) {
      HMODULE user32 = LoadLibraryA("user32.dll");
      if (user32) {
        typedef BOOL(WINAPI * SetProcessDpiAwarenessContextFn)(HANDLE);
        auto setContext = (SetProcessDpiAwarenessContextFn)GetProcAddress(
            user32, "SetProcessDpiAwarenessContext");
        if (setContext) setContext((HANDLE)-4 /*PER_MONITOR_AWARE_V2*/);
        else SetProcessDPIAware();
      }
      g_dpiAware = true;
    }

    HINSTANCE instance = GetModuleHandleA(nullptr);
    WNDCLASSEXA wc = {};
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW | CS_OWNDC | CS_DBLCLKS;
    wc.lpfnWndProc = &Win32Window::WindowProcThunk;
    wc.hInstance = instance;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr;
    wc.lpszClassName = kWindowClassName;
    wc.hIcon = LoadIcon(nullptr, IDI_APPLICATION);
    if (!RegisterClassExA(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
      NF_ERROR(LogCategory::Core, "RegisterClassEx failed (%lu)", GetLastError());
      return false;
    }

    RECT rect = {0, 0, desc.width, desc.height};
    DWORD style = WS_OVERLAPPEDWINDOW;
    if (!desc.resizable) style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    AdjustWindowRectEx(&rect, style, FALSE, 0);

    std::wstring title = Utf8ToWide(desc.title);
    hwnd_ = CreateWindowExA(0, kWindowClassName, desc.title.c_str(), style, CW_USEDEFAULT,
                            CW_USEDEFAULT, rect.right - rect.left, rect.bottom - rect.top, nullptr,
                            nullptr, instance, this);
    if (!hwnd_) {
      NF_ERROR(LogCategory::Core, "CreateWindowEx failed (%lu)", GetLastError());
      return false;
    }
    desc_ = desc;
    windowedStyle_ = style;
    GetWindowRect(hwnd_, &windowedRect_);

    // ---- OpenGL context -------------------------------------------------
    hdc_ = GetDC(hwnd_);
    PIXELFORMATDESCRIPTOR pfd = {};
    pfd.nSize = sizeof(pfd);
    pfd.nVersion = 1;
    pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
    pfd.iPixelType = PFD_TYPE_RGBA;
    pfd.cColorBits = 32;
    pfd.cDepthBits = 24;
    pfd.cStencilBits = 8;
    pfd.iLayerType = PFD_MAIN_PLANE;
    int pixelFormat = ChoosePixelFormat(hdc_, &pfd);
    if (!pixelFormat) {
      NF_ERROR(LogCategory::Core, "ChoosePixelFormat failed");
      return false;
    }
    SetPixelFormat(hdc_, pixelFormat, &pfd);

    HGLRC tempContext = wglCreateContext(hdc_);
    if (!tempContext || !wglMakeCurrent(hdc_, tempContext)) {
      NF_ERROR(LogCategory::Core, "wglCreateContext failed");
      return false;
    }
    // Try a real 3.3 core context; fall back to the compatibility context Windows gave us.
    auto wglCreateContextAttribsARB =
        (HGLRC(WINAPI*)(HDC, HGLRC, const int*))wglGetProcAddress("wglCreateContextAttribsARB");
    HGLRC coreContext = nullptr;
    if (wglCreateContextAttribsARB) {
      const int attribs[] = {0x2091 /*WGL_CONTEXT_MAJOR_VERSION_ARB*/, 3,
                             0x2092 /*MINOR_VERSION*/, 3,
                             0x9126 /*PROFILE_MASK*/, 0x00000001 /*CORE_PROFILE*/,
                             0x2094 /*FLAGS*/, 0 /*no debug for release performance*/,
                             0};
      coreContext = wglCreateContextAttribsARB(hdc_, nullptr, attribs);
      if (!coreContext) {
        NF_WARN(LogCategory::Core, "OpenGL 3.3 core context unavailable - using compatibility");
      }
    }
    if (coreContext) {
      wglMakeCurrent(nullptr, nullptr);
      wglDeleteContext(tempContext);
      hglrc_ = coreContext;
      wglMakeCurrent(hdc_, hglrc_);
    } else {
      hglrc_ = tempContext;
    }

    wglSwapIntervalEXT_ = (BOOL(WINAPI*)(int))wglGetProcAddress("wglSwapIntervalEXT");
    if (wglSwapIntervalEXT_) wglSwapIntervalEXT_(desc.vsync ? 1 : 0);

    // raw mouse input for first/third person camera control
    RAWINPUTDEVICE rid = {};
    rid.usUsagePage = 0x01;   // generic desktop
    rid.usUsage = 0x02;       // mouse
    rid.dwFlags = RIDEV_INPUTSINK;
    rid.hwndTarget = hwnd_;
    RegisterRawInputDevices(&rid, 1, sizeof(rid));

    if (desc.fullscreen) SetFullscreen(true);
    if (!g_timerRaised) {
      timeBeginPeriod(1);
      g_timerRaised = true;
    }
    created_ = true;
    NF_INFO(LogCategory::Core, "Win32 window created (%dx%d, vsync=%d)", desc.width, desc.height,
            desc.vsync ? 1 : 0);
    return true;
  }

  void Destroy() override {
    if (!created_) return;
    if (inputCaptured_) SetMouseCaptured(false);
    if (hglrc_) {
      wglMakeCurrent(nullptr, nullptr);
      wglDeleteContext(hglrc_);
      hglrc_ = nullptr;
    }
    if (hdc_ && hwnd_) {
      ReleaseDC(hwnd_, hdc_);
      hdc_ = nullptr;
    }
    if (hwnd_) {
      DestroyWindow(hwnd_);
      hwnd_ = nullptr;
    }
    created_ = false;
  }

  void Show() override {
    ShowWindow(hwnd_, SW_SHOW);
    SetForegroundWindow(hwnd_);
    UpdateWindow(hwnd_);
  }

  void PollEvents() override {
    input_.NewFrame();
    MSG msg;
    while (PeekMessageA(&msg, nullptr, 0, 0, PM_REMOVE)) {
      if (msg.message == WM_QUIT) {
        shouldClose_ = true;
        continue;
      }
      TranslateMessage(&msg);
      DispatchMessageA(&msg);
    }
  }

  void SwapBuffers() override {
    if (hdc_) ::SwapBuffers(hdc_);
  }

  bool ShouldClose() const override { return shouldClose_ || !hwnd_; }
  void RequestClose() override { shouldClose_ = true; }

  void SetTitle(const std::string& title) override {
    if (hwnd_) SetWindowTextA(hwnd_, title.c_str());
  }

  void SetCursorVisible(bool visible) override {
    cursorVisible_ = visible;
    ShowCursor(visible ? TRUE : FALSE);
  }

  void SetMouseCaptured(bool captured) override {
    if (captured == inputCaptured_) return;
    inputCaptured_ = captured;
    if (captured) {
      SetCapture(hwnd_);
      // clip the cursor to the centre of the window while playing
      RECT rect;
      GetClientRect(hwnd_, &rect);
      POINT center = {(rect.right - rect.left) / 2, (rect.bottom - rect.top) / 2};
      ClientToScreen(hwnd_, &center);
      RECT clip = {center.x - 2, center.y - 2, center.x + 2, center.y + 2};
      ClipCursor(&clip);
      ShowCursor(FALSE);
    } else {
      ClipCursor(nullptr);
      ReleaseCapture();
      if (cursorVisible_) ShowCursor(TRUE);
    }
  }

  bool IsMouseCaptured() const override { return inputCaptured_; }

  void Resize(int width, int height) override {
    if (!hwnd_) return;
    RECT rect = {0, 0, width, height};
    DWORD style = (DWORD)GetWindowLongPtrA(hwnd_, GWL_STYLE);
    AdjustWindowRectEx(&rect, style, FALSE, 0);
    SetWindowPos(hwnd_, nullptr, 0, 0, rect.right - rect.left, rect.bottom - rect.top,
                 SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
  }

  void SetFullscreen(bool fullscreen) override {
    if (!hwnd_ || fullscreen == fullscreen_) return;
    if (fullscreen) {
      GetWindowRect(hwnd_, &windowedRect_);
      MONITORINFO monitor = {};
      monitor.cbSize = sizeof(monitor);
      GetMonitorInfoA(MonitorFromWindow(hwnd_, MONITOR_DEFAULTTONEAREST), &monitor);
      SetWindowLongPtrA(hwnd_, GWL_STYLE, WS_POPUP | WS_VISIBLE);
      SetWindowPos(hwnd_, HWND_TOP, monitor.rcMonitor.left, monitor.rcMonitor.top,
                   monitor.rcMonitor.right - monitor.rcMonitor.left,
                   monitor.rcMonitor.bottom - monitor.rcMonitor.top,
                   SWP_FRAMECHANGED | SWP_NOACTIVATE);
    } else {
      SetWindowLongPtrA(hwnd_, GWL_STYLE, windowedStyle_);
      SetWindowPos(hwnd_, nullptr, windowedRect_.left, windowedRect_.top,
                   windowedRect_.right - windowedRect_.left,
                   windowedRect_.bottom - windowedRect_.top,
                   SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE);
    }
    fullscreen_ = fullscreen;
  }

  int Width() const override {
    RECT rect;
    if (!hwnd_ || !GetClientRect(hwnd_, &rect)) return 0;
    return rect.right - rect.left;
  }
  int Height() const override {
    RECT rect;
    if (!hwnd_ || !GetClientRect(hwnd_, &rect)) return 0;
    return rect.bottom - rect.top;
  }
  f32 DpiScale() const override {
    if (!hwnd_) return 1.0f;
    typedef UINT(WINAPI * GetDpiForWindowFn)(HWND);
    static GetDpiForWindowFn getDpi = (GetDpiForWindowFn)[]() -> void* {
      HMODULE user32 = GetModuleHandleA("user32.dll");
      return user32 ? (void*)GetProcAddress(user32, "GetDpiForWindow") : nullptr;
    }();
    if (!getDpi) return 1.0f;
    UINT dpi = getDpi(hwnd_);
    return dpi > 0 ? (f32)dpi / 96.0f : 1.0f;
  }
  bool IsFocused() const override { return hwnd_ && GetActiveWindow() == hwnd_; }
  bool IsMinimized() const override { return hwnd_ && IsIconic(hwnd_); }
  InputState& Input() override { return input_; }
  void* NativeHandle() const override { return hwnd_; }

  bool HasGLContext() const override { return hglrc_ != nullptr; }
  void MakeContextCurrent() override {
    if (hglrc_ && hdc_) wglMakeCurrent(hdc_, hglrc_);
  }
  void* GetGLProcAddress(const char* name) override { return (void*)wglGetProcAddress(name); }

  void SetVsync(bool enabled) {
    if (wglSwapIntervalEXT_) wglSwapIntervalEXT_(enabled ? 1 : 0);
  }

private:
  static LRESULT CALLBACK WindowProcThunk(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    Win32Window* self = nullptr;
    if (msg == WM_NCCREATE) {
      auto* cs = (CREATESTRUCTA*)lparam;
      self = (Win32Window*)cs->lpCreateParams;
      SetWindowLongPtrA(hwnd, GWLP_USERDATA, (LONG_PTR)self);
      self->hwnd_ = hwnd;
    } else {
      self = (Win32Window*)GetWindowLongPtrA(hwnd, GWLP_USERDATA);
    }
    if (!self) return DefWindowProcA(hwnd, msg, wparam, lparam);
    return self->HandleMessage(hwnd, msg, wparam, lparam);
  }

  LRESULT HandleMessage(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    if (g_messageHook) {
      long long handled =
          g_messageHook(hwnd, msg, (unsigned long long)wparam, (long long)lparam);
      if (handled) return (LRESULT)handled;
    }
    switch (msg) {
      case WM_CLOSE:
        shouldClose_ = true;
        ShowWindow(hwnd, SW_HIDE);
        return 0;
      case WM_DESTROY:
        shouldClose_ = true;
        PostQuitMessage(0);
        return 0;
      case WM_ERASEBKGND:
        return 1;   // OpenGL paints everything
      case WM_SIZE:
        if (wparam != SIZE_MINIMIZED) {
          int w = LOWORD(lparam), h = HIWORD(lparam);
          if (resizeCallback_) resizeCallback_(w, h);
        }
        return 0;
      case WM_SYSKEYDOWN:
      case WM_KEYDOWN: {
        Key key = KeyFromVirtualKey(wparam, lparam);
        if (key != Key::Unknown) input_.SetKey((int)key, true);
        if (msg == WM_SYSKEYDOWN) return 0;   // swallow Alt menu activation
        return 0;
      }
      case WM_SYSKEYUP:
      case WM_KEYUP: {
        Key key = KeyFromVirtualKey(wparam, lparam);
        if (key != Key::Unknown) input_.SetKey((int)key, false);
        return 0;
      }
      case WM_CHAR: {
        char c = (char)wparam;
        if (c >= 32 || c == '\t') {
          if (input_.CharCallback()) input_.CharCallback()((unsigned int)wparam);
          input_.AddText(c);
        }
        return 0;
      }
      case WM_LBUTTONDOWN: case WM_LBUTTONDBLCLK: SetCapture(hwnd); input_.SetMouseButton((int)MouseButton::Left, true); return 0;
      case WM_LBUTTONUP: ReleaseCapture(); input_.SetMouseButton((int)MouseButton::Left, false); return 0;
      case WM_RBUTTONDOWN: case WM_RBUTTONDBLCLK: SetCapture(hwnd); input_.SetMouseButton((int)MouseButton::Right, true); return 0;
      case WM_RBUTTONUP: ReleaseCapture(); input_.SetMouseButton((int)MouseButton::Right, false); return 0;
      case WM_MBUTTONDOWN: input_.SetMouseButton((int)MouseButton::Middle, true); return 0;
      case WM_MBUTTONUP: input_.SetMouseButton((int)MouseButton::Middle, false); return 0;
      case WM_XBUTTONDOWN:
        input_.SetMouseButton((int)(HIWORD(wparam) == XBUTTON1 ? MouseButton::X1 : MouseButton::X2), true);
        return TRUE;
      case WM_XBUTTONUP:
        input_.SetMouseButton((int)(HIWORD(wparam) == XBUTTON1 ? MouseButton::X1 : MouseButton::X2), false);
        return TRUE;
      case WM_MOUSEMOVE: {
        f32 x = (f32)GET_X_LPARAM(lparam);
        f32 y = (f32)GET_Y_LPARAM(lparam);
        input_.SetMousePosition(x, y);
        if (!rawMouseActive_) {
          // fall back to client-space deltas when raw input is unavailable
          POINT p = {GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
          input_.AccumulateMouseDelta(x - lastMousePos_.x, y - lastMousePos_.y);
          lastMousePos_ = Vec2(x, y);
          NF_UNUSED(p);
        }
        return 0;
      }
      case WM_MOUSEWHEEL:
        input_.AddWheel((f32)GET_WHEEL_DELTA_WPARAM(wparam) / (f32)WHEEL_DELTA);
        return 0;
      case WM_INPUT: {
        UINT size = 0;
        GetRawInputData((HRAWINPUT)lparam, RID_INPUT, nullptr, &size, sizeof(RAWINPUTHEADER));
        if (size > 0 && size <= 256) {
          BYTE buffer[256];
          if (GetRawInputData((HRAWINPUT)lparam, RID_INPUT, buffer, &size, sizeof(RAWINPUTHEADER)) ==
              size) {
            auto* raw = (RAWINPUT*)buffer;
            if (raw->header.dwType == RIM_TYPEMOUSE &&
                (raw->data.mouse.usFlags & MOUSE_MOVE_ABSOLUTE) == 0) {
              rawMouseActive_ = true;
              input_.AccumulateMouseDelta((f32)raw->data.mouse.lLastX, (f32)raw->data.mouse.lLastY);
            }
          }
        }
        return DefWindowProcA(hwnd, msg, wparam, lparam);
      }
      case WM_SETFOCUS:
        focused_ = true;
        return 0;
      case WM_KILLFOCUS:
        focused_ = false;
        if (inputCaptured_) SetMouseCaptured(false);
        // release every key so the game does not see stuck input
        for (int i = 0; i < (int)Key::Count; i++) input_.SetKey(i, false);
        return 0;
      case WM_SETCURSOR:
        if (inputCaptured_) return TRUE;
        break;
      default:
        break;
    }
    return DefWindowProcA(hwnd, msg, wparam, lparam);
  }

private:
  HWND hwnd_ = nullptr;
  HDC hdc_ = nullptr;
  HGLRC hglrc_ = nullptr;
  BOOL(WINAPI* wglSwapIntervalEXT_)(int) = nullptr;
  InputState input_;
  WindowDesc desc_;
  DWORD windowedStyle_ = 0;
  RECT windowedRect_ = {};
  Vec2 lastMousePos_{};
  bool created_ = false;
  bool shouldClose_ = false;
  bool fullscreen_ = false;
  bool inputCaptured_ = false;
  bool cursorVisible_ = true;
  bool focused_ = true;
  bool rawMouseActive_ = false;
};

std::vector<Win32Window*> g_windows;

} // namespace

// ------------------------------------------------------------------ factories
std::unique_ptr<Window> CreatePlatformWindow() { return std::make_unique<Win32Window>(); }

void PlatformInitialize() {
#if defined(_MSC_VER)
  SetConsoleOutputCP(CP_UTF8);
#endif
}

void PlatformShutdown() {
  if (g_timerRaised) {
    timeEndPeriod(1);
    g_timerRaised = false;
  }
}

void SetConsoleVisible(bool visible) {
  if (HWND console = GetConsoleWindow()) {
    ShowWindow(console, visible ? SW_SHOW : SW_HIDE);
  }
}

void EnsureConsoleVisible() {
  if (GetConsoleWindow()) return;
  if (!AllocConsole()) return;
  AllocConsole();
  freopen_s((FILE**)stdout, "CONOUT$", "w", stdout);
  freopen_s((FILE**)stderr, "CONOUT$", "w", stderr);
  freopen_s((FILE**)stdin, "CONIN$", "r", stdin);
  SetConsoleTitleA("NovaForge Game - log output");
  g_consoleAllocated = true;
}

// SleepMs / GetEnvironmentVariable are implemented once in platform/Platform.cpp (the shared
// OS helper layer) for every backend - do not redefine them here.


void ShowMessageBox(const std::string& title, const std::string& text, bool isError) {
  MessageBoxA(nullptr, text.c_str(), title.c_str(), MB_OK | (isError ? MB_ICONERROR : MB_ICONINFORMATION));
}

std::string OpenFileDialog(Window* parent, const std::string& title,
                           const std::vector<FileDialogFilter>& filters) {
  char fileBuffer[MAX_PATH * 4] = {0};
  std::string filterString;
  for (const auto& filter : filters) {
    filterString += filter.description;
    filterString.push_back('\0');
    filterString += filter.pattern;
    filterString.push_back('\0');
  }
  filterString += "All files (*.*)";
  filterString.push_back('\0');
  filterString += "*.*";
  filterString.push_back('\0');
  filterString.push_back('\0');

  OPENFILENAMEA ofn = {};
  ofn.lStructSize = sizeof(ofn);
  ofn.hwndOwner = parent ? (HWND)parent->NativeHandle() : nullptr;
  ofn.lpstrFilter = filterString.c_str();
  ofn.lpstrFile = fileBuffer;
  ofn.nMaxFile = sizeof(fileBuffer);
  ofn.lpstrTitle = title.c_str();
  ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER;
  if (!GetOpenFileNameA(&ofn)) return {};
  return std::string(fileBuffer);
}

std::string SaveFileDialog(Window* parent, const std::string& title,
                           const std::vector<FileDialogFilter>& filters,
                           const std::string& defaultName) {
  char fileBuffer[MAX_PATH * 4] = {0};
  if (!defaultName.empty())
    strncpy_s(fileBuffer, sizeof(fileBuffer), defaultName.c_str(), _TRUNCATE);
  std::string filterString;
  for (const auto& filter : filters) {
    filterString += filter.description;
    filterString.push_back('\0');
    filterString += filter.pattern;
    filterString.push_back('\0');
  }
  filterString.push_back('\0');

  OPENFILENAMEA ofn = {};
  ofn.lStructSize = sizeof(ofn);
  ofn.hwndOwner = parent ? (HWND)parent->NativeHandle() : nullptr;
  ofn.lpstrFilter = filterString.c_str();
  ofn.lpstrFile = fileBuffer;
  ofn.nMaxFile = sizeof(fileBuffer);
  ofn.lpstrTitle = title.c_str();
  ofn.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER;
  if (!GetSaveFileNameA(&ofn)) return {};
  return std::string(fileBuffer);
}

std::string SelectFolderDialog(Window* parent, const std::string& title) {
  BROWSEINFOA info = {};
  info.hwndOwner = parent ? (HWND)parent->NativeHandle() : nullptr;
  info.lpszTitle = title.c_str();
  info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE | BIF_USENEWUI;
  LPITEMIDLIST item = SHBrowseForFolderA(&info);
  if (!item) return {};
  char path[MAX_PATH] = {0};
  std::string result;
  if (SHGetPathFromIDListA(item, path)) result = path;
  CoTaskMemFree(item);
  return result;
}

namespace win32 {

void SetMessageHook(win32::MessageHook hook) { g_messageHook = hook; }

void GetMonitorWorkArea(int* outX, int* outY, int* outWidth, int* outHeight) {
  RECT rect;
  SystemParametersInfoA(SPI_GETWORKAREA, 0, &rect, 0);
  if (outX) *outX = rect.left;
  if (outY) *outY = rect.top;
  if (outWidth) *outWidth = rect.right - rect.left;
  if (outHeight) *outHeight = rect.bottom - rect.top;
}

} // namespace win32

} // namespace nf::platform

#endif // NF_PLATFORM_WINDOWS
