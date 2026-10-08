#ifdef _WIN32

#include "AudioEngine.h"

#include <objbase.h>
#include <mmreg.h>
#include <propsys.h>
#include <propidl.h>

#ifndef PKEY_Device_FriendlyName
// {A45C254E-DF1C-4EFD-8020-67D146A850E0}, 14
static const PROPERTYKEY PKEY_Device_FriendlyName = {
    { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } }, 14
};
#endif

#ifndef AUDCLNT_STREAMFLAGS_EVENTCALLBACK
#define AUDCLNT_STREAMFLAGS_EVENTCALLBACK 0x00040000
#endif
#ifndef AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
#define AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM 0x80000000
#endif
#ifndef AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY
#define AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY 0x08000000
#endif

static std::wstring errHr(const wchar_t* what, HRESULT hr) {
    wchar_t buf[256];
    swprintf(buf, 256, L"%s (0x%08X)", what, (unsigned)hr);
    return buf;
}

AudioEngine::AudioEngine() = default;

AudioEngine::~AudioEngine() {
    stop();
}

void AudioEngine::setRenderCallback(RenderFn fn) {
    std::lock_guard<std::mutex> g(renderMutex_);
    render_ = std::move(fn);
}

void AudioEngine::fillFloat(float* stereo, int frames) {
    RenderFn fn;
    {
        std::lock_guard<std::mutex> g(renderMutex_);
        fn = render_;
    }
    if (fn) fn(stereo, frames);
    else memset(stereo, 0, frames * 2 * sizeof(float));
}

void AudioEngine::floatToInt16(const float* stereo, int16_t* dst, int frames) {
    const int n = frames * 2;
    for (int i = 0; i < n; ++i) {
        float x = stereo[i];
        if (x > 1.0f) x = 1.0f;
        if (x < -1.0f) x = -1.0f;
        dst[i] = (int16_t)(x * 32767.0f);
    }
}

static std::wstring friendlyName(IMMDevice* dev) {
    if (!dev) return L"Unknown device";
    IPropertyStore* store = nullptr;
    HRESULT hr = dev->OpenPropertyStore(STGM_READ, &store);
    if (FAILED(hr) || !store) return L"Audio device";
    PROPVARIANT pv;
    PropVariantInit(&pv);
    std::wstring name = L"Audio device";
    hr = store->GetValue(PKEY_Device_FriendlyName, &pv);
    if (SUCCEEDED(hr) && pv.vt == VT_LPWSTR && pv.pwszVal)
        name = pv.pwszVal;
    PropVariantClear(&pv);
    store->Release();
    return name;
}

std::vector<AudioDeviceInfo> AudioEngine::enumerate() {
    std::vector<AudioDeviceInfo> out;
    HRESULT hrCo = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    IMMDeviceEnumerator* en = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                  __uuidof(IMMDeviceEnumerator), (void**)&en);
    if (FAILED(hr) || !en) {
        // waveOut fallback names
        UINT n = waveOutGetNumDevs();
        for (UINT i = 0; i < n; ++i) {
            WAVEOUTCAPSW caps {};
            if (waveOutGetDevCapsW(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
                AudioDeviceInfo d;
                d.id = L"wave:" + std::to_wstring(i);
                d.name = caps.szPname;
                d.isDefault = (i == 0);
                out.push_back(d);
            }
        }
        if (SUCCEEDED(hrCo)) CoUninitialize();
        return out;
    }
    IMMDevice* def = nullptr;
    LPWSTR defId = nullptr;
    en->GetDefaultAudioEndpoint(eRender, eConsole, &def);
    if (def) {
        def->GetId(&defId);
        def->Release();
    }
    IMMDeviceCollection* col = nullptr;
    hr = en->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &col);
    if (SUCCEEDED(hr) && col) {
        UINT count = 0;
        col->GetCount(&count);
        for (UINT i = 0; i < count; ++i) {
            IMMDevice* dev = nullptr;
            if (FAILED(col->Item(i, &dev)) || !dev) continue;
            LPWSTR id = nullptr;
            dev->GetId(&id);
            AudioDeviceInfo info;
            info.id = id ? id : L"";
            info.name = friendlyName(dev);
            info.isDefault = (defId && id && wcscmp(defId, id) == 0);
            out.push_back(info);
            if (id) CoTaskMemFree(id);
            dev->Release();
        }
        col->Release();
    }
    if (defId) CoTaskMemFree(defId);
    en->Release();
    if (SUCCEEDED(hrCo)) CoUninitialize();
    return out;
}

void AudioEngine::releaseWasapi() {
    if (renderer_) { renderer_->Release(); renderer_ = nullptr; }
    if (client_) { client_->Release(); client_ = nullptr; }
    if (device_) { device_->Release(); device_ = nullptr; }
    if (enum_) { enum_->Release(); enum_ = nullptr; }
    if (event_) { CloseHandle(event_); event_ = nullptr; }
}

void AudioEngine::releaseWaveOut() {
    if (hwo_) {
        waveOutReset(hwo_);
        for (int i = 0; i < kWaveBufs; ++i) {
            if (whdr_[i].dwFlags & WHDR_PREPARED)
                waveOutUnprepareHeader(hwo_, &whdr_[i], sizeof(WAVEHDR));
        }
        waveOutClose(hwo_);
        hwo_ = nullptr;
    }
    waveMem_.clear();
    if (waveEvent_) { CloseHandle(waveEvent_); waveEvent_ = nullptr; }
}

void AudioEngine::stop() {
    stopReq_.store(true);
    if (event_) SetEvent(event_);
    if (waveEvent_) SetEvent(waveEvent_);
    if (thread_.joinable()) thread_.join();
    running_.store(false);
    if (client_) client_->Stop();
    releaseWasapi();
    releaseWaveOut();
    stopReq_.store(false);
}

bool AudioEngine::start(const std::wstring& deviceId, int sampleRate, int bufferFrames, std::wstring& err) {
    stop();
    sampleRate_ = sampleRate > 0 ? sampleRate : kDefaultSr;
    bufferFrames_ = bufferFrames > 0 ? bufferFrames : kDefaultBuf;
    if (bufferFrames_ < 64) bufferFrames_ = 64;
    if (bufferFrames_ > 4096) bufferFrames_ = 4096;

    if (deviceId.rfind(L"wave:", 0) == 0) {
        return startWaveOut(sampleRate_, bufferFrames_, err);
    }
    if (startWasapi(deviceId, sampleRate_, bufferFrames_, err))
        return true;
    // Fallback
    std::wstring wasapiErr = err;
    if (startWaveOut(sampleRate_, bufferFrames_, err)) {
        lastError_.clear();
        return true;
    }
    err = L"Audio device unavailable. Please select another output device.\n\nWASAPI: "
          + wasapiErr + L"\nwaveOut: " + err;
    lastError_ = err;
    return false;
}

bool AudioEngine::startWasapi(const std::wstring& deviceId, int sampleRate, int bufferFrames, std::wstring& err) {
    HRESULT hrCo = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    (void)hrCo;

    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                                  __uuidof(IMMDeviceEnumerator), (void**)&enum_);
    if (FAILED(hr) || !enum_) {
        err = errHr(L"Could not create audio enumerator", hr);
        return false;
    }

    if (!deviceId.empty()) {
        hr = enum_->GetDevice(deviceId.c_str(), &device_);
        if (FAILED(hr) || !device_) {
            err = L"The selected audio device is no longer available. Please select another output device.";
            releaseWasapi();
            return false;
        }
    } else {
        hr = enum_->GetDefaultAudioEndpoint(eRender, eConsole, &device_);
        if (FAILED(hr) || !device_) {
            err = L"No default audio output device is available.";
            releaseWasapi();
            return false;
        }
    }

    deviceName_ = friendlyName(device_);

    hr = device_->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&client_);
    if (FAILED(hr) || !client_) {
        err = errHr(L"Could not activate audio client", hr);
        releaseWasapi();
        return false;
    }

    WAVEFORMATEX fmt {};
    fmt.wFormatTag = WAVE_FORMAT_IEEE_FLOAT;
    fmt.nChannels = 2;
    fmt.nSamplesPerSec = (DWORD)sampleRate;
    fmt.wBitsPerSample = 32;
    fmt.nBlockAlign = 8;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

    REFERENCE_TIME hns = (REFERENCE_TIME)((10000000.0 * bufferFrames) / sampleRate);
    if (hns < 30000) hns = 30000; // 3 ms min attempt

    DWORD flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;

    hr = client_->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, hns, 0, &fmt, nullptr);
    if (FAILED(hr)) {
        // try without event callback, still IEEE float so the renderer writes float32
        if (client_) { client_->Release(); client_ = nullptr; }
        hr = device_->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&client_);
        flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        if (client_)
            hr = client_->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, hns, 0, &fmt, nullptr);
        event_ = nullptr;
    }

    if (FAILED(hr)) {
        err = errHr(L"Unsupported sample rate or audio format. Try 44100 Hz.", hr);
        releaseWasapi();
        return false;
    }

    hr = client_->GetBufferSize(&wasapiBufFrames_);
    if (FAILED(hr) || wasapiBufFrames_ == 0) {
        err = errHr(L"Could not get audio buffer size", hr);
        releaseWasapi();
        return false;
    }
    bufferFrames_ = (int)wasapiBufFrames_;

    hr = client_->GetService(__uuidof(IAudioRenderClient), (void**)&renderer_);
    if (FAILED(hr) || !renderer_) {
        err = errHr(L"Could not get render client", hr);
        releaseWasapi();
        return false;
    }

    event_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (event_) {
        HRESULT se = client_->SetEventHandle(event_);
        if (FAILED(se)) {
            CloseHandle(event_);
            event_ = nullptr;
        }
    }

    // Pre-fill silence
    BYTE* data = nullptr;
    hr = renderer_->GetBuffer(wasapiBufFrames_, &data);
    if (SUCCEEDED(hr) && data) {
        memset(data, 0, wasapiBufFrames_ * 8);
        renderer_->ReleaseBuffer(wasapiBufFrames_, 0);
    }

    hr = client_->Start();
    if (FAILED(hr)) {
        err = errHr(L"Could not start audio stream", hr);
        releaseWasapi();
        return false;
    }

    useWasapi_ = true;
    running_.store(true);
    stopReq_.store(false);
    thread_ = std::thread([this] { wasapiThread(); });
    lastError_.clear();
    return true;
}

void AudioEngine::wasapiThread() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    std::vector<float> tmp;

    while (!stopReq_.load()) {
        if (event_) {
            DWORD w = WaitForSingleObject(event_, 50);
            if (w == WAIT_FAILED) break;
        } else {
            Sleep(2);
        }
        if (stopReq_.load() || !client_ || !renderer_) break;

        UINT32 padding = 0;
        HRESULT hr = client_->GetCurrentPadding(&padding);
        if (FAILED(hr)) {
            lastError_ = L"Audio device unavailable. Please select another output device.";
            break;
        }
        UINT32 avail = wasapiBufFrames_ > padding ? (wasapiBufFrames_ - padding) : 0;
        if (avail == 0) continue;
        // Render in modest chunks
        if (avail > 2048) avail = 2048;

        BYTE* data = nullptr;
        hr = renderer_->GetBuffer(avail, &data);
        if (FAILED(hr) || !data) {
            lastError_ = L"Audio device unavailable. Please select another output device.";
            break;
        }
        tmp.resize(avail * 2);
        fillFloat(tmp.data(), (int)avail);
        memcpy(data, tmp.data(), avail * 8); // float32 stereo
        renderer_->ReleaseBuffer(avail, 0);
    }
    running_.store(false);
    CoUninitialize();
}

bool AudioEngine::startWaveOut(int sampleRate, int bufferFrames, std::wstring& err) {
    WAVEFORMATEX fmt {};
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = 2;
    fmt.nSamplesPerSec = (DWORD)sampleRate;
    fmt.wBitsPerSample = 16;
    fmt.nBlockAlign = 4;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

    waveEvent_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);

    MMRESULT mr = waveOutOpen(&hwo_, WAVE_MAPPER, &fmt, (DWORD_PTR)waveEvent_, 0, CALLBACK_EVENT);
    if (mr != MMSYSERR_NOERROR) {
        err = L"Audio device unavailable. Please select another output device.";
        releaseWaveOut();
        return false;
    }

    WAVEOUTCAPSW caps {};
    if (waveOutGetDevCapsW(WAVE_MAPPER, &caps, sizeof(caps)) == MMSYSERR_NOERROR)
        deviceName_ = caps.szPname;
    else
        deviceName_ = L"Default playback device";

    const int frames = bufferFrames;
    waveMem_.assign((size_t)kWaveBufs * frames * 2, 0);
    memset(whdr_, 0, sizeof(whdr_));
    for (int i = 0; i < kWaveBufs; ++i) {
        whdr_[i].lpData = (LPSTR)(waveMem_.data() + (size_t)i * frames * 2);
        whdr_[i].dwBufferLength = (DWORD)(frames * 2 * sizeof(int16_t));
        waveOutPrepareHeader(hwo_, &whdr_[i], sizeof(WAVEHDR));
        waveOutWrite(hwo_, &whdr_[i], sizeof(WAVEHDR));
    }

    sampleRate_ = sampleRate;
    bufferFrames_ = frames;
    useWasapi_ = false;
    running_.store(true);
    stopReq_.store(false);
    thread_ = std::thread([this, frames] {
        std::vector<float> tmp((size_t)frames * 2);
        while (!stopReq_.load()) {
            DWORD w = WaitForSingleObject(waveEvent_, 100);
            if (stopReq_.load()) break;
            if (w != WAIT_OBJECT_0) continue;
            for (int i = 0; i < kWaveBufs; ++i) {
                if (whdr_[i].dwFlags & WHDR_DONE) {
                    fillFloat(tmp.data(), frames);
                    floatToInt16(tmp.data(), (int16_t*)whdr_[i].lpData, frames);
                    whdr_[i].dwFlags &= ~WHDR_DONE;
                    waveOutWrite(hwo_, &whdr_[i], sizeof(WAVEHDR));
                }
            }
        }
        running_.store(false);
    });
    lastError_.clear();
    return true;
}

#endif
