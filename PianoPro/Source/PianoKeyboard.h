#pragma once

#include "PianoEngine.h"

#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>
#include <optional>

namespace piano
{

class PianoKeyboard final : public juce::Component
{
public:
    explicit PianoKeyboard (PianoEngine& pianoEngine);
    ~PianoKeyboard() override;

    void setNoteCallbacks (std::function<void (int, int)> noteOnCallback,
                           std::function<void (int)> noteOffCallback);
    void setSelectedOctave (int octave);
    void setPracticeNote (int midiNote);
    void setDarkTheme (bool isDark);
    void setUiScale (float scale);
    void releaseMouseNote();

    void paint (juce::Graphics& graphics) override;
    void mouseDown (const juce::MouseEvent& event) override;
    void mouseDrag (const juce::MouseEvent& event) override;
    void mouseUp (const juce::MouseEvent& event) override;
    bool keyPressed (const juce::KeyPress& key) override;

    static juce::String noteName (int midiNote, bool includeOctave = true);
    static bool isBlackKey (int midiNote) noexcept;
    static std::optional<int> parseNoteName (juce::String token);

private:
    juce::Rectangle<float> pianoArea() const;
    juce::Rectangle<float> boundsForNote (int midiNote) const;
    std::optional<int> noteAtPoint (juce::Point<float> point) const;
    int mouseVelocityAt (juce::Point<float> point, int note) const;
    int keyboardMapNote (int note) const noexcept;
    void transitionMouseNote (std::optional<int> newNote, juce::Point<float> pointerPosition);

    PianoEngine& engine;
    std::function<void (int, int)> onNoteOn;
    std::function<void (int)> onNoteOff;
    int selectedOctave = 4;
    int practiceNote = -1;
    int activeMouseNote = -1;
    bool darkTheme = true;
    float uiScale = 1.0f;
};

} // namespace piano
