// NovaForge Engine - core/Time.h
#pragma once

#include "core/Base.h"

namespace nf {

// Frame/clock services. The runtime feeds this each frame; systems read it.
struct Time {
  f32 deltaTime = 0.0f;      // seconds, clamped
  f32 unscaledDelta = 0.0f;  // real seconds
  f32 timeScale = 1.0f;      // slow-motion / pause scaling
  f64 totalTime = 0.0;
  u64 frameIndex = 0;
  u32 fps = 0;
  f32 fpsAccum = 0.0f;
  u32 fpsFrames = 0;

  void Tick(f64 rawDelta) {
    unscaledDelta = (f32)rawDelta;
    deltaTime = (f32)rawDelta * timeScale;
    if (deltaTime > 0.1f) deltaTime = 0.1f;   // avoid physics explosions after a stall
    totalTime += rawDelta;
    frameIndex++;
    fpsAccum += (f32)rawDelta;
    fpsFrames++;
    if (fpsAccum >= 0.5f) {
      fps = (u32)(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
    }
  }
};

f64 NowSeconds();

// Human readable local timestamp ("2026-10-07 14:03:22"). Generated at run time so builds
// stay reproducible (no __DATE__/__TIME__ in the generated sources).
std::string TimestampString(bool dateAndTime = true);     // monotonic wall clock

} // namespace nf
