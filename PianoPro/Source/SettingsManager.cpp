#include "SettingsManager.h"

#include <algorithm>

namespace piano
{

SettingsManager::SettingsManager()
{
    juce::PropertiesFile::Options options;
    options.applicationName = "PianoPro";
    options.filenameSuffix = ".settings";
    options.folderName = "PianoPro";
    options.osxLibrarySubFolder = "Application Support/PianoPro";
    options.commonToAllUsers = false;
    options.ignoreCaseOfKeyNames = false;
    options.doNotSave = false;
    options.millisecondsBeforeSaving = -1;
    options.storageFormat = juce::PropertiesFile::storeAsXML;
    applicationProperties.setStorageParameters (options);
}

AppSettings SettingsManager::load() const
{
    AppSettings settings;
    auto* properties = const_cast<juce::ApplicationProperties&> (applicationProperties).getUserSettings();
    if (properties == nullptr)
        return settings;

    settings.masterVolume = static_cast<float> (std::clamp (properties->getDoubleValue ("masterVolume", 0.78), 0.0, 1.0));
    settings.muted = properties->getBoolValue ("muted", false);
    settings.sustainEnabled = properties->getBoolValue ("sustainEnabled", false);
    settings.instrument = std::clamp (properties->getIntValue ("instrument", 0), 0, 3);
    settings.octave = std::clamp (properties->getIntValue ("octave", 4), 1, 7);
    settings.midiInputIdentifier = properties->getValue ("midiInputIdentifier");
    settings.audioDeviceStateXml = properties->getValue ("audioDeviceStateXml");
    settings.darkTheme = properties->getBoolValue ("darkTheme", true);
    settings.uiScale = static_cast<float> (std::clamp (properties->getDoubleValue ("uiScale", 1.0), 0.80, 1.20));
    settings.computerKeyVelocity = std::clamp (properties->getIntValue ("computerKeyVelocity", 96), 1, 127);
    settings.metronomeEnabled = properties->getBoolValue ("metronomeEnabled", false);
    settings.metronomeBpm = std::clamp (properties->getIntValue ("metronomeBpm", 100), 40, 240);
    settings.metronomeVolume = static_cast<float> (std::clamp (properties->getDoubleValue ("metronomeVolume", 0.35), 0.0, 1.0));
    return settings;
}

void SettingsManager::save (const AppSettings& settings)
{
    auto* properties = applicationProperties.getUserSettings();
    if (properties == nullptr)
        return;

    properties->setValue ("masterVolume", static_cast<double> (std::clamp (settings.masterVolume, 0.0f, 1.0f)));
    properties->setValue ("muted", settings.muted);
    properties->setValue ("sustainEnabled", settings.sustainEnabled);
    properties->setValue ("instrument", std::clamp (settings.instrument, 0, 3));
    properties->setValue ("octave", std::clamp (settings.octave, 1, 7));
    properties->setValue ("midiInputIdentifier", settings.midiInputIdentifier);
    properties->setValue ("audioDeviceStateXml", settings.audioDeviceStateXml);
    properties->setValue ("darkTheme", settings.darkTheme);
    properties->setValue ("uiScale", static_cast<double> (std::clamp (settings.uiScale, 0.80f, 1.20f)));
    properties->setValue ("computerKeyVelocity", std::clamp (settings.computerKeyVelocity, 1, 127));
    properties->setValue ("metronomeEnabled", settings.metronomeEnabled);
    properties->setValue ("metronomeBpm", std::clamp (settings.metronomeBpm, 40, 240));
    properties->setValue ("metronomeVolume", static_cast<double> (std::clamp (settings.metronomeVolume, 0.0f, 1.0f)));
}

void SettingsManager::flush()
{
    applicationProperties.saveIfNeeded();
}

} // namespace piano
