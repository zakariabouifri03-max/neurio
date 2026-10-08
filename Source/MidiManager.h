#pragma once

#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmsystem.h>
#include <vector>
#include <string>
#include <atomic>
#include <functional>
#include <mutex>

#include "Common.h"

class MidiManager {
public:
    using NoteFn = std::function<void(int note, int vel, bool on)>;
    using SustainFn = std::function<void(bool on)>;
    using DisconnectFn = std::function<void()>;

    MidiManager();
    ~MidiManager();

    std::vector<MidiDeviceInfo> enumerate();

    void setNoteCallback(NoteFn fn);
    void setSustainCallback(SustainFn fn);
    void setDisconnectCallback(DisconnectFn fn);

    // index -1 = none
    bool open(int index, std::wstring& err);
    void close();
    bool isOpen() const { return handle_ != nullptr; }
    int  index() const { return index_; }
    std::wstring name() const { return name_; }

private:
    static void CALLBACK cback(HMIDIIN h, UINT msg, DWORD_PTR inst, DWORD_PTR p1, DWORD_PTR p2);
    void onShort(DWORD packed);

    HMIDIIN handle_ = nullptr;
    int index_ = -1;
    std::wstring name_;
    NoteFn noteFn_;
    SustainFn susFn_;
    DisconnectFn discFn_;
    std::mutex cbMutex_;
    uint8_t sustainCc_ = 0;
};

#endif
