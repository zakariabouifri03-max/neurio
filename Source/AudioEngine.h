#pragma once

#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <vector>
#include <string>
#include <atomic>
#include <thread>
#include <mutex>
#include <functional>

#include "Common.h"

class AudioEngine {
public:
    using RenderFn = std::function<void(float* interleavedStereo, int frames)>;

    AudioEngine();
    ~AudioEngine();

    void setRenderCallback(RenderFn fn);

    std::vector<AudioDeviceInfo> enumerate();

    // deviceId empty = default. Returns false and fills err on failure.
    bool start(const std::wstring& deviceId, int sampleRate, int bufferFrames, std::wstring& err);
    void stop();
    bool running() const { return running_.load(); }

    int sampleRate() const { return sampleRate_; }
    int bufferFrames() const { return bufferFrames_; }
    std::wstring currentDeviceName() const { return deviceName_; }
    std::wstring lastError() const { return lastError_; }

private:
    bool startWasapi(const std::wstring& deviceId, int sampleRate, int bufferFrames, std::wstring& err);
    bool startWaveOut(int sampleRate, int bufferFrames, std::wstring& err);
    void wasapiThread();
    void fillFloat(float* stereo, int frames);
    void floatToInt16(const float* stereo, int16_t* dst, int frames);

    RenderFn render_;
    std::mutex renderMutex_;

    std::atomic<bool> running_ { false };
    std::atomic<bool> stopReq_ { false };
    std::thread thread_;

    int sampleRate_ = kDefaultSr;
    int bufferFrames_ = kDefaultBuf;
    std::wstring deviceName_;
    std::wstring lastError_;

    // WASAPI
    IMMDeviceEnumerator* enum_ = nullptr;
    IMMDevice* device_ = nullptr;
    IAudioClient* client_ = nullptr;
    IAudioRenderClient* renderer_ = nullptr;
    HANDLE event_ = nullptr;
    UINT32 wasapiBufFrames_ = 0;
    bool useWasapi_ = false;

    // waveOut fallback
    HWAVEOUT hwo_ = nullptr;
    static const int kWaveBufs = 4;
    WAVEHDR whdr_[kWaveBufs] {};
    std::vector<int16_t> waveMem_;
    HANDLE waveEvent_ = nullptr;

    void releaseWasapi();
    void releaseWaveOut();
};

#endif
