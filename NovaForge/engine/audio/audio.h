// NovaForge Engine - audio
//
// V1 scope, stated honestly:
//   * WAV decoding (PCM 8/16/24/32 bit, mono/stereo) and a real software mixer
//     (volume, pitch resampling, panning, distance attenuation, looping)
//   * Windows: playback through WinMM waveOut (real sound card output)
//   * Other platforms: a real-time null sink. The mixer still runs, so game
//     logic (waiting for a clip, looping music, voice counts) behaves exactly
//     the same - there is simply no speaker attached.
//   * MP3/OGG are stored as project assets but not decoded in V1
//     (see docs/AUDIO.md); importing them produces a clear warning.
#pragma once
#include "core/math.h"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace nf {

struct AudioClip {
    std::string name;
    std::string path;
    int sampleRate = 44100;
    int channels = 1;
    std::vector<float> samples;      // interleaved, -1..1
    bool valid() const { return sampleRate > 0 && channels > 0 && !samples.empty(); }
    float durationSeconds() const {
        return valid() ? (float)samples.size() / (float)(sampleRate * channels) : 0.0f;
    }
};

// Decodes a .wav file from disk (RIFF / fmt / data chunks).
bool loadWavFile(const std::string& path, AudioClip& out, std::string* error = nullptr);
bool decodeWav(const uint8_t* data, size_t size, AudioClip& out, std::string* error = nullptr);
// Writes a 16 bit PCM mono .wav (used by the sample project + tests).
bool writeWavFile(const std::string& path, const std::vector<float>& samples, int sampleRate);

using SoundHandle = uint32_t;
constexpr SoundHandle kInvalidSound = 0;

struct AudioSettings {
    int sampleRate = 44100;          // mixer rate
    int bufferFrames = 1024;         // frames per device buffer
    int bufferCount = 4;             // double/quad buffering
    float masterVolume = 1.0f;
    bool muted = false;
    int maxVoices = 48;
};

class AudioSystem {
public:
    AudioSystem();
    ~AudioSystem();
    AudioSystem(const AudioSystem&) = delete;
    AudioSystem& operator=(const AudioSystem&) = delete;

    bool init(const AudioSettings& settings = AudioSettings(), std::string* error = nullptr);
    void shutdown();
    bool isInitialised() const;
    // "WinMM waveOut" / "Null sink (no audio device)" - shown in the editor.
    const std::string& backendName() const;
    bool hasRealDevice() const;

    const AudioSettings& settings() const;
    void setMasterVolume(float v);
    float masterVolume() const;
    void setMuted(bool muted);
    bool muted() const;

    void setListener(const Vec3& position, const Vec3& forward, const Vec3& up);

    // Loading (cached by absolute path).
    std::shared_ptr<AudioClip> load(const std::string& path);
    // Registers an in-memory clip (used by tests and generated tones).
    std::shared_ptr<AudioClip> registerClip(const std::string& name, std::vector<float> samples,
                                            int sampleRate, int channels);

    SoundHandle play(const std::shared_ptr<AudioClip>& clip, const Vec3& position = Vec3(0, 0, 0),
                     float volume = 1.0f, bool loop = false, bool spatial = true,
                     float minDistance = 1.0f, float maxDistance = 30.0f);
    SoundHandle playFile(const std::string& path, const Vec3& position = Vec3(0, 0, 0),
                         float volume = 1.0f, bool loop = false, bool spatial = true);
    void stop(SoundHandle handle);
    void stopAll();
    bool isPlaying(SoundHandle handle) const;
    void setVoicePosition(SoundHandle handle, const Vec3& position);
    void setVoiceVolume(SoundHandle handle, float volume);
    size_t activeVoices() const;

    // Mixes `dt` seconds of audio and feeds the device. Call once per frame.
    void update(float dt);
    // Mixes into an explicit buffer (used by tests and by the offline exporter).
    void mixInto(std::vector<float>& stereo, int frames);

    // Diagnostics: RMS of the most recent mixed block.
    float lastMixedRms() const { return lastMixedRms_; }
    int mixedFrames() const { return mixedFrames_; }
    const std::string& lastError() const { return lastError_; }

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    float lastMixedRms_ = 0.0f;
    int mixedFrames_ = 0;
    std::string lastError_;
};

}  // namespace nf
