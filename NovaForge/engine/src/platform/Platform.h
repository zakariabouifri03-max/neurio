// NovaForge Engine - platform/Platform.h
// Window / OS abstraction. The editor and the exported game both talk to this
// interface only, which is what allows editor and runtime to share the renderer.
#pragma once

#include "core/Base.h"
#include "core/Math.h"

// Windows headers define several of the names below as macros. Undefine them so any
// translation unit that pulls in <windows.h> before this header still compiles.
#ifdef CreateWindow
#  undef CreateWindow
#endif
#ifdef IsMinimized
#  undef IsMinimized
#endif
#ifdef MessageBox
#  undef MessageBox
#endif
// windows.h maps GetEnvironmentVariable to GetEnvironmentVariableA/W; the engine helper is
// named differently on purpose so no macro can ever capture it (see ReadEnvironmentVariable).
#ifdef LoadImage
#  undef LoadImage
#endif

namespace nf::platform {

enum class Key : int {
  Unknown = 0,
  A = 65, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z,
  Num0 = 48, Num1, Num2, Num3, Num4, Num5, Num6, Num7, Num8, Num9,
  Escape = 256, Enter, Tab, Backspace, Insert, Delete, Right, Left, Down, Up,
  PageUp, PageDown, Home, End, CapsLock, ScrollLock, NumLock, PrintScreen, Pause,
  F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
  Space = 32, Apostrophe = 39, Comma = 44, Minus = 45, Period = 46, Slash = 47,
  Semicolon = 59, Equal = 61, LeftBracket = 91, Backslash = 92, RightBracket = 93,
  Grave = 96,
  LeftShift = 512, RightShift, LeftCtrl, RightCtrl, LeftAlt, RightAlt, LeftSuper, RightSuper,
  Count = 640
};

enum class MouseButton : int { Left = 0, Right, Middle, X1, X2, Count };

struct WindowDesc {
  std::string title = "NovaForge Engine";
  int width = 1600;
  int height = 900;
  bool vsync = true;
  bool resizable = true;
  bool fullscreen = false;
  bool showConsole = false;   // exported game: keep a console window for logs
  bool softwareRenderer = false;
};

// Keyboard/mouse state shared by the editor and the game runtime.
class InputState {
public:
  void NewFrame();      // call once per frame *before* processing events
  void EndFrame();      // copies current -> previous

  bool IsKeyDown(Key k) const { return keys_[(int)k]; }
  bool WasKeyPressed(Key k) const { return keys_[(int)k] && !prevKeys_[(int)k]; }
  bool WasKeyReleased(Key k) const { return !keys_[(int)k] && prevKeys_[(int)k]; }

  bool IsMouseDown(MouseButton b) const { return mouse_[(int)b]; }
  bool WasMousePressed(MouseButton b) const { return mouse_[(int)b] && !prevMouse_[(int)b]; }
  bool WasMouseReleased(MouseButton b) const { return !mouse_[(int)b] && prevMouse_[(int)b]; }

  Vec2 MousePosition() const { return mousePos_; }
  Vec2 MouseDelta() const { return mouseDelta_; }
  f32 WheelDelta() const { return wheelDelta_; }

  bool TextInputThisFrame() const { return textCount_ > 0; }
  const std::string& TextInput() const { return text_; }

  // ---- written by the platform backend
  void SetKey(int key, bool down);
  void SetMouseButton(int button, bool down);
  void AccumulateMouseDelta(f32 dx, f32 dy);
  void SetMousePosition(f32 x, f32 y);
  void AddWheel(f32 d) { wheelDelta_ += d; }
  void AddText(char c) { text_.push_back(c); textCount_++; }
  void AddText(const std::string& s) { text_ += s; textCount_ += (int)s.size(); }
  void SetCharCallback(std::function<void(unsigned int)> cb) { charCallback_ = std::move(cb); }
  const std::function<void(unsigned int)>& CharCallback() const { return charCallback_; }

private:
  bool keys_[(int)Key::Count] = {};
  bool prevKeys_[(int)Key::Count] = {};
  bool mouse_[(int)MouseButton::Count] = {};
  bool prevMouse_[(int)MouseButton::Count] = {};
  Vec2 mousePos_{};
  Vec2 mouseDelta_{};
  f32 wheelDelta_ = 0;
  std::string text_;
  int textCount_ = 0;
  std::function<void(unsigned int)> charCallback_;
};

class Window {
public:
  virtual ~Window() = default;
  virtual bool Create(const WindowDesc& desc) = 0;
  virtual void Destroy() = 0;
  virtual void Show() = 0;
  virtual void PollEvents() = 0;
  virtual void SwapBuffers() = 0;
  virtual bool ShouldClose() const = 0;
  virtual void RequestClose() = 0;

  virtual void SetTitle(const std::string& title) = 0;
  virtual void SetCursorVisible(bool visible) = 0;
  virtual void SetMouseCaptured(bool captured) = 0;
  virtual bool IsMouseCaptured() const = 0;
  virtual void Resize(int width, int height) = 0;
  virtual void SetFullscreen(bool fullscreen) = 0;

  virtual int Width() const = 0;
  virtual int Height() const = 0;
  virtual f32 DpiScale() const { return 1.0f; }
  virtual bool IsFocused() const = 0;
  virtual bool IsMinimized() const = 0;
  virtual InputState& Input() = 0;
  virtual void* NativeHandle() const = 0;     // HWND on Windows

  // OpenGL context management (no-ops on the headless backend).
  virtual bool HasGLContext() const { return true; }
  virtual void MakeContextCurrent() {}
  virtual void* GetGLProcAddress(const char* name) { return nullptr; }

  // Notified whenever the client area changes size (used to resize the framebuffer).
  virtual void SetResizeCallback(std::function<void(int, int)> callback) {
    resizeCallback_ = std::move(callback);
  }

protected:
  std::function<void(int, int)> resizeCallback_;
};

// Factory implemented per platform (win32 / null).
std::unique_ptr<Window> CreatePlatformWindow();

// ---- platform lifecycle (implemented by the win32 / null backend)
void PlatformInitialize();
void PlatformShutdown();
void EnsureConsoleVisible();       // exported game: attach/create a console for logs
void SetConsoleVisible(bool visible);   // hide the console window of a console-subsystem game
void SleepMs(int ms);

// OS services
struct FileDialogFilter { std::string description; std::string pattern; };
std::string OpenFileDialog(Window* parent, const std::string& title,
                           const std::vector<FileDialogFilter>& filters);
std::string SaveFileDialog(Window* parent, const std::string& title,
                           const std::vector<FileDialogFilter>& filters,
                           const std::string& defaultName = "");
std::string SelectFolderDialog(Window* parent, const std::string& title);
void ShowMessageBox(const std::string& title, const std::string& text, bool isError = false);
std::string ReadEnvironmentVariable(const std::string& name);

} // namespace nf::platform
