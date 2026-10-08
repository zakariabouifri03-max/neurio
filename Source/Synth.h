#pragma once

#include "Common.h"

// High-quality local piano synthesizer. No samples required.
// Four real instruments, 64-voice polyphony, sustain, velocity.

class Synth {
public:
    Synth();

    void setSampleRate(double sr);
    void setInstrument(int id);
    void setMasterGain(float linear01); // 0..1
    void setMuted(bool m);

    void noteOn(int midi, float velocity01);
    void noteOff(int midi);
    void setSustain(bool on);
    void allNotesOff(bool immediate);

    // Render interleaved stereo float32, range ~[-1,1]
    void render(float* interleavedStereo, int frames);

    int  instrument() const { return instrument_; }
    bool sustain() const { return sustain_; }
    int  activeVoices() const;

    // Visualization: 1 = held, 2 = sustaining, 0 = off
    uint8_t visualState(int midi) const;

    // Metronome mixed into the same callback (sample-accurate).
    void setMetronome(bool on, float bpm, float vol01);
    void metronomeReset();
    bool metronomeOn() const { return metroOn_; }
    float metronomeBpm() const { return metroBpm_; }

    float lastPeak() const { return lastPeak_; }

private:
    struct Voice {
        bool  active = false;
        bool  releasing = false;
        int   note = 0;
        int   inst = 0;
        int   age = 0;
        int   nHarms = 0;
        float velocity = 0;
        float panL = 1, panR = 1;
        float env = 0;
        float envAttackInc = 0;
        float envDecayMul = 1;
        float relMul = 0.99f;
        float attackRemain = 0;
        uint32_t phase[kMaxHarms] {};
        uint32_t incr[kMaxHarms] {};
        float    hAmp[kMaxHarms] {};
        float    hDecay[kMaxHarms] {};
        // FM extras
        uint32_t modPhase = 0;
        uint32_t modIncr = 0;
        float    fmIndex = 0;
        float    fmDecay = 0;
        float    hammer = 0;
        float    hammerDecay = 0;
        uint32_t noise = 1;
        float    lp = 0; // per-voice brightness filter
        float    lpCoeff = 0.3f;
    };

    void triggerVoice(Voice& v, int midi, float vel);
    void releaseNote(int midi);
    Voice* allocVoice(int midi);
    void renderVoice(Voice& v, float* L, float* R, int frames);

    double sr_ = kDefaultSr;
    int    instrument_ = 0;
    float  master_ = 0.8f;
    bool   muted_ = false;
    bool   sustain_ = false;
    uint8_t held_[128] {};
    uint8_t sustained_[128] {};
    uint8_t visual_[128] {};
    Voice  voices_[kMaxVoices];
    int    voiceAge_ = 1;

    bool  metroOn_ = false;
    float metroBpm_ = 120;
    float metroVol_ = 0.5f;
    double metroPhase_ = 0; // samples until next click
    int    metroBeat_ = 0;
    float  metroEnv_ = 0;
    uint32_t metroOsc_ = 0;
    uint32_t metroInc_ = 0;

    float dcL_ = 0, dcR_ = 0;
    float lastPeak_ = 0;
    float peakEnv_ = 0;

    static float sinLut_[4096];
    static bool  lutReady_;
    static void  ensureLut();
    static inline float fastSin(uint32_t phase) {
        const uint32_t i0 = phase >> 20;                 // 12-bit
        const uint32_t i1 = (i0 + 1) & 4095;
        const float frac = (float)(phase & 0xFFFFF) * (1.0f / 1048576.0f);
        return sinLut_[i0] + (sinLut_[i1] - sinLut_[i0]) * frac;
    }
};
