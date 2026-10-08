#pragma once

#include <array>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace piano
{

enum class MidiEventType : std::uint8_t
{
    noteOn,
    noteOff,
    sustain,
    programChange
};

struct MidiEvent
{
    double timeSeconds = 0.0;
    MidiEventType type = MidiEventType::noteOn;
    std::uint8_t note = 0;
    std::uint8_t value = 0;
    std::uint16_t bank = 0;
    std::uint64_t order = 0;
};

/**
    Thread-safe local performance recorder and Standard MIDI File (SMF) reader/writer.

    MIDI file timing uses 480 PPQ and a 120 BPM default tempo. Imported format 0/1
    files with PPQ timing are supported; unsupported/corrupt files return a useful
    error instead of partially replacing the current performance.
*/
class RecordingManager
{
public:
    RecordingManager() = default;

    bool beginRecording (std::uint16_t initialBank, std::uint8_t initialProgram);
    void stopRecording();
    bool isRecording() const;
    double elapsedSeconds() const;
    double performanceDurationSeconds() const;
    std::size_t eventCount() const;

    void recordNoteOn (int note, int velocity);
    void recordNoteOff (int note);
    void recordSustain (bool enabled);
    void recordProgramChange (std::uint16_t bank, int program);
    void closeOpenNotes();

    std::shared_ptr<const std::vector<MidiEvent>> playbackEvents() const;
    bool saveToFile (const std::filesystem::path& path, std::string& error) const;
    bool loadFromFile (const std::filesystem::path& path, std::string& error);

private:
    double nowSecondsLocked() const;
    void appendLocked (MidiEvent event);
    static bool writeMidiFile (const std::vector<MidiEvent>& events,
                               const std::filesystem::path& path,
                               std::string& error);
    static bool readMidiFile (const std::filesystem::path& path,
                              std::vector<MidiEvent>& events,
                              std::string& error);

    mutable std::mutex mutex;
    bool recording = false;
    bool sustainIsOn = false;
    std::chrono::steady_clock::time_point recordingStart{};
    std::uint64_t nextOrder = 0;
    std::array<unsigned int, 128> openNoteCounts{};
    std::vector<MidiEvent> events;
};

} // namespace piano
