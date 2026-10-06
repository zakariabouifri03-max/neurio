// NovaForge Engine - audio/AudioSystem.h
// Voice-based audio playback. Windows builds mix through miniaudio (WASAPI);
// head-less builds use the same mixer with a null sink so gameplay logic that
// depends on sound timing (and the test-suite) still behaves identically.
#pragma once

#include "core/Base.h"
#include "core/Math.h"
#include "assets/AssetDatabase.h"

namespace nf {

struct AudioVoice {
  u64 id = 0;
  std::string clipPath;
  f32 volume = 1.0f;
  f32 pitch = 1.0f;
  bool loop = false;
  bool spatial = false;
  bool playing = false;
  Vec3 position{0, 0, 0};
  f32 minDistance = 1.0f;
  f32 maxDistance = 25.0f;
  f32 time = 0.0f;          // seconds played
  f32 duration = 0.0f;
  f32 effectiveVolume = 1.0f;
};

class AudioSystem {
public:
  AudioSystem();
  ~AudioSystem();

  bool Initialize(f32 masterVolume = 0.8f);
  void Shutdown();
  bool IsInitialized() const { return initialized_; }
  bool HasOutputDevice() const { return hasDevice_; }
  const std::string& BackendName() const { return backend_; }

  // Called once per frame by the runtime: keeps voice positions and attenuation current.
  void Update(const Vec3& listenerPosition, const Vec3& listenerForward, const Vec3& listenerUp,
              f32 deltaTime);

  u64 Play(const std::string& clipPath, f32 volume = 1.0f, bool loop = false, f32 pitch = 1.0f);
  u64 PlayAt(const std::string& clipPath, const Vec3& position, f32 volume = 1.0f, bool loop = false,
             bool spatial = true, f32 minDistance = 1.0f, f32 maxDistance = 25.0f, f32 pitch = 1.0f);
  void Stop(u64 voiceId);
  void StopAll();
  void UpdatePosition(u64 voiceId, const Vec3& position);
  bool IsPlaying(u64 voiceId) const;
  u32 ActiveVoiceCount() const;

  // Root used to resolve relative clip paths ("Assets/Audio/x.wav"). The runtime points this
  // at the project root (or the executable folder for a packaged game).
  void SetContentRoot(const std::string& root) { contentRoot_ = root; }
  const std::string& ContentRoot() const { return contentRoot_; }
  std::string ResolveClipPath(const std::string& clipPath) const;

  void SetMasterVolume(f32 volume) { masterVolume_ = Saturate(volume); }
  f32 MasterVolume() const { return masterVolume_; }
  void SetMuted(bool muted) { muted_ = muted; }
  bool IsMuted() const { return muted_; }

  // Generated fallback tone used when a project has no audio assets (keeps the
  // pipeline testable with zero binary content).
  u64 PlayTone(f32 frequency, f32 seconds, f32 volume = 0.4f);

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  bool initialized_ = false;
  bool hasDevice_ = false;
  std::string backend_ = "none";
  f32 masterVolume_ = 0.8f;
  bool muted_ = false;
  Vec3 listenerPosition_{0, 0, 0};
  std::string contentRoot_;
};

} // namespace nf
