// NovaForge Engine - platform layer, common (backend independent) code
#include "platform/platform.h"
#include "core/log.h"

#include <chrono>
#include <cstring>
#include <thread>

namespace nf {

const char* keyName(Key k) {
    static const char* names[] = {
        "None", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
        "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
        "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
        "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
        "Escape", "Enter", "Tab", "Backspace", "Delete", "Insert", "Space",
        "LeftShift", "RightShift", "LeftCtrl", "RightCtrl", "LeftAlt", "RightAlt",
        "LeftSuper", "RightSuper", "Up", "Down", "Left", "Right", "Home", "End",
        "PageUp", "PageDown", "Minus", "Equal", "LeftBracket", "RightBracket",
        "Semicolon", "Apostrophe", "Comma", "Period", "Slash", "Backslash", "Grave",
        "CapsLock", "PrintScreen", "Pause",
        "Keypad0", "Keypad1", "Keypad2", "Keypad3", "Keypad4", "Keypad5", "Keypad6",
        "Keypad7", "Keypad8", "Keypad9", "KeypadDecimal", "KeypadDivide",
        "KeypadMultiply", "KeypadMinus", "KeypadPlus", "KeypadEnter",
    };
    int i = (int)k;
    if (i < 0 || i >= (int)(sizeof(names) / sizeof(names[0]))) return "?";
    return names[i];
}

Key keyFromName(const std::string& name) {
    if (name.empty()) return Key::None;
    for (int i = 0; i < (int)Key::Count; ++i) {
        const char* n = keyName((Key)i);
        if (n && name == n) return (Key)i;
    }
    // friendly aliases used in project input bindings and scripts
    if (name == "Shift") return Key::LeftShift;
    if (name == "Ctrl") return Key::LeftCtrl;
    if (name == "Alt") return Key::LeftAlt;
    if (name == "Return") return Key::Enter;
    if (name == "Esc") return Key::Escape;
    return Key::None;
}

void Window::applyEvent(const PlatformEvent& e) {
    switch (e.type) {
        case PlatformEvent::KeyDown:
            if (!input_.keyDown[(int)e.key]) input_.keyPressed[(int)e.key] = true;
            input_.keyDown[(int)e.key] = true;
            input_.mods = e.mods;
            break;
        case PlatformEvent::KeyUp:
            input_.keyDown[(int)e.key] = false;
            input_.keyReleased[(int)e.key] = true;
            input_.mods = e.mods;
            break;
        case PlatformEvent::MouseMove:
            input_.mouseX = e.x;
            input_.mouseY = e.y;
            input_.mouseDX += e.dx;
            input_.mouseDY += e.dy;
            break;
        case PlatformEvent::MouseDown: {
            int b = (int)e.button;
            if (b >= 0 && b < 3) {
                if (!input_.mouseDown[b]) input_.mousePressed[b] = true;
                input_.mouseDown[b] = true;
            }
            input_.mouseX = e.x;
            input_.mouseY = e.y;
            break;
        }
        case PlatformEvent::MouseUp: {
            int b = (int)e.button;
            if (b >= 0 && b < 3) {
                input_.mouseDown[b] = false;
                input_.mouseReleased[b] = true;
            }
            input_.mouseX = e.x;
            input_.mouseY = e.y;
            break;
        }
        case PlatformEvent::MouseWheel:
            input_.wheel += e.wheel;
            break;
        case PlatformEvent::Resize:
            resize(e.width, e.height);
            break;
        case PlatformEvent::FocusGained:
            focused_ = true;
            break;
        case PlatformEvent::FocusLost:
            focused_ = false;
            break;
        case PlatformEvent::CloseRequested:
            wantsClose_ = true;
            break;
        default:
            break;
    }
}

bool Window::pumpEvents() {
    events_.clear();
    pollOSEvents();
    return !shouldClose();
}

void Window::setTitle(const std::string& t) {
    title_ = t;
    setTitleOS(t);
}

void Window::resize(int w, int h) {
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    width_ = w;
    height_ = h;
}

void Window::injectKey(Key k, bool down, int mods) {
    PlatformEvent e;
    e.type = down ? PlatformEvent::KeyDown : PlatformEvent::KeyUp;
    e.key = k;
    e.mods = mods;
    pushEvent(e);
}

void Window::injectMouseMove(float x, float y) {
    PlatformEvent e;
    e.type = PlatformEvent::MouseMove;
    e.x = x;
    e.y = y;
    e.dx = x - input_.mouseX;
    e.dy = y - input_.mouseY;
    pushEvent(e);
}

void Window::injectMouseButton(MouseButton b, bool down) {
    PlatformEvent e;
    e.type = down ? PlatformEvent::MouseDown : PlatformEvent::MouseUp;
    e.button = b;
    e.x = input_.mouseX;
    e.y = input_.mouseY;
    pushEvent(e);
}

void Window::injectWheel(float d) {
    PlatformEvent e;
    e.type = PlatformEvent::MouseWheel;
    e.wheel = d;
    pushEvent(e);
}

void Window::injectChar(unsigned cp) {
    PlatformEvent e;
    e.type = PlatformEvent::TextInput;
    e.codepoint = cp;
    pushEvent(e);
}

double timeSeconds() {
    using namespace std::chrono;
    static auto t0 = steady_clock::now();
    return duration<double>(steady_clock::now() - t0).count();
}

void sleepMilliseconds(int ms) {
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

// ------------------------------------------------------------------ factory
Window* createWindow(const WindowDesc& desc) {
    if (desc.headless) return createOffscreenWindow(desc);
#if defined(NF_PLATFORM_WINDOWS)
    Window* w = createWin32Window(desc);
    if (w && desc.gl) {
    }
    return w;
#else
    // Linux/other desktop builds of V1 ship the headless + capture path.
    // (Windows is the shipping desktop target, see docs/ARCHITECTURE.md)
    NF_LOG_WARN("Platform",
                "no native window backend in this build - running headless (%dx%d). "
                "Build with --target windows-editor for the Windows desktop editor.",
                desc.width, desc.height);
    WindowDesc d = desc;
    d.headless = true;
    return createOffscreenWindow(d);
#endif
}

const char* platformName() {
#if defined(NF_PLATFORM_WINDOWS)
    return "Windows";
#elif defined(NF_PLATFORM_LINUX)
    return "Linux";
#else
    return "Unknown";
#endif
}

}  // namespace nf
