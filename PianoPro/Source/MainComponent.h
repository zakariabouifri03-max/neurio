#pragma once

#include "MidiManager.h"
#include "PianoEngine.h"
#include "PianoKeyboard.h"
#include "RecordingManager.h"
#include "SettingsManager.h"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <vector>

namespace piano
{

class PianoProLookAndFeel final : public juce::LookAndFeel_V4
{
public:
    PianoProLookAndFeel();
    void setDarkTheme (bool dark);
    bool isDarkTheme() const noexcept { return darkTheme; }

    void drawButtonBackground (juce::Graphics& graphics, juce::Button& button,
                               const juce::Colour& backgroundColour,
                               bool shouldDrawButtonAsHighlighted,
                               bool shouldDrawButtonAsDown) override;
    void drawButtonText (juce::Graphics& graphics, juce::TextButton& button,
                         bool shouldDrawButtonAsHighlighted,
                         bool shouldDrawButtonAsDown) override;
    void drawComboBox (juce::Graphics& graphics, int width, int height,
                       bool isButtonDown, int buttonX, int buttonY,
                       int buttonW, int buttonH, juce::ComboBox& box) override;
    void drawLinearSlider (juce::Graphics& graphics, int x, int y, int width, int height,
                           float sliderPos, float minSliderPos, float maxSliderPos,
                           juce::Slider::SliderStyle style, juce::Slider& slider) override;

private:
    bool darkTheme = true;
};

class SettingsWindow;

class MainComponent final : public juce::Component,
                            private juce::AudioIODeviceCallback,
                            private juce::KeyListener,
                            private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;

    void paint (juce::Graphics& graphics) override;
    void resized() override;

    bool keyPressed (const juce::KeyPress& key) override;
    bool keyStateChanged (bool isKeyDown) override;

private:
    // AudioIODeviceCallback (called on the selected device's high-priority thread).
    void audioDeviceIOCallbackWithContext (const float* const* inputChannelData,
                                           int numInputChannels,
                                           float* const* outputChannelData,
                                           int numOutputChannels,
                                           int numSamples,
                                           const juce::AudioIODeviceCallbackContext& context) override;
    void audioDeviceAboutToStart (juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;
    void audioDeviceError (const juce::String& errorMessage) override;

    // KeyListener, added to the controls so note mapping works across the window.
    bool keyPressed (const juce::KeyPress& key, juce::Component* originatingComponent) override;
    bool keyStateChanged (bool isKeyDown, juce::Component* originatingComponent) override;

    // Timer.
    void timerCallback() override;

    void configureControls();
    void configureKeyListeners();
    void populateMidiDropdown();
    void updateInstrumentAvailability();
    void updateAudioStateAndStatus();
    void updatePerformanceStatus();
    void applyTheme();
    void applyUiScale();
    void scheduleSettingsSave();
    void saveSettingsNow();

    void chooseInstrument (Instrument instrument);
    void changeOctave (int delta);
    void setSustainState (SustainSource source, bool enabled);
    bool effectiveSustainState() const;
    void setMetronomeState();

    void startRecording();
    void stopAll();
    void startOrStopPlayback();
    void saveMidiFile();
    void openMidiFile();
    void loadMidiFile (const juce::File& file);
    void showMessage (const juce::String& title, const juce::String& message, bool isError = false);

    void onLocalNoteOn (int note, int velocity);
    void onNoteOff (int note);
    void onMidiNoteOn (int note, int velocity);
    void onMidiNoteOff (int note);
    void onMidiProgramChange (std::uint16_t bank, int program);
    void onNoteStartedOnMessageThread (int note);
    void releaseComputerKey (int keyCode);
    void releaseAnyLostComputerKeys();
    void releaseAllComputerKeys();
    bool handleComputerKeyPress (const juce::KeyPress& key);
    std::optional<std::vector<int>> parsePracticeSequence (juce::String text) const;
    void startPractice();
    void clearPractice();
    void advancePractice (int playedNote);
    void updatePracticeLabel();
    void openSettings();

    juce::AudioDeviceManager deviceManager;
    SettingsManager settingsManager;
    AppSettings userSettings;
    PianoEngine engine;
    RecordingManager recordingManager;
    MidiManager midiManager;
    PianoProLookAndFeel lookAndFeel;
    PianoKeyboard pianoKeyboard;

    juce::Label appNameLabel;
    juce::ComboBox instrumentBox;
    juce::TextButton octaveDownButton { "−" };
    juce::TextButton octaveUpButton { "+" };
    juce::Label octaveLabel;
    juce::ComboBox midiInputBox;
    juce::Label audioStatusLabel;
    juce::Slider masterVolumeSlider;
    juce::Label volumeValueLabel;
    juce::TextButton muteButton { "Mute" };
    juce::TextButton settingsButton { "Settings" };

    juce::Label currentNoteHeading;
    juce::Label currentNoteLabel;
    juce::Label audioDeviceLabel;
    juce::Label recordingStatusLabel;

    juce::TextButton recordButton { "●  Record" };
    juce::TextButton stopButton { "■  Stop" };
    juce::TextButton playButton { "▶  Play" };
    juce::TextButton saveMidiButton { "Save MIDI" };
    juce::TextButton openMidiButton { "Open MIDI" };
    juce::TextButton sustainButton { "Sustain" };
    juce::TextButton metronomeButton { "Metronome" };
    juce::Label bpmLabel;
    juce::Slider bpmSlider;

    juce::Label practiceHeading;
    juce::TextEditor practiceEditor;
    juce::TextButton practiceButton { "Start Practice" };
    juce::TextButton clearPracticeButton { "Clear" };
    juce::Label nextNoteLabel;

    std::vector<juce::String> midiComboIdentifiers;
    std::map<int, int> heldComputerNotes;
    std::vector<int> practiceSequence;
    std::size_t practiceIndex = 0;
    std::uint64_t lastUiNoteEventCounter = 0;
    std::uint32_t lastMidiRefreshMs = 0;
    std::uint32_t lastDeviceStateSaveMs = 0;
    std::uint32_t settingsSaveDueMs = 0;
    bool audioCallbackRegistered = false;
    bool suppressControlCallbacks = false;
    bool spaceShortcutDown = false;
    bool zShortcutDown = false;
    bool xShortcutDown = false;
    int zShortcutKeyCode = 'z';
    int xShortcutKeyCode = 'x';
    bool settingsSavePending = false;
    bool midiSustainOn = false;
    bool uiSustainOn = false;
    mutable std::mutex sustainMutex;
    mutable std::mutex audioErrorMutex;
    juce::String lastAudioError;
    int selectedInstrumentUi = 0;
    std::unique_ptr<SettingsWindow> settingsWindow;
    std::unique_ptr<juce::FileChooser> fileChooser;
};

} // namespace piano
