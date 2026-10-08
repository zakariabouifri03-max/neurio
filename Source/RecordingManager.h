#pragma once

#include "Common.h"
#include <string>

struct RecEvent {
    uint32_t timeMs = 0;
    uint8_t  status = 0; // 0x90 note on, 0x80 note off, 0xB0 CC
    uint8_t  data1  = 0;
    uint8_t  data2  = 0;
};

class RecordingManager {
public:
    void clear();

    void start();
    void stop();
    bool isRecording() const { return recording_; }
    bool isPlaying() const { return playing_; }

    void startPlayback();
    void stopPlayback();
    void seekPlayback(uint32_t ms);

    // Transport clock. Call from UI or audio with current time.
    uint32_t elapsedMs() const;
    uint32_t lengthMs() const { return lengthMs_; }

    void recordNoteOn(int note, int vel);
    void recordNoteOff(int note, int vel = 0);
    void recordSustain(bool on);
    void recordProgram(int program);

    // Playback: emit events whose time is <= nowMs. Returns count.
    int  dequeueDue(uint32_t nowMs, RecEvent* out, int maxOut);
    void resetPlayhead();

    bool empty() const { return events_.empty(); }
    int  eventCount() const { return (int)events_.size(); }

    bool saveMidi(const std::wstring& path, int instrumentProgram, std::wstring& err) const;
    bool loadMidi(const std::wstring& path, std::wstring& err);

    const std::vector<RecEvent>& events() const { return events_; }

private:
    uint32_t nowRecMs() const;

    bool recording_ = false;
    bool playing_ = false;
    uint64_t recStartMs_ = 0;
    uint64_t playStartMs_ = 0;
    uint32_t playOffsetMs_ = 0;
    uint32_t lengthMs_ = 0;
    int playIndex_ = 0;
    std::vector<RecEvent> events_;
};

// Wall-clock milliseconds (portable).
uint64_t wallTimeMs();
