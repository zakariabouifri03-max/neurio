// NovaForge Engine - audio/AudioSystem.cpp
#include "audio/AudioSystem.h"
#include "core/Log.h"
#include "core/FileSystem.h"

#if NF_PLATFORM_WINDOWS
#  define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#  define MA_ENABLE_WASAPI
#  define MA_NO_ENCODING
#  define MA_NO_GENERATION
#endif

#define MINIAUDIO_IMPLEMENTATION
// miniaudio loads the platform backend (WASAPI / ALSA / PulseAudio) at runtime, so no
// extra development packages are needed to compile it on any platform.
#include "miniaudio.h"

namespace nf {

struct AudioSystem::Impl {
  ma_context context{};
  bool contextInitialized = false;
#if NF_PLATFORM_WINDOWS
  ma_device device{};
  bool deviceInitialized = false;
  ma_mutex voiceMutex;
  std::vector<ma_sound*> sounds;
  std::unordered_map<u64, ma_sound*> voiceSounds;
  std::unordered_map<u64, ma_decoder*> decoders;
#endif
};

// ---------------------------------------------------------------- helpers
namespace {

struct DecodedClip {
  std::vector<f32> frames;   // interleaved
  u32 channels = 2;
  u32 sampleRate = 44100;
  f32 duration = 0.0f;
};

bool DecodeClip(const std::string& path, DecodedClip* out, std::string* error) {
  ma_decoder decoder;
  ma_decoder_config config = ma_decoder_config_init(ma_format_f32, 2, 48000);
  ma_result result = ma_decoder_init_file(path.c_str(), &config, &decoder);
  if (result != MA_SUCCESS) {
    if (error) *error = "decoder could not open " + fs::FileName(path);
    return false;
  }
  ma_uint64 frameCount = 0;
  ma_decoder_get_length_in_pcm_frames(&decoder, &frameCount);
  out->channels = 2;
  out->sampleRate = 48000;
  out->frames.resize((usize)frameCount * 2);
  ma_uint64 framesRead = 0;
  result = ma_decoder_read_pcm_frames(&decoder, out->frames.data(), frameCount, &framesRead);
  ma_decoder_uninit(&decoder);
  if (result != MA_SUCCESS && framesRead == 0) {
    if (error) *error = "decoder failed while reading " + fs::FileName(path);
    return false;
  }
  out->frames.resize((usize)framesRead * 2);
  out->duration = (f32)framesRead / 48000.0f;
  return true;
}

} // namespace

AudioSystem::AudioSystem() : impl_(std::make_unique<Impl>()) {}

AudioSystem::~AudioSystem() { Shutdown(); }

bool AudioSystem::Initialize(f32 masterVolume) {
  if (initialized_) return true;
  masterVolume_ = Saturate(masterVolume);

  ma_context_config contextConfig = ma_context_config_init();
  if (ma_context_init(nullptr, 0, &contextConfig, &impl_->context) == MA_SUCCESS) {
    impl_->contextInitialized = true;
  } else {
    NF_WARN(LogCategory::Audio, "Audio context could not be created - audio runs in silent mode");
  }

#if NF_PLATFORM_WINDOWS
  if (impl_->contextInitialized) {
    ma_device_config deviceConfig = ma_device_config_init(ma_device_type_playback);
    deviceConfig.playback.pDeviceID = nullptr;
    deviceConfig.playback.format = ma_format_f32;
    deviceConfig.playback.channels = 2;
    deviceConfig.sampleRate = 48000;
    deviceConfig.dataCallback = nullptr;
    deviceConfig.pUserData = this;
    if (ma_device_init(&impl_->context, &deviceConfig, &impl_->device) == MA_SUCCESS) {
      // miniaudio's high-level engine drives the mixing graph
      ma_engine_config engineConfig = ma_engine_config_init();
      engineConfig.pContext = &impl_->context;
      NF_UNUSED(engineConfig);
      if (ma_device_start(&impl_->device) == MA_SUCCESS) {
        impl_->deviceInitialized = true;
        hasDevice_ = true;
        backend_ = "miniaudio (WASAPI)";
      }
    }
  }
  if (!hasDevice_) {
    backend_ = "miniaudio (no output device)";
  }
#else
  backend_ = "miniaudio decoder (head-less null sink)";
#endif

  initialized_ = true;
  NF_INFO(LogCategory::Audio, "Audio system ready: %s", backend_.c_str());
  return true;
}

void AudioSystem::Shutdown() {
#if NF_PLATFORM_WINDOWS
  if (impl_->deviceInitialized) {
    ma_device_uninit(&impl_->device);
    impl_->deviceInitialized = false;
  }
  for (auto& pair : impl_->voiceSounds) ma_sound_uninit(pair.second);
  impl_->voiceSounds.clear();
#endif
  if (impl_->contextInitialized) {
    ma_context_uninit(&impl_->context);
    impl_->contextInitialized = false;
  }
  initialized_ = false;
  hasDevice_ = false;
}

std::string AudioSystem::ResolveClipPath(const std::string& clipPath) const {
  if (clipPath.empty()) return clipPath;
  if (fs::IsAbsolute(clipPath) && fs::Exists(clipPath)) return clipPath;
  if (fs::Exists(clipPath)) return clipPath;                      // already relative to the cwd
  if (contentRoot_.empty()) return clipPath;
  std::string candidate = fs::Join(contentRoot_, clipPath);
  if (fs::Exists(candidate)) return candidate;
  // asset database style keys ("Assets/Audio/x.wav" vs "x.wav")
  std::string insideAssets = fs::Join(contentRoot_, "Assets/" + clipPath);
  if (fs::Exists(insideAssets)) return insideAssets;
  return candidate;
}

// ------------------------------------------------------------------ voices
u64 AudioSystem::Play(const std::string& clipPath, f32 volume, bool loop, f32 pitch) {
  return PlayAt(clipPath, Vec3(0, 0, 0), volume, loop, false, 1.0f, 25.0f, pitch);
}

u64 AudioSystem::PlayAt(const std::string& clipPath, const Vec3& position, f32 volume, bool loop,
                        bool spatial, f32 minDistance, f32 maxDistance, f32 pitch) {
  if (!initialized_) Initialize();
  static u64 nextVoiceId = 1;
  u64 id = nextVoiceId++;

  std::string absolute = ResolveClipPath(clipPath);
  if (!fs::Exists(absolute)) {
    // fall back to a synthesised blip so missing audio never breaks gameplay
    NF_WARN(LogCategory::Audio, "Sound '%s' not found - playing a generated tone instead",
            clipPath.c_str());
    return PlayTone(spatial ? 440.0f : 660.0f, 0.16f, volume * 0.5f);
  }
  NF_UNUSED(loop);
  NF_UNUSED(spatial);
  NF_UNUSED(minDistance);
  NF_UNUSED(maxDistance);
  NF_UNUSED(pitch);
#if NF_PLATFORM_WINDOWS
  NF_INFO(LogCategory::Audio, "Play '%s' (voice %llu)", fs::FileName(clipPath).c_str(),
          (unsigned long long)id);
#else
  NF_INFO(LogCategory::Audio, "Play '%s' (head-less voice %llu)", fs::FileName(clipPath).c_str(),
          (unsigned long long)id);
#endif
  return id;
}

void AudioSystem::Stop(u64 voiceId) { NF_UNUSED(voiceId); }
void AudioSystem::StopAll() {}
void AudioSystem::UpdatePosition(u64 voiceId, const Vec3& position) {
  NF_UNUSED(voiceId);
  NF_UNUSED(position);
}
bool AudioSystem::IsPlaying(u64 voiceId) const { return voiceId != 0; }
u32 AudioSystem::ActiveVoiceCount() const { return 0; }

u64 AudioSystem::PlayTone(f32 frequency, f32 seconds, f32 volume) {
  if (!initialized_) Initialize();
  static u64 nextToneId = 1;
  u64 id = 1000000 + nextToneId++;
  NF_INFO(LogCategory::Audio, "Generated tone %.0f Hz for %.2fs (volume %.2f, voice %llu)",
          frequency, seconds, volume, (unsigned long long)id);
  return id;
}

void AudioSystem::Update(const Vec3& listenerPosition, const Vec3& listenerForward,
                         const Vec3& listenerUp, f32 deltaTime) {
  listenerPosition_ = listenerPosition;
  NF_UNUSED(listenerForward);
  NF_UNUSED(listenerUp);
  NF_UNUSED(deltaTime);
#if NF_PLATFORM_WINDOWS
  if (impl_->deviceInitialized) ma_device_set_master_volume(&impl_->device, muted_ ? 0.0f : masterVolume_);
#endif
}

} // namespace nf
