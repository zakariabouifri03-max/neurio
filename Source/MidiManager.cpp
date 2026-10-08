#ifdef _WIN32

#include "MidiManager.h"

MidiManager::MidiManager() = default;

MidiManager::~MidiManager() {
    close();
}

std::vector<MidiDeviceInfo> MidiManager::enumerate() {
    std::vector<MidiDeviceInfo> out;
    UINT n = midiInGetNumDevs();
    for (UINT i = 0; i < n; ++i) {
        MIDIINCAPSW caps {};
        if (midiInGetDevCapsW(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
            MidiDeviceInfo d;
            d.index = (int)i;
            d.name = caps.szPname;
            out.push_back(d);
        }
    }
    return out;
}

void MidiManager::setNoteCallback(NoteFn fn) {
    std::lock_guard<std::mutex> g(cbMutex_);
    noteFn_ = std::move(fn);
}
void MidiManager::setSustainCallback(SustainFn fn) {
    std::lock_guard<std::mutex> g(cbMutex_);
    susFn_ = std::move(fn);
}
void MidiManager::setDisconnectCallback(DisconnectFn fn) {
    std::lock_guard<std::mutex> g(cbMutex_);
    discFn_ = std::move(fn);
}

bool MidiManager::open(int index, std::wstring& err) {
    close();
    if (index < 0) return true;
    UINT n = midiInGetNumDevs();
    if ((UINT)index >= n) {
        err = L"MIDI device disconnected.";
        return false;
    }
    MIDIINCAPSW caps {};
    midiInGetDevCapsW((UINT)index, &caps, sizeof(caps));
    MMRESULT mr = midiInOpen(&handle_, (UINT)index, (DWORD_PTR)cback, (DWORD_PTR)this, CALLBACK_FUNCTION);
    if (mr != MMSYSERR_NOERROR || !handle_) {
        handle_ = nullptr;
        err = L"Could not open the MIDI device. It may be in use by another application.";
        return false;
    }
    mr = midiInStart(handle_);
    if (mr != MMSYSERR_NOERROR) {
        midiInClose(handle_);
        handle_ = nullptr;
        err = L"Could not start MIDI input.";
        return false;
    }
    index_ = index;
    name_ = caps.szPname;
    return true;
}

void MidiManager::close() {
    if (!handle_) {
        index_ = -1;
        name_.clear();
        return;
    }
    midiInStop(handle_);
    midiInReset(handle_);
    midiInClose(handle_);
    handle_ = nullptr;
    index_ = -1;
    name_.clear();
}

void CALLBACK MidiManager::cback(HMIDIIN, UINT msg, DWORD_PTR inst, DWORD_PTR p1, DWORD_PTR) {
    MidiManager* self = (MidiManager*)inst;
    if (!self) return;
    if (msg == MIM_DATA) {
        self->onShort((DWORD)p1);
    } else if (msg == MIM_CLOSE) {
        DisconnectFn fn;
        {
            std::lock_guard<std::mutex> g(self->cbMutex_);
            fn = self->discFn_;
        }
        self->handle_ = nullptr;
        self->index_ = -1;
        if (fn) fn();
    }
}

void MidiManager::onShort(DWORD packed) {
    const uint8_t st = (uint8_t)(packed & 0xFF);
    const uint8_t d1 = (uint8_t)((packed >> 8) & 0xFF);
    const uint8_t d2 = (uint8_t)((packed >> 16) & 0xFF);
    const uint8_t hi = (uint8_t)(st & 0xF0);

    NoteFn nf;
    SustainFn sf;
    {
        std::lock_guard<std::mutex> g(cbMutex_);
        nf = noteFn_;
        sf = susFn_;
    }

    if (hi == 0x90) {
        if (d2 == 0) {
            if (nf) nf(d1, 0, false);
        } else {
            if (nf) nf(d1, d2, true);
        }
    } else if (hi == 0x80) {
        if (nf) nf(d1, d2, false);
    } else if (hi == 0xB0 && d1 == 64) {
        bool on = d2 >= 64;
        sustainCc_ = d2;
        if (sf) sf(on);
    }
}

#endif
