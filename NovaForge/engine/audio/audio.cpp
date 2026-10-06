// NovaForge Engine - audio implementation
#include "audio/audio.h"

#include "core/fs.h"
#include "core/log.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <string>

#if defined(_WIN32)
#include <windows.h>
#include <mmsystem.h>
#endif

namespace nf {

// ---------------------------------------------------------------- WAV decode
namespace {

uint32_t readU32(const uint8_t* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
uint16_t readU16(const uint8_t* p) { return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8)); }

bool parseWav(const uint8_t* data, size_t size, AudioClip& out, std::string* error) {
    auto fail = [&](const char* msg) {
        if (error) *error = msg;
        return false;
    };
    if (size < 44) return fail("wav file too small");
    if (std::memcmp(data, "RIFF", 4) != 0 || std::memcmp(data + 8, "WAVE", 4) != 0)
        return fail("not a RIFF/WAVE file");

    int channels = 0, sampleRate = 0, bits = 0, format = 1;
    const uint8_t* pcm = nullptr;
    size_t pcmSize = 0;

    size_t offset = 12;
    while (offset + 8 <= size) {
        const uint8_t* chunk = data + offset;
        uint32_t chunkSize = readU32(chunk + 4);
        if (std::memcmp(chunk, "fmt ", 4) == 0 && chunkSize >= 16 && offset + 8 + 16 <= size) {
            format = readU16(chunk + 8);
            channels = readU16(chunk + 10);
            sampleRate = (int)readU32(chunk + 12);
            bits = readU16(chunk + 22);
            if (format == 0xFFFE && chunkSize >= 40) {
                // WAVE_FORMAT_EXTENSIBLE: the real format is in the sub-format GUID
                format = readU16(chunk + 32);
            }
        } else if (std::memcmp(chunk, "data", 4) == 0) {
            pcm = chunk + 8;
            pcmSize = std::min<size_t>(chunkSize, size - (offset + 8));
        }
        offset += 8 + chunkSize + (chunkSize & 1);   // chunks are word aligned
    }

    if (channels < 1 || channels > 2) return fail("only mono/stereo wav files are supported");
    if (sampleRate < 1000 || sampleRate > 384000) return fail("unsupported wav sample rate");
    if (!pcm || pcmSize == 0) return fail("wav file has no data chunk");
    if (format != 1 && format != 3) return fail("compressed wav files are not supported (PCM only)");

    out.channels = channels;
    out.sampleRate = sampleRate;
    int bytesPerSample = bits / 8;
    if (bytesPerSample <= 0) return fail("invalid wav bit depth");
    size_t frames = pcmSize / ((size_t)bytesPerSample * channels);
    out.samples.resize(frames * channels);

    for (size_t i = 0; i < frames * (size_t)channels; ++i) {
        const uint8_t* s = pcm + i * bytesPerSample;
        float v = 0.0f;
        switch (bits) {
            case 8: v = ((int)s[0] - 128) / 128.0f; break;
            case 16: {
                int16_t raw = (int16_t)((uint16_t)s[0] | ((uint16_t)s[1] << 8));
                v = raw / 32768.0f;
                break;
            }
            case 24: {
                int32_t raw = (int32_t)((uint32_t)s[0] | ((uint32_t)s[1] << 8) | ((uint32_t)s[2] << 16));
                if (raw & 0x800000) raw |= (int32_t)0xFF000000;
                v = raw / 8388608.0f;
                break;
            }
            case 32: {
                if (format == 3) {
                    float f;
                    std::memcpy(&f, s, 4);
                    v = f;
                } else {
                    int32_t raw = (int32_t)readU32(s);
                    v = raw / 2147483648.0f;
                }
                break;
            }
            default: return fail("unsupported wav bit depth (use 8/16/24/32)");
        }
        out.samples[i] = std::max(-1.0f, std::min(1.0f, v));
    }
    return true;
}

}  // namespace

bool decodeWav(const uint8_t* data, size_t size, AudioClip& out, std::string* error) {
    return parseWav(data, size, out, error);
}

bool loadWavFile(const std::string& path, AudioClip& out, std::string* error) {
    if (!fs::exists(path)) {
        if (error) *error = "file not found: " + path;
        return false;
    }
    fs::Bytes bytes = fs::readBinary(path);
    if (bytes.empty()) {
        if (error) *error = "cannot read " + path;
        return false;
    }
    out.name = fs::stem(path);
    out.path = path;
    return parseWav(bytes.data(), bytes.size(), out, error);
}

bool writeWavFile(const std::string& path, const std::vector<float>& samples, int sampleRate) {
    std::vector<uint8_t> bytes;
    size_t dataSize = samples.size() * 2;
    bytes.reserve(44 + dataSize);
    auto push32 = [&](uint32_t v) {
        bytes.push_back((uint8_t)(v & 0xFF));
        bytes.push_back((uint8_t)((v >> 8) & 0xFF));
        bytes.push_back((uint8_t)((v >> 16) & 0xFF));
        bytes.push_back((uint8_t)((v >> 24) & 0xFF));
    };
    auto push16 = [&](uint16_t v) {
        bytes.push_back((uint8_t)(v & 0xFF));
        bytes.push_back((uint8_t)((v >> 8) & 0xFF));
    };
    const char* riff = "RIFF";
    bytes.insert(bytes.end(), riff, riff + 4);
    push32((uint32_t)(36 + dataSize));
    const char* wave = "WAVEfmt ";
    bytes.insert(bytes.end(), wave, wave + 8);
    push32(16);
    push16(1);          // PCM
    push16(1);          // mono
    push32((uint32_t)sampleRate);
    push32((uint32_t)(sampleRate * 2));
    push16(2);          // block align
    push16(16);         // bits
    const char* dataTag = "data";
    bytes.insert(bytes.end(), dataTag, dataTag + 4);
    push32((uint32_t)dataSize);
    for (float f : samples) {
        float c = std::max(-1.0f, std::min(1.0f, f));
        push16((uint16_t)(int16_t)std::lround(c * 32767.0f));
    }
    fs::createDirectories(fs::parent(path));
    return fs::writeBinary(path, bytes);
}

// ------------------------------------------------------------------- mixer
namespace {

struct Voice {
    SoundHandle handle = kInvalidSound;
    std::shared_ptr<AudioClip> clip;
    bool loop = false;
    bool spatial = true;
    Vec3 position{0, 0, 0};
    float volume = 1.0f;
    float pitch = 1.0f;
    float minDistance = 1.0f;
    float maxDistance = 30.0f;
    double cursor = 0.0;      // in frames (source sample rate)
    bool finished = false;
};

}  // namespace

struct AudioSystem::Impl {
    AudioSettings settings;
    bool initialised = false;
    std::string backend = "Null sink (no audio device)";
    bool realDevice = false;
    bool muted = false;
    float masterVolume = 1.0f;
    Vec3 listenerPos{0, 0, 0};
    Vec3 listenerRight{1, 0, 0};
    SoundHandle nextHandle = 1;
    std::vector<Voice> voices;
    std::map<std::string, std::shared_ptr<AudioClip>> cache;
    std::vector<float> scratch;      // interleaved stereo mix buffer
    size_t scratchFrames = 0;

#if defined(_WIN32)
    HWAVEOUT waveOut = nullptr;
    static constexpr int kBuffers = 4;
    struct DeviceBuffer {
        std::vector<int16_t> data;
        WAVEHDR header{};
        bool queued = false;
    };
    DeviceBuffer buffers[kBuffers];
    int bufferFrames = 1024;
    int nextBuffer = 0;
#endif

    void ensureScratch(size_t frames) {
        if (frames == scratchFrames) return;
        scratchFrames = frames;
        scratch.assign(frames * 2, 0.0f);
    }

    ~Impl() { closeDevice(); }

    void closeDevice() {
#if defined(_WIN32)
        if (waveOut) {
            waveOutReset(waveOut);
            for (int i = 0; i < kBuffers; ++i) {
                if (buffers[i].header.lpData) {
                    waveOutUnprepareHeader(waveOut, &buffers[i].header, sizeof(WAVEHDR));
                    buffers[i].header = WAVEHDR{};
                }
                buffers[i].queued = false;
            }
            waveOutClose(waveOut);
            waveOut = nullptr;
        }
#endif
    }

    bool openDevice(std::string* error) {
#if defined(_WIN32)
        WAVEFORMATEX fmt{};
        fmt.wFormatTag = WAVE_FORMAT_PCM;
        fmt.nChannels = 2;
        fmt.nSamplesPerSec = (DWORD)settings.sampleRate;
        fmt.wBitsPerSample = 16;
        fmt.nBlockAlign = (WORD)(fmt.nChannels * fmt.wBitsPerSample / 8);
        fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
        MMRESULT res = waveOutOpen(&waveOut, WAVE_MAPPER, &fmt, 0, 0, CALLBACK_NULL);
        if (res != MMSYSERR_NOERROR) {
            waveOut = nullptr;
            backend = "Null sink (waveOut unavailable)";
            realDevice = false;
            if (error) *error = "waveOutOpen failed (" + std::to_string((int)res) + ")";
            return false;
        }
        bufferFrames = std::max(256, settings.bufferFrames);
        for (int i = 0; i < kBuffers; ++i) {
            buffers[i].data.assign((size_t)bufferFrames * 2, 0);
            buffers[i].header.lpData = (LPSTR)buffers[i].data.data();
            buffers[i].header.dwBufferLength = (DWORD)(buffers[i].data.size() * sizeof(int16_t));
            buffers[i].queued = false;
        }
        backend = "WinMM waveOut";
        realDevice = true;
        return true;
#else
        (void)error;
        backend = "Null sink (no audio device on this platform)";
        realDevice = false;
        return false;
#endif
    }

    // Pushes one block of already mixed 16 bit stereo frames to the device.
    void submitBlock(const float* stereoFrames, int frames) {
#if defined(_WIN32)
        if (!waveOut) return;
        DeviceBuffer& buf = buffers[nextBuffer];
        nextBuffer = (nextBuffer + 1) % kBuffers;
        if (buf.queued) {
            if (!(buf.header.dwFlags & WHDR_DONE)) return;   // device still busy
            waveOutUnprepareHeader(waveOut, &buf.header, sizeof(WAVEHDR));
            buf.header.dwFlags = 0;
            buf.queued = false;
        }
        int n = std::min(frames, bufferFrames);
        for (int i = 0; i < n * 2; ++i) {
            float c = std::max(-1.0f, std::min(1.0f, stereoFrames[i]));
            buf.data[(size_t)i] = (int16_t)std::lround(c * 32767.0f);
        }
        buf.header.dwBufferLength = (DWORD)((size_t)n * 2 * sizeof(int16_t));
        buf.header.lpData = (LPSTR)buf.data.data();
        if (waveOutPrepareHeader(waveOut, &buf.header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR) {
            if (waveOutWrite(waveOut, &buf.header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR)
                buf.queued = true;
        }
#else
        (void)stereoFrames;
        (void)frames;
#endif
    }
};

AudioSystem::AudioSystem() : impl_(new Impl()) {}
AudioSystem::~AudioSystem() { shutdown(); }

bool AudioSystem::init(const AudioSettings& settings, std::string* error) {
    impl_->settings = settings;
    if (impl_->settings.sampleRate < 8000) impl_->settings.sampleRate = 44100;
    impl_->masterVolume = settings.masterVolume;
    impl_->muted = settings.muted;
    impl_->voices.clear();
    impl_->nextHandle = 1;
    std::string deviceError;
    impl_->openDevice(&deviceError);
    if (!impl_->realDevice && error) *error = deviceError;
    impl_->initialised = true;
    NF_LOG_INFO("Audio", "audio backend: %s (%d Hz, %d voices max)", impl_->backend.c_str(),
                impl_->settings.sampleRate, impl_->settings.maxVoices);
    return true;
}

void AudioSystem::shutdown() {
    if (!impl_) return;
    impl_->closeDevice();
    impl_->voices.clear();
    impl_->initialised = false;
}

bool AudioSystem::isInitialised() const { return impl_ && impl_->initialised; }
const std::string& AudioSystem::backendName() const { return impl_->backend; }
bool AudioSystem::hasRealDevice() const { return impl_->realDevice; }
const AudioSettings& AudioSystem::settings() const { return impl_->settings; }

void AudioSystem::setMasterVolume(float v) {
    impl_->masterVolume = std::max(0.0f, std::min(v, 2.0f));
}
float AudioSystem::masterVolume() const { return impl_->masterVolume; }
void AudioSystem::setMuted(bool m) { impl_->muted = m; }
bool AudioSystem::muted() const { return impl_->muted; }

void AudioSystem::setListener(const Vec3& position, const Vec3& forward, const Vec3& up) {
    impl_->listenerPos = position;
    Vec3 f = forward.length() > 1e-5f ? forward.normalized() : Vec3(0, 0, 1);
    Vec3 right = cross(f, up.length() > 1e-5f ? up.normalized() : Vec3(0, 1, 0));
    if (right.length() < 1e-5f) right = Vec3(1, 0, 0);
    impl_->listenerRight = right.normalized();
}

std::shared_ptr<AudioClip> AudioSystem::load(const std::string& path) {
    auto it = impl_->cache.find(path);
    if (it != impl_->cache.end()) return it->second;
    auto clip = std::make_shared<AudioClip>();
    std::string error;
    if (!loadWavFile(path, *clip, &error)) {
        lastError_ = error;
        NF_LOG_WARN("Audio", "cannot load '%s': %s", path.c_str(), error.c_str());
        impl_->cache[path] = nullptr;
        return nullptr;
    }
    impl_->cache[path] = clip;
    NF_LOG_INFO("Audio", "loaded '%s' (%.2fs, %d Hz, %d ch)", fs::filename(path).c_str(),
                clip->durationSeconds(), clip->sampleRate, clip->channels);
    return clip;
}

std::shared_ptr<AudioClip> AudioSystem::registerClip(const std::string& name,
                                                     std::vector<float> samples, int sampleRate,
                                                     int channels) {
    auto clip = std::make_shared<AudioClip>();
    clip->name = name;
    clip->samples = std::move(samples);
    clip->sampleRate = sampleRate;
    clip->channels = channels;
    return clip;
}

SoundHandle AudioSystem::play(const std::shared_ptr<AudioClip>& clip, const Vec3& position,
                              float volume, bool loop, bool spatial, float minDistance,
                              float maxDistance) {
    if (!clip || !clip->valid()) return kInvalidSound;
    if (impl_->voices.size() >= (size_t)std::max(1, impl_->settings.maxVoices)) {
        // steal the oldest finished/non looping voice
        auto it = std::find_if(impl_->voices.begin(), impl_->voices.end(),
                               [](const Voice& v) { return v.finished; });
        if (it == impl_->voices.end()) impl_->voices.erase(impl_->voices.begin());
        else impl_->voices.erase(it);
    }
    Voice v;
    v.handle = impl_->nextHandle++;
    v.clip = clip;
    v.position = position;
    v.volume = volume;
    v.loop = loop;
    v.spatial = spatial;
    v.minDistance = minDistance;
    v.maxDistance = std::max(maxDistance, minDistance + 0.01f);
    impl_->voices.push_back(std::move(v));
    return impl_->voices.back().handle;
}

SoundHandle AudioSystem::playFile(const std::string& path, const Vec3& position, float volume,
                                  bool loop, bool spatial) {
    return play(load(path), position, volume, loop, spatial);
}

void AudioSystem::stop(SoundHandle handle) {
    impl_->voices.erase(std::remove_if(impl_->voices.begin(), impl_->voices.end(),
                                       [handle](const Voice& v) { return v.handle == handle; }),
                        impl_->voices.end());
}

void AudioSystem::stopAll() { impl_->voices.clear(); }

bool AudioSystem::isPlaying(SoundHandle handle) const {
    for (const Voice& v : impl_->voices)
        if (v.handle == handle && !v.finished) return true;
    return false;
}

void AudioSystem::setVoicePosition(SoundHandle handle, const Vec3& position) {
    for (Voice& v : impl_->voices)
        if (v.handle == handle) v.position = position;
}

void AudioSystem::setVoiceVolume(SoundHandle handle, float volume) {
    for (Voice& v : impl_->voices)
        if (v.handle == handle) v.volume = volume;
}

size_t AudioSystem::activeVoices() const {
    size_t n = 0;
    for (const Voice& v : impl_->voices)
        if (!v.finished) ++n;
    return n;
}

void AudioSystem::mixInto(std::vector<float>& stereo, int frames) {
    if (frames <= 0) return;
    stereo.assign((size_t)frames * 2, 0.0f);
    if (impl_->muted) return;
    const double mixRate = (double)impl_->settings.sampleRate;

    for (Voice& v : impl_->voices) {
        if (v.finished || !v.clip || !v.clip->valid()) continue;
        const AudioClip& clip = *v.clip;
        float gain = v.volume * impl_->masterVolume;
        float panLeft = 1.0f, panRight = 1.0f;
        if (v.spatial) {
            Vec3 delta = v.position - impl_->listenerPos;
            float dist = delta.length();
            if (dist > v.maxDistance) {
                if (!v.loop) {
                    v.finished = true;
                    continue;
                }
                gain = 0.0f;
            } else if (dist > v.minDistance) {
                float t = (dist - v.minDistance) / (v.maxDistance - v.minDistance);
                gain *= (1.0f - t) * (1.0f - t);
            }
            if (dist > 1e-3f && gain > 0.0f) {
                float pan = dot(delta, impl_->listenerRight) / dist;   // -1 left .. 1 right
                pan = std::max(-1.0f, std::min(1.0f, pan));
                panLeft = std::sqrt(std::max(0.0f, 1.0f - pan) * 0.5f + 0.25f);
                panRight = std::sqrt(std::max(0.0f, 1.0f + pan) * 0.5f + 0.25f);
            }
        }
        double step = mixRate / (double)clip.sampleRate;
        size_t sourceFrames = clip.samples.size() / (size_t)clip.channels;
        for (int f = 0; f < frames; ++f) {
            size_t i0 = (size_t)v.cursor;
            if (i0 + 1 >= sourceFrames) {
                if (v.loop) {
                    v.cursor = std::fmod(v.cursor, (double)sourceFrames);
                    i0 = (size_t)v.cursor;
                    if (i0 + 1 >= sourceFrames) break;
                } else {
                    v.finished = true;
                    break;
                }
            }
            float frac = (float)(v.cursor - (double)i0);
            float l0, r0, l1, r1;
            if (clip.channels == 1) {
                l0 = r0 = clip.samples[i0];
                l1 = r1 = clip.samples[i0 + 1];
            } else {
                l0 = clip.samples[i0 * 2];
                r0 = clip.samples[i0 * 2 + 1];
                l1 = clip.samples[(i0 + 1) * 2];
                r1 = clip.samples[(i0 + 1) * 2 + 1];
            }
            float l = l0 + (l1 - l0) * frac;
            float r = r0 + (r1 - r0) * frac;
            stereo[(size_t)f * 2] += l * gain * panLeft;
            stereo[(size_t)f * 2 + 1] += r * gain * panRight;
            v.cursor += step;
        }
    }

    // soft clip the master bus so loud scenes distort gracefully
    for (float& s : stereo) s = std::tanh(s * 0.9f);

    impl_->voices.erase(std::remove_if(impl_->voices.begin(), impl_->voices.end(),
                                       [](const Voice& v) { return v.finished && !v.loop; }),
                        impl_->voices.end());
}

void AudioSystem::update(float dt) {
    if (!impl_->initialised || dt <= 0.0f) return;
    if (dt > 0.25f) dt = 0.25f;
    int frames = (int)std::lround(dt * impl_->settings.sampleRate);
    if (frames <= 0) return;
    int blockSize = std::max(64, impl_->settings.bufferFrames);
    int done = 0;
    double sumSq = 0.0;
    int counted = 0;
    while (done < frames) {
        int block = std::min(blockSize, frames - done);
        mixInto(impl_->scratch, block);
        for (float s : impl_->scratch) {
            sumSq += (double)s * s;
            ++counted;
        }
        impl_->submitBlock(impl_->scratch.data(), block);
        done += block;
    }
    lastMixedRms_ = counted > 0 ? (float)std::sqrt(sumSq / counted) : 0.0f;
    mixedFrames_ += frames;
}

}  // namespace nf
