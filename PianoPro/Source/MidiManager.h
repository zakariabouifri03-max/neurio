#pragma once

#include <juce_audio_devices/juce_audio_devices.h>

#include <array>
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <vector>

namespace piano
{

class MidiManager final : private juce::MidiInputCallback
{
public:
    struct Callbacks
    {
        std::function<void (int note, int velocity)> noteOn;
        std::function<void (int note)> noteOff;
        std::function<void (bool enabled)> sustain;
        std::function<void (std::uint16_t bank, int program)> programChange;
        std::function<void()> deviceDisconnected;
    };

    MidiManager();
    ~MidiManager();

    void setCallbacks (Callbacks newCallbacks);
    std::vector<juce::MidiDeviceInfo> availableDevices() const;
    bool refreshDevices();
    bool selectDevice (const juce::String& identifier);
    void releaseAllNotes();
    juce::String selectedIdentifier() const;
    juce::String selectedDeviceName() const;
    juce::String statusText() const;
    bool isConnected() const noexcept;

private:
    void handleIncomingMidiMessage (juce::MidiInput* source,
                                    const juce::MidiMessage& message) override;
    void openSelectedDevice();
    void closeInput (bool releaseHeldNotes);
    void releaseHeldNotes();

    Callbacks callbacks;
    std::vector<juce::MidiDeviceInfo> devices;
    juce::String selectedId;
    juce::String connectedId;
    juce::String status;
    std::unique_ptr<juce::MidiInput> input;
    std::array<std::atomic<int>, 128> heldNotes{};
    std::array<int, 16> bankMsb{};
    std::array<int, 16> bankLsb{};
    std::atomic<bool> midiSustain { false };
    std::atomic<bool> connected { false };
};

} // namespace piano
