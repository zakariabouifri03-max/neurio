// NovaForge Engine - platform/null/NullPlatform.cpp
// Head-less backend used by the native (dev/test) builds: no window, no GL.
// It lets the whole engine (scene, physics, AI, scripting, build system) be
// exercised deterministically without a display.
#include "platform/Platform.h"
#include "core/Log.h"

#include <chrono>
#include <thread>

#if !NF_PLATFORM_WINDOWS

namespace nf::platform {

namespace {

class NullWindow : public Window {
public:
  bool Create(const WindowDesc& desc) override {
    width_ = desc.width;
    height_ = desc.height;
    close_ = false;
    NF_INFO(LogCategory::Core, "Head-less window created (%dx%d) - no GPU context available",
            width_, height_);
    return true;
  }
  void Destroy() override {}
  void Show() override {}
  void PollEvents() override { input_.EndFrame(); input_.NewFrame(); }
  void SwapBuffers() override {}
  bool ShouldClose() const override { return close_; }
  void RequestClose() override { close_ = true; }
  void SetTitle(const std::string&) override {}
  void SetCursorVisible(bool) override {}
  void SetMouseCaptured(bool) override {}
  bool IsMouseCaptured() const override { return false; }
  void Resize(int w, int h) override { width_ = w; height_ = h; }
  void SetFullscreen(bool) override {}
  int Width() const override { return width_; }
  int Height() const override { return height_; }
  bool IsFocused() const override { return true; }
  bool IsMinimized() const override { return false; }
  InputState& Input() override { return input_; }
  void* NativeHandle() const override { return nullptr; }
  bool HasGLContext() const override { return false; }

private:
  int width_ = 1280, height_ = 720;
  bool close_ = false;
  InputState input_;
};

} // namespace

std::unique_ptr<Window> CreatePlatformWindow() { return std::make_unique<NullWindow>(); }

void PlatformInitialize() {}
void PlatformShutdown() {}
void EnsureConsoleVisible() {}
void SetConsoleVisible(bool) {}
// SleepMs / GetEnvironmentVariable live in platform/Platform.cpp (shared by all backends).

std::string OpenFileDialog(Window*, const std::string&, const std::vector<FileDialogFilter>&) {
  return {};
}
std::string SaveFileDialog(Window*, const std::string&, const std::vector<FileDialogFilter>&,
                           const std::string&) {
  return {};
}
std::string SelectFolderDialog(Window*, const std::string&) { return {}; }
void ShowMessageBox(const std::string& title, const std::string& text, bool isError) {
  if (isError) NF_ERROR(LogCategory::Core, "%s: %s", title.c_str(), text.c_str());
  else NF_INFO(LogCategory::Core, "%s: %s", title.c_str(), text.c_str());
}

} // namespace nf::platform

#endif // !NF_PLATFORM_WINDOWS
