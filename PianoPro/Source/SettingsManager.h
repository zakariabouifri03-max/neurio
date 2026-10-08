#pragma once

#include <juce_data_structures/juce_data_structures.h>

namespace piano
{

struct AppSettings
{
    float masterVolume = 0.78f;
    bool muted = false;
    bool sustainEnabled = false;
    int instrument = 0;
    int octave = 4;
    juce::String midiInputIdentifier;
    juce::String audioDeviceStateXml;
    bool darkTheme = true;
    float uiScale = 1.0f;
    int computerKeyVelocity = 96;
    bool metronomeEnabled = false;
    int metronomeBpm = 100;
    float metronomeVolume = 0.35f;
};

/** Small per-user settings file stored under the operating system's app-data folder. */
class SettingsManager
{
public:
    SettingsManager();

    AppSettings load() const;
    void save (const AppSettings& settings);
    void flush();

private:
    juce::ApplicationProperties applicationProperties;
};

} // namespace piano
