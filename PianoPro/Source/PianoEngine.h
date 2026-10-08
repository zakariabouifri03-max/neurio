#pragma once

#include "RecordingManager.h"

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

struct tsf;

namespace piano
{

enum class Instrument : std::uint8_t
{
    grandPiano = 0,
    electricPiano = 1,
    organ = 2,
    softPiano = 3
};

enum class SustainSource : std::uint8_t
{
    userInterface = 0,
    midiPedal = 1,
    playback = 2
};

/**
    Low-allocation SoundFont playback engine.

    All TinySoundFont voice/channel calls are serialized on the audio callback.
    UI and MIDI producer threads submit bounded, lock-free commands; an overflow
    requests an all-notes-off as a final stuck-note safety net.
*/
class PianoEngine
{
public:
    PianoEngine();
    ~PianoEngine();

    PianoEngine (const PianoEngine&) = delete;
    PianoEngine& operator= (const PianoEngine&) = delete;

    bool loadSoundFonts (const std::filesystem::path& generalMidiFont,
                         const std::filesystem::path& softPianoFont,
                         std::string& message);
    bool instrumentAvailable (Instrument instrument) const noexcept;
    std::string soundFontStatus() const;

    void prepareToPlay (double sampleRate, int expectedBlockSize);
    void releaseResources() noexcept;
    void render (float* const* outputChannels, int numOutputChannels, int numSamples) noexcept;

    void noteOn (int midiNote, int velocity) noexcept;
    void noteOff (int midiNote) noexcept;
    void allNotesOff (bool immediate = false) noexcept;
    void setInstrument (Instrument instrument) noexcept;
    void setProgram (std::uint16_t bank, int program) noexcept;
    void setSustain (SustainSource source, bool enabled) noexcept;

    void setMasterVolume (float normalizedVolume) noexcept;
    void setMuted (bool shouldMute) noexcept;
    void setMetronome (bool enabled, int bpm, float normalizedVolume) noexcept;

    bool startPlayback (std::shared_ptr<const std::vector<MidiEvent>> sequence) noexcept;
    void stopPlayback() noexcept;
    bool isPlaybackRunning() const noexcept;

    bool isNoteActive (int midiNote) const noexcept;
    int mostRecentlyPlayedNote() const noexcept;
    std::uint64_t noteEventCounter() const noexcept;
    std::uint16_t activeBank() const noexcept;
    int activeProgram() const noexcept;
    Instrument activeInstrument() const noexcept;
    int activeVoiceCount() const noexcept;
    double currentSampleRate() const noexcept;

    static std::uint16_t bankForInstrument (Instrument instrument) noexcept;
    static std::uint8_t programForInstrument (Instrument instrument) noexcept;

private:
    enum class CommandType : std::uint8_t
    {
        noteOn,
        noteOff,
        allNotesOff,
        setProgram,
        setSustain,
        startPlayback,
        stopPlayback
    };

    struct Command
    {
        CommandType type = CommandType::noteOff;
        std::uint8_t first = 0;
        std::uint8_t second = 0;
        std::uint16_t bank = 0;
        bool flag = false;
    };

    template <std::size_t Capacity>
    class CommandQueue
    {
    public:
        CommandQueue() noexcept
        {
            for (std::size_t i = 0; i < Capacity; ++i)
                cells[i].sequence.store (i, std::memory_order_relaxed);
        }

        bool tryEnqueue (const Command& command) noexcept
        {
            auto position = enqueuePosition.load (std::memory_order_relaxed);
            for (;;)
            {
                auto& cell = cells[position % Capacity];
                const auto sequence = cell.sequence.load (std::memory_order_acquire);
                const auto difference = static_cast<std::intptr_t> (sequence)
                                      - static_cast<std::intptr_t> (position);
                if (difference == 0)
                {
                    if (enqueuePosition.compare_exchange_weak (position, position + 1,
                                                               std::memory_order_relaxed))
                    {
                        cell.command = command;
                        cell.sequence.store (position + 1, std::memory_order_release);
                        return true;
                    }
                }
                else if (difference < 0)
                {
                    return false;
                }
                else
                {
                    position = enqueuePosition.load (std::memory_order_relaxed);
                }
            }
        }

        bool tryDequeue (Command& command) noexcept
        {
            auto position = dequeuePosition.load (std::memory_order_relaxed);
            for (;;)
            {
                auto& cell = cells[position % Capacity];
                const auto sequence = cell.sequence.load (std::memory_order_acquire);
                const auto difference = static_cast<std::intptr_t> (sequence)
                                      - static_cast<std::intptr_t> (position + 1);
                if (difference == 0)
                {
                    if (dequeuePosition.compare_exchange_weak (position, position + 1,
                                                               std::memory_order_relaxed))
                    {
                        command = cell.command;
                        cell.sequence.store (position + Capacity, std::memory_order_release);
                        return true;
                    }
                }
                else if (difference < 0)
                {
                    return false;
                }
                else
                {
                    position = dequeuePosition.load (std::memory_order_relaxed);
                }
            }
        }

    private:
        struct Cell
        {
            std::atomic<std::size_t> sequence { 0 };
            Command command{};
        };

        std::array<Cell, Capacity> cells{};
        alignas (64) std::atomic<std::size_t> enqueuePosition { 0 };
        alignas (64) std::atomic<std::size_t> dequeuePosition { 0 };
    };

    bool enqueue (const Command& command) noexcept;
    void processCommand (const Command& command) noexcept;
    void applyProgram (std::uint16_t bank, int program) noexcept;
    void applySustainState() noexcept;
    void releaseAllVoices (bool immediate) noexcept;
    void applyPlaybackEvent (const MidiEvent& event) noexcept;
    void renderSynth (float* interleaved, int samples) noexcept;
    void renderSegment (float* const* outputs, int outputCount, int outputOffset,
                        int frameCount, int scratchOffset, float metronomeVolume) noexcept;
    float nextMetronomeSample (int clickInterval, int clickLength, float normalizedVolume) noexcept;
    void updateVisualNoteOn (int note) noexcept;
    void updateVisualNoteOff (int note) noexcept;

    static bool readSoundFont (const std::filesystem::path& path,
                               std::vector<std::uint8_t>& bytes,
                               std::string& error);

    tsf* generalMidiSynth = nullptr;
    tsf* softPianoSynth = nullptr;
    tsf* activeSynth = nullptr;
    bool generalMidiLoaded = false;
    bool softPianoLoaded = false;
    std::string fontStatus;

    CommandQueue<4096> commands;
    std::atomic<bool> commandOverflow { false };
    std::shared_ptr<const std::vector<MidiEvent>> requestedPlaybackSequence; // accessed with atomic_load/store free functions
    std::shared_ptr<const std::vector<MidiEvent>> currentPlaybackSequence;
    std::size_t playbackEventIndex = 0;
    std::uint64_t playbackFrame = 0;
    bool playbackActiveOnAudioThread = false;
    std::atomic<bool> playbackActiveForUi { false };

    std::array<std::atomic<int>, 128> activeNotes{};
    std::atomic<int> mostRecentNote { -1 };
    std::atomic<std::uint64_t> noteEvents { 0 };
    std::atomic<std::uint16_t> publishedBank { 0 };
    std::atomic<int> publishedProgram { 0 };
    std::atomic<int> publishedInstrument { static_cast<int> (Instrument::grandPiano) };
    std::atomic<int> publishedVoiceCount { 0 };

    bool sustainUi = false;
    bool sustainMidi = false;
    bool sustainPlayback = false;
    bool effectiveSustain = false;

    std::atomic<float> requestedVolume { 0.78f };
    std::atomic<bool> requestedMute { false };
    std::atomic<bool> requestedMetronome { false };
    std::atomic<int> requestedBpm { 100 };
    std::atomic<float> requestedMetronomeVolume { 0.35f };
    float currentGain = 0.0f;
    float gainTarget = 0.0f;
    float gainStep = 0.0f;
    int gainRampRemaining = 0;

    double sampleRate = 44100.0; // audio-thread only
    std::atomic<double> publishedSampleRate { 44100.0 };
    int preparedBlockSize = 0;
    std::vector<float> interleavedScratch;
    int samplesUntilMetronomeClick = 0;
    int metronomeClickSamplesRemaining = 0;
    int metronomeBeatIndex = 0;
    float metronomePhase = 0.0f;
    float metronomePhaseIncrement = 0.0f;
    float metronomeClickAmplitude = 0.0f;
    int lastMetronomeBpm = 0;
    bool metronomeWasEnabled = false;
};

} // namespace piano
