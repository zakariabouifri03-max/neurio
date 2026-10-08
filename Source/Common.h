#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static constexpr int kMinNote     = 21;   // A0
static constexpr int kMaxNote     = 108;  // C8
static constexpr int kNumKeys     = 88;
static constexpr int kMaxVoices   = 64;
static constexpr int kMaxHarms    = 24;
static constexpr int kDefaultSr   = 44100;
static constexpr int kDefaultBuf  = 256;
static constexpr int kMaxOctave   = 7;
static constexpr int kMinOctave   = 1;

enum class Instrument : int {
    GrandPiano = 0,
    ElectricPiano,
    Organ,
    SoftPiano,
    Count
};

inline const wchar_t* instrumentName(int id) {
    switch (id) {
        case 0: return L"Grand Piano";
        case 1: return L"Electric Piano";
        case 2: return L"Organ";
        case 3: return L"Soft Piano";
        default: return L"Grand Piano";
    }
}

inline int instrumentMidiProgram(int id) {
    switch (id) {
        case 0: return 0;   // Acoustic Grand
        case 1: return 4;   // Electric Piano 1
        case 2: return 16;  // Drawbar Organ
        case 3: return 0;   // Acoustic Grand (soft via velocity)
        default: return 0;
    }
}

inline bool isBlackKey(int midi) {
    switch (midi % 12) {
        case 1: case 3: case 6: case 8: case 10: return true;
        default: return false;
    }
}

inline int whiteKeyIndex(int midi) {
    // Number of white keys from A0 (21) up to but not including midi.
    int n = 0;
    for (int m = kMinNote; m < midi; ++m)
        if (!isBlackKey(m)) ++n;
    return n;
}

inline int whiteKeyCount() { return 52; }

inline const char* noteNameRaw(int midi) {
    static const char* names[12] = {
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
    };
    if (midi < 0 || midi > 127) return "?";
    return names[midi % 12];
}

inline void noteName(int midi, char* buf, int bufLen) {
    if (!buf || bufLen < 4) return;
    if (midi < 0 || midi > 127) {
        buf[0] = '?'; buf[1] = 0;
        return;
    }
    const char* n = noteNameRaw(midi);
    int oct = midi / 12 - 1;
    if (n[1] == '#')
        snprintf(buf, bufLen, "%s%d", n, oct);
    else
        snprintf(buf, bufLen, "%s%d", n, oct);
}

inline void noteNameW(int midi, wchar_t* buf, int bufLen) {
    char tmp[16];
    noteName(midi, tmp, 16);
    if (bufLen <= 0) return;
    int i = 0;
    for (; tmp[i] && i < bufLen - 1; ++i)
        buf[i] = (wchar_t)(unsigned char)tmp[i];
    buf[i] = 0;
}

// Parse "C4", "C#4", "Db4", "60". Returns -1 on failure.
inline int parseNoteName(const char* s) {
    if (!s) return -1;
    while (*s == ' ' || *s == '\t') ++s;
    if (!*s) return -1;
    if (s[0] >= '0' && s[0] <= '9') {
        int v = atoi(s);
        if (v >= 0 && v <= 127) return v;
        return -1;
    }
    char c = s[0];
    if (c >= 'a' && c <= 'z') c = (char)(c - 'a' + 'A');
    int pc = -1;
    switch (c) {
        case 'C': pc = 0; break;
        case 'D': pc = 2; break;
        case 'E': pc = 4; break;
        case 'F': pc = 5; break;
        case 'G': pc = 7; break;
        case 'A': pc = 9; break;
        case 'B': pc = 11; break;
        default: return -1;
    }
    ++s;
    if (*s == '#' || *s == 's' || *s == 'S') { pc += 1; ++s; }
    else if (*s == 'b') { pc -= 1; ++s; }
    if (pc < 0) pc += 12;
    if (pc > 11) pc -= 12;
    if (*s == '-') {
        // negative octave not used
    }
    if (!*s) return -1;
    bool neg = false;
    if (*s == '-') { neg = true; ++s; }
    if (*s < '0' || *s > '9') return -1;
    int oct = 0;
    while (*s >= '0' && *s <= '9') { oct = oct * 10 + (*s - '0'); ++s; }
    if (neg) oct = -oct;
    int midi = (oct + 1) * 12 + pc;
    if (midi < 0 || midi > 127) return -1;
    return midi;
}

inline float midiToHz(int midi) {
    return 440.0f * powf(2.0f, (midi - 69) / 12.0f);
}

inline int clampi(int v, int a, int b) {
    return v < a ? a : (v > b ? b : v);
}

inline float clampf(float v, float a, float b) {
    return v < a ? a : (v > b ? b : v);
}

struct AudioDeviceInfo {
    std::wstring id;
    std::wstring name;
    bool isDefault = false;
};

struct MidiDeviceInfo {
    int index = -1;
    std::wstring name;
};

enum class CmdType : uint8_t {
    NoteOn = 0,
    NoteOff,
    Sustain,
    AllNotesOff,
    SetInstrument,
    SetVolume,
    Metronome,
    MetronomeClick,
    Panic
};

struct EngineCmd {
    CmdType  type = CmdType::NoteOn;
    uint8_t  note = 0;
    uint8_t  vel  = 0;
    uint8_t  u8   = 0;
    float    f    = 0;
};

static constexpr int kCmdQSize = 1024;
