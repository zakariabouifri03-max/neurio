#include "MidiManager.h"

#include <algorithm>

namespace piano
{
namespace
{
constexpr int kFirstPianoNote = 21;
constexpr int kLastPianoNote = 108;
}

MidiManager::MidiManager()
{
    for (auto& count : heldNotes)
        count.store (0, std::memory_order_relaxed);
    status = "No MIDI input selected";
}

MidiManager::~MidiManager()
{
    closeInput (true);
}

void MidiManager::setCallbacks (Callbacks newCallbacks)
{
    callbacks = std::move (newCallbacks);
}

std::vector<juce::MidiDeviceInfo> MidiManager::availableDevices() const
{
    return devices;
}

bool MidiManager::refreshDevices()
{
    const auto foundDevices = juce::MidiInput::getAvailableDevices();
    std::vector<juce::MidiDeviceInfo> latest;
    latest.reserve (static_cast<std::size_t> (foundDevices.size()));
    for (const auto& info : foundDevices)
        latest.push_back (info);

    bool changed = latest.size() != devices.size();
    if (! changed)
    {
        for (std::size_t i = 0; i < latest.size(); ++i)
            if (latest[i].identifier != devices[i].identifier || latest[i].name != devices[i].name)
            {
                changed = true;
                break;
            }
    }
    devices = std::move (latest);

    if (selectedId.isNotEmpty())
    {
        const auto selectedIsPresent = std::any_of (devices.begin(), devices.end(), [this] (const auto& device)
        {
            return device.identifier == selectedId;
        });

        if (input != nullptr && ! selectedIsPresent)
        {
            closeInput (true);
            status = "MIDI device disconnected";
            if (callbacks.deviceDisconnected)
                callbacks.deviceDisconnected();
            changed = true;
        }
        else if (input == nullptr && selectedIsPresent)
        {
            openSelectedDevice();
            changed = true;
        }
        else if (input == nullptr && ! selectedIsPresent && status != "MIDI device disconnected")
        {
            status = "Saved MIDI device is not connected";
        }
    }

    return changed;
}

bool MidiManager::selectDevice (const juce::String& identifier)
{
    if (identifier == selectedId && (identifier.isEmpty() || input != nullptr))
        return true;

    closeInput (true);
    selectedId = identifier;
    if (selectedId.isEmpty())
    {
        status = "No MIDI input selected";
        return true;
    }

    openSelectedDevice();
    return input != nullptr;
}

void MidiManager::releaseAllNotes()
{
    releaseHeldNotes();
}

juce::String MidiManager::selectedIdentifier() const
{
    return selectedId;
}

juce::String MidiManager::selectedDeviceName() const
{
    for (const auto& device : devices)
        if (device.identifier == selectedId)
            return device.name;
    return selectedId.isNotEmpty() ? "Disconnected" : "No Device";
}

juce::String MidiManager::statusText() const
{
    return status;
}

bool MidiManager::isConnected() const noexcept
{
    return connected.load (std::memory_order_acquire);
}

void MidiManager::handleIncomingMidiMessage (juce::MidiInput*, const juce::MidiMessage& message)
{
    if (message.isNoteOn())
    {
        const auto note = message.getNoteNumber();
        if (note < kFirstPianoNote || note > kLastPianoNote)
            return;

        heldNotes[static_cast<std::size_t> (note)].fetch_add (1, std::memory_order_relaxed);
        if (callbacks.noteOn)
            callbacks.noteOn (note, static_cast<int> (message.getVelocity()));
        return;
    }

    if (message.isNoteOff())
    {
        const auto note = message.getNoteNumber();
        if (note < kFirstPianoNote || note > kLastPianoNote)
            return;

        auto& count = heldNotes[static_cast<std::size_t> (note)];
        auto previous = count.load (std::memory_order_relaxed);
        while (previous > 0 && ! count.compare_exchange_weak (previous, previous - 1,
                                                               std::memory_order_relaxed,
                                                               std::memory_order_relaxed))
        {
        }
        if (previous > 0 && callbacks.noteOff)
            callbacks.noteOff (note);
        return;
    }

    if (! message.isController() && ! message.isProgramChange())
        return;

    const auto channel = std::clamp (message.getChannel() - 1, 0, 15);
    if (message.isController())
    {
        const auto number = message.getControllerNumber();
        const auto value = message.getControllerValue();
        if (number == 0)
            bankMsb[static_cast<std::size_t> (channel)] = value;
        else if (number == 32)
            bankLsb[static_cast<std::size_t> (channel)] = value;
        else if (number == 64)
        {
            const bool enabled = value >= 64;
            if (midiSustain.exchange (enabled, std::memory_order_acq_rel) != enabled && callbacks.sustain)
                callbacks.sustain (enabled);
        }
        return;
    }

    if (message.isProgramChange() && callbacks.programChange)
    {
        const auto bank = static_cast<std::uint16_t> ((bankMsb[static_cast<std::size_t> (channel)] << 7)
                                                       | bankLsb[static_cast<std::size_t> (channel)]);
        callbacks.programChange (bank, message.getProgramChangeNumber());
    }
}

void MidiManager::openSelectedDevice()
{
    if (selectedId.isEmpty())
        return;

    const auto found = std::any_of (devices.begin(), devices.end(), [this] (const auto& device)
    {
        return device.identifier == selectedId;
    });
    if (! found)
    {
        connected.store (false, std::memory_order_release);
        connectedId.clear();
        status = "Saved MIDI device is not connected";
        return;
    }

    input = juce::MidiInput::openDevice (selectedId, this);
    if (input == nullptr)
    {
        connected.store (false, std::memory_order_release);
        connectedId.clear();
        status = "Could not open this MIDI input device";
        return;
    }

    bankMsb.fill (0);
    bankLsb.fill (0);
    input->start();
    connectedId = selectedId;
    connected.store (true, std::memory_order_release);
    status = "Connected: " + selectedDeviceName();
}

void MidiManager::closeInput (bool shouldReleaseHeldNotes)
{
    if (input != nullptr)
    {
        input->stop();
        input.reset();
    }

    connected.store (false, std::memory_order_release);
    connectedId.clear();
    if (shouldReleaseHeldNotes)
        releaseHeldNotes();
}

void MidiManager::releaseHeldNotes()
{
    for (std::size_t note = 0; note < heldNotes.size(); ++note)
    {
        const auto count = heldNotes[note].exchange (0, std::memory_order_acq_rel);
        if (callbacks.noteOff)
            for (int i = 0; i < count; ++i)
                callbacks.noteOff (static_cast<int> (note));
    }

    if (midiSustain.exchange (false, std::memory_order_acq_rel) && callbacks.sustain)
        callbacks.sustain (false);
}

} // namespace piano
