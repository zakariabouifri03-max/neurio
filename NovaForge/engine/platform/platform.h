// NovaForge Engine - platform layer (window, input, events)
//
// Backends:  platform_win32.cpp     (shipping desktop target: Windows)
//            platform_x11.cpp       (Linux desktop / CI)
//            platform_offscreen.cpp (headless: automated tests, screenshots,
//                                    video capture - no GPU, no display)
//
// All UI (ImGui) and gameplay input flows through this layer, so every
// backend is interchangeable and editor/game logic is identical everywhere.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace nf {

// ------------------------------------------------------------------ keys
enum class Key : int {
    None = 0,
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z,
    Num0, Num1, Num2, Num3, Num4, Num5, Num6, Num7, Num8, Num9,
    F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
    Escape, Enter, Tab, Backspace, Delete, Insert, Space,
    LeftShift, RightShift, LeftCtrl, RightCtrl, LeftAlt, RightAlt, LeftSuper, RightSuper,
    Up, Down, Left, Right, Home, End, PageUp, PageDown,
    Minus, Equal, LeftBracket, RightBracket, Semicolon, Apostrophe, Comma, Period,
    Slash, Backslash, Grave, CapsLock, PrintScreen, Pause,
    Keypad0, Keypad1, Keypad2, Keypad3, Keypad4, Keypad5, Keypad6, Keypad7,
    Keypad8, Keypad9, KeypadDecimal, KeypadDivide, KeypadMultiply, KeypadMinus,
    KeypadPlus, KeypadEnter,
    Count
};

enum KeyMod {
    ModNone = 0,
    ModShift = 1 << 0,
    ModCtrl = 1 << 1,
    ModAlt = 1 << 2,
    ModSuper = 1 << 3,
};

enum class MouseButton { Left = 0, Right = 1, Middle = 2, Count = 3 };

const char* keyName(Key k);
// Parses a key name ("W", "Space", "LeftShift", "F5") back into a Key.
// Returns Key::None when the name is unknown (input bindings fall back to that).
Key keyFromName(const std::string& name);

// ------------------------------------------------------------------ events
struct PlatformEvent {
    enum Type {
        KeyDown, KeyUp, TextInput, MouseMove, MouseDown, MouseUp, MouseWheel,
        Resize, FocusGained, FocusLost, CloseRequested
    } type;
    Key key = Key::None;
    int mods = ModNone;
    unsigned codepoint = 0;
    float x = 0, y = 0;       // mouse position (virtual pixels)
    float dx = 0, dy = 0;     // motion delta
    float wheel = 0;
    MouseButton button = MouseButton::Left;
    int width = 0, height = 0;
};

struct InputState {
    bool keyDown[(int)Key::Count] = {false};
    bool keyPressed[(int)Key::Count] = {false};
    bool keyReleased[(int)Key::Count] = {false};
    bool mouseDown[3] = {false, false, false};
    bool mousePressed[3] = {false, false, false};
    bool mouseReleased[3] = {false, false, false};
    float mouseX = 0, mouseY = 0;
    float mouseDX = 0, mouseDY = 0;
    float wheel = 0;
    int mods = ModNone;

    bool down(Key k) const { return keyDown[(int)k]; }
    bool pressed(Key k) const { return keyPressed[(int)k]; }
    bool released(Key k) const { return keyReleased[(int)k]; }
    // clear per-frame edge data; call at the start of a frame
    void beginFrame() {
        for (int i = 0; i < (int)Key::Count; ++i) keyPressed[i] = keyReleased[i] = false;
        for (int i = 0; i < 3; ++i) mousePressed[i] = mouseReleased[i] = false;
        mouseDX = mouseDY = 0;
        wheel = 0;
    }
};

struct WindowDesc {
    std::string title = "NovaForge";
    int width = 1600;
    int height = 900;
    bool headless = false;        // run without a display (tests / capture)
    bool resizable = true;
    bool gl = false;              // request an OpenGL context (else software blit)
    bool captureDir = false;      // keep the mouse inside the window (FPS mode)
};

class Window {
public:
    virtual ~Window() = default;

    // pump the OS event queue; returns false when the window should close
    bool pumpEvents();
    virtual void pollOSEvents() = 0;

    int width() const { return width_; }
    int height() const { return height_; }
    bool closed() const { return closed_; }
    bool shouldClose() const { return closed_ || wantsClose_; }
    void requestClose() { wantsClose_ = true; }
    void setTitle(const std::string& t);
    virtual void setTitleOS(const std::string& t) {}
    void resize(int w, int h);

    bool hasFocus() const { return focused_; }
    void setFocus(bool f) { focused_ = f; }

    InputState& input() { return input_; }
    const InputState& input() const { return input_; }
    const std::vector<PlatformEvent>& events() const { return events_; }
    void clearEvents() { events_.clear(); }

    // ---- presentation ------------------------------------------------
    // Software path: hand the platform an RGBA8 image to blit.
    virtual void present(const uint8_t* rgba, int w, int h) = 0;
    // Headless / capture path: the last presented image (also filled by the
    // offscreen backend for screenshots and the automated test suite).
    const std::vector<uint8_t>& lastFrame() const { return lastFrame_; }
    int lastFrameWidth() const { return lastW_; }
    int lastFrameHeight() const { return lastH_; }

    // ---- OpenGL (NF_ENABLE_GL) --------------------------------------
    virtual bool hasGL() const { return false; }
    // Create the platform GL context (returns false when unavailable, in which
    // case the engine falls back to the software rasterizer).
    virtual bool createGLContext() { return false; }
    virtual void* glGetProcAddress(const char* name) { (void)name; return nullptr; }
    virtual void glMakeCurrent() {}
    virtual void glSwapBuffers() {}
    virtual void glDestroyContext() {}

    // ---- cursor / clipboard -----------------------------------------
    virtual void setCursorCaptured(bool captured) { cursorCaptured_ = captured; }
    bool cursorCaptured() const { return cursorCaptured_; }
    virtual const char* clipboardGet() { return clipboard_.c_str(); }
    virtual void clipboardSet(const char* text) { clipboard_ = text ? text : ""; }
    std::string clipboard_;

    const std::string& title() const { return title_; }
    bool headless() const { return headless_; }
    virtual void* nativeHandle() const { return nullptr; }

    // Test hook: inject synthetic input (used by tests and the capture tool).
    void injectKey(Key k, bool down, int mods = ModNone);
    void injectMouseMove(float x, float y);
    void injectMouseButton(MouseButton b, bool down);
    void injectWheel(float d);
    void injectChar(unsigned cp);

protected:
    std::vector<uint8_t> lastFrame_;
    int lastW_ = 0, lastH_ = 0;
    std::string title_;
    int width_ = 1600, height_ = 900;
    bool closed_ = false, wantsClose_ = false, focused_ = true, headless_ = false;
    bool cursorCaptured_ = false;
    InputState input_;
    std::vector<PlatformEvent> events_;
    // helpers for backends
    void applyEvent(const PlatformEvent& e);
    void pushEvent(const PlatformEvent& e) { events_.push_back(e); applyEvent(e); }
};

Window* createWindow(const WindowDesc& desc);
// Backend factories (one per platform translation unit)
Window* createOffscreenWindow(const WindowDesc& desc);   // platform_offscreen.cpp
Window* createWin32Window(const WindowDesc& desc);       // platform_win32.cpp (NF_PLATFORM_WINDOWS)

// ---- OS integration (implemented per backend) ------------------------
double timeSeconds();                     // monotonic clock
void sleepMilliseconds(int ms);
// Native file dialogs. Returns empty string when cancelled.
std::string openFileDialog(const std::string& title,
                           const std::vector<std::pair<std::string, std::string>>& filters,
                           const std::string& defaultDir = "");
std::string saveFileDialog(const std::string& title, const std::string& defaultName,
                           const std::vector<std::pair<std::string, std::string>>& filters);
void showMessageBox(const std::string& title, const std::string& message, bool error = false);
const char* platformName();

}  // namespace nf
