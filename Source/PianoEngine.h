#pragma once

#include "Common.h"
#include "Synth.h"
#include <mutex>

// Thread-safe front-end to the synthesizer.
// UI / MIDI / keyboard push commands; the audio thread calls process().

class PianoEngine {
public:
    PianoEngine();

    void setSampleRate(double sr);

    // Called from any thread (UI, MIDI, keyboard).
    void noteOn(int midi, float velocity01);
    void noteOff(int midi);
    void setSustain(bool on);
    void panic();
    void setInstrument(int id);
    void setMasterGain(float linear01);
    void setMuted(bool m);
    void setMetronome(bool on, float bpm, float vol01);
    void metronomeReset();

    // Audio thread only.
    void process(float* interleavedStereo, int frames);

    // Safe to read from UI thread (atomics / copies).
    int  instrument() const { return instrument_.load(); }
    bool sustain() const { return sustain_.load(); }
    bool muted() const { return muted_.load(); }
    float masterGain() const { return master_.load(); }
    int  activeVoices() const { return voices_.load(); }
    uint8_t visualState(int midi) const;
    float lastPeak() const { return peak_.load(); }
    int  lastNote() const { return lastNote_.load(); }

    bool metronomeOn() const { return metroOn_.load(); }
    float metronomeBpm() const { return metroBpm_.load(); }
    float metronomeVol() const { return metroVol_.load(); }

    // Snapshot of 128 visual states for the UI.
    void copyVisual(uint8_t out[128]) const;

private:
    void push(const EngineCmd& c);

    Synth synth_;
    std::mutex qMutex_;
    EngineCmd q_[kCmdQSize];
    int qHead_ = 0, qTail_ = 0;

    std::atomic<int>   instrument_ { 0 };
    std::atomic<bool>  sustain_ { false };
    std::atomic<bool>  muted_ { false };
    std::atomic<float> master_ { 0.8f };
    std::atomic<int>   voices_ { 0 };
    std::atomic<float> peak_ { 0 };
    std::atomic<int>   lastNote_ { -1 };
    std::atomic<bool>  metroOn_ { false };
    std::atomic<float> metroBpm_ { 120 };
    std::atomic<float> metroVol_ { 0.5f };
    std::atomic<uint8_t> visual_[128];
};
