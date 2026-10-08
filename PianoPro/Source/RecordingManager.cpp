#include "RecordingManager.h"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <limits>
#include <system_error>

namespace piano
{
namespace
{
constexpr std::uint16_t kTicksPerQuarterNote = 480;
constexpr std::uint32_t kDefaultTempoMicrosPerQuarter = 500000;
constexpr std::uint64_t kMaximumFileBytes = 64ULL * 1024ULL * 1024ULL;
constexpr std::size_t kMaximumEvents = 500000;

void appendU16BE (std::vector<std::uint8_t>& out, std::uint16_t value)
{
    out.push_back (static_cast<std::uint8_t> (value >> 8));
    out.push_back (static_cast<std::uint8_t> (value));
}

void appendU32BE (std::vector<std::uint8_t>& out, std::uint32_t value)
{
    out.push_back (static_cast<std::uint8_t> (value >> 24));
    out.push_back (static_cast<std::uint8_t> (value >> 16));
    out.push_back (static_cast<std::uint8_t> (value >> 8));
    out.push_back (static_cast<std::uint8_t> (value));
}

std::uint16_t readU16BE (const std::uint8_t* p)
{
    return static_cast<std::uint16_t> ((static_cast<std::uint16_t> (p[0]) << 8) | p[1]);
}

std::uint32_t readU32BE (const std::uint8_t* p)
{
    return (static_cast<std::uint32_t> (p[0]) << 24)
         | (static_cast<std::uint32_t> (p[1]) << 16)
         | (static_cast<std::uint32_t> (p[2]) << 8)
         | static_cast<std::uint32_t> (p[3]);
}

void appendVariableLength (std::vector<std::uint8_t>& out, std::uint32_t value)
{
    std::uint8_t bytes[4]{};
    int count = 0;
    bytes[count++] = static_cast<std::uint8_t> (value & 0x7fU);
    while ((value >>= 7U) != 0U && count < 4)
        bytes[count++] = static_cast<std::uint8_t> ((value & 0x7fU) | 0x80U);

    while (count > 0)
        out.push_back (bytes[--count]);
}

bool readVariableLength (const std::vector<std::uint8_t>& bytes,
                         std::size_t& position,
                         std::size_t end,
                         std::uint32_t& value)
{
    value = 0;
    for (int i = 0; i < 4; ++i)
    {
        if (position >= end)
            return false;

        const auto byte = bytes[position++];
        value = (value << 7U) | static_cast<std::uint32_t> (byte & 0x7fU);
        if ((byte & 0x80U) == 0)
            return true;
    }

    return false;
}

struct RawEvent
{
    enum class Type { noteOn, noteOff, controlChange, programChange, tempo } type;
    std::uint64_t tick = 0;
    std::uint64_t order = 0;
    std::uint8_t channel = 0;
    std::uint8_t first = 0;
    std::uint8_t second = 0;
    std::uint32_t tempoMicros = kDefaultTempoMicrosPerQuarter;
};

struct TempoPoint
{
    std::uint64_t tick = 0;
    std::uint64_t order = 0;
    std::uint32_t microsPerQuarter = kDefaultTempoMicrosPerQuarter;
};

bool hasTag (const std::vector<std::uint8_t>& bytes, std::size_t position, const char* tag)
{
    return position + 4 <= bytes.size()
        && bytes[position] == static_cast<std::uint8_t> (tag[0])
        && bytes[position + 1] == static_cast<std::uint8_t> (tag[1])
        && bytes[position + 2] == static_cast<std::uint8_t> (tag[2])
        && bytes[position + 3] == static_cast<std::uint8_t> (tag[3]);
}

} // namespace

bool RecordingManager::beginRecording (std::uint16_t initialBank, std::uint8_t initialProgram)
{
    std::lock_guard<std::mutex> guard (mutex);
    if (recording)
        return false;

    events.clear();
    openNoteCounts.fill (0);
    nextOrder = 0;
    sustainIsOn = false;
    recordingStart = std::chrono::steady_clock::now();
    recording = true;

    MidiEvent program;
    program.type = MidiEventType::programChange;
    program.bank = static_cast<std::uint16_t> (std::min<unsigned int> (initialBank, 16383));
    program.value = static_cast<std::uint8_t> (std::min<unsigned int> (initialProgram, 127));
    appendLocked (program);
    return true;
}

void RecordingManager::stopRecording()
{
    std::lock_guard<std::mutex> guard (mutex);
    if (! recording)
        return;

    const auto stopTime = nowSecondsLocked();
    for (std::size_t note = 0; note < openNoteCounts.size(); ++note)
    {
        while (openNoteCounts[note] > 0)
        {
            MidiEvent event;
            event.timeSeconds = stopTime;
            event.type = MidiEventType::noteOff;
            event.note = static_cast<std::uint8_t> (note);
            appendLocked (event);
            --openNoteCounts[note];
        }
    }

    if (sustainIsOn)
    {
        MidiEvent event;
        event.timeSeconds = stopTime;
        event.type = MidiEventType::sustain;
        event.value = 0;
        appendLocked (event);
        sustainIsOn = false;
    }

    recording = false;
}

bool RecordingManager::isRecording() const
{
    std::lock_guard<std::mutex> guard (mutex);
    return recording;
}

double RecordingManager::elapsedSeconds() const
{
    std::lock_guard<std::mutex> guard (mutex);
    return recording ? nowSecondsLocked() : 0.0;
}

double RecordingManager::performanceDurationSeconds() const
{
    std::lock_guard<std::mutex> guard (mutex);
    double duration = 0.0;
    for (const auto& event : events)
        duration = std::max (duration, event.timeSeconds);
    return duration;
}

std::size_t RecordingManager::eventCount() const
{
    std::lock_guard<std::mutex> guard (mutex);
    return events.size();
}

void RecordingManager::recordNoteOn (int note, int velocity)
{
    if (note < 0 || note > 127 || velocity <= 0)
        return;

    std::lock_guard<std::mutex> guard (mutex);
    if (! recording)
        return;

    MidiEvent event;
    event.timeSeconds = nowSecondsLocked();
    event.type = MidiEventType::noteOn;
    event.note = static_cast<std::uint8_t> (note);
    event.value = static_cast<std::uint8_t> (std::clamp (velocity, 1, 127));
    appendLocked (event);
    ++openNoteCounts[static_cast<std::size_t> (note)];
}

void RecordingManager::recordNoteOff (int note)
{
    if (note < 0 || note > 127)
        return;

    std::lock_guard<std::mutex> guard (mutex);
    if (! recording)
        return;

    auto& count = openNoteCounts[static_cast<std::size_t> (note)];
    if (count == 0)
        return; // Avoid writing a dangling note-off for a key held before Record.

    MidiEvent event;
    event.timeSeconds = nowSecondsLocked();
    event.type = MidiEventType::noteOff;
    event.note = static_cast<std::uint8_t> (note);
    appendLocked (event);
    --count;
}

void RecordingManager::recordSustain (bool enabled)
{
    std::lock_guard<std::mutex> guard (mutex);
    if (! recording || sustainIsOn == enabled)
        return;

    MidiEvent event;
    event.timeSeconds = nowSecondsLocked();
    event.type = MidiEventType::sustain;
    event.value = enabled ? 127 : 0;
    appendLocked (event);
    sustainIsOn = enabled;
}

void RecordingManager::recordProgramChange (std::uint16_t bank, int program)
{
    if (program < 0 || program > 127 || bank > 16383)
        return;

    std::lock_guard<std::mutex> guard (mutex);
    if (! recording)
        return;

    MidiEvent event;
    event.timeSeconds = nowSecondsLocked();
    event.type = MidiEventType::programChange;
    event.bank = bank;
    event.value = static_cast<std::uint8_t> (program);
    appendLocked (event);
}

void RecordingManager::closeOpenNotes()
{
    std::lock_guard<std::mutex> guard (mutex);
    if (! recording)
        return;

    const auto stopTime = nowSecondsLocked();
    for (std::size_t note = 0; note < openNoteCounts.size(); ++note)
    {
        while (openNoteCounts[note] > 0)
        {
            MidiEvent event;
            event.timeSeconds = stopTime;
            event.type = MidiEventType::noteOff;
            event.note = static_cast<std::uint8_t> (note);
            appendLocked (event);
            --openNoteCounts[note];
        }
    }
}

std::shared_ptr<const std::vector<MidiEvent>> RecordingManager::playbackEvents() const
{
    std::lock_guard<std::mutex> guard (mutex);
    auto snapshot = events;
    std::stable_sort (snapshot.begin(), snapshot.end(), [] (const MidiEvent& a, const MidiEvent& b)
    {
        if (a.timeSeconds != b.timeSeconds)
            return a.timeSeconds < b.timeSeconds;
        return a.order < b.order;
    });
    return std::make_shared<const std::vector<MidiEvent>> (std::move (snapshot));
}

bool RecordingManager::saveToFile (const std::filesystem::path& path, std::string& error) const
{
    std::vector<MidiEvent> snapshot;
    {
        std::lock_guard<std::mutex> guard (mutex);
        snapshot = events;
    }

    if (snapshot.empty())
    {
        error = "There is no performance to save yet.";
        return false;
    }

    std::stable_sort (snapshot.begin(), snapshot.end(), [] (const MidiEvent& a, const MidiEvent& b)
    {
        if (a.timeSeconds != b.timeSeconds)
            return a.timeSeconds < b.timeSeconds;
        return a.order < b.order;
    });

    return writeMidiFile (snapshot, path, error);
}

bool RecordingManager::loadFromFile (const std::filesystem::path& path, std::string& error)
{
    std::vector<MidiEvent> parsed;
    if (! readMidiFile (path, parsed, error))
        return false;

    std::lock_guard<std::mutex> guard (mutex);
    recording = false;
    sustainIsOn = false;
    openNoteCounts.fill (0);
    events.clear();
    nextOrder = 0;
    for (auto& event : parsed)
    {
        event.order = nextOrder++;
        events.push_back (event);
    }
    return true;
}

double RecordingManager::nowSecondsLocked() const
{
    return std::chrono::duration<double> (std::chrono::steady_clock::now() - recordingStart).count();
}

void RecordingManager::appendLocked (MidiEvent event)
{
    event.timeSeconds = std::max (0.0, event.timeSeconds);
    event.order = nextOrder++;
    events.push_back (event);
}

bool RecordingManager::writeMidiFile (const std::vector<MidiEvent>& eventsToWrite,
                                      const std::filesystem::path& path,
                                      std::string& error)
{
    std::vector<std::uint8_t> track;
    track.reserve (eventsToWrite.size() * 8 + 16);

    // Constant tempo: 500,000 microseconds per quarter note (120 BPM).
    track.insert (track.end(), { 0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20 });

    std::uint64_t previousTick = 0;
    for (const auto& event : eventsToWrite)
    {
        if (! std::isfinite (event.timeSeconds) || event.timeSeconds < 0.0
            || event.timeSeconds > 24.0 * 60.0 * 60.0)
        {
            error = "The performance contains an invalid or excessively long event time.";
            return false;
        }

        if (event.note > 127 || event.value > 127 || event.bank > 16383)
        {
            error = "The performance contains a MIDI value outside the supported range.";
            return false;
        }

        const auto tick = static_cast<std::uint64_t> (std::llround (event.timeSeconds
                                                                    * kTicksPerQuarterNote
                                                                    * 1000000.0
                                                                    / kDefaultTempoMicrosPerQuarter));
        if (tick < previousTick || tick - previousTick > 0x0fffffffULL)
        {
            error = "A MIDI event is too far from the previous event to encode safely.";
            return false;
        }

        appendVariableLength (track, static_cast<std::uint32_t> (tick - previousTick));
        switch (event.type)
        {
            case MidiEventType::noteOn:
                track.insert (track.end(), { 0x90, event.note, event.value });
                break;
            case MidiEventType::noteOff:
                track.insert (track.end(), { 0x80, event.note, 0x00 });
                break;
            case MidiEventType::sustain:
                track.insert (track.end(), { 0xb0, 0x40, static_cast<std::uint8_t> (event.value >= 64 ? 127 : 0) });
                break;
            case MidiEventType::programChange:
                // Standard Bank Select (CC 0/32) followed by Program Change. Bank 1 is
                // reserved by Piano Pro for its separately licensed soft-piano bank.
                track.insert (track.end(), { 0xb0, 0x00, static_cast<std::uint8_t> ((event.bank >> 7) & 0x7f) });
                track.insert (track.end(), { 0x00, 0xb0, 0x20, static_cast<std::uint8_t> (event.bank & 0x7f) });
                track.insert (track.end(), { 0x00, 0xc0, event.value });
                break;
        }
        previousTick = tick;
    }

    track.insert (track.end(), { 0x00, 0xff, 0x2f, 0x00 });
    if (track.size() > std::numeric_limits<std::uint32_t>::max())
    {
        error = "The MIDI performance is too large to save.";
        return false;
    }

    std::vector<std::uint8_t> file;
    file.reserve (14 + track.size());
    file.insert (file.end(), { 'M', 'T', 'h', 'd' });
    appendU32BE (file, 6);
    appendU16BE (file, 0); // Format 0: one self-contained track.
    appendU16BE (file, 1);
    appendU16BE (file, kTicksPerQuarterNote);
    file.insert (file.end(), { 'M', 'T', 'r', 'k' });
    appendU32BE (file, static_cast<std::uint32_t> (track.size()));
    file.insert (file.end(), track.begin(), track.end());

    std::error_code ec;
    if (! path.parent_path().empty())
        std::filesystem::create_directories (path.parent_path(), ec);

    std::ofstream output (path, std::ios::binary | std::ios::trunc);
    if (! output)
    {
        error = "Could not open the selected file for writing.";
        return false;
    }

    output.write (reinterpret_cast<const char*> (file.data()), static_cast<std::streamsize> (file.size()));
    if (! output.good())
    {
        error = "The MIDI file could not be written. Check that the destination has free space and is writable.";
        return false;
    }

    error.clear();
    return true;
}

bool RecordingManager::readMidiFile (const std::filesystem::path& path,
                                     std::vector<MidiEvent>& result,
                                     std::string& error)
{
    std::ifstream input (path, std::ios::binary | std::ios::ate);
    if (! input)
    {
        error = "Could not open the selected MIDI file.";
        return false;
    }

    const auto endPosition = input.tellg();
    if (endPosition < 14 || static_cast<std::uint64_t> (endPosition) > kMaximumFileBytes)
    {
        error = "The MIDI file is empty, truncated, or larger than 64 MB.";
        return false;
    }

    std::vector<std::uint8_t> bytes (static_cast<std::size_t> (endPosition));
    input.seekg (0, std::ios::beg);
    input.read (reinterpret_cast<char*> (bytes.data()), static_cast<std::streamsize> (bytes.size()));
    if (! input.good() && ! input.eof())
    {
        error = "The MIDI file could not be read completely.";
        return false;
    }

    if (! hasTag (bytes, 0, "MThd") || bytes.size() < 14)
    {
        error = "This is not a Standard MIDI File (missing MThd header).";
        return false;
    }

    const auto headerLength = readU32BE (bytes.data() + 4);
    if (headerLength < 6 || headerLength > 1024 || 8ULL + headerLength > bytes.size())
    {
        error = "The MIDI header is invalid or truncated.";
        return false;
    }

    const auto format = readU16BE (bytes.data() + 8);
    const auto numberOfTracks = readU16BE (bytes.data() + 10);
    const auto division = readU16BE (bytes.data() + 12);
    if (format > 1 || numberOfTracks == 0 || numberOfTracks > 128)
    {
        error = "Only MIDI format 0 and format 1 files with up to 128 tracks are supported.";
        return false;
    }

    if ((division & 0x8000U) != 0 || division == 0)
    {
        error = "This MIDI file uses SMPTE timing. Piano Pro currently supports PPQ-timed MIDI files.";
        return false;
    }

    std::vector<RawEvent> rawEvents;
    rawEvents.reserve (1024);
    std::uint64_t globalOrder = 0;
    std::size_t position = static_cast<std::size_t> (8 + headerLength);

    for (std::uint16_t trackNumber = 0; trackNumber < numberOfTracks; ++trackNumber)
    {
        if (! hasTag (bytes, position, "MTrk") || position + 8 > bytes.size())
        {
            error = "A MIDI track header is missing or truncated.";
            return false;
        }

        const auto trackLength = readU32BE (bytes.data() + position + 4);
        position += 8;
        if (static_cast<std::uint64_t> (position) + trackLength > bytes.size())
        {
            error = "A MIDI track extends past the end of the file.";
            return false;
        }

        const auto trackEnd = position + trackLength;
        std::uint64_t absoluteTick = 0;
        std::uint8_t runningStatus = 0;

        while (position < trackEnd)
        {
            std::uint32_t delta = 0;
            if (! readVariableLength (bytes, position, trackEnd, delta))
            {
                error = "A MIDI event has a malformed variable-length delta.";
                return false;
            }
            absoluteTick += delta;
            if (absoluteTick > 0x7fffffffffffffffULL || position >= trackEnd)
            {
                error = "A MIDI event position is invalid.";
                return false;
            }

            auto status = bytes[position];
            bool hasFirstDataByte = false;
            std::uint8_t firstDataByte = 0;
            if ((status & 0x80U) == 0)
            {
                if (runningStatus < 0x80 || runningStatus >= 0xf0)
                {
                    error = "A MIDI track uses running status before a channel status byte.";
                    return false;
                }
                status = runningStatus;
                hasFirstDataByte = true;
                firstDataByte = bytes[position++];
            }
            else
            {
                ++position;
                if (status >= 0x80 && status <= 0xef)
                    runningStatus = status;
                else if (status < 0xf8)
                    runningStatus = 0;
            }

            if (status == 0xff)
            {
                if (position >= trackEnd)
                {
                    error = "A MIDI meta event is truncated.";
                    return false;
                }
                const auto metaType = bytes[position++];
                std::uint32_t length = 0;
                if (! readVariableLength (bytes, position, trackEnd, length)
                    || static_cast<std::uint64_t> (position) + length > trackEnd)
                {
                    error = "A MIDI meta event has an invalid length.";
                    return false;
                }

                if (metaType == 0x51 && length == 3)
                {
                    const auto tempo = (static_cast<std::uint32_t> (bytes[position]) << 16)
                                     | (static_cast<std::uint32_t> (bytes[position + 1]) << 8)
                                     | static_cast<std::uint32_t> (bytes[position + 2]);
                    if (tempo != 0)
                    {
                        RawEvent raw;
                        raw.type = RawEvent::Type::tempo;
                        raw.tick = absoluteTick;
                        raw.order = globalOrder++;
                        raw.tempoMicros = tempo;
                        rawEvents.push_back (raw);
                    }
                }
                position += length;
                if (metaType == 0x2f)
                    position = trackEnd;
                continue;
            }

            if (status == 0xf0 || status == 0xf7)
            {
                std::uint32_t length = 0;
                if (! readVariableLength (bytes, position, trackEnd, length)
                    || static_cast<std::uint64_t> (position) + length > trackEnd)
                {
                    error = "A MIDI system-exclusive event has an invalid length.";
                    return false;
                }
                position += length;
                continue;
            }

            if (status < 0x80 || status >= 0xf0)
            {
                error = "A MIDI track contains an unsupported status byte.";
                return false;
            }

            const auto kind = static_cast<std::uint8_t> (status & 0xf0U);
            const auto channel = static_cast<std::uint8_t> (status & 0x0fU);
            const int dataLength = (kind == 0xc0 || kind == 0xd0) ? 1 : 2;
            if (position + static_cast<std::size_t> (dataLength - (hasFirstDataByte ? 1 : 0)) > trackEnd)
            {
                error = "A MIDI channel event is truncated.";
                return false;
            }

            const auto data1 = hasFirstDataByte ? firstDataByte : bytes[position++];
            const auto data2 = dataLength == 2 ? bytes[position++] : 0;
            if (data1 > 127 || data2 > 127)
            {
                error = "A MIDI channel event contains invalid data.";
                return false;
            }

            RawEvent raw;
            raw.tick = absoluteTick;
            raw.order = globalOrder++;
            raw.channel = channel;
            raw.first = data1;
            raw.second = data2;

            if (kind == 0x90)
                raw.type = data2 == 0 ? RawEvent::Type::noteOff : RawEvent::Type::noteOn;
            else if (kind == 0x80)
                raw.type = RawEvent::Type::noteOff;
            else if (kind == 0xb0)
                raw.type = RawEvent::Type::controlChange;
            else if (kind == 0xc0)
                raw.type = RawEvent::Type::programChange;
            else
                continue;

            rawEvents.push_back (raw);
            if (rawEvents.size() > kMaximumEvents)
            {
                error = "The MIDI file contains too many events to load safely.";
                return false;
            }
        }

        position = trackEnd;
    }

    std::stable_sort (rawEvents.begin(), rawEvents.end(), [] (const RawEvent& a, const RawEvent& b)
    {
        if (a.tick != b.tick)
            return a.tick < b.tick;
        return a.order < b.order;
    });

    std::vector<TempoPoint> tempos;
    tempos.push_back ({ 0, 0, kDefaultTempoMicrosPerQuarter });
    for (const auto& raw : rawEvents)
        if (raw.type == RawEvent::Type::tempo)
            tempos.push_back ({ raw.tick, raw.order, raw.tempoMicros });

    std::stable_sort (tempos.begin(), tempos.end(), [] (const TempoPoint& a, const TempoPoint& b)
    {
        if (a.tick != b.tick)
            return a.tick < b.tick;
        return a.order < b.order;
    });

    auto ticksToSeconds = [division, &tempos] (std::uint64_t targetTick)
    {
        double seconds = 0.0;
        std::uint64_t previousTick = 0;
        std::uint32_t tempo = kDefaultTempoMicrosPerQuarter;
        for (const auto& point : tempos)
        {
            if (point.tick > targetTick)
                break;
            if (point.tick > previousTick)
                seconds += static_cast<double> (point.tick - previousTick) * tempo
                         / (static_cast<double> (division) * 1000000.0);
            previousTick = point.tick;
            tempo = point.microsPerQuarter;
        }
        if (targetTick > previousTick)
            seconds += static_cast<double> (targetTick - previousTick) * tempo
                     / (static_cast<double> (division) * 1000000.0);
        return seconds;
    };

    std::array<unsigned int, 16> bankMsb{};
    std::array<unsigned int, 16> bankLsb{};
    result.clear();
    result.reserve (rawEvents.size());
    std::uint64_t order = 0;

    for (const auto& raw : rawEvents)
    {
        MidiEvent event;
        event.timeSeconds = ticksToSeconds (raw.tick);
        event.order = order++;

        switch (raw.type)
        {
            case RawEvent::Type::noteOn:
                event.type = MidiEventType::noteOn;
                event.note = raw.first;
                event.value = raw.second;
                result.push_back (event);
                break;
            case RawEvent::Type::noteOff:
                event.type = MidiEventType::noteOff;
                event.note = raw.first;
                result.push_back (event);
                break;
            case RawEvent::Type::controlChange:
                if (raw.first == 0)
                    bankMsb[raw.channel] = raw.second;
                else if (raw.first == 32)
                    bankLsb[raw.channel] = raw.second;
                else if (raw.first == 64)
                {
                    event.type = MidiEventType::sustain;
                    event.value = raw.second;
                    result.push_back (event);
                }
                break;
            case RawEvent::Type::programChange:
                event.type = MidiEventType::programChange;
                event.value = raw.first;
                event.bank = static_cast<std::uint16_t> ((bankMsb[raw.channel] << 7) | bankLsb[raw.channel]);
                result.push_back (event);
                break;
            case RawEvent::Type::tempo:
                break;
        }

        if (result.size() > kMaximumEvents)
        {
            error = "The MIDI file contains too many playable events to load safely.";
            return false;
        }
    }

    if (result.empty())
    {
        error = "The MIDI file contains no notes, sustain events, or program changes.";
        return false;
    }

    error.clear();
    return true;
}

} // namespace piano
