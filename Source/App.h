#pragma once

#ifdef _WIN32

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <vector>
#include <string>

#include "Common.h"
#include "Theme.h"
#include "PianoEngine.h"
#include "AudioEngine.h"
#include "MidiManager.h"
#include "RecordingManager.h"
#include "SettingsManager.h"
#include "PianoKeyboard.h"

class App {
public:
    static App& instance();
    int run(HINSTANCE hInst, int nCmdShow);

    PianoEngine& engine() { return engine_; }

private:
    App() = default;

    static LRESULT CALLBACK wndProc(HWND, UINT, WPARAM, LPARAM);
    static LRESULT CALLBACK settingsProc(HWND, UINT, WPARAM, LPARAM);

    LRESULT handle(HWND, UINT, WPARAM, LPARAM);
    LRESULT handleSettings(HWND, UINT, WPARAM, LPARAM);

    bool createMain(HINSTANCE, int nCmdShow);
    void applyThemeToWindow(HWND);
    void computeLayout();
    void paint(HWND, HDC);
    void paintSettings(HDC);
    void tick();
    void saveSettings();
    void loadSettings();
    std::wstring settingsPath() const;
    std::wstring appDataDir() const;

    bool startAudio(std::wstring& err);
    void applyInstrument(int id);
    void applyVolume();
    void setOctave(int oct);
    void toggleSustain();
    void setSustain(bool on);

    void pressNote(int midi, int vel127, int source);
    void releaseNote(int midi, int source);
    void releaseSource(int source);
    void releaseAllComputerKeys();

    void startRecord();
    void stopTransport();
    void startPlay();
    void saveMidi();
    void openMidi();

    void openSettings();
    void applySettingsFromUi();
    void refreshDeviceLists();

    bool parsePractice(const std::wstring& text);
    void practiceAdvance(int midi);

    int midiFromVk(int vk) const;
    float mouseVelocity(int midi, int y) const;

    HINSTANCE hInst_ = nullptr;
    HWND hwnd_ = nullptr;
    HWND hwndSet_ = nullptr;
    UINT_PTR timer_ = 0;

    PianoEngine engine_;
    AudioEngine audio_;
    MidiManager midi_;
    RecordingManager rec_;
    SettingsManager cfg_;
    PianoKeyboard kbd_;
    Theme theme_;

    // Layout
    RECT rcClient_ {}, rcTop_ {}, rcStatus_ {}, rcPiano_ {}, rcBottom_ {};
    RECT rcLogo_ {}, rcInst_ {}, rcOctDn_ {}, rcOct_ {}, rcOctUp_ {};
    RECT rcVol_ {}, rcMute_ {}, rcGear_ {};
    RECT rcRec_ {}, rcStop_ {}, rcPlay_ {}, rcOpen_ {}, rcSave_ {};
    RECT rcSus_ {}, rcMetro_ {}, rcBpmDn_ {}, rcBpm_ {}, rcBpmUp_ {}, rcPrac_ {};
    RECT rcNote_ {}, rcMidi_ {}, rcInfo_ {};
    float scale_ = 1.0f;
    int dpi_ = 96;

    // Interaction
    int hoverId_ = 0;
    int activeId_ = 0;
    int comboOpen_ = 0; // 1 inst, 2 midi (settings)
    int mouseNote_ = -1;
    int hoverMidi_ = -1;
    bool mouseDown_ = false;
    bool keyDown_[256] {};
    int holdCount_[128] {};
    int lastNote_ = -1;
    float pressAmt_[88] {};
    uint8_t visual_[128] {};

    // Settings UI scratch
    std::vector<AudioDeviceInfo> audioDevs_;
    std::vector<MidiDeviceInfo> midiDevs_;
    int setAudioSel_ = 0;
    int setMidiSel_ = 0;
    int setSrSel_ = 0;
    int setBufSel_ = 1;
    int setTheme_ = 0;
    int setScale_ = 100;
    bool setVelMouse_ = true;
    bool setLabels_ = true;
    bool setCompKeys_ = true;
    int setDefVel_ = 100;
    int remapArmedVk_ = -1; // waiting for piano click to bind
    bool waitingBind_ = false;

    // Practice
    bool practiceOn_ = false;
    std::vector<int> practiceSeq_;
    int practiceIdx_ = 0;
    std::wstring practiceText_ = L"C4 E4 G4 C5";
    bool practiceFocus_ = false;
    bool spaceSustain_ = false;
    bool wasPlaying_ = false;

    struct SetLayout {
        RECT audio {}, sr {}, buf {}, midi {};
        RECT vel {}, lab {}, comp {}, defvel {}, reset {};
        RECT dark {}, light {}, s100 {}, s125 {}, s150 {};
        RECT metroVol {};
        RECT apply {}, close {};
        RECT dropAudio {}, dropMidi {};
    } setL_;
    void computeSettingsLayout(int W, int H);

    std::wstring statusMsg_;
    uint64_t statusUntil_ = 0;
    bool audioOk_ = false;

    static const int SRC_KBD = 1;
    static const int SRC_MOUSE = 2;
    static const int SRC_MIDI = 3;
    static const int SRC_PLAY = 4;
};

#endif
