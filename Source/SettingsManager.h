#pragma once

#include "Common.h"
#include <map>

struct AppSettings {
    // Audio
    std::wstring audioDevice;
    int sampleRate = kDefaultSr;
    int bufferSize = kDefaultBuf;
    int volumePct = 80;
    bool muted = false;

    // MIDI
    std::wstring midiDevice;

    // Piano
    int instrument = 0;
    int octave = 4;
    bool sustain = false;
    bool velocityFromMouse = true;
    int defaultVelocity = 100;

    // Keyboard: vk -> semitone offset from C of current octave, -1 unused
    int keyMap[256];

    // Interface
    int theme = 0;      // 0 dark, 1 light
    int uiScale = 100;  // 100, 125, 150
    bool showKeyLabels = true;
    bool showComputerKeys = true;

    // Metronome
    bool metroOn = false;
    int metroBpm = 120;
    int metroVol = 50;

    // Window
    int winX = CW_USEDEFAULT_SENTINEL;
    int winY = CW_USEDEFAULT_SENTINEL;
    int winW = 1280;
    int winH = 760;

    static const int CW_USEDEFAULT_SENTINEL = -32000;

    AppSettings();
    void resetKeyMap();
};

class SettingsManager {
public:
    bool load(const std::wstring& path);
    bool save(const std::wstring& path) const;

    AppSettings data;
};
