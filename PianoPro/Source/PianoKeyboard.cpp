#include "PianoKeyboard.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace piano
{
namespace
{
constexpr int kFirstNote = 21;
constexpr int kLastNote = 108;
constexpr int kWhiteKeyCount = 52;
constexpr std::array<const char*, 12> kNoteNames {
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
};
constexpr std::array<char, 13> kComputerKeys {
    'A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K'
};

int whitesBefore (int note) noexcept
{
    int count = 0;
    for (int current = kFirstNote; current < note; ++current)
        if (! PianoKeyboard::isBlackKey (current))
            ++count;
    return count;
}

juce::Font makeFont (float height, int style = juce::Font::plain)
{
    return juce::Font (juce::FontOptions (height, style));
}

} // namespace

PianoKeyboard::PianoKeyboard (PianoEngine& pianoEngine) : engine (pianoEngine)
{
    setOpaque (false);
    setWantsKeyboardFocus (true);
    setMouseCursor (juce::MouseCursor::PointingHandCursor);
}

PianoKeyboard::~PianoKeyboard()
{
    releaseMouseNote();
}

void PianoKeyboard::setNoteCallbacks (std::function<void (int, int)> noteOnCallback,
                                      std::function<void (int)> noteOffCallback)
{
    onNoteOn = std::move (noteOnCallback);
    onNoteOff = std::move (noteOffCallback);
}

void PianoKeyboard::setSelectedOctave (int octave)
{
    selectedOctave = std::clamp (octave, 1, 7);
    repaint();
}

void PianoKeyboard::setPracticeNote (int midiNote)
{
    practiceNote = midiNote >= kFirstNote && midiNote <= kLastNote ? midiNote : -1;
    repaint();
}

void PianoKeyboard::setDarkTheme (bool isDark)
{
    darkTheme = isDark;
    repaint();
}

void PianoKeyboard::setUiScale (float scale)
{
    uiScale = std::clamp (scale, 0.80f, 1.20f);
    repaint();
}

void PianoKeyboard::releaseMouseNote()
{
    if (activeMouseNote >= 0)
    {
        if (onNoteOff)
            onNoteOff (activeMouseNote);
        activeMouseNote = -1;
        repaint();
    }
}

void PianoKeyboard::paint (juce::Graphics& g)
{
    const auto bounds = getLocalBounds().toFloat();
    const auto background = darkTheme ? juce::Colour (0xff111a2a) : juce::Colour (0xffe6edf5);
    const auto border = darkTheme ? juce::Colour (0xff25334a) : juce::Colour (0xffcbd6e4);
    g.setColour (background);
    g.fillRoundedRectangle (bounds, 14.0f * uiScale);
    g.setColour (border);
    g.drawRoundedRectangle (bounds.reduced (0.5f), 14.0f * uiScale, 1.0f);

    const auto area = pianoArea();
    if (area.isEmpty())
        return;

    const float whiteWidth = area.getWidth() / static_cast<float> (kWhiteKeyCount);
    const float keyHeight = area.getHeight();
    const float blackWidth = whiteWidth * 0.64f;
    const float blackHeight = keyHeight * 0.61f;
    const auto whiteBase = darkTheme ? juce::Colour (0xfff5f7fb) : juce::Colour (0xffffffff);
    const auto whiteEdge = darkTheme ? juce::Colour (0xffc8d1de) : juce::Colour (0xffaab8c9);
    const auto whitePressed = juce::Colour (0xff9be4dd);
    const auto blackBase = darkTheme ? juce::Colour (0xff111a28) : juce::Colour (0xff182437);
    const auto blackPressed = juce::Colour (0xff27bba9);
    const auto normalText = darkTheme ? juce::Colour (0xff64748b) : juce::Colour (0xff62738a);
    const auto mapText = darkTheme ? juce::Colour (0xff096b68) : juce::Colour (0xff087f77);
    const float keyFont = std::max (6.5f, 8.0f * uiScale);
    const float mapFont = std::max (7.0f, 8.5f * uiScale);

    // White keys are painted first so the black keys sit above their neighbours.
    for (int note = kFirstNote; note <= kLastNote; ++note)
    {
        if (isBlackKey (note))
            continue;

        const auto whiteIndex = whitesBefore (note);
        auto key = juce::Rectangle<float> (area.getX() + whiteIndex * whiteWidth,
                                           area.getY(), whiteWidth + 0.25f, keyHeight);
        const bool isPressed = note == activeMouseNote || engine.isNoteActive (note);
        const bool isPractice = note == practiceNote;
        g.setColour (isPractice ? juce::Colour (0xffb8f1e8) : isPressed ? whitePressed : whiteBase);
        g.fillRect (key);
        g.setColour (isPractice ? juce::Colour (0xff1b9b8f) : whiteEdge);
        g.drawRect (key, isPractice ? 1.7f : 0.8f);

        const auto labelY = area.getBottom() - 30.0f * uiScale;
        const auto keyMap = keyboardMapNote (note);
        if (keyMap >= 0)
        {
            g.setColour (mapText);
            g.setFont (makeFont (mapFont, juce::Font::bold));
            g.drawText (juce::String::charToString (kComputerKeys[static_cast<std::size_t> (keyMap)]),
                        key.withY (labelY - 3.0f * uiScale).withHeight (12.0f * uiScale).toNearestInt(),
                        juce::Justification::centred, false);
        }

        g.setColour (normalText);
        g.setFont (makeFont (keyFont));
        const bool isC = note % 12 == 0;
        const auto name = isC ? noteName (note, true) : noteName (note, false);
        g.drawText (name,
                    key.withY (area.getBottom() - (keyMap >= 0 ? 17.0f : 18.0f) * uiScale)
                        .withHeight (12.0f * uiScale).toNearestInt(),
                    juce::Justification::centred, false);
    }

    // Then overlay every raised key, including its shadow, pressed state and label.
    for (int note = kFirstNote; note <= kLastNote; ++note)
    {
        if (! isBlackKey (note))
            continue;

        auto key = boundsForNote (note);
        const bool isPressed = note == activeMouseNote || engine.isNoteActive (note);
        const bool isPractice = note == practiceNote;
        auto shadow = key.translated (0.0f, 3.0f * uiScale);
        g.setColour (juce::Colours::black.withAlpha (darkTheme ? 0.40f : 0.25f));
        g.fillRoundedRectangle (shadow, 3.0f * uiScale);

        auto gradientTop = isPractice ? juce::Colour (0xff79dfd1)
                       : isPressed ? blackPressed.brighter (0.10f)
                       : blackBase.brighter (0.15f);
        auto gradientBottom = isPractice ? juce::Colour (0xff219b91)
                          : isPressed ? blackPressed.darker (0.08f)
                          : blackBase.darker (0.10f);
        g.setGradientFill (juce::ColourGradient (gradientTop, key.getTopLeft(),
                                                  gradientBottom, key.getBottomLeft(), false));
        g.fillRoundedRectangle (key, 3.5f * uiScale);
        g.setColour (isPractice ? juce::Colour (0xffa9fff3) : juce::Colour (0xff3b4b61));
        g.drawRoundedRectangle (key, 3.5f * uiScale, isPractice ? 1.5f : 0.8f);

        const auto label = noteName (note, false);
        g.setColour (isPractice || isPressed ? juce::Colour (0xffeffffc) : juce::Colour (0xffaebbd0));
        g.setFont (makeFont (std::max (6.0f, 7.0f * uiScale), juce::Font::bold));
        g.drawText (label, key.withY (key.getBottom() - 18.0f * uiScale)
                            .withHeight (11.0f * uiScale).toNearestInt(),
                    juce::Justification::centred, false);

        const auto keyMap = keyboardMapNote (note);
        if (keyMap >= 0)
        {
            g.setColour (juce::Colour (0xffb8f7ed));
            g.setFont (makeFont (std::max (6.0f, 7.2f * uiScale), juce::Font::bold));
            g.drawText (juce::String::charToString (kComputerKeys[static_cast<std::size_t> (keyMap)]),
                        key.withY (key.getBottom() - 31.0f * uiScale)
                            .withHeight (10.0f * uiScale).toNearestInt(),
                        juce::Justification::centred, false);
        }
    }
}

void PianoKeyboard::mouseDown (const juce::MouseEvent& event)
{
    grabKeyboardFocus();
    transitionMouseNote (noteAtPoint (event.position), event.position);
}

void PianoKeyboard::mouseDrag (const juce::MouseEvent& event)
{
    transitionMouseNote (noteAtPoint (event.position), event.position);
}

void PianoKeyboard::mouseUp (const juce::MouseEvent&)
{
    releaseMouseNote();
}

bool PianoKeyboard::keyPressed (const juce::KeyPress&)
{
    return false;
}

juce::String PianoKeyboard::noteName (int midiNote, bool includeOctave)
{
    if (midiNote < 0 || midiNote > 127)
        return "—";

    auto result = juce::String (kNoteNames[static_cast<std::size_t> (midiNote % 12)]);
    if (includeOctave)
        result += juce::String (midiNote / 12 - 1);
    return result;
}

bool PianoKeyboard::isBlackKey (int midiNote) noexcept
{
    switch (midiNote % 12)
    {
        case 1: case 3: case 6: case 8: case 10: return true;
        default: return false;
    }
}

std::optional<int> PianoKeyboard::parseNoteName (juce::String token)
{
    token = token.trim().toUpperCase();
    if (token.isEmpty())
        return std::nullopt;

    int semitone = -1;
    switch (token[0])
    {
        case 'C': semitone = 0; break;
        case 'D': semitone = 2; break;
        case 'E': semitone = 4; break;
        case 'F': semitone = 5; break;
        case 'G': semitone = 7; break;
        case 'A': semitone = 9; break;
        case 'B': semitone = 11; break;
        default: return std::nullopt;
    }

    int position = 1;
    if (position < token.length() && (token[position] == '#' || token[position] == 'B'))
    {
        if (token[position] == '#')
            ++semitone;
        else
            --semitone;
        ++position;
    }

    if (position >= token.length())
        return std::nullopt;

    const auto octaveText = token.substring (position);
    if (! octaveText.containsOnly ("0123456789") || octaveText.length() > 1)
        return std::nullopt;

    const auto octave = octaveText.getIntValue();
    const auto note = (octave + 1) * 12 + semitone;
    if (note < kFirstNote || note > kLastNote)
        return std::nullopt;
    return note;
}

juce::Rectangle<float> PianoKeyboard::pianoArea() const
{
    return getLocalBounds().toFloat().reduced (10.0f * uiScale, 10.0f * uiScale);
}

juce::Rectangle<float> PianoKeyboard::boundsForNote (int midiNote) const
{
    const auto area = pianoArea();
    const auto whiteWidth = area.getWidth() / static_cast<float> (kWhiteKeyCount);
    const auto blackWidth = whiteWidth * 0.64f;
    const auto blackHeight = area.getHeight() * 0.61f;

    if (isBlackKey (midiNote))
    {
        const auto boundaryIndex = whitesBefore (midiNote);
        const auto centre = area.getX() + static_cast<float> (boundaryIndex) * whiteWidth;
        return { centre - blackWidth * 0.5f, area.getY(), blackWidth, blackHeight };
    }

    const auto whiteIndex = whitesBefore (midiNote);
    return { area.getX() + static_cast<float> (whiteIndex) * whiteWidth,
             area.getY(), whiteWidth, area.getHeight() };
}

std::optional<int> PianoKeyboard::noteAtPoint (juce::Point<float> point) const
{
    if (! pianoArea().contains (point))
        return std::nullopt;

    // Raised keys overlap their neighbouring white keys, so test them first.
    for (int note = kFirstNote; note <= kLastNote; ++note)
        if (isBlackKey (note) && boundsForNote (note).contains (point))
            return note;

    for (int note = kFirstNote; note <= kLastNote; ++note)
        if (! isBlackKey (note) && boundsForNote (note).contains (point))
            return note;

    return std::nullopt;
}

int PianoKeyboard::mouseVelocityAt (juce::Point<float> point, int note) const
{
    const auto bounds = boundsForNote (note);
    if (bounds.getHeight() <= 0.0f)
        return 96;

    const auto verticalPosition = std::clamp ((point.y - bounds.getY()) / bounds.getHeight(), 0.0f, 1.0f);
    return static_cast<int> (std::lround (55.0f + 72.0f * verticalPosition));
}

int PianoKeyboard::keyboardMapNote (int note) const noexcept
{
    const auto firstNoteOfOctave = (selectedOctave + 1) * 12;
    const auto offset = note - firstNoteOfOctave;
    return offset >= 0 && offset < static_cast<int> (kComputerKeys.size()) ? offset : -1;
}

void PianoKeyboard::transitionMouseNote (std::optional<int> newNote, juce::Point<float> pointerPosition)
{
    const int nextNote = newNote.has_value() ? *newNote : -1;
    if (nextNote == activeMouseNote)
        return;

    if (activeMouseNote >= 0 && onNoteOff)
        onNoteOff (activeMouseNote);

    activeMouseNote = nextNote;
    if (activeMouseNote >= 0 && onNoteOn)
        onNoteOn (activeMouseNote, mouseVelocityAt (pointerPosition, activeMouseNote));
    repaint();
}

} // namespace piano
