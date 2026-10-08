#include "RecordingManager.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <thread>

namespace
{
void require (bool condition, const char* message)
{
    if (! condition)
        throw std::runtime_error (message);
}
}

int main()
{
    const auto folder = std::filesystem::temp_directory_path() / "PianoPro-MidiTests";
    const auto midiPath = folder / "round-trip.mid";
    const auto brokenPath = folder / "broken.mid";
    std::error_code ec;
    std::filesystem::create_directories (folder, ec);

    try
    {
        piano::RecordingManager recorder;
        require (recorder.beginRecording (0, 0), "recording did not start");
        recorder.recordNoteOn (60, 93); // C4, velocity 93.
        std::this_thread::sleep_for (std::chrono::milliseconds (18));
        recorder.recordSustain (true);
        recorder.recordNoteOff (60);
        std::this_thread::sleep_for (std::chrono::milliseconds (18));
        recorder.recordSustain (false);
        recorder.recordProgramChange (1, 0); // Piano Pro's separate soft-piano bank.
        recorder.recordNoteOn (64, 77); // E4.
        std::this_thread::sleep_for (std::chrono::milliseconds (14));
        recorder.stopRecording();

        require (! recorder.isRecording(), "stop did not end the recording");
        require (recorder.eventCount() >= 8, "recorded MIDI events are missing");
        require (recorder.performanceDurationSeconds() > 0.035, "performance duration was not kept");

        std::string error;
        require (recorder.saveToFile (midiPath, error), error.c_str());
        require (std::filesystem::file_size (midiPath) > 30, "MIDI export is unexpectedly small");
        {
            std::ifstream file (midiPath, std::ios::binary);
            char header[4]{};
            file.read (header, 4);
            require (std::string (header, 4) == "MThd", "export does not contain a Standard MIDI header");
        }

        piano::RecordingManager loaded;
        require (loaded.loadFromFile (midiPath, error), error.c_str());
        const auto events = loaded.playbackEvents();
        require (events != nullptr && events->size() == recorder.eventCount(), "round-trip event count changed");

        bool foundC4On = false;
        bool foundC4Off = false;
        bool foundVelocity = false;
        bool foundSustainOn = false;
        bool foundSoftBank = false;
        for (const auto& event : *events)
        {
            if (event.type == piano::MidiEventType::noteOn && event.note == 60)
            {
                foundC4On = true;
                foundVelocity = event.value == 93;
            }
            if (event.type == piano::MidiEventType::noteOff && event.note == 60)
                foundC4Off = true;
            if (event.type == piano::MidiEventType::sustain && event.value >= 64)
                foundSustainOn = true;
            if (event.type == piano::MidiEventType::programChange && event.bank == 1 && event.value == 0)
                foundSoftBank = true;
        }
        require (foundC4On && foundVelocity, "note or velocity did not survive MIDI round trip");
        require (foundC4Off, "note duration / note-off did not survive MIDI round trip");
        require (foundSustainOn, "sustain controller did not survive MIDI round trip");
        require (foundSoftBank, "bank-select/program-change did not survive MIDI round trip");

        {
            std::ofstream broken (brokenPath, std::ios::binary | std::ios::trunc);
            broken << "not a midi file";
        }
        const auto originalCount = loaded.eventCount();
        require (! loaded.loadFromFile (brokenPath, error), "invalid MIDI file was accepted");
        require (loaded.eventCount() == originalCount, "invalid file corrupted the existing performance");

        std::filesystem::remove (midiPath, ec);
        std::filesystem::remove (brokenPath, ec);
        std::filesystem::remove (folder, ec);
        std::cout << "MIDI record, SMF export/import, timing, sustain, velocity and validation passed.\n";
        return 0;
    }
    catch (const std::exception& exception)
    {
        std::cerr << "RecordingManager test failed: " << exception.what() << '\n';
        return 1;
    }
}
