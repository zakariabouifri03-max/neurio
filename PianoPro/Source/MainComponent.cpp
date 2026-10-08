#include "MainComponent.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <iomanip>
#include <sstream>
#include <utility>

namespace piano
{
namespace
{
const juce::Colour kWindowDark { 0xff0a1020 };
const juce::Colour kCardDark { 0xff121c2d };
const juce::Colour kCardDarkRaised { 0xff18243a };
const juce::Colour kBorderDark { 0xff283750 };
const juce::Colour kTextDark { 0xfff0f5fc };
const juce::Colour kMutedDark { 0xff91a1b9 };
const juce::Colour kTeal { 0xff45d5c3 };
const juce::Colour kTealDark { 0xff167f7a };
const juce::Colour kRecordRed { 0xffe45d70 };
const juce::Colour kWindowLight { 0xffe8eef5 };
const juce::Colour kCardLight { 0xffffffff };
const juce::Colour kCardLightRaised { 0xfff2f6fb };
const juce::Colour kBorderLight { 0xffcad5e2 };
const juce::Colour kTextLight { 0xff17243a };
const juce::Colour kMutedLight { 0xff63748a };

juce::String formatClock (double seconds)
{
    const auto total = std::max (0, static_cast<int> (std::floor (seconds)));
    const auto minutes = total / 60;
    const auto remainder = total % 60;
    return juce::String::formatted ("%02d:%02d", minutes, remainder);
}

juce::String instrumentName (Instrument instrument)
{
    switch (instrument)
    {
        case Instrument::grandPiano: return "Grand Piano";
        case Instrument::electricPiano: return "Electric Piano";
        case Instrument::organ: return "Organ";
        case Instrument::softPiano: return "Soft Piano";
    }
    return "Grand Piano";
}

Instrument instrumentFromIndex (int index)
{
    switch (index)
    {
        case 1: return Instrument::electricPiano;
        case 2: return Instrument::organ;
        case 3: return Instrument::softPiano;
        default: return Instrument::grandPiano;
    }
}

int instrumentIndexFromMidiProgram (std::uint16_t bank, int program)
{
    if (bank == 1)
        return 3;
    if (program == 4)
        return 1;
    if (program == 16)
        return 2;
    return 0;
}

juce::Font makeFont (float height, int style = juce::Font::plain)
{
    return juce::Font (juce::FontOptions (height, style));
}

void setLabelAppearance (juce::Label& label, float fontSize, juce::Colour colour,
                         bool bold = false, juce::Justification justification = juce::Justification::centredLeft)
{
    label.setColour (juce::Label::textColourId, colour);
    label.setFont (makeFont (fontSize, bold ? juce::Font::bold : juce::Font::plain));
    label.setJustificationType (justification);
}

void setButtonAppearance (juce::TextButton& button, juce::Colour fill, juce::Colour text,
                          juce::Colour outline = juce::Colours::transparentBlack)
{
    button.setColour (juce::TextButton::buttonColourId, fill);
    button.setColour (juce::TextButton::textColourOffId, text);
    button.setColour (juce::TextButton::textColourOnId, text);
    button.setColour (juce::ComboBox::outlineColourId, outline);
}

std::filesystem::path pathFromJuceFile (const juce::File& file)
{
    const auto utf8 = file.getFullPathName().toRawUTF8();
    return std::filesystem::u8path (utf8);
}

} // namespace

PianoProLookAndFeel::PianoProLookAndFeel()
{
    setDarkTheme (true);
}

void PianoProLookAndFeel::setDarkTheme (bool dark)
{
    darkTheme = dark;
    const auto window = dark ? kWindowDark : kWindowLight;
    const auto card = dark ? kCardDark : kCardLight;
    const auto text = dark ? kTextDark : kTextLight;
    const auto muted = dark ? kMutedDark : kMutedLight;
    const auto border = dark ? kBorderDark : kBorderLight;

    setColour (juce::ResizableWindow::backgroundColourId, window);
    setColour (juce::PopupMenu::backgroundColourId, card);
    setColour (juce::PopupMenu::textColourId, text);
    setColour (juce::PopupMenu::highlightedBackgroundColourId, kTealDark);
    setColour (juce::PopupMenu::highlightedTextColourId, juce::Colours::white);
    setColour (juce::ComboBox::backgroundColourId, card);
    setColour (juce::ComboBox::textColourId, text);
    setColour (juce::ComboBox::outlineColourId, border);
    setColour (juce::ComboBox::arrowColourId, muted);
    setColour (juce::Slider::thumbColourId, kTeal);
    setColour (juce::Slider::trackColourId, kTealDark);
    setColour (juce::Slider::backgroundColourId, border);
    setColour (juce::Label::textColourId, text);
    setColour (juce::TextEditor::backgroundColourId, card);
    setColour (juce::TextEditor::textColourId, text);
    setColour (juce::TextEditor::outlineColourId, border);
    setColour (juce::TextEditor::focusedOutlineColourId, kTeal);
}

void PianoProLookAndFeel::drawButtonBackground (juce::Graphics& graphics, juce::Button& button,
                                                 const juce::Colour& backgroundColour,
                                                 bool shouldDrawButtonAsHighlighted,
                                                 bool shouldDrawButtonAsDown)
{
    auto colour = backgroundColour;
    if (shouldDrawButtonAsDown || button.getToggleState())
        colour = colour.brighter (darkTheme ? 0.14f : 0.04f);
    else if (shouldDrawButtonAsHighlighted)
        colour = colour.brighter (darkTheme ? 0.08f : 0.02f);

    if (! button.isEnabled())
        colour = colour.withAlpha (0.42f);

    const auto bounds = button.getLocalBounds().toFloat().reduced (0.5f);
    graphics.setColour (colour);
    graphics.fillRoundedRectangle (bounds, 9.0f);
    graphics.setColour ((darkTheme ? kBorderDark : kBorderLight).withAlpha (button.isEnabled() ? 0.9f : 0.4f));
    graphics.drawRoundedRectangle (bounds, 9.0f, 1.0f);
}

void PianoProLookAndFeel::drawButtonText (juce::Graphics& graphics, juce::TextButton& button,
                                           bool, bool)
{
    const auto colour = button.findColour (button.getToggleState() ? juce::TextButton::textColourOnId
                                                                   : juce::TextButton::textColourOffId);
    graphics.setColour (colour.withAlpha (button.isEnabled() ? 1.0f : 0.50f));
    graphics.setFont (makeFont (13.0f, juce::Font::bold));
    graphics.drawFittedText (button.getButtonText(), button.getLocalBounds().reduced (7, 2),
                             juce::Justification::centred, 1);
}

void PianoProLookAndFeel::drawComboBox (juce::Graphics& graphics, int width, int height,
                                         bool isButtonDown, int buttonX, int buttonY,
                                         int buttonW, int buttonH, juce::ComboBox& box)
{
    const auto bounds = juce::Rectangle<float> (0.5f, 0.5f, static_cast<float> (width) - 1.0f,
                                                 static_cast<float> (height) - 1.0f);
    graphics.setColour (box.findColour (juce::ComboBox::backgroundColourId));
    graphics.fillRoundedRectangle (bounds, 9.0f);
    graphics.setColour (box.findColour (juce::ComboBox::outlineColourId));
    graphics.drawRoundedRectangle (bounds, 9.0f, 1.0f);

    const auto arrowColour = box.findColour (juce::ComboBox::arrowColourId);
    juce::Path arrow;
    const auto centreX = static_cast<float> (buttonX) + static_cast<float> (buttonW) * 0.5f;
    const auto centreY = static_cast<float> (buttonY) + static_cast<float> (buttonH) * 0.5f;
    arrow.startNewSubPath (centreX - 4.0f, centreY - 2.0f);
    arrow.lineTo (centreX, centreY + 2.0f);
    arrow.lineTo (centreX + 4.0f, centreY - 2.0f);
    graphics.setColour (isButtonDown ? kTeal : arrowColour);
    graphics.strokePath (arrow, juce::PathStrokeType (1.7f, juce::PathStrokeType::curved,
                                                      juce::PathStrokeType::rounded));
}

void PianoProLookAndFeel::drawLinearSlider (juce::Graphics& graphics, int x, int y, int width, int height,
                                             float sliderPos, float, float,
                                             juce::Slider::SliderStyle style, juce::Slider& slider)
{
    if (style != juce::Slider::LinearHorizontal)
    {
        juce::LookAndFeel_V4::drawLinearSlider (graphics, x, y, width, height, sliderPos, 0.0f, 0.0f, style, slider);
        return;
    }

    const auto trackY = static_cast<float> (y) + static_cast<float> (height) * 0.5f;
    const auto left = static_cast<float> (x) + 2.0f;
    const auto right = static_cast<float> (x + width) - 2.0f;
    graphics.setColour (slider.findColour (juce::Slider::backgroundColourId));
    graphics.fillRoundedRectangle (juce::Rectangle<float> (left, trackY - 3.0f, right - left, 6.0f), 3.0f);
    graphics.setColour (slider.findColour (juce::Slider::trackColourId));
    graphics.fillRoundedRectangle (juce::Rectangle<float> (left, trackY - 3.0f,
                                                            std::max (0.0f, sliderPos - left), 6.0f), 3.0f);
    const auto thumb = juce::Rectangle<float> (sliderPos - 7.0f, trackY - 7.0f, 14.0f, 14.0f);
    graphics.setColour (slider.findColour (juce::Slider::thumbColourId));
    graphics.fillEllipse (thumb);
    graphics.setColour (darkTheme ? kTextDark : kTextLight);
    graphics.drawEllipse (thumb, 1.0f);
}

namespace
{
struct SettingsCallbacks
{
    std::function<void (const juce::String&)> midiDeviceChanged;
    std::function<void (bool)> themeChanged;
    std::function<void (float)> scaleChanged;
    std::function<void (int)> velocityChanged;
    std::function<void (float)> metronomeVolumeChanged;
};

class SettingsPanel final : public juce::Component
{
public:
    SettingsPanel (PianoProLookAndFeel& lookAndFeel, juce::AudioDeviceManager& audioManager,
                   MidiManager& midi, const AppSettings& initialSettings,
                   SettingsCallbacks newCallbacks)
        : lookAndFeelRef (lookAndFeel), midiManager (midi), callbacks (std::move (newCallbacks)),
          audioSelector (audioManager, 0, 0, 1, 2, false, false, true, false)
    {
        setLookAndFeel (&lookAndFeelRef);
        addAndMakeVisible (audioHeading);
        addAndMakeVisible (audioSelector);
        addAndMakeVisible (midiHeading);
        addAndMakeVisible (midiCombo);
        addAndMakeVisible (refreshMidiButton);
        addAndMakeVisible (keyboardHeading);
        addAndMakeVisible (keyboardHelp);
        addAndMakeVisible (themeButton);
        addAndMakeVisible (scaleHeading);
        addAndMakeVisible (scaleSlider);
        addAndMakeVisible (velocityHeading);
        addAndMakeVisible (velocitySlider);
        addAndMakeVisible (metronomeHeading);
        addAndMakeVisible (metronomeVolumeSlider);
        addAndMakeVisible (offlineNote);

        audioHeading.setText ("AUDIO OUTPUT", juce::dontSendNotification);
        midiHeading.setText ("MIDI INPUT", juce::dontSendNotification);
        keyboardHeading.setText ("COMPUTER KEYBOARD", juce::dontSendNotification);
        scaleHeading.setText ("INTERFACE SCALE", juce::dontSendNotification);
        velocityHeading.setText ("COMPUTER-KEY VELOCITY", juce::dontSendNotification);
        metronomeHeading.setText ("METRONOME VOLUME", juce::dontSendNotification);
        for (auto* label : { &audioHeading, &midiHeading, &keyboardHeading, &scaleHeading,
                             &velocityHeading, &metronomeHeading })
            setLabelAppearance (*label, 11.0f, lookAndFeelRef.isDarkTheme() ? kMutedDark : kMutedLight, true);

        audioSelector.setItemHeight (28);
        midiCombo.setTextWhenNothingSelected ("No MIDI Device");
        refreshMidiButton.setButtonText ("Refresh");
        setButtonAppearance (refreshMidiButton, lookAndFeelRef.isDarkTheme() ? kCardDarkRaised : kCardLightRaised,
                             lookAndFeelRef.isDarkTheme() ? kTextDark : kTextLight);
        refreshMidiButton.onClick = [this] { refreshMidiDevices(); };
        midiCombo.onChange = [this]
        {
            const auto id = midiCombo.getSelectedId();
            const auto found = midiIdentifiers.find (id);
            if (found != midiIdentifiers.end() && callbacks.midiDeviceChanged)
                callbacks.midiDeviceChanged (found->second);
        };

        keyboardHelp.setText ("A W S E D F T G Y H U J K   ·   Z/X octave   ·   Space sustain\n"
                              "Type notes such as C4 E4 G4 C5 in Practice Mode.",
                              juce::dontSendNotification);
        keyboardHelp.setColour (juce::Label::textColourId,
                                lookAndFeelRef.isDarkTheme() ? kMutedDark : kMutedLight);
        keyboardHelp.setFont (makeFont (12.0f));
        keyboardHelp.setJustificationType (juce::Justification::topLeft);

        themeButton.setClickingTogglesState (true);
        themeButton.setToggleState (initialSettings.darkTheme, juce::dontSendNotification);
        themeButton.onClick = [this]
        {
            const bool dark = themeButton.getToggleState();
            themeButton.setButtonText (dark ? "Dark theme" : "Light theme");
            if (callbacks.themeChanged)
                callbacks.themeChanged (dark);
        };

        scaleSlider.setSliderStyle (juce::Slider::LinearHorizontal);
        scaleSlider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 52, 22);
        scaleSlider.setRange (0.80, 1.20, 0.05);
        scaleSlider.setValue (initialSettings.uiScale, juce::dontSendNotification);
        scaleSlider.setTextValueSuffix ("×");
        scaleSlider.onValueChange = [this]
        {
            if (callbacks.scaleChanged)
                callbacks.scaleChanged (static_cast<float> (scaleSlider.getValue()));
        };

        velocitySlider.setSliderStyle (juce::Slider::LinearHorizontal);
        velocitySlider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 52, 22);
        velocitySlider.setRange (1, 127, 1);
        velocitySlider.setValue (initialSettings.computerKeyVelocity, juce::dontSendNotification);
        velocitySlider.setTextValueSuffix (" / 127");
        velocitySlider.onValueChange = [this]
        {
            if (callbacks.velocityChanged)
                callbacks.velocityChanged (static_cast<int> (std::lround (velocitySlider.getValue())));
        };

        metronomeVolumeSlider.setSliderStyle (juce::Slider::LinearHorizontal);
        metronomeVolumeSlider.setTextBoxStyle (juce::Slider::TextBoxRight, false, 52, 22);
        metronomeVolumeSlider.setRange (0.0, 100.0, 1.0);
        metronomeVolumeSlider.setValue (initialSettings.metronomeVolume * 100.0f, juce::dontSendNotification);
        metronomeVolumeSlider.setTextValueSuffix ("%");
        metronomeVolumeSlider.onValueChange = [this]
        {
            if (callbacks.metronomeVolumeChanged)
                callbacks.metronomeVolumeChanged (static_cast<float> (metronomeVolumeSlider.getValue() / 100.0));
        };

        offlineNote.setText ("All audio and MIDI processing stays on this computer. No network connection or account is used.",
                             juce::dontSendNotification);
        offlineNote.setColour (juce::Label::textColourId,
                               lookAndFeelRef.isDarkTheme() ? juce::Colour (0xff9aadc5) : juce::Colour (0xff566a82));
        offlineNote.setFont (makeFont (11.0f));
        offlineNote.setJustificationType (juce::Justification::centredLeft);

        refreshMidiDevices();
        setSize (820, 670);
    }

    ~SettingsPanel() override
    {
        setLookAndFeel (nullptr);
    }

    void paint (juce::Graphics& graphics) override
    {
        graphics.fillAll (lookAndFeelRef.isDarkTheme() ? kWindowDark : kWindowLight);
    }

    void resized() override
    {
        const auto area = getLocalBounds().reduced (22, 16);
        const int leftWidth = juce::jmin (area.getWidth() - 300, 500);
        const int gap = 28;
        int y = area.getY();

        audioHeading.setBounds (area.getX(), y, leftWidth, 20);
        y += 24;
        audioSelector.setBounds (area.getX(), y, leftWidth, 292);
        y += 306;
        midiHeading.setBounds (area.getX(), y, 120, 20);
        midiCombo.setBounds (area.getX(), y + 24, leftWidth - 90, 34);
        refreshMidiButton.setBounds (area.getRight() - 82, y + 24, 82, 34);
        y += 74;
        keyboardHeading.setBounds (area.getX(), y, leftWidth, 20);
        keyboardHelp.setBounds (area.getX(), y + 26, leftWidth, 55);

        const int rightX = area.getX() + leftWidth + gap;
        const int rightWidth = area.getRight() - rightX;
        int rightY = area.getY();
        themeButton.setBounds (rightX, rightY + 2, rightWidth, 40);
        rightY += 62;
        scaleHeading.setBounds (rightX, rightY, rightWidth, 20);
        scaleSlider.setBounds (rightX, rightY + 24, rightWidth, 32);
        rightY += 76;
        velocityHeading.setBounds (rightX, rightY, rightWidth, 20);
        velocitySlider.setBounds (rightX, rightY + 24, rightWidth, 32);
        rightY += 76;
        metronomeHeading.setBounds (rightX, rightY, rightWidth, 20);
        metronomeVolumeSlider.setBounds (rightX, rightY + 24, rightWidth, 32);

        offlineNote.setBounds (area.getX(), area.getBottom() - 30, area.getWidth(), 25);
    }

private:
    void refreshMidiDevices()
    {
        midiManager.refreshDevices();
        midiCombo.clear (juce::dontSendNotification);
        midiIdentifiers.clear();
        midiCombo.addItem ("No MIDI Device", 1);
        midiIdentifiers[1] = {};
        int itemId = 2;
        bool selectedWasListed = false;
        const auto selected = midiManager.selectedIdentifier();
        for (const auto& device : midiManager.availableDevices())
        {
            midiCombo.addItem (device.name, itemId);
            midiIdentifiers[itemId] = device.identifier;
            if (device.identifier == selected)
            {
                midiCombo.setSelectedId (itemId, juce::dontSendNotification);
                selectedWasListed = true;
            }
            ++itemId;
        }
        if (selected.isNotEmpty() && ! selectedWasListed)
        {
            midiCombo.addItem ("Disconnected MIDI Device", itemId);
            midiIdentifiers[itemId] = selected;
            midiCombo.setSelectedId (itemId, juce::dontSendNotification);
        }
        else if (selected.isEmpty())
        {
            midiCombo.setSelectedId (1, juce::dontSendNotification);
        }
    }

    PianoProLookAndFeel& lookAndFeelRef;
    MidiManager& midiManager;
    SettingsCallbacks callbacks;
    juce::AudioDeviceSelectorComponent audioSelector;
    juce::Label audioHeading;
    juce::Label midiHeading;
    juce::ComboBox midiCombo;
    juce::TextButton refreshMidiButton;
    juce::Label keyboardHeading;
    juce::Label keyboardHelp;
    juce::TextButton themeButton { "Dark theme" };
    juce::Label scaleHeading;
    juce::Slider scaleSlider;
    juce::Label velocityHeading;
    juce::Slider velocitySlider;
    juce::Label metronomeHeading;
    juce::Slider metronomeVolumeSlider;
    juce::Label offlineNote;
    std::map<int, juce::String> midiIdentifiers;
};

} // namespace

class SettingsWindow final : public juce::DocumentWindow
{
public:
    SettingsWindow (PianoProLookAndFeel& lookAndFeel, juce::AudioDeviceManager& audioManager,
                    MidiManager& midi, const AppSettings& settings,
                    SettingsCallbacks callbacks)
        : juce::DocumentWindow ("Piano Pro Settings",
                                lookAndFeel.isDarkTheme() ? kCardDark : kCardLight,
                                juce::DocumentWindow::allButtons)
    {
        setUsingNativeTitleBar (true);
        setResizable (true, true);
        setResizeLimits (820, 670, 1280, 900);
        setContentOwned (new SettingsPanel (lookAndFeel, audioManager, midi, settings, std::move (callbacks)), true);
        centreWithSize (820, 670);
        setVisible (true);
    }

    void closeButtonPressed() override
    {
        setVisible (false);
    }
};

MainComponent::MainComponent()
    : userSettings (settingsManager.load()),
      pianoKeyboard (engine)
{
    setSize (1240, 760);
    setWantsKeyboardFocus (true);
    setLookAndFeel (&lookAndFeel);
    lookAndFeel.setDarkTheme (userSettings.darkTheme);

    const auto executableDirectory = juce::File::getSpecialLocation (juce::File::currentExecutableFile).getParentDirectory();
    const auto soundsDirectory = executableDirectory.getChildFile ("assets").getChildFile ("sounds");
    std::string soundFontMessage;
    const auto soundFontsLoaded = engine.loadSoundFonts (
        pathFromJuceFile (soundsDirectory.getChildFile ("GeneralUser-GS.sf2")),
        pathFromJuceFile (soundsDirectory.getChildFile ("UprightPianoKW-small-20190703.sf2")),
        soundFontMessage);

    auto savedAudioXml = juce::XmlDocument::parse (userSettings.audioDeviceStateXml);
    const auto audioInitError = deviceManager.initialise (0, 2, savedAudioXml.get(), true);
    if (audioInitError.isNotEmpty())
    {
        std::lock_guard<std::mutex> guard (audioErrorMutex);
        lastAudioError = audioInitError;
    }
    deviceManager.addAudioCallback (this);
    audioCallbackRegistered = true;

    configureControls();

    MidiManager::Callbacks midiCallbacks;
    midiCallbacks.noteOn = [this] (int note, int velocity) { onMidiNoteOn (note, velocity); };
    midiCallbacks.noteOff = [this] (int note) { onMidiNoteOff (note); };
    midiCallbacks.sustain = [this] (bool enabled) { setSustainState (SustainSource::midiPedal, enabled); };
    midiCallbacks.programChange = [this] (std::uint16_t bank, int program)
    {
        onMidiProgramChange (bank, program);
    };
    midiCallbacks.deviceDisconnected = [safe = juce::Component::SafePointer<MainComponent> (this)]
    {
        juce::MessageManager::callAsync ([safe]
        {
            if (safe != nullptr)
                safe->audioStatusLabel.setTooltip (safe->midiManager.statusText());
        });
    };
    midiManager.setCallbacks (std::move (midiCallbacks));
    midiManager.refreshDevices();
    if (userSettings.midiInputIdentifier.isNotEmpty())
        midiManager.selectDevice (userSettings.midiInputIdentifier);
    populateMidiDropdown();

    if (! soundFontsLoaded)
        audioDeviceLabel.setTooltip (juce::String (soundFontMessage));
    else if (soundFontMessage.find ("unavailable") >= 0)
        audioDeviceLabel.setTooltip (juce::String (soundFontMessage));

    int wantedInstrument = std::clamp (userSettings.instrument, 0, 3);
    if (! engine.instrumentAvailable (instrumentFromIndex (wantedInstrument)))
    {
        wantedInstrument = -1;
        for (int candidate = 0; candidate < 4; ++candidate)
            if (engine.instrumentAvailable (instrumentFromIndex (candidate)))
            {
                wantedInstrument = candidate;
                break;
            }
        if (wantedInstrument < 0)
            wantedInstrument = 0;
        userSettings.instrument = wantedInstrument;
    }

    selectedInstrumentUi = wantedInstrument;
    instrumentBox.setSelectedId (wantedInstrument + 1, juce::dontSendNotification);
    engine.setInstrument (instrumentFromIndex (wantedInstrument));
    engine.setMasterVolume (userSettings.masterVolume);
    engine.setMuted (userSettings.muted);
    engine.setMetronome (userSettings.metronomeEnabled, userSettings.metronomeBpm,
                         userSettings.metronomeVolume);
    uiSustainOn = userSettings.sustainEnabled;
    engine.setSustain (SustainSource::userInterface, uiSustainOn);

    pianoKeyboard.setSelectedOctave (userSettings.octave);
    pianoKeyboard.setDarkTheme (userSettings.darkTheme);
    pianoKeyboard.setUiScale (userSettings.uiScale);
    pianoKeyboard.setNoteCallbacks ([this] (int note, int velocity) { onLocalNoteOn (note, velocity); },
                                    [this] (int note) { onNoteOff (note); });

    updateInstrumentAvailability();
    applyTheme();
    applyUiScale();
    updateAudioStateAndStatus();
    updatePerformanceStatus();
    lastUiNoteEventCounter = engine.noteEventCounter();
    lastMidiRefreshMs = juce::Time::getMillisecondCounter();
    lastDeviceStateSaveMs = lastMidiRefreshMs;
    startTimerHz (30);
    settingsManager.save (userSettings);
    settingsManager.flush();
}

MainComponent::~MainComponent()
{
    stopTimer();
    releaseAllComputerKeys();
    pianoKeyboard.releaseMouseNote();
    midiManager.selectDevice ({});
    if (recordingManager.isRecording())
        recordingManager.stopRecording();

    if (audioCallbackRegistered)
    {
        deviceManager.removeAudioCallback (this);
        deviceManager.closeAudioDevice();
        audioCallbackRegistered = false;
    }

    saveSettingsNow();
    setLookAndFeel (nullptr);
}

void MainComponent::paint (juce::Graphics& graphics)
{
    const bool dark = userSettings.darkTheme;
    const auto window = dark ? kWindowDark : kWindowLight;
    const auto card = dark ? kCardDark : kCardLight;
    const auto cardRaised = dark ? kCardDarkRaised : kCardLightRaised;
    const auto border = dark ? kBorderDark : kBorderLight;
    const auto accent = dark ? kTeal : kTealDark;
    const float scale = userSettings.uiScale;

    graphics.fillAll (window);
    const auto width = static_cast<float> (getWidth());
    const auto margin = 20.0f * scale;
    const auto headerHeight = 58.0f * scale;
    const auto header = juce::Rectangle<float> (margin, margin, width - 2.0f * margin, headerHeight);
    graphics.setColour (card);
    graphics.fillRoundedRectangle (header, 13.0f * scale);
    graphics.setColour (border);
    graphics.drawRoundedRectangle (header.reduced (0.5f), 13.0f * scale, 1.0f);

    const auto noteStripY = header.getBottom() + 12.0f * scale;
    const auto noteStrip = juce::Rectangle<float> (margin, noteStripY, width - 2.0f * margin, 66.0f * scale);
    graphics.setColour (card);
    graphics.fillRoundedRectangle (noteStrip, 12.0f * scale);
    graphics.setColour (border.withAlpha (0.8f));
    graphics.drawRoundedRectangle (noteStrip.reduced (0.5f), 12.0f * scale, 1.0f);
    graphics.setColour (accent.withAlpha (0.88f));
    graphics.fillRoundedRectangle (juce::Rectangle<float> (noteStrip.getX(), noteStrip.getY() + 14.0f * scale,
                                                           3.0f * scale, noteStrip.getHeight() - 28.0f * scale),
                                   1.5f * scale);

    const auto controlsY = static_cast<float> (getHeight()) - margin - 76.0f * scale;
    const auto practiceY = controlsY - 12.0f * scale - 98.0f * scale;
    const auto practiceCard = juce::Rectangle<float> (margin, practiceY, width - 2.0f * margin,
                                                       98.0f * scale);
    graphics.setColour (card);
    graphics.fillRoundedRectangle (practiceCard, 12.0f * scale);
    graphics.setColour (border);
    graphics.drawRoundedRectangle (practiceCard.reduced (0.5f), 12.0f * scale, 1.0f);

    const auto controls = juce::Rectangle<float> (margin, controlsY, width - 2.0f * margin, 76.0f * scale);
    graphics.setColour (card);
    graphics.fillRoundedRectangle (controls, 12.0f * scale);
    graphics.setColour (border);
    graphics.drawRoundedRectangle (controls.reduced (0.5f), 12.0f * scale, 1.0f);

    // Subtle piano-mark built from four vertical bars; this is drawn, not a remote asset.
    const auto logoBox = juce::Rectangle<float> (header.getX() + 12.0f * scale,
                                                  header.getY() + 11.0f * scale,
                                                  36.0f * scale, 36.0f * scale);
    graphics.setColour (dark ? juce::Colour (0xff1b343f) : juce::Colour (0xffe2f6f1));
    graphics.fillRoundedRectangle (logoBox, 8.0f * scale);
    graphics.setColour (accent);
    const float barWidth = 4.0f * scale;
    const float barGap = 3.0f * scale;
    for (int i = 0; i < 4; ++i)
    {
        const auto barX = logoBox.getX() + 8.0f * scale + static_cast<float> (i) * (barWidth + barGap);
        const auto barHeight = (i == 1 || i == 3 ? 18.0f : 24.0f) * scale;
        graphics.fillRoundedRectangle (barX, logoBox.getCentreY() - barHeight * 0.5f,
                                       barWidth, barHeight, 2.0f * scale);
    }
}

void MainComponent::resized()
{
    const auto scale = userSettings.uiScale;
    const int margin = juce::roundToInt (20.0f * scale);
    const int headerHeight = juce::roundToInt (58.0f * scale);
    const int noteStripHeight = juce::roundToInt (66.0f * scale);
    const int gap = juce::roundToInt (12.0f * scale);
    const int width = getWidth();
    const int height = getHeight();
    const int headerY = margin;

    appNameLabel.setBounds (margin + 58, headerY + 7, 128, headerHeight - 14);
    appNameLabel.setFont (makeFont (20.0f * scale, juce::Font::bold));

    const int instrumentX = margin + 175;
    instrumentBox.setBounds (instrumentX, headerY + 11, 138, headerHeight - 22);
    octaveDownButton.setBounds (instrumentX + 147, headerY + 11, 30, headerHeight - 22);
    octaveLabel.setBounds (instrumentX + 180, headerY + 11, 84, headerHeight - 22);
    octaveUpButton.setBounds (instrumentX + 267, headerY + 11, 30, headerHeight - 22);
    midiInputBox.setBounds (instrumentX + 307, headerY + 11, 150, headerHeight - 22);

    const int settingsWidth = 82;
    settingsButton.setBounds (width - margin - settingsWidth, headerY + 11, settingsWidth, headerHeight - 22);
    const int muteWidth = 56;
    muteButton.setBounds (settingsButton.getX() - 8 - muteWidth, headerY + 11, muteWidth, headerHeight - 22);
    volumeValueLabel.setBounds (muteButton.getX() - 43, headerY + 11, 38, headerHeight - 22);
    masterVolumeSlider.setBounds (volumeValueLabel.getX() - 121, headerY + 12, 112, headerHeight - 24);
    volumeValueLabel.setJustificationType (juce::Justification::centredRight);
    audioStatusLabel.setBounds (midiInputBox.getRight() + 10, headerY + 12, 18, headerHeight - 24);

    const int noteY = margin + headerHeight + gap;
    currentNoteHeading.setBounds (margin + 18, noteY + 8, 116, 16);
    currentNoteLabel.setBounds (margin + 18, noteY + 25, 145, 34);
    audioDeviceLabel.setBounds (margin + 182, noteY + 17, width / 2 - margin - 190, 32);
    recordingStatusLabel.setBounds (width / 2 + 12, noteY + 17, width / 2 - margin - 30, 32);

    const int controlsHeight = juce::roundToInt (76.0f * scale);
    const int practiceHeight = juce::roundToInt (98.0f * scale);
    const int controlsY = height - margin - controlsHeight;
    const int practiceY = controlsY - gap - practiceHeight;
    const int keyboardY = noteY + noteStripHeight + gap;
    const int keyboardHeight = juce::jmax (180, practiceY - gap - keyboardY);
    pianoKeyboard.setBounds (margin, keyboardY, width - margin * 2, keyboardHeight);

    int x = margin + 14;
    const int y = controlsY + juce::roundToInt (15.0f * scale);
    const int h = juce::roundToInt (46.0f * scale);
    const int buttonGap = juce::roundToInt (9.0f * scale);
    auto place = [&] (juce::Component& component, int buttonWidth)
    {
        component.setBounds (x, y, buttonWidth, h);
        x += buttonWidth + buttonGap;
    };

    place (recordButton, 94);
    place (stopButton, 72);
    place (playButton, 72);
    place (saveMidiButton, 94);
    place (openMidiButton, 92);
    place (sustainButton, 82);
    place (metronomeButton, 98);
    bpmLabel.setBounds (x, y, 46, h);
    x += 46 + buttonGap / 2;
    bpmSlider.setBounds (x, y + 5, juce::jmax (50, width - margin - x - 14), h - 10);

    const int practiceX = margin + 16;
    const int practiceRowY = practiceY;
    practiceHeading.setBounds (practiceX, practiceRowY + 9, 145, 18);
    practiceEditor.setBounds (practiceX, practiceRowY + 34, juce::jmax (180, width / 2 - margin - 140), 42);
    practiceButton.setBounds (practiceEditor.getRight() + 10, practiceRowY + 34, 128, 42);
    clearPracticeButton.setBounds (practiceButton.getRight() + 8, practiceRowY + 34, 76, 42);
    nextNoteLabel.setBounds (clearPracticeButton.getRight() + 14, practiceRowY + 34,
                             width - margin - clearPracticeButton.getRight() - 30, 42);

    const auto labelFont = makeFont (11.0f * scale, juce::Font::bold);
    currentNoteHeading.setFont (labelFont);
    currentNoteLabel.setFont (makeFont (27.0f * scale, juce::Font::bold));
    audioDeviceLabel.setFont (makeFont (11.0f * scale));
    recordingStatusLabel.setFont (makeFont (12.0f * scale, juce::Font::bold));
    practiceHeading.setFont (makeFont (11.0f * scale, juce::Font::bold));
    nextNoteLabel.setFont (makeFont (13.0f * scale, juce::Font::bold));
}

void MainComponent::configureControls()
{
    addAndMakeVisible (appNameLabel);
    addAndMakeVisible (instrumentBox);
    addAndMakeVisible (octaveDownButton);
    addAndMakeVisible (octaveUpButton);
    addAndMakeVisible (octaveLabel);
    addAndMakeVisible (midiInputBox);
    addAndMakeVisible (audioStatusLabel);
    addAndMakeVisible (masterVolumeSlider);
    addAndMakeVisible (volumeValueLabel);
    addAndMakeVisible (muteButton);
    addAndMakeVisible (settingsButton);
    addAndMakeVisible (currentNoteHeading);
    addAndMakeVisible (currentNoteLabel);
    addAndMakeVisible (audioDeviceLabel);
    addAndMakeVisible (recordingStatusLabel);
    addAndMakeVisible (pianoKeyboard);
    addAndMakeVisible (recordButton);
    addAndMakeVisible (stopButton);
    addAndMakeVisible (playButton);
    addAndMakeVisible (saveMidiButton);
    addAndMakeVisible (openMidiButton);
    addAndMakeVisible (sustainButton);
    addAndMakeVisible (metronomeButton);
    addAndMakeVisible (bpmLabel);
    addAndMakeVisible (bpmSlider);
    addAndMakeVisible (practiceHeading);
    addAndMakeVisible (practiceEditor);
    addAndMakeVisible (practiceButton);
    addAndMakeVisible (clearPracticeButton);
    addAndMakeVisible (nextNoteLabel);

    appNameLabel.setText ("Piano Pro", juce::dontSendNotification);
    appNameLabel.setColour (juce::Label::textColourId, userSettings.darkTheme ? kTextDark : kTextLight);
    appNameLabel.setFont (makeFont (20.0f, juce::Font::bold));
    currentNoteHeading.setText ("CURRENT NOTE", juce::dontSendNotification);
    currentNoteLabel.setText ("—", juce::dontSendNotification);
    audioDeviceLabel.setText ("", juce::dontSendNotification);
    recordingStatusLabel.setText ("READY  ·  00:00", juce::dontSendNotification);
    practiceHeading.setText ("PRACTICE SEQUENCE", juce::dontSendNotification);
    nextNoteLabel.setText ("Enter notes, for example: C4 E4 G4 C5", juce::dontSendNotification);

    instrumentBox.addItem ("Grand Piano", 1);
    instrumentBox.addItem ("Electric Piano", 2);
    instrumentBox.addItem ("Organ", 3);
    instrumentBox.addItem ("Soft Piano", 4);
    instrumentBox.setSelectedId (userSettings.instrument + 1, juce::dontSendNotification);
    instrumentBox.setTooltip ("Choose one of the locally installed sampled instruments.");
    instrumentBox.onChange = [this]
    {
        if (! suppressControlCallbacks)
            chooseInstrument (instrumentFromIndex (instrumentBox.getSelectedId() - 1));
    };

    octaveDownButton.setTooltip ("Octave down (Z)");
    octaveUpButton.setTooltip ("Octave up (X)");
    octaveDownButton.onClick = [this] { changeOctave (-1); };
    octaveUpButton.onClick = [this] { changeOctave (1); };
    octaveLabel.setJustificationType (juce::Justification::centred);
    octaveLabel.setTooltip ("Z lowers the octave; X raises it.");
    octaveLabel.setText ("OCTAVE " + juce::String (userSettings.octave), juce::dontSendNotification);

    midiInputBox.setTextWhenNothingSelected ("No MIDI Device");
    midiInputBox.setTooltip ("Select an external MIDI keyboard. No device is required for normal use.");
    midiInputBox.onChange = [this]
    {
        if (suppressControlCallbacks)
            return;
        const auto selectedItem = midiInputBox.getSelectedId();
        if (selectedItem <= 0 || static_cast<std::size_t> (selectedItem - 1) >= midiComboIdentifiers.size())
            return;
        const auto identifier = midiComboIdentifiers[static_cast<std::size_t> (selectedItem - 1)];
        midiManager.selectDevice (identifier);
        userSettings.midiInputIdentifier = midiManager.selectedIdentifier();
        scheduleSettingsSave();
        updateAudioStateAndStatus();
    };

    masterVolumeSlider.setSliderStyle (juce::Slider::LinearHorizontal);
    masterVolumeSlider.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
    masterVolumeSlider.setRange (0.0, 100.0, 1.0);
    masterVolumeSlider.setValue (userSettings.masterVolume * 100.0f, juce::dontSendNotification);
    masterVolumeSlider.setTooltip ("Master output level");
    masterVolumeSlider.onValueChange = [this]
    {
        userSettings.masterVolume = static_cast<float> (masterVolumeSlider.getValue() / 100.0);
        engine.setMasterVolume (userSettings.masterVolume);
        volumeValueLabel.setText (juce::String (static_cast<int> (std::lround (masterVolumeSlider.getValue()))) + "%",
                                  juce::dontSendNotification);
        scheduleSettingsSave();
    };
    volumeValueLabel.setText (juce::String (static_cast<int> (std::lround (userSettings.masterVolume * 100.0f))) + "%",
                              juce::dontSendNotification);

    muteButton.setClickingTogglesState (true);
    muteButton.setToggleState (userSettings.muted, juce::dontSendNotification);
    muteButton.onClick = [this]
    {
        userSettings.muted = muteButton.getToggleState();
        engine.setMuted (userSettings.muted);
        scheduleSettingsSave();
        applyTheme();
    };
    settingsButton.onClick = [this] { openSettings(); };

    recordButton.setTooltip ("Start a local MIDI recording");
    recordButton.onClick = [this] { startRecording(); };
    stopButton.setTooltip ("Stop recording or playback and release held notes");
    stopButton.onClick = [this] { stopAll(); };
    playButton.setTooltip ("Play the current recording or imported MIDI file");
    playButton.onClick = [this] { startOrStopPlayback(); };
    saveMidiButton.setTooltip ("Export a valid Standard MIDI File (.mid)");
    saveMidiButton.onClick = [this] { saveMidiFile(); };
    openMidiButton.setTooltip ("Open a Standard MIDI File (.mid or .midi)");
    openMidiButton.onClick = [this] { openMidiFile(); };

    sustainButton.setClickingTogglesState (true);
    sustainButton.setToggleState (userSettings.sustainEnabled, juce::dontSendNotification);
    sustainButton.setTooltip ("Sustain pedal (Space)");
    sustainButton.onClick = [this]
    {
        setSustainState (SustainSource::userInterface, sustainButton.getToggleState());
    };

    metronomeButton.setClickingTogglesState (true);
    metronomeButton.setToggleState (userSettings.metronomeEnabled, juce::dontSendNotification);
    metronomeButton.setTooltip ("Toggle the audible metronome");
    metronomeButton.onClick = [this]
    {
        userSettings.metronomeEnabled = metronomeButton.getToggleState();
        setMetronomeState();
        scheduleSettingsSave();
        applyTheme();
    };
    bpmLabel.setText ("100 BPM", juce::dontSendNotification);
    bpmLabel.setJustificationType (juce::Justification::centredRight);
    bpmSlider.setSliderStyle (juce::Slider::LinearHorizontal);
    bpmSlider.setTextBoxStyle (juce::Slider::NoTextBox, false, 0, 0);
    bpmSlider.setRange (40, 240, 1);
    bpmSlider.setValue (userSettings.metronomeBpm, juce::dontSendNotification);
    bpmSlider.setTooltip ("Metronome tempo: 40–240 BPM");
    bpmSlider.onValueChange = [this]
    {
        userSettings.metronomeBpm = static_cast<int> (std::lround (bpmSlider.getValue()));
        bpmLabel.setText (juce::String (userSettings.metronomeBpm) + " BPM", juce::dontSendNotification);
        setMetronomeState();
        scheduleSettingsSave();
    };

    practiceEditor.setMultiLine (false);
    practiceEditor.setReturnKeyStartsNewLine (false);
    practiceEditor.setTextToShowWhenEmpty ("C4 E4 G4 C5", userSettings.darkTheme ? kMutedDark : kMutedLight);
    practiceEditor.setTooltip ("Enter note names such as C4 E4 G4 C5. Sharps (C#4) and flats (Bb3) are accepted.");
    practiceButton.onClick = [this] { startPractice(); };
    clearPracticeButton.onClick = [this] { clearPractice(); };

    configureKeyListeners();
    applyTheme();
    resized();
}

void MainComponent::configureKeyListeners()
{
    addKeyListener (this);
    const std::array<juce::Component*, 19> components {
        &instrumentBox, &octaveDownButton, &octaveUpButton, &midiInputBox, &masterVolumeSlider,
        &muteButton, &settingsButton, &recordButton, &stopButton, &playButton, &saveMidiButton,
        &openMidiButton, &sustainButton, &metronomeButton, &bpmSlider, &practiceEditor,
        &practiceButton, &clearPracticeButton, &pianoKeyboard
    };
    for (auto* component : components)
        component->addKeyListener (this);
}

void MainComponent::updateInstrumentAvailability()
{
    instrumentBox.setItemEnabled (1, engine.instrumentAvailable (Instrument::grandPiano));
    instrumentBox.setItemEnabled (2, engine.instrumentAvailable (Instrument::electricPiano));
    instrumentBox.setItemEnabled (3, engine.instrumentAvailable (Instrument::organ));
    instrumentBox.setItemEnabled (4, engine.instrumentAvailable (Instrument::softPiano));
}

void MainComponent::populateMidiDropdown()
{
    const auto selected = midiManager.selectedIdentifier();
    const auto devices = midiManager.availableDevices();
    suppressControlCallbacks = true;
    midiInputBox.clear (juce::dontSendNotification);
    midiComboIdentifiers.clear();
    midiInputBox.addItem ("No MIDI Device", 1);
    midiComboIdentifiers.push_back ({});
    int id = 2;
    bool selectedPresent = selected.isEmpty();
    for (const auto& device : devices)
    {
        midiInputBox.addItem (device.name, id);
        midiComboIdentifiers.push_back (device.identifier);
        if (device.identifier == selected)
        {
            midiInputBox.setSelectedId (id, juce::dontSendNotification);
            selectedPresent = true;
        }
        ++id;
    }
    if (selected.isNotEmpty() && ! selectedPresent)
    {
        midiInputBox.addItem ("Disconnected: " + midiManager.selectedDeviceName(), id);
        midiComboIdentifiers.push_back (selected);
        midiInputBox.setSelectedId (id, juce::dontSendNotification);
    }
    else if (selected.isEmpty())
    {
        midiInputBox.setSelectedId (1, juce::dontSendNotification);
    }
    suppressControlCallbacks = false;
}

void MainComponent::applyTheme()
{
    lookAndFeel.setDarkTheme (userSettings.darkTheme);
    pianoKeyboard.setDarkTheme (userSettings.darkTheme);
    const auto text = userSettings.darkTheme ? kTextDark : kTextLight;
    const auto muted = userSettings.darkTheme ? kMutedDark : kMutedLight;
    const auto card = userSettings.darkTheme ? kCardDarkRaised : kCardLightRaised;

    appNameLabel.setColour (juce::Label::textColourId, text);
    setLabelAppearance (currentNoteHeading, 10.0f * userSettings.uiScale, muted, true);
    setLabelAppearance (currentNoteLabel, 27.0f * userSettings.uiScale, text, true);
    setLabelAppearance (audioDeviceLabel, 11.0f * userSettings.uiScale, muted);
    setLabelAppearance (recordingStatusLabel, 12.0f * userSettings.uiScale, muted, true);
    setLabelAppearance (octaveLabel, 10.0f * userSettings.uiScale, text, true, juce::Justification::centred);
    setLabelAppearance (volumeValueLabel, 10.0f * userSettings.uiScale, muted, true, juce::Justification::centredRight);
    setLabelAppearance (audioStatusLabel, 10.0f * userSettings.uiScale, muted, true, juce::Justification::centred);
    setLabelAppearance (practiceHeading, 10.0f * userSettings.uiScale, muted, true);
    setLabelAppearance (nextNoteLabel, 12.0f * userSettings.uiScale, text, true);
    setLabelAppearance (bpmLabel, 10.0f * userSettings.uiScale, muted, true, juce::Justification::centredRight);

    const auto neutralFill = userSettings.darkTheme ? card : card;
    const auto outline = userSettings.darkTheme ? kBorderDark : kBorderLight;
    setButtonAppearance (octaveDownButton, neutralFill, text, outline);
    setButtonAppearance (octaveUpButton, neutralFill, text, outline);
    setButtonAppearance (settingsButton, neutralFill, text, outline);
    setButtonAppearance (muteButton, userSettings.muted ? kTealDark : neutralFill,
                         userSettings.muted ? juce::Colours::white : text, outline);
    setButtonAppearance (recordButton, kRecordRed, juce::Colours::white, kRecordRed);
    setButtonAppearance (stopButton, neutralFill, text, outline);
    setButtonAppearance (playButton, userSettings.darkTheme ? juce::Colour (0xff1d706d) : juce::Colour (0xffd2f1e9),
                         userSettings.darkTheme ? juce::Colours::white : kTealDark, outline);
    setButtonAppearance (saveMidiButton, neutralFill, text, outline);
    setButtonAppearance (openMidiButton, neutralFill, text, outline);
    setButtonAppearance (sustainButton, sustainButton.getToggleState() ? kTealDark : neutralFill,
                         sustainButton.getToggleState() ? juce::Colours::white : text, outline);
    setButtonAppearance (metronomeButton, metronomeButton.getToggleState() ? kTealDark : neutralFill,
                         metronomeButton.getToggleState() ? juce::Colours::white : text, outline);
    setButtonAppearance (practiceButton, userSettings.darkTheme ? juce::Colour (0xff1d706d) : juce::Colour (0xffd2f1e9),
                         userSettings.darkTheme ? juce::Colours::white : kTealDark, outline);
    setButtonAppearance (clearPracticeButton, neutralFill, text, outline);

    for (auto* combo : { &instrumentBox, &midiInputBox })
    {
        combo->setColour (juce::ComboBox::backgroundColourId, userSettings.darkTheme ? kCardDarkRaised : kCardLightRaised);
        combo->setColour (juce::ComboBox::textColourId, text);
        combo->setColour (juce::ComboBox::outlineColourId, outline);
        combo->setColour (juce::ComboBox::arrowColourId, muted);
    }
    practiceEditor.setColour (juce::TextEditor::backgroundColourId, userSettings.darkTheme ? kCardDarkRaised : kCardLightRaised);
    practiceEditor.setColour (juce::TextEditor::textColourId, text);
    practiceEditor.setColour (juce::TextEditor::outlineColourId, outline);
    practiceEditor.setColour (juce::TextEditor::focusedOutlineColourId, userSettings.darkTheme ? kTeal : kTealDark);
    practiceEditor.setFont (makeFont (13.0f * userSettings.uiScale));

    setColour (juce::ResizableWindow::backgroundColourId, userSettings.darkTheme ? kWindowDark : kWindowLight);
    repaint();
}

void MainComponent::applyUiScale()
{
    userSettings.uiScale = std::clamp (userSettings.uiScale, 0.80f, 1.20f);
    pianoKeyboard.setUiScale (userSettings.uiScale);
    resized();
    repaint();
}

void MainComponent::audioDeviceIOCallbackWithContext (const float* const*, int,
                                                       float* const* outputChannelData,
                                                       int numOutputChannels, int numSamples,
                                                       const juce::AudioIODeviceCallbackContext&)
{
    engine.render (outputChannelData, numOutputChannels, numSamples);
}

void MainComponent::audioDeviceAboutToStart (juce::AudioIODevice* device)
{
    if (device != nullptr)
        engine.prepareToPlay (device->getCurrentSampleRate(), device->getCurrentBufferSizeSamples());
    else
        engine.prepareToPlay (44100.0, 512);

    std::lock_guard<std::mutex> guard (audioErrorMutex);
    lastAudioError.clear();
}

void MainComponent::audioDeviceStopped()
{
    engine.releaseResources();
}

void MainComponent::audioDeviceError (const juce::String& errorMessage)
{
    {
        std::lock_guard<std::mutex> guard (audioErrorMutex);
        lastAudioError = errorMessage;
    }

    const auto safe = juce::Component::SafePointer<MainComponent> (this);
    juce::MessageManager::callAsync ([safe]
    {
        if (safe != nullptr)
            safe->updateAudioStateAndStatus();
    });
}

bool MainComponent::keyPressed (const juce::KeyPress& key)
{
    return handleComputerKeyPress (key);
}

bool MainComponent::keyStateChanged (bool)
{
    releaseAnyLostComputerKeys();
    return false;
}

bool MainComponent::keyPressed (const juce::KeyPress& key, juce::Component*)
{
    return handleComputerKeyPress (key);
}

bool MainComponent::keyStateChanged (bool, juce::Component*)
{
    releaseAnyLostComputerKeys();
    return false;
}

void MainComponent::timerCallback()
{
    releaseAnyLostComputerKeys();
    pianoKeyboard.repaint();

    const auto now = juce::Time::getMillisecondCounter();
    if (now - lastMidiRefreshMs >= 1500U)
    {
        lastMidiRefreshMs = now;
        if (midiManager.refreshDevices())
        {
            populateMidiDropdown();
            userSettings.midiInputIdentifier = midiManager.selectedIdentifier();
            scheduleSettingsSave();
        }
    }

    if (now - lastDeviceStateSaveMs >= 2000U)
    {
        lastDeviceStateSaveMs = now;
        auto state = deviceManager.createStateXml();
        if (state != nullptr)
        {
            const auto xml = state->toString();
            if (xml != userSettings.audioDeviceStateXml)
            {
                userSettings.audioDeviceStateXml = xml;
                scheduleSettingsSave();
            }
        }
    }

    const auto eventCount = engine.noteEventCounter();
    if (eventCount != lastUiNoteEventCounter)
    {
        lastUiNoteEventCounter = eventCount;
        const auto note = engine.mostRecentlyPlayedNote();
        if (note >= 0)
            currentNoteLabel.setText (PianoKeyboard::noteName (note), juce::dontSendNotification);
    }

    const auto activeInstrument = static_cast<int> (engine.activeInstrument());
    if (activeInstrument >= 0 && activeInstrument <= 3 && activeInstrument != selectedInstrumentUi)
    {
        selectedInstrumentUi = activeInstrument;
        userSettings.instrument = activeInstrument;
        suppressControlCallbacks = true;
        instrumentBox.setSelectedId (activeInstrument + 1, juce::dontSendNotification);
        suppressControlCallbacks = false;
        scheduleSettingsSave();
    }

    updateAudioStateAndStatus();
    updatePerformanceStatus();
    if (settingsSavePending && static_cast<std::int32_t> (now - settingsSaveDueMs) >= 0)
    {
        settingsManager.save (userSettings);
        settingsManager.flush();
        settingsSavePending = false;
    }
}

void MainComponent::updateAudioStateAndStatus()
{
    auto* device = deviceManager.getCurrentAudioDevice();
    const bool ready = device != nullptr;
    const auto currentRate = ready ? device->getCurrentSampleRate() : engine.currentSampleRate();
    const auto bufferSize = ready ? device->getCurrentBufferSizeSamples() : 0;

    juce::String error;
    {
        std::lock_guard<std::mutex> guard (audioErrorMutex);
        error = lastAudioError;
    }

    if (ready)
    {
        const auto rateKHz = currentRate / 1000.0;
        audioDeviceLabel.setText (device->getName() + "   ·   "
                                  + juce::String (rateKHz, 1) + " kHz   ·   "
                                  + juce::String (bufferSize) + " samples",
                                  juce::dontSendNotification);
        audioStatusLabel.setText ("●", juce::dontSendNotification);
        audioStatusLabel.setColour (juce::Label::textColourId, kTeal);
        audioStatusLabel.setTooltip ("Audio ready · " + device->getName());
    }
    else
    {
        audioDeviceLabel.setText (error.isNotEmpty()
                                    ? "Audio device unavailable · open Settings to select an output"
                                    : "Audio output not available · open Settings to select a device",
                                  juce::dontSendNotification);
        audioStatusLabel.setText ("●", juce::dontSendNotification);
        audioStatusLabel.setColour (juce::Label::textColourId, kRecordRed);
        audioStatusLabel.setTooltip (error.isNotEmpty() ? error : "Audio device unavailable");
    }

    const bool generalBankAvailable = engine.instrumentAvailable (Instrument::grandPiano);
    const bool softBankAvailable = engine.instrumentAvailable (Instrument::softPiano);
    if (! generalBankAvailable && ! softBankAvailable)
    {
        audioDeviceLabel.setText ("Piano samples are missing · restore assets/sounds to enable audio",
                                  juce::dontSendNotification);
        audioDeviceLabel.setTooltip (juce::String (engine.soundFontStatus()));
    }
    else if (! generalBankAvailable || ! softBankAvailable)
    {
        audioDeviceLabel.setText ("Some local instruments unavailable · check assets/sounds",
                                  juce::dontSendNotification);
        audioDeviceLabel.setTooltip (juce::String (engine.soundFontStatus()));
    }

    midiInputBox.setTooltip (midiManager.statusText());
}

void MainComponent::updatePerformanceStatus()
{
    const bool isRecording = recordingManager.isRecording();
    const bool isPlaying = engine.isPlaybackRunning();

    if (isRecording)
    {
        recordingStatusLabel.setText ("RECORDING  ·  " + formatClock (recordingManager.elapsedSeconds()),
                                      juce::dontSendNotification);
        recordingStatusLabel.setColour (juce::Label::textColourId, kRecordRed);
    }
    else if (isPlaying)
    {
        recordingStatusLabel.setText ("PLAYING  ·  " + formatClock (recordingManager.performanceDurationSeconds()),
                                      juce::dontSendNotification);
        recordingStatusLabel.setColour (juce::Label::textColourId, kTeal);
    }
    else
    {
        const auto duration = recordingManager.performanceDurationSeconds();
        const auto count = recordingManager.eventCount();
        recordingStatusLabel.setText (count == 0 ? "READY  ·  00:00"
                                                  : "READY  ·  " + formatClock (duration) + "  ·  "
                                                        + juce::String (static_cast<int> (count)) + " MIDI events",
                                      juce::dontSendNotification);
        recordingStatusLabel.setColour (juce::Label::textColourId,
                                        userSettings.darkTheme ? kMutedDark : kMutedLight);
    }

    recordButton.setEnabled (! isRecording && ! isPlaying);
    playButton.setEnabled (! isRecording && recordingManager.eventCount() > 0);
    playButton.setButtonText (isPlaying ? "■  Stop Play" : "▶  Play");
    stopButton.setEnabled (true);
}

void MainComponent::chooseInstrument (Instrument instrument)
{
    const auto index = static_cast<int> (instrument);
    if (index < 0 || index > 3 || ! engine.instrumentAvailable (instrument))
    {
        instrumentBox.setSelectedId (selectedInstrumentUi + 1, juce::dontSendNotification);
        showMessage ("Instrument unavailable", "This instrument's local SoundFont is missing or could not be loaded.", true);
        return;
    }

    selectedInstrumentUi = index;
    userSettings.instrument = index;
    engine.setInstrument (instrument);
    if (recordingManager.isRecording())
        recordingManager.recordProgramChange (PianoEngine::bankForInstrument (instrument),
                                              PianoEngine::programForInstrument (instrument));
    scheduleSettingsSave();
}

void MainComponent::changeOctave (int delta)
{
    userSettings.octave = std::clamp (userSettings.octave + delta, 1, 7);
    octaveLabel.setText ("OCTAVE " + juce::String (userSettings.octave), juce::dontSendNotification);
    pianoKeyboard.setSelectedOctave (userSettings.octave);
    scheduleSettingsSave();
    repaint();
}

void MainComponent::setSustainState (SustainSource source, bool enabled)
{
    bool effectiveBefore = false;
    bool effectiveAfter = false;
    {
        std::lock_guard<std::mutex> guard (sustainMutex);
        effectiveBefore = uiSustainOn || midiSustainOn;
        if (source == SustainSource::userInterface)
            uiSustainOn = enabled;
        else if (source == SustainSource::midiPedal)
            midiSustainOn = enabled;
        effectiveAfter = uiSustainOn || midiSustainOn;
    }

    engine.setSustain (source, enabled);
    if (effectiveBefore != effectiveAfter)
        recordingManager.recordSustain (effectiveAfter);

    if (source == SustainSource::userInterface)
    {
        userSettings.sustainEnabled = enabled;
        sustainButton.setToggleState (enabled, juce::dontSendNotification);
        scheduleSettingsSave();
    }

    const auto safe = juce::Component::SafePointer<MainComponent> (this);
    juce::MessageManager::callAsync ([safe]
    {
        if (safe != nullptr)
        {
            bool midiPedal = false;
            {
                std::lock_guard<std::mutex> guard (safe->sustainMutex);
                midiPedal = safe->midiSustainOn;
            }
            safe->sustainButton.setButtonText (midiPedal ? "Sustain · MIDI" : "Sustain");
            safe->applyTheme();
        }
    });
}

bool MainComponent::effectiveSustainState() const
{
    std::lock_guard<std::mutex> guard (sustainMutex);
    return uiSustainOn || midiSustainOn;
}

void MainComponent::setMetronomeState()
{
    engine.setMetronome (userSettings.metronomeEnabled, userSettings.metronomeBpm,
                         userSettings.metronomeVolume);
}

void MainComponent::startRecording()
{
    if (recordingManager.isRecording() || engine.isPlaybackRunning())
        return;

    releaseAllComputerKeys();
    pianoKeyboard.releaseMouseNote();
    midiManager.releaseAllNotes();
    engine.allNotesOff (false);

    const auto instrument = instrumentFromIndex (selectedInstrumentUi);
    if (! recordingManager.beginRecording (PianoEngine::bankForInstrument (instrument),
                                          PianoEngine::programForInstrument (instrument)))
        return;
    recordingManager.recordSustain (effectiveSustainState());
    updatePerformanceStatus();
}

void MainComponent::stopAll()
{
    releaseAllComputerKeys();
    pianoKeyboard.releaseMouseNote();
    midiManager.releaseAllNotes();
    if (recordingManager.isRecording())
        recordingManager.stopRecording();
    engine.stopPlayback();
    engine.allNotesOff (false);
    updatePerformanceStatus();
}

void MainComponent::startOrStopPlayback()
{
    if (engine.isPlaybackRunning())
    {
        engine.stopPlayback();
        return;
    }

    if (recordingManager.isRecording())
        return;

    const auto sequence = recordingManager.playbackEvents();
    if (sequence == nullptr || sequence->empty())
    {
        showMessage ("Nothing to play", "Record a performance or open a MIDI file first.");
        return;
    }

    releaseAllComputerKeys();
    pianoKeyboard.releaseMouseNote();
    if (! engine.startPlayback (sequence))
        showMessage ("Playback unavailable", "The audio command queue is busy. Press Stop and try again.", true);
}

void MainComponent::saveMidiFile()
{
    if (recordingManager.eventCount() == 0)
    {
        showMessage ("Nothing to save", "Record a performance or open a MIDI file first.");
        return;
    }

    fileChooser = std::make_unique<juce::FileChooser> (
        "Save Piano Pro performance as MIDI",
        juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile ("My_Piano_Song.mid"),
        "*.mid");
    const auto safe = juce::Component::SafePointer<MainComponent> (this);
    fileChooser->launchAsync (juce::FileBrowserComponent::saveMode
                              | juce::FileBrowserComponent::canSelectFiles
                              | juce::FileBrowserComponent::warnAboutOverwriting,
                              [safe] (const juce::FileChooser& chooser)
    {
        if (safe == nullptr)
            return;
        auto file = chooser.getResult();
        if (file == juce::File())
            return;
        if (file.getFileExtension().isEmpty())
            file = file.withFileExtension (".mid");
        std::string error;
        if (! safe->recordingManager.saveToFile (pathFromJuceFile (file), error))
            safe->showMessage ("MIDI export failed", juce::String (error), true);
        else
            safe->showMessage ("MIDI saved", "Saved a standard MIDI file to:\n" + file.getFullPathName());
        safe->updatePerformanceStatus();
    });
}

void MainComponent::openMidiFile()
{
    fileChooser = std::make_unique<juce::FileChooser> (
        "Open MIDI performance", juce::File::getSpecialLocation (juce::File::userDocumentsDirectory),
        "*.mid;*.midi");
    const auto safe = juce::Component::SafePointer<MainComponent> (this);
    fileChooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                              [safe] (const juce::FileChooser& chooser)
    {
        if (safe != nullptr)
        {
            const auto result = chooser.getResult();
            if (result.existsAsFile())
                safe->loadMidiFile (result);
        }
    });
}

void MainComponent::loadMidiFile (const juce::File& file)
{
    if (recordingManager.isRecording())
        stopAll();
    engine.stopPlayback();
    engine.allNotesOff (true);

    std::string error;
    if (! recordingManager.loadFromFile (pathFromJuceFile (file), error))
    {
        showMessage ("Could not open MIDI file", juce::String (error), true);
        return;
    }

    clearPractice();
    showMessage ("MIDI loaded", file.getFileName() + " is ready to play.");
    updatePerformanceStatus();
}

void MainComponent::showMessage (const juce::String& title, const juce::String& message, bool isError)
{
    juce::AlertWindow::showMessageBoxAsync (isError ? juce::AlertWindow::WarningIcon : juce::AlertWindow::InfoIcon,
                                            title, message, "OK");
}

void MainComponent::onLocalNoteOn (int note, int velocity)
{
    if (note < 21 || note > 108)
        return;
    engine.noteOn (note, velocity);
    recordingManager.recordNoteOn (note, velocity);
    currentNoteLabel.setText (PianoKeyboard::noteName (note), juce::dontSendNotification);
    advancePractice (note);
}

void MainComponent::onNoteOff (int note)
{
    engine.noteOff (note);
    recordingManager.recordNoteOff (note);
}

void MainComponent::onMidiNoteOn (int note, int velocity)
{
    engine.noteOn (note, velocity);
    recordingManager.recordNoteOn (note, velocity);
    const auto safe = juce::Component::SafePointer<MainComponent> (this);
    juce::MessageManager::callAsync ([safe, note]
    {
        if (safe != nullptr)
            safe->onNoteStartedOnMessageThread (note);
    });
}

void MainComponent::onMidiNoteOff (int note)
{
    engine.noteOff (note);
    recordingManager.recordNoteOff (note);
}

void MainComponent::onMidiProgramChange (std::uint16_t bank, int program)
{
    engine.setProgram (bank, program);
    if (recordingManager.isRecording())
        recordingManager.recordProgramChange (bank, program);

    const auto instrumentIndex = instrumentIndexFromMidiProgram (bank, program);
    const auto safe = juce::Component::SafePointer<MainComponent> (this);
    juce::MessageManager::callAsync ([safe, instrumentIndex]
    {
        if (safe == nullptr)
            return;
        safe->selectedInstrumentUi = instrumentIndex;
        safe->userSettings.instrument = instrumentIndex;
        safe->suppressControlCallbacks = true;
        safe->instrumentBox.setSelectedId (instrumentIndex + 1, juce::dontSendNotification);
        safe->suppressControlCallbacks = false;
        safe->scheduleSettingsSave();
    });
}

void MainComponent::onNoteStartedOnMessageThread (int note)
{
    if (note < 21 || note > 108)
        return;
    currentNoteLabel.setText (PianoKeyboard::noteName (note), juce::dontSendNotification);
    advancePractice (note);
}

void MainComponent::releaseComputerKey (int keyCode)
{
    const auto found = heldComputerNotes.find (keyCode);
    if (found == heldComputerNotes.end())
        return;
    onNoteOff (found->second);
    heldComputerNotes.erase (found);
}

void MainComponent::releaseAnyLostComputerKeys()
{
    std::vector<int> released;
    released.reserve (heldComputerNotes.size());
    for (const auto& item : heldComputerNotes)
        if (! juce::KeyPress::isKeyCurrentlyDown (item.first))
            released.push_back (item.first);
    for (const auto keyCode : released)
        releaseComputerKey (keyCode);

    if (spaceShortcutDown && ! juce::KeyPress::isKeyCurrentlyDown (juce::KeyPress::spaceKey))
        spaceShortcutDown = false;
    if (zShortcutDown && ! juce::KeyPress::isKeyCurrentlyDown (zShortcutKeyCode))
        zShortcutDown = false;
    if (xShortcutDown && ! juce::KeyPress::isKeyCurrentlyDown (xShortcutKeyCode))
        xShortcutDown = false;
}

void MainComponent::releaseAllComputerKeys()
{
    std::vector<int> keyCodes;
    keyCodes.reserve (heldComputerNotes.size());
    for (const auto& item : heldComputerNotes)
        keyCodes.push_back (item.first);
    for (const auto keyCode : keyCodes)
        releaseComputerKey (keyCode);
}

bool MainComponent::handleComputerKeyPress (const juce::KeyPress& key)
{
    if (practiceEditor.hasKeyboardFocus (true))
        return false;

    const auto keyCode = key.getKeyCode();
    if (keyCode == juce::KeyPress::spaceKey)
    {
        if (! spaceShortcutDown)
        {
            spaceShortcutDown = true;
            sustainButton.setToggleState (! sustainButton.getToggleState(), juce::dontSendNotification);
            setSustainState (SustainSource::userInterface, sustainButton.getToggleState());
        }
        return true;
    }

    auto character = static_cast<juce::juce_wchar> (keyCode);
    character = juce::CharacterFunctions::toUpperCase (character);
    if (character == 'Z')
    {
        if (! zShortcutDown)
        {
            zShortcutDown = true;
            zShortcutKeyCode = keyCode;
            changeOctave (-1);
        }
        return true;
    }
    if (character == 'X')
    {
        if (! xShortcutDown)
        {
            xShortcutDown = true;
            xShortcutKeyCode = keyCode;
            changeOctave (1);
        }
        return true;
    }

    constexpr std::array<char, 13> keys { 'A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K' };
    for (std::size_t offset = 0; offset < keys.size(); ++offset)
    {
        if (character != static_cast<juce::juce_wchar> (keys[offset]))
            continue;

        if (heldComputerNotes.find (keyCode) == heldComputerNotes.end())
        {
            const auto note = (userSettings.octave + 1) * 12 + static_cast<int> (offset);
            if (note >= 21 && note <= 108)
            {
                heldComputerNotes[keyCode] = note;
                onLocalNoteOn (note, userSettings.computerKeyVelocity);
            }
        }
        return true;
    }

    return false;
}

std::optional<std::vector<int>> MainComponent::parsePracticeSequence (juce::String text) const
{
    text = text.replace ("->", " ").replace ("→", " ").replaceCharacter (',', ' ')
             .replaceCharacter (';', ' ').replaceCharacter ('\n', ' ').replaceCharacter ('\t', ' ');
    juce::StringArray tokens;
    tokens.addTokens (text, " ", "\"'");
    tokens.removeEmptyStrings();
    if (tokens.isEmpty() || tokens.size() > 256)
        return std::nullopt;

    std::vector<int> notes;
    notes.reserve (static_cast<std::size_t> (tokens.size()));
    for (const auto& token : tokens)
    {
        const auto note = PianoKeyboard::parseNoteName (token);
        if (! note.has_value())
            return std::nullopt;
        notes.push_back (*note);
    }
    return notes;
}

void MainComponent::startPractice()
{
    const auto parsed = parsePracticeSequence (practiceEditor.getText());
    if (! parsed.has_value())
    {
        showMessage ("Check the note sequence",
                     "Enter up to 256 note names in the A0–C8 range, separated by spaces or commas.\n"
                     "Example: C4 E4 G4 C5. Sharps and flats are supported.", true);
        return;
    }

    practiceSequence = *parsed;
    practiceIndex = 0;
    updatePracticeLabel();
    pianoKeyboard.setPracticeNote (practiceSequence.front());
}

void MainComponent::clearPractice()
{
    practiceSequence.clear();
    practiceIndex = 0;
    pianoKeyboard.setPracticeNote (-1);
    nextNoteLabel.setText ("Enter notes, for example: C4 E4 G4 C5", juce::dontSendNotification);
}

void MainComponent::advancePractice (int playedNote)
{
    if (practiceIndex >= practiceSequence.size() || practiceSequence.empty())
        return;
    if (playedNote != practiceSequence[practiceIndex])
        return;

    ++practiceIndex;
    if (practiceIndex < practiceSequence.size())
    {
        pianoKeyboard.setPracticeNote (practiceSequence[practiceIndex]);
        updatePracticeLabel();
    }
    else
    {
        pianoKeyboard.setPracticeNote (-1);
        nextNoteLabel.setText ("Sequence complete  ·  " + juce::String (static_cast<int> (practiceSequence.size()))
                               + " notes", juce::dontSendNotification);
    }
}

void MainComponent::updatePracticeLabel()
{
    if (practiceSequence.empty() || practiceIndex >= practiceSequence.size())
    {
        nextNoteLabel.setText ("Enter notes, for example: C4 E4 G4 C5", juce::dontSendNotification);
        return;
    }

    nextNoteLabel.setText ("NEXT NOTE   " + PianoKeyboard::noteName (practiceSequence[practiceIndex]),
                           juce::dontSendNotification);
}

void MainComponent::openSettings()
{
    if (settingsWindow != nullptr)
    {
        settingsWindow->setVisible (true);
        settingsWindow->toFront (true);
        return;
    }

    SettingsCallbacks callbacks;
    callbacks.midiDeviceChanged = [this] (const juce::String& identifier)
    {
        midiManager.selectDevice (identifier);
        userSettings.midiInputIdentifier = midiManager.selectedIdentifier();
        populateMidiDropdown();
        updateAudioStateAndStatus();
        scheduleSettingsSave();
    };
    callbacks.themeChanged = [this] (bool dark)
    {
        userSettings.darkTheme = dark;
        applyTheme();
        scheduleSettingsSave();
    };
    callbacks.scaleChanged = [this] (float scale)
    {
        userSettings.uiScale = std::clamp (scale, 0.80f, 1.20f);
        applyUiScale();
        applyTheme();
        scheduleSettingsSave();
    };
    callbacks.velocityChanged = [this] (int velocity)
    {
        userSettings.computerKeyVelocity = std::clamp (velocity, 1, 127);
        scheduleSettingsSave();
    };
    callbacks.metronomeVolumeChanged = [this] (float volume)
    {
        userSettings.metronomeVolume = std::clamp (volume, 0.0f, 1.0f);
        setMetronomeState();
        scheduleSettingsSave();
    };

    settingsWindow = std::make_unique<SettingsWindow> (lookAndFeel, deviceManager, midiManager,
                                                        userSettings, std::move (callbacks));
}

void MainComponent::scheduleSettingsSave()
{
    settingsSavePending = true;
    settingsSaveDueMs = juce::Time::getMillisecondCounter() + 850U;
}

void MainComponent::saveSettingsNow()
{
    userSettings.midiInputIdentifier = midiManager.selectedIdentifier();
    auto state = deviceManager.createStateXml();
    if (state != nullptr)
        userSettings.audioDeviceStateXml = state->toString();
    settingsManager.save (userSettings);
    settingsManager.flush();
    settingsSavePending = false;
}

} // namespace piano
