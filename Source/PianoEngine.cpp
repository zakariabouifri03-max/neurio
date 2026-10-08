#include "PianoEngine.h"

PianoEngine::PianoEngine() {
    for (int i = 0; i < 128; ++i)
        visual_[i].store(0);
}

void PianoEngine::setSampleRate(double sr) {
    synth_.setSampleRate(sr);
}

void PianoEngine::push(const EngineCmd& c) {
    std::lock_guard<std::mutex> g(qMutex_);
    const int next = (qHead_ + 1) % kCmdQSize;
    if (next == qTail_) {
        // Queue full: drop oldest.
        qTail_ = (qTail_ + 1) % kCmdQSize;
    }
    q_[qHead_] = c;
    qHead_ = next;
}

void PianoEngine::noteOn(int midi, float velocity01) {
    midi = clampi(midi, kMinNote, kMaxNote);
    EngineCmd c;
    c.type = CmdType::NoteOn;
    c.note = (uint8_t)midi;
    c.vel  = (uint8_t)clampi((int)(velocity01 * 127.0f + 0.5f), 1, 127);
    push(c);
    lastNote_.store(midi);
}

void PianoEngine::noteOff(int midi) {
    midi = clampi(midi, 0, 127);
    EngineCmd c;
    c.type = CmdType::NoteOff;
    c.note = (uint8_t)midi;
    push(c);
}

void PianoEngine::setSustain(bool on) {
    EngineCmd c;
    c.type = CmdType::Sustain;
    c.u8 = on ? 1 : 0;
    push(c);
    sustain_.store(on);
}

void PianoEngine::panic() {
    EngineCmd c;
    c.type = CmdType::Panic;
    push(c);
}

void PianoEngine::setInstrument(int id) {
    id = clampi(id, 0, (int)Instrument::Count - 1);
    EngineCmd c;
    c.type = CmdType::SetInstrument;
    c.u8 = (uint8_t)id;
    push(c);
    instrument_.store(id);
}

void PianoEngine::setMasterGain(float linear01) {
    EngineCmd c;
    c.type = CmdType::SetVolume;
    c.f = clampf(linear01, 0.0f, 1.0f);
    push(c);
    master_.store(c.f);
}

void PianoEngine::setMuted(bool m) {
    muted_.store(m);
    EngineCmd c;
    c.type = CmdType::SetVolume;
    c.f = m ? 0.0f : master_.load();
    // Also send mute via instrument? Use volume + a dedicated mute in process.
    push(c);
}

void PianoEngine::setMetronome(bool on, float bpm, float vol01) {
    metroOn_.store(on);
    metroBpm_.store(bpm);
    metroVol_.store(vol01);
    EngineCmd c;
    c.type = CmdType::Metronome;
    c.u8 = on ? 1 : 0;
    c.f = bpm;
    c.vel = (uint8_t)clampi((int)(vol01 * 127), 0, 127);
    push(c);
}

void PianoEngine::metronomeReset() {
    EngineCmd c;
    c.type = CmdType::MetronomeClick; // reuse: reset
    push(c);
}

void PianoEngine::process(float* interleavedStereo, int frames) {
    EngineCmd local[256];
    int ncmd = 0;
    {
        std::lock_guard<std::mutex> g(qMutex_);
        while (qTail_ != qHead_ && ncmd < 256) {
            local[ncmd++] = q_[qTail_];
            qTail_ = (qTail_ + 1) % kCmdQSize;
        }
    }
    for (int i = 0; i < ncmd; ++i) {
        const EngineCmd& c = local[i];
        switch (c.type) {
            case CmdType::NoteOn:
                synth_.noteOn(c.note, c.vel / 127.0f);
                break;
            case CmdType::NoteOff:
                synth_.noteOff(c.note);
                break;
            case CmdType::Sustain:
                synth_.setSustain(c.u8 != 0);
                break;
            case CmdType::AllNotesOff:
            case CmdType::Panic:
                synth_.allNotesOff(c.type == CmdType::Panic);
                break;
            case CmdType::SetInstrument:
                synth_.setInstrument(c.u8);
                break;
            case CmdType::SetVolume:
                synth_.setMasterGain(muted_.load() ? 0.0f : c.f);
                synth_.setMuted(muted_.load());
                break;
            case CmdType::Metronome:
                synth_.setMetronome(c.u8 != 0, c.f, c.vel / 127.0f);
                break;
            case CmdType::MetronomeClick:
                synth_.metronomeReset();
                break;
        }
    }

    synth_.setMuted(muted_.load());
    synth_.render(interleavedStereo, frames);
    voices_.store(synth_.activeVoices());
    peak_.store(synth_.lastPeak());
    for (int n = 0; n < 128; ++n)
        visual_[n].store(synth_.visualState(n));
}

uint8_t PianoEngine::visualState(int midi) const {
    if (midi < 0 || midi > 127) return 0;
    return visual_[midi].load();
}

void PianoEngine::copyVisual(uint8_t out[128]) const {
    for (int i = 0; i < 128; ++i)
        out[i] = visual_[i].load();
}
