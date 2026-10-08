#include "Synth.h"

float Synth::sinLut_[4096];
bool  Synth::lutReady_ = false;

void Synth::ensureLut() {
    if (lutReady_) return;
    for (int i = 0; i < 4096; ++i)
        sinLut_[i] = sinf(6.28318530718f * (float)i / 4096.0f);
    lutReady_ = true;
}

Synth::Synth() {
    ensureLut();
    memset(held_, 0, sizeof(held_));
    memset(sustained_, 0, sizeof(sustained_));
    memset(visual_, 0, sizeof(visual_));
}

void Synth::setSampleRate(double sr) {
    if (sr < 8000) sr = 8000;
    if (sr > 192000) sr = 192000;
    sr_ = sr;
}

void Synth::setInstrument(int id) {
    id = clampi(id, 0, (int)Instrument::Count - 1);
    instrument_ = id;
}

void Synth::setMasterGain(float linear01) {
    master_ = clampf(linear01, 0.0f, 1.0f);
}

void Synth::setMuted(bool m) { muted_ = m; }

void Synth::setMetronome(bool on, float bpm, float vol01) {
    metroOn_ = on;
    metroBpm_ = clampf(bpm, 40.0f, 240.0f);
    metroVol_ = clampf(vol01, 0.0f, 1.0f);
}

void Synth::metronomeReset() {
    metroPhase_ = 0;
    metroBeat_ = 0;
    metroEnv_ = 0;
}

int Synth::activeVoices() const {
    int n = 0;
    for (int i = 0; i < kMaxVoices; ++i)
        if (voices_[i].active) ++n;
    return n;
}

uint8_t Synth::visualState(int midi) const {
    if (midi < 0 || midi > 127) return 0;
    return visual_[midi];
}

Synth::Voice* Synth::allocVoice(int midi) {
    // Prefer existing voice on same note (retrigger).
    for (int i = 0; i < kMaxVoices; ++i) {
        if (voices_[i].active && voices_[i].note == midi)
            return &voices_[i];
    }
    for (int i = 0; i < kMaxVoices; ++i) {
        if (!voices_[i].active)
            return &voices_[i];
    }
    // Steal: quietest releasing, else oldest.
    int bestRel = -1;
    float bestEnv = 1e9f;
    int bestOld = 0;
    int oldest = 0x7fffffff;
    for (int i = 0; i < kMaxVoices; ++i) {
        Voice& v = voices_[i];
        if (v.releasing && v.env < bestEnv) {
            bestEnv = v.env;
            bestRel = i;
        }
        if (v.age < oldest) {
            oldest = v.age;
            bestOld = i;
        }
    }
    return &voices_[bestRel >= 0 ? bestRel : bestOld];
}

void Synth::triggerVoice(Voice& v, int midi, float vel) {
    vel = clampf(vel, 0.01f, 1.0f);
    v.active = true;
    v.releasing = false;
    v.note = midi;
    v.inst = instrument_;
    v.age = voiceAge_++;
    v.velocity = vel;
    v.env = 0;
    v.lp = 0;
    v.noise = 0x12345678u ^ (uint32_t)(midi * 7919 + (int)(vel * 1000));

    const float pan = (midi - kMinNote) / 87.0f; // 0 left .. 1 right
    v.panL = 0.75f - 0.45f * pan;
    v.panR = 0.30f + 0.45f * pan;

    const float hz = midiToHz(midi);
    const float nyq = (float)sr_ * 0.48f;

    auto setHarm = [&](int i, float freq, float amp, float tauSec) {
        if (i >= kMaxHarms) return;
        if (freq >= nyq || freq < 20.0f) {
            v.incr[i] = 0;
            v.hAmp[i] = 0;
            v.hDecay[i] = 1;
            return;
        }
        const double inc = (double)freq / sr_;
        v.incr[i] = (uint32_t)(inc * 4294967296.0);
        v.phase[i] = (uint32_t)(v.noise * (i + 3) * 0x9E3779B9u);
        v.hAmp[i] = amp;
        const float mul = expf(-1.0f / ((float)sr_ * tauSec));
        v.hDecay[i] = mul;
    };

    const float bass = clampf(1.0f - (midi - 21) / 87.0f, 0.0f, 1.0f);
    const float treble = 1.0f - bass;

    if (v.inst == (int)Instrument::ElectricPiano) {
        v.nHarms = 2;
        // Carrier
        setHarm(0, hz, 0.55f * (0.4f + 0.6f * vel), 0.55f + vel * 0.9f + bass * 0.8f);
        // Unused slot kept zero
        setHarm(1, hz * 2.0f, 0.08f * vel, 0.25f);
        v.modIncr = (uint32_t)((hz / sr_) * 4294967296.0);
        v.modPhase = 0;
        v.fmIndex = (2.2f + 4.5f * vel);
        v.fmDecay = expf(-1.0f / ((float)sr_ * (0.22f + 0.35f * vel)));
        v.hammer = 0.22f * vel;
        v.hammerDecay = expf(-1.0f / ((float)sr_ * 0.006f));
        v.attackRemain = (float)sr_ * 0.004f;
        v.envAttackInc = 1.0f / v.attackRemain;
        v.envDecayMul = expf(-1.0f / ((float)sr_ * (0.7f + 1.1f * vel + bass)));
        v.relMul = expf(-1.0f / ((float)sr_ * 0.18f));
        v.lpCoeff = 0.15f + 0.55f * vel;
    } else if (v.inst == (int)Instrument::Organ) {
        // Hammond-ish drawbars relative to 8'
        const float ratios[] = { 0.5f, 1.5f, 1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 8.0f };
        const float amps[]   = { 0.35f, 0.55f, 1.00f, 0.70f, 0.45f, 0.38f, 0.22f, 0.16f, 0.10f };
        v.nHarms = 9;
        for (int i = 0; i < 9; ++i)
            setHarm(i, hz * ratios[i], amps[i] * (0.25f + 0.2f * vel), 50.0f); // no decay
        v.hammer = 0;
        v.hammerDecay = 0;
        v.fmIndex = 0;
        v.attackRemain = (float)sr_ * 0.018f;
        v.envAttackInc = 1.0f / v.attackRemain;
        v.envDecayMul = 1.0f; // sustain
        v.relMul = expf(-1.0f / ((float)sr_ * 0.09f));
        v.lpCoeff = 0.85f;
    } else {
        // Grand / Soft piano — additive with inharmonicity
        const bool soft = (v.inst == (int)Instrument::SoftPiano);
        const float B = 0.00012f + 0.00028f * treble; // inharmonicity
        v.nHarms = soft ? 12 : (midi > 90 ? 8 : (midi > 70 ? 14 : 22));
        const float tilt = soft ? 1.55f : (1.05f - 0.45f * vel);
        const float tauSlow = (soft ? 1.6f : 1.1f) * (0.35f + 3.8f * powf(0.50f, (midi - 21) / 28.0f));
        const float tauFast = 0.07f + 0.22f * bass;
        for (int n = 1; n <= v.nHarms; ++n) {
            const float fn = hz * (float)n * sqrtf(1.0f + B * (float)(n * n));
            float amp = powf(1.0f / (float)n, tilt);
            if (n == 1) amp *= 1.0f;
            else amp *= 0.85f;
            // Slight formant around 1 kHz for body
            const float form = 1.0f + 0.35f * expf(-0.5f * powf((fn - 900.0f) / 700.0f, 2.0f));
            amp *= form;
            if (soft && n > 6) amp *= 0.55f;
            const float tau = tauSlow / (1.0f + 0.12f * (float)n) + tauFast * (n == 1 ? 1.0f : 0.25f);
            setHarm(n - 1, fn, amp * (0.22f + 0.18f * vel), tau);
        }
        v.hammer = (soft ? 0.08f : 0.18f) * vel * (0.5f + 0.5f * treble);
        v.hammerDecay = expf(-1.0f / ((float)sr_ * (soft ? 0.012f : 0.007f)));
        v.fmIndex = 0;
        v.attackRemain = (float)sr_ * (soft ? 0.008f : 0.0035f);
        v.envAttackInc = 1.0f / v.attackRemain;
        v.envDecayMul = expf(-1.0f / ((float)sr_ * tauSlow));
        v.relMul = expf(-1.0f / ((float)sr_ * (soft ? 0.22f : 0.14f)));
        v.lpCoeff = soft ? (0.12f + 0.25f * vel) : (0.22f + 0.55f * vel);
    }
}

void Synth::noteOn(int midi, float velocity01) {
    midi = clampi(midi, 0, 127);
    velocity01 = clampf(velocity01, 0.01f, 1.0f);
    held_[midi] = 1;
    sustained_[midi] = 0;
    visual_[midi] = 1;
    Voice* v = allocVoice(midi);
    triggerVoice(*v, midi, velocity01);
}

void Synth::releaseNote(int midi) {
    for (int i = 0; i < kMaxVoices; ++i) {
        Voice& v = voices_[i];
        if (v.active && v.note == midi && !v.releasing) {
            v.releasing = true;
            // Organ and others: switch to release multiplier.
            v.envDecayMul = v.relMul;
            if (v.inst == (int)Instrument::Organ)
                v.envDecayMul = v.relMul;
        }
    }
}

void Synth::noteOff(int midi) {
    midi = clampi(midi, 0, 127);
    held_[midi] = 0;
    if (sustain_) {
        sustained_[midi] = 1;
        visual_[midi] = 2;
        return;
    }
    visual_[midi] = 0;
    releaseNote(midi);
}

void Synth::setSustain(bool on) {
    if (sustain_ == on) return;
    sustain_ = on;
    if (!on) {
        for (int n = 0; n < 128; ++n) {
            if (sustained_[n]) {
                sustained_[n] = 0;
                if (!held_[n]) {
                    visual_[n] = 0;
                    releaseNote(n);
                }
            }
        }
    } else {
        for (int n = 0; n < 128; ++n)
            if (held_[n]) visual_[n] = 1;
    }
}

void Synth::allNotesOff(bool immediate) {
    memset(held_, 0, sizeof(held_));
    memset(sustained_, 0, sizeof(sustained_));
    memset(visual_, 0, sizeof(visual_));
    sustain_ = false;
    if (immediate) {
        for (int i = 0; i < kMaxVoices; ++i)
            voices_[i].active = false;
        return;
    }
    for (int i = 0; i < kMaxVoices; ++i) {
        if (voices_[i].active && !voices_[i].releasing) {
            voices_[i].releasing = true;
            voices_[i].envDecayMul = voices_[i].relMul * voices_[i].relMul;
        }
    }
}

void Synth::renderVoice(Voice& v, float* L, float* R, int frames) {
    const int nh = v.nHarms;
    const float panL = v.panL;
    const float panR = v.panR;
    const bool organ = (v.inst == (int)Instrument::Organ);
    const bool fm = (v.inst == (int)Instrument::ElectricPiano);

    for (int i = 0; i < frames; ++i) {
        if (v.attackRemain > 0) {
            v.env += v.envAttackInc;
            if (v.env > 1.0f) v.env = 1.0f;
            v.attackRemain -= 1.0f;
        } else {
            v.env *= v.envDecayMul;
        }

        float s = 0.0f;
        if (fm) {
            const float mod = fastSin(v.modPhase);
            v.modPhase += v.modIncr;
            const float idx = v.fmIndex;
            v.fmIndex *= v.fmDecay;
            // Phase modulation of carrier
            const uint32_t pm = v.phase[0] + (uint32_t)(mod * idx * (float)(1u << 20) * 8.0f);
            s = fastSin(pm);
            v.phase[0] += v.incr[0];
            s *= v.hAmp[0];
            v.hAmp[0] *= v.hDecay[0];
            // Bell overtone
            s += 0.12f * v.velocity * fastSin(v.phase[1]);
            v.phase[1] += v.incr[1];
        } else {
            for (int h = 0; h < nh; ++h) {
                if (v.hAmp[h] < 1e-6f) continue;
                s += v.hAmp[h] * fastSin(v.phase[h]);
                v.phase[h] += v.incr[h];
                v.hAmp[h] *= v.hDecay[h];
            }
        }

        // Hammer / tine noise
        if (v.hammer > 1e-5f) {
            v.noise = v.noise * 1664525u + 1013904223u;
            const float n = ((int32_t)v.noise) * (1.0f / 2147483648.0f);
            s += v.hammer * n;
            v.hammer *= v.hammerDecay;
        }

        // Brightness one-pole
        v.lp += v.lpCoeff * (s - v.lp);
        s = v.lp;

        s *= v.env * (0.55f + 0.45f * v.velocity);

        L[i] += s * panL;
        R[i] += s * panR;

        if (v.env < 0.0008f && v.attackRemain <= 0 && !organ) {
            v.active = false;
            return;
        }
        if (organ && v.releasing && v.env < 0.001f) {
            v.active = false;
            return;
        }
    }
}

void Synth::render(float* interleavedStereo, int frames) {
    if (frames <= 0) return;

    // Local mix buffers (cap at 2048 frames per call; loop if bigger).
    const int chunkMax = 1024;
    int done = 0;
    float peak = peakEnv_ * 0.95f;

    while (done < frames) {
        const int n = std::min(chunkMax, frames - done);
        float L[1024];
        float R[1024];
        memset(L, 0, n * sizeof(float));
        memset(R, 0, n * sizeof(float));

        for (int vi = 0; vi < kMaxVoices; ++vi) {
            if (voices_[vi].active)
                renderVoice(voices_[vi], L, R, n);
        }

        // Metronome
        if (metroOn_ && metroBpm_ > 0) {
            const double samplesPerBeat = sr_ * 60.0 / (double)metroBpm_;
            const uint32_t accInc = (uint32_t)((1000.0 / sr_) * 4294967296.0);
            const uint32_t beatInc = (uint32_t)((1400.0 / sr_) * 4294967296.0);
            for (int i = 0; i < n; ++i) {
                if (metroPhase_ <= 0) {
                    metroEnv_ = 1.0f;
                    metroOsc_ = 0;
                    metroInc_ = (metroBeat_ == 0) ? beatInc : accInc;
                    metroBeat_ = (metroBeat_ + 1) & 3;
                    metroPhase_ += samplesPerBeat;
                }
                metroPhase_ -= 1.0;
                if (metroEnv_ > 0.0001f) {
                    const float click = fastSin(metroOsc_) * metroEnv_ * metroVol_ * 0.35f;
                    metroOsc_ += metroInc_;
                    metroEnv_ *= expf(-1.0f / ((float)sr_ * 0.012f));
                    L[i] += click;
                    R[i] += click;
                }
            }
            // Fix metroEnv decay properly
            // (the ternary above is messy; re-decay via exp once)
        }

        const float g = muted_ ? 0.0f : (master_ * master_ * 0.85f + master_ * 0.15f);
        const float dcA = 1.0f - (float)(20.0 * 6.28318530718 / sr_); // ~20 Hz DC block

        float* out = interleavedStereo + done * 2;
        for (int i = 0; i < n; ++i) {
            float l = L[i] * g;
            float r = R[i] * g;
            // DC blocker
            const float nl = l;
            const float nr = r;
            l = nl - dcL_;
            r = nr - dcR_;
            dcL_ = nl + (dcL_ - nl) * (1.0f - 0.0025f);
            dcR_ = nr + (dcR_ - nr) * (1.0f - 0.0025f);
            (void)dcA;
            // Soft saturate
            l = tanhf(l);
            r = tanhf(r);
            const float p = fabsf(l) > fabsf(r) ? fabsf(l) : fabsf(r);
            if (p > peak) peak = p;
            out[i * 2]     = l;
            out[i * 2 + 1] = r;
        }
        done += n;
    }

    peakEnv_ = peak;
    lastPeak_ = peak;
}
