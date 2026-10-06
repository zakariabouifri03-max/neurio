// NovaForge Engine - Win32 platform backend (shipping desktop target)
#include "platform/platform.h"
#include "core/log.h"
#include "core/fs.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <commdlg.h>

namespace nf {

// ------------------------------------------------------------------ key map
static Key vkToKey(WPARAM vk) {
    if (vk >= 'A' && vk <= 'Z') return (Key)((int)Key::A + (vk - 'A'));
    if (vk >= '0' && vk <= '9') return (Key)((int)Key::Num0 + (vk - '0'));
    if (vk >= VK_F1 && vk <= VK_F12) return (Key)((int)Key::F1 + (vk - VK_F1));
    if (vk >= VK_NUMPAD0 && vk <= VK_NUMPAD9) return (Key)((int)Key::Keypad0 + (vk - VK_NUMPAD0));
    switch (vk) {
        case VK_ESCAPE: return Key::Escape;
        case VK_RETURN: return Key::Enter;
        case VK_TAB: return Key::Tab;
        case VK_BACK: return Key::Backspace;
        case VK_DELETE: return Key::Delete;
        case VK_INSERT: return Key::Insert;
        case VK_SPACE: return Key::Space;
        case VK_SHIFT: return Key::LeftShift;
        case VK_LSHIFT: return Key::LeftShift;
        case VK_RSHIFT: return Key::RightShift;
        case VK_CONTROL: return Key::LeftCtrl;
        case VK_LCONTROL: return Key::LeftCtrl;
        case VK_RCONTROL: return Key::RightCtrl;
        case VK_MENU: return Key::LeftAlt;
        case VK_LMENU: return Key::LeftAlt;
        case VK_RMENU: return Key::RightAlt;
        case VK_LWIN: return Key::LeftSuper;
        case VK_RWIN: return Key::RightSuper;
        case VK_UP: return Key::Up;
        case VK_DOWN: return Key::Down;
        case VK_LEFT: return Key::Left;
        case VK_RIGHT: return Key::Right;
        case VK_HOME: return Key::Home;
        case VK_END: return Key::End;
        case VK_PRIOR: return Key::PageUp;
        case VK_NEXT: return Key::PageDown;
        case VK_OEM_MINUS: return Key::Minus;
        case VK_OEM_PLUS: return Key::Equal;
        case VK_OEM_4: return Key::LeftBracket;
        case VK_OEM_6: return Key::RightBracket;
        case VK_OEM_1: return Key::Semicolon;
        case VK_OEM_7: return Key::Apostrophe;
        case VK_OEM_COMMA: return Key::Comma;
        case VK_OEM_PERIOD: return Key::Period;
        case VK_OEM_2: return Key::Slash;
        case VK_OEM_5: return Key::Backslash;
        case VK_OEM_3: return Key::Grave;
        case VK_CAPITAL: return Key::CapsLock;
        case VK_SNAPSHOT: return Key::PrintScreen;
        case VK_PAUSE: return Key::Pause;
        case VK_DECIMAL: return Key::KeypadDecimal;
        case VK_DIVIDE: return Key::KeypadDivide;
        case VK_MULTIPLY: return Key::KeypadMultiply;
        case VK_SUBTRACT: return Key::KeypadMinus;
        case VK_ADD: return Key::KeypadPlus;
        default: return Key::None;
    }
}

static int modsFromOS() {
    int m = ModNone;
    if (GetKeyState(VK_SHIFT) & 0x8000) m |= ModShift;
    if (GetKeyState(VK_CONTROL) & 0x8000) m |= ModCtrl;
    if (GetKeyState(VK_MENU) & 0x8000) m |= ModAlt;
    return m;
}

// ------------------------------------------------------------------ window
class Win32Window : public Window {
public:
    Win32Window(const WindowDesc& d) : desc_(d) {
        title_ = d.title;
        width_ = d.width;
        height_ = d.height;
        HINSTANCE inst = GetModuleHandleW(nullptr);
        WNDCLASSEXW wc = {};
        wc.cbSize = sizeof(wc);
        wc.style = CS_OWNDC | CS_HREDRAW | CS_VREDRAW;
        wc.lpfnWndProc = &Win32Window::wndProcStatic;
        wc.hInstance = inst;
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
        wc.lpszClassName = L"NovaForgeWindow";
        RegisterClassExW(&wc);

        DWORD style = WS_OVERLAPPEDWINDOW;
        if (!d.resizable) style &= ~(WS_THICKFRAME | WS_MAXIMIZEBOX);
        RECT r = {0, 0, d.width, d.height};
        AdjustWindowRect(&r, style, FALSE);
        std::wstring wtitle(d.title.begin(), d.title.end());
        hwnd_ = CreateWindowExW(0, L"NovaForgeWindow", wtitle.c_str(), style, CW_USEDEFAULT,
                                CW_USEDEFAULT, r.right - r.left, r.bottom - r.top, nullptr,
                                nullptr, inst, this);
        if (!hwnd_) {
            NF_LOG_FATAL("Platform", "CreateWindowExW failed (error %lu)", GetLastError());
            closed_ = true;
            return;
        }
        stats_.cbSize = sizeof(stats_);
        QueryPerformanceFrequency(&freq_);
        QueryPerformanceCounter(&t0_);
        ShowWindow(hwnd_, SW_SHOW);
        UpdateWindow(hwnd_);
        NF_LOG_INFO("Platform", "Win32 window created %dx%d ('%s')", d.width, d.height,
                    d.title.c_str());
    }

    ~Win32Window() override {
        glDestroyContext();
        freeDib();
        if (hwnd_) DestroyWindow(hwnd_);
    }

    void pollOSEvents() override {
        MSG msg;
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        // Track window size directly - WM_SIZE can be missed on some drivers.
        RECT cr;
        if (hwnd_ && GetClientRect(hwnd_, &cr)) {
            int w = cr.right - cr.left, h = cr.bottom - cr.top;
            if (w > 0 && h > 0 && (w != width_ || h != height_)) {
                PlatformEvent e;
                e.type = PlatformEvent::Resize;
                e.width = w;
                e.height = h;
                pushEvent(e);
            }
        }
    }

    void present(const uint8_t* rgba, int w, int h) override {
        if (headless_) {
            lastFrame_.assign(rgba, rgba + (size_t)w * h * 4);
            lastW_ = w;
            lastH_ = h;
            return;
        }
        if (!ensureDib(w, h) || !hwnd_) return;
        // copy into the DIB (top-down, BGRA order expected by GDI)
        for (int y = 0; y < h; ++y) {
            const uint8_t* src = rgba + (size_t)y * w * 4;
            uint8_t* dst = dibBits_ + (size_t)y * dibStride_;
            for (int x = 0; x < w; ++x) {
                dst[x * 4 + 0] = src[x * 4 + 2];
                dst[x * 4 + 1] = src[x * 4 + 1];
                dst[x * 4 + 2] = src[x * 4 + 0];
                dst[x * 4 + 3] = 255;
            }
        }
        RECT cr;
        GetClientRect(hwnd_, &cr);
        int cw = cr.right - cr.left, ch = cr.bottom - cr.top;
        HDC dc = GetDC(hwnd_);
        if (cw == w && ch == h) {
            SetDIBitsToDevice(dc, 0, 0, w, h, 0, 0, 0, h, dibBits_, &dibInfo_, DIB_RGB_COLORS);
        } else {
            SetStretchBltMode(dc, HALFTONE);
            StretchDIBits(dc, 0, 0, cw, ch, 0, 0, w, h, dibBits_, &dibInfo_, DIB_RGB_COLORS,
                          SRCCOPY);
        }
        ReleaseDC(hwnd_, dc);
        lastFrame_.assign(rgba, rgba + (size_t)w * h * 4);
        lastW_ = w;
        lastH_ = h;
    }

    // ---- OpenGL ------------------------------------------------------
    bool hasGL() const override { return glrc_ != nullptr; }

    bool createGLContext() override {
        if (glrc_ || !hwnd_) return glrc_ != nullptr;
        hdc_ = GetDC(hwnd_);
        PIXELFORMATDESCRIPTOR pfd = {};
        pfd.nSize = sizeof(pfd);
        pfd.nVersion = 1;
        pfd.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
        pfd.iPixelType = PFD_TYPE_RGBA;
        pfd.cColorBits = 32;
        pfd.cDepthBits = 24;
        pfd.cStencilBits = 8;
        int pf = ChoosePixelFormat(hdc_, &pfd);
        if (!pf) {
            NF_LOG_ERROR("Platform", "ChoosePixelFormat failed - no OpenGL support");
            return false;
        }
        SetPixelFormat(hdc_, pf, &pfd);
        HGLRC tmp = wglCreateContext(hdc_);
        if (!tmp) {
            NF_LOG_ERROR("Platform", "wglCreateContext failed");
            return false;
        }
        wglMakeCurrent(hdc_, tmp);
        // Ask for a 3.3 core context (falls back to the compatibility one).
        typedef HGLRC(WINAPI * PFNWGLCREATECONTEXTATTRIBSARB)(HDC, HGLRC, const int*);
        auto createCtx = (PFNWGLCREATECONTEXTATTRIBSARB)wglGetProcAddress(
            "wglCreateContextAttribsARB");
        if (createCtx) {
            const int attribs[] = {0x2091 /*MAJOR*/, 3, 0x2092 /*MINOR*/, 3,
                                   0x9126 /*PROFILE_MASK*/, 0x0001 /*CORE*/, 0};
            HGLRC core = createCtx(hdc_, nullptr, attribs);
            if (core) {
                wglMakeCurrent(nullptr, nullptr);
                wglDeleteContext(tmp);
                glrc_ = core;
                wglMakeCurrent(hdc_, glrc_);
                NF_LOG_INFO("Platform", "OpenGL 3.3 core context created");
            } else {
                glrc_ = tmp;
                NF_LOG_WARN("Platform", "OpenGL 3.3 core unavailable, using compatibility context");
            }
        } else {
            glrc_ = tmp;
            NF_LOG_WARN("Platform", "wglCreateContextAttribsARB missing, using legacy context");
        }
        return true;
    }

    void* glGetProcAddress(const char* name) override {
        void* p = (void*)wglGetProcAddress(name);
        if (!p || p == (void*)1 || p == (void*)2 || p == (void*)3 || p == (void*)-1) {
            static HMODULE gl = LoadLibraryA("opengl32.dll");
            if (gl) p = (void*)GetProcAddress(gl, name);
        }
        return p;
    }
    void glMakeCurrent() override { if (glrc_) wglMakeCurrent(hdc_, glrc_); }
    void glSwapBuffers() override { if (hdc_) SwapBuffers(hdc_); }
    void glDestroyContext() override {
        if (glrc_) {
            wglMakeCurrent(nullptr, nullptr);
            wglDeleteContext(glrc_);
            glrc_ = nullptr;
        }
        if (hdc_ && hwnd_) { ReleaseDC(hwnd_, hdc_); hdc_ = nullptr; }
    }

    void setTitleOS(const std::string& t) override {
        if (hwnd_) SetWindowTextW(hwnd_, std::wstring(t.begin(), t.end()).c_str());
    }

    void setCursorCaptured(bool captured) override {
        cursorCaptured_ = captured;
        if (!hwnd_) return;
        if (captured) {
            RECT cr;
            GetClientRect(hwnd_, &cr);
            POINT tl = {cr.left, cr.top}, br = {cr.right, cr.bottom};
            ClientToScreen(hwnd_, &tl);
            ClientToScreen(hwnd_, &br);
            RECT clip = {tl.x, tl.y, br.x, br.y};
            ClipCursor(&clip);
            ShowCursor(FALSE);
        } else {
            ClipCursor(nullptr);
            ShowCursor(TRUE);
        }
    }

    void* nativeHandle() const override { return (void*)hwnd_; }

    const char* clipboardGet() override {
        clipCache_.clear();
        if (OpenClipboard(hwnd_)) {
            HANDLE h = GetClipboardData(CF_TEXT);
            if (h) {
                const char* p = (const char*)GlobalLock(h);
                if (p) {
                    clipCache_ = p;
                    GlobalUnlock(h);
                }
            }
            CloseClipboard();
        }
        return clipCache_.c_str();
    }
    void clipboardSet(const char* text) override {
        if (!OpenClipboard(hwnd_)) return;
        EmptyClipboard();
        size_t n = strlen(text ? text : "") + 1;
        HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, n);
        if (mem) {
            memcpy(GlobalLock(mem), text ? text : "", n);
            GlobalUnlock(mem);
            SetClipboardData(CF_TEXT, mem);
        }
        CloseClipboard();
    }

    bool wantsQuit() const { return wantsClose_; }

private:
    static LRESULT CALLBACK wndProcStatic(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        if (msg == WM_NCCREATE) {
            auto cs = (CREATESTRUCTW*)lp;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, (LONG_PTR)cs->lpCreateParams);
        }
        auto self = (Win32Window*)GetWindowLongPtrW(hwnd, GWLP_USERDATA);
        if (self) return self->wndProc(hwnd, msg, wp, lp);
        return DefWindowProcW(hwnd, msg, wp, lp);
    }

    LRESULT wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
        auto mouseEvent = [&](PlatformEvent::Type t) {
            PlatformEvent e;
            e.type = t;
            e.x = (float)(short)LOWORD(lp);
            e.y = (float)(short)HIWORD(lp);
            e.mods = modsFromOS();
            return e;
        };
        switch (msg) {
            case WM_CLOSE:
            case WM_DESTROY: {
                PlatformEvent e;
                e.type = PlatformEvent::CloseRequested;
                pushEvent(e);
                closed_ = true;
                return 0;
            }
            case WM_SIZE: {
                PlatformEvent e;
                e.type = PlatformEvent::Resize;
                e.width = LOWORD(lp);
                e.height = HIWORD(lp);
                pushEvent(e);
                return 0;
            }
            case WM_SETFOCUS: {
                PlatformEvent e; e.type = PlatformEvent::FocusGained; pushEvent(e);
                return 0;
            }
            case WM_KILLFOCUS: {
                PlatformEvent e; e.type = PlatformEvent::FocusLost; pushEvent(e);
                return 0;
            }
            case WM_KEYDOWN:
            case WM_SYSKEYDOWN: {
                Key k = vkToKey(wp);
                if (k != Key::None) {
                    PlatformEvent e;
                    e.type = PlatformEvent::KeyDown;
                    e.key = k;
                    e.mods = modsFromOS();
                    pushEvent(e);
                }
                if (wp == VK_F4 && (modsFromOS() & ModAlt)) { PostQuitMessage(0); closed_ = true; }
                return 0;
            }
            case WM_KEYUP:
            case WM_SYSKEYUP: {
                Key k = vkToKey(wp);
                if (k != Key::None) {
                    PlatformEvent e;
                    e.type = PlatformEvent::KeyUp;
                    e.key = k;
                    e.mods = modsFromOS();
                    pushEvent(e);
                }
                return 0;
            }
            case WM_CHAR: {
                PlatformEvent e;
                e.type = PlatformEvent::TextInput;
                unsigned c = (unsigned)wp;
                if (c >= 0xD800 && c <= 0xDBFF) { pendingHighSurrogate_ = c; return 0; }
                if (c >= 0xDC00 && c <= 0xDFFF && pendingHighSurrogate_) {
                    c = 0x10000 + ((pendingHighSurrogate_ - 0xD800) << 10) + (c - 0xDC00);
                    pendingHighSurrogate_ = 0;
                } else {
                    pendingHighSurrogate_ = 0;
                }
                if (c < 32) return 0;
                e.codepoint = c;
                pushEvent(e);
                return 0;
            }
            case WM_MOUSEMOVE: {
                POINT p = {(short)LOWORD(lp), (short)HIWORD(lp)};
                POINT prev = p;
                if (haveMouse_) {
                    PlatformEvent e = mouseEvent(PlatformEvent::MouseMove);
                    e.dx = (float)(p.x - lastMouse_.x);
                    e.dy = (float)(p.y - lastMouse_.y);
                    pushEvent(e);
                } else {
                    haveMouse_ = true;
                }
                lastMouse_ = p;
                (void)prev;
                return 0;
            }
            case WM_LBUTTONDOWN:
            case WM_RBUTTONDOWN:
            case WM_MBUTTONDOWN: {
                PlatformEvent e = mouseEvent(PlatformEvent::MouseDown);
                e.button = msg == WM_LBUTTONDOWN ? MouseButton::Left
                           : msg == WM_RBUTTONDOWN ? MouseButton::Right
                                                   : MouseButton::Middle;
                pushEvent(e);
                SetCapture(hwnd);
                return 0;
            }
            case WM_LBUTTONUP:
            case WM_RBUTTONUP:
            case WM_MBUTTONUP: {
                PlatformEvent e = mouseEvent(PlatformEvent::MouseUp);
                e.button = msg == WM_LBUTTONUP ? MouseButton::Left
                           : msg == WM_RBUTTONUP ? MouseButton::Right
                                                 : MouseButton::Middle;
                pushEvent(e);
                ReleaseCapture();
                return 0;
            }
            case WM_MOUSEWHEEL: {
                PlatformEvent e;
                e.type = PlatformEvent::MouseWheel;
                e.wheel = (float)GET_WHEEL_DELTA_WPARAM(wp) / (float)WHEEL_DELTA;
                e.x = input_.mouseX;
                e.y = input_.mouseY;
                pushEvent(e);
                return 0;
            }
            case WM_ERASEBKGND:
                return 1;  // we paint the whole client area ourselves
            default:
                break;
        }
        return DefWindowProcW(hwnd, msg, wp, lp);
    }

    bool ensureDib(int w, int h) {
        if (dibBits_ && dibW_ == w && dibH_ == h) return true;
        freeDib();
        ZeroMemory(&dibInfo_, sizeof(dibInfo_));
        dibInfo_.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        dibInfo_.bmiHeader.biWidth = w;
        dibInfo_.bmiHeader.biHeight = -h;  // top-down
        dibInfo_.bmiHeader.biPlanes = 1;
        dibInfo_.bmiHeader.biBitCount = 32;
        dibInfo_.bmiHeader.biCompression = BI_RGB;
        HDC dc = GetDC(hwnd_);
        HBITMAP bmp = CreateDIBSection(dc, &dibInfo_, DIB_RGB_COLORS, (void**)&dibBits_, nullptr, 0);
        ReleaseDC(hwnd_, dc);
        if (!bmp) {
            NF_LOG_ERROR("Platform", "CreateDIBSection failed");
            return false;
        }
        dibBmp_ = bmp;
        dibW_ = w;
        dibH_ = h;
        dibStride_ = w * 4;
        return true;
    }
    void freeDib() {
        if (dibBmp_) DeleteObject(dibBmp_);
        dibBmp_ = nullptr;
        dibBits_ = nullptr;
        dibW_ = dibH_ = 0;
    }

    WindowDesc desc_;
    HWND hwnd_ = nullptr;
    HDC hdc_ = nullptr;
    HGLRC glrc_ = nullptr;
    HBITMAP dibBmp_ = nullptr;
    uint8_t* dibBits_ = nullptr;
    BITMAPINFO dibInfo_ = {};
    int dibW_ = 0, dibH_ = 0, dibStride_ = 0;
    POINT lastMouse_ = {0, 0};
    bool haveMouse_ = false;
    unsigned pendingHighSurrogate_ = 0;
    LARGE_INTEGER freq_ = {}, t0_ = {};
    std::string clipCache_;
};

Window* createWin32Window(const WindowDesc& desc) { return new Win32Window(desc); }

// ------------------------------------------------------------- OS services
std::string openFileDialog(const std::string& title,
                           const std::vector<std::pair<std::string, std::string>>& filters,
                           const std::string& defaultDir) {
    std::string filterStr;
    for (auto& f : filters) {
        filterStr += f.first + " (" + f.second + ")";
        filterStr.push_back('\0');
        filterStr += f.second;
        filterStr.push_back('\0');
    }
    filterStr += "All files (*.*)";
    filterStr.push_back('\0');
    filterStr += "*.*";
    filterStr.push_back('\0');
    filterStr.push_back('\0');

    char buf[MAX_PATH] = {0};
    if (!defaultDir.empty()) {
        strncpy(buf, defaultDir.c_str(), MAX_PATH - 1);
    }
    OPENFILENAMEA ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.hwndOwner = nullptr;
    ofn.lpstrFilter = filterStr.c_str();
    ofn.lpstrFile = buf;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = title.c_str();
    ofn.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_EXPLORER;
    if (GetOpenFileNameA(&ofn)) return fs::normalize(buf);
    return "";
}

std::string saveFileDialog(const std::string& title, const std::string& defaultName,
                           const std::vector<std::pair<std::string, std::string>>& filters) {
    std::string filterStr;
    for (auto& f : filters) {
        filterStr += f.first + " (" + f.second + ")";
        filterStr.push_back('\0');
        filterStr += f.second;
        filterStr.push_back('\0');
    }
    filterStr.push_back('\0');

    char buf[MAX_PATH] = {0};
    strncpy(buf, defaultName.c_str(), MAX_PATH - 1);
    OPENFILENAMEA ofn = {};
    ofn.lStructSize = sizeof(ofn);
    ofn.lpstrFilter = filterStr.c_str();
    ofn.lpstrFile = buf;
    ofn.nMaxFile = MAX_PATH;
    ofn.lpstrTitle = title.c_str();
    ofn.Flags = OFN_OVERWRITEPROMPT | OFN_EXPLORER | OFN_PATHMUSTEXIST;
    if (GetSaveFileNameA(&ofn)) return fs::normalize(buf);
    return "";
}

void showMessageBox(const std::string& title, const std::string& message, bool error) {
    MessageBoxA(nullptr, message.c_str(), title.c_str(),
                MB_OK | (error ? MB_ICONERROR : MB_ICONINFORMATION));
}

}  // namespace nf
