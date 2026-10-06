// NovaForge Engine - platform/Platform.cpp  (shared, platform independent parts)
#include "platform/Platform.h"
#include "core/Log.h"

#if NF_PLATFORM_WINDOWS
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  include <unistd.h>
#  include <cstdlib>
#endif

namespace nf::platform {

// ------------------------------------------------------------------ InputState
void InputState::NewFrame() {
  mouseDelta_ = Vec2(0, 0);
  wheelDelta_ = 0;
  text_.clear();
  textCount_ = 0;
}

void InputState::EndFrame() {
  memcpy(prevKeys_, keys_, sizeof(keys_));
  memcpy(prevMouse_, mouse_, sizeof(mouse_));
}

void InputState::SetKey(int key, bool down) {
  if (key > 0 && key < (int)Key::Count) keys_[key] = down;
}

void InputState::SetMouseButton(int button, bool down) {
  if (button >= 0 && button < (int)MouseButton::Count) mouse_[button] = down;
}

void InputState::AccumulateMouseDelta(f32 dx, f32 dy) {
  mouseDelta_.x += dx;
  mouseDelta_.y += dy;
}

void InputState::SetMousePosition(f32 x, f32 y) {
  mousePos_.x = x;
  mousePos_.y = y;
}

// ------------------------------------------------------------------ OS helpers
void SleepMs(int ms) {
#if NF_PLATFORM_WINDOWS
  Sleep((DWORD)ms);
#else
  usleep((useconds_t)ms * 1000);
#endif
}

std::string ReadEnvironmentVariable(const std::string& name) {
#if NF_PLATFORM_WINDOWS
  char buffer[2048];
  DWORD n = GetEnvironmentVariableA(name.c_str(), buffer, (DWORD)sizeof(buffer));
  return n > 0 && n < (DWORD)sizeof(buffer) ? std::string(buffer, n) : std::string();
#else
  const char* v = ::getenv(name.c_str());
  return v ? v : "";
#endif
}

} // namespace nf::platform
