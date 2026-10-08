#define TSF_NO_STDIO
#define TSF_IMPLEMENTATION
#include "third_party/tsf.h"

#include "PianoEngine.h"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <limits>
#include <utility>

namespace piano
{
namespace
{
constexpr int kMinimumPianoNote = 21; // A0
constexpr int kMaximumPianoNote = 108; // C8
constexpr int kMaximumVoices = 128;
constexpr int kMaximumScratchFrames = 32768;
constexpr float kPi = 3.14159265358979323846f;

void clearSoundFontChannel (tsf* synth, bool immediate) noexcept
{
    if (synth == nullptr)
        return;

    if (immediate)
        tsf_channel_sounds_off_all (synth, 0);
    else
        tsf_channel_note_off_all (synth, 0);
}

float softLimit (float sample) noexcept
{
    const auto magnitude = std::abs (sample);
    constexpr float knee = 0.92f;
    if (magnitude <= knee)
        return sample;

    const auto limited = knee + (1.0f - knee) * std::tanh ((magnitude - knee) / (1.0f - knee));
    return std::copysign (limited, sample);
}

} // namespace

PianoEngine::PianoEngine()
{
    for (auto& active : activeNotes)
        active.store (0, std::memory_order_relaxed);
}

PianoEngine::~PianoEngine()
{
    if (generalMidiSynth != nullptr)
        tsf_close (generalMidiSynth);
    if (softPianoSynth != nullptr)
        tsf_close (softPianoSynth);
}

bool PianoEngine::loadSoundFonts (const std::filesystem::path& generalMidiFont,
                                  const std::filesystem::path& softPianoFont,
                                  std::string& message)
{
    std::string generalError;
    std::string softError;
    std::vector<std::uint8_t> bytes;

    if (readSoundFont (generalMidiFont, bytes, generalError))
    {
        generalMidiSynth = tsf_load_memory (bytes.data(), static_cast<int> (bytes.size()));
        if (generalMidiSynth == nullptr)
            generalError = "The General MIDI SoundFont is invalid or could not be decoded.";
        else
        {
            generalMidiLoaded = true;
            tsf_set_output (generalMidiSynth, TSF_STEREO_INTERLEAVED, 44100, -3.0f);
            if (tsf_set_max_voices (generalMidiSynth, kMaximumVoices) == 0)
            {
                tsf_close (generalMidiSynth);
                generalMidiSynth = nullptr;
                generalMidiLoaded = false;
                generalError = "Not enough memory to prepare General MIDI voices.";
            }
            else if (tsf_channel_set_bank_preset (generalMidiSynth, 0, 0, 0) == 0)
            {
                tsf_close (generalMidiSynth);
                generalMidiSynth = nullptr;
                generalMidiLoaded = false;
                generalError = "The General MIDI SoundFont does not contain its required piano preset.";
            }
        }
    }

    bytes.clear();
    bytes.shrink_to_fit();
    if (readSoundFont (softPianoFont, bytes, softError))
    {
        softPianoSynth = tsf_load_memory (bytes.data(), static_cast<int> (bytes.size()));
        if (softPianoSynth == nullptr)
            softError = "The soft-piano SoundFont is invalid or could not be decoded.";
        else
        {
            softPianoLoaded = true;
            tsf_set_output (softPianoSynth, TSF_STEREO_INTERLEAVED, 44100, -3.0f);
            if (tsf_set_max_voices (softPianoSynth, kMaximumVoices) == 0)
            {
                tsf_close (softPianoSynth);
                softPianoSynth = nullptr;
                softPianoLoaded = false;
                softError = "Not enough memory to prepare soft-piano voices.";
            }
            else if (tsf_channel_set_bank_preset (softPianoSynth, 0, 0, 0) == 0)
            {
                tsf_close (softPianoSynth);
                softPianoSynth = nullptr;
                softPianoLoaded = false;
                softError = "The soft-piano SoundFont does not contain its required piano preset.";
            }
        }
    }

    if (generalMidiLoaded && softPianoLoaded)
    {
        fontStatus = "Sampled General MIDI and soft-piano instruments loaded.";
        message = fontStatus;
        applyProgram (0, 0);
        return true;
    }

    if (generalMidiLoaded)
    {
        fontStatus = "General MIDI instruments loaded. Soft piano is unavailable: " + softError;
        message = fontStatus;
        applyProgram (0, 0);
        return true;
    }

    if (softPianoLoaded)
    {
        fontStatus = "Soft piano loaded. Grand Piano, Electric Piano, and Organ are unavailable: " + generalError;
        message = fontStatus;
        applyProgram (1, 0);
        return true;
    }

    fontStatus = "No piano SoundFont could be loaded. " + generalError + " " + softError;
    message = fontStatus;
    activeSynth = nullptr;
    return false;
}

bool PianoEngine::instrumentAvailable (Instrument instrument) const noexcept
{
    switch (instrument)
    {
        case Instrument::grandPiano:
        case Instrument::electricPiano:
        case Instrument::organ: return generalMidiLoaded;
        case Instrument::softPiano: return softPianoLoaded;
    }
    return false;
}

std::string PianoEngine::soundFontStatus() const
{
    return fontStatus;
}

void PianoEngine::prepareToPlay (double newSampleRate, int expectedBlockSize)
{
    sampleRate = std::isfinite (newSampleRate) && newSampleRate >= 8000.0 && newSampleRate <= 384000.0
               ? newSampleRate : 44100.0;
    publishedSampleRate.store (sampleRate, std::memory_order_relaxed);
    preparedBlockSize = std::clamp (expectedBlockSize, 1, kMaximumScratchFrames);
    interleavedScratch.resize (static_cast<std::size_t> (2 * std::max (preparedBlockSize, kMaximumScratchFrames)));

    if (generalMidiSynth != nullptr)
    {
        tsf_set_output (generalMidiSynth, TSF_STEREO_INTERLEAVED, static_cast<int> (sampleRate), -3.0f);
        tsf_channel_sounds_off_all (generalMidiSynth, 0);
    }
    if (softPianoSynth != nullptr)
    {
        tsf_set_output (softPianoSynth, TSF_STEREO_INTERLEAVED, static_cast<int> (sampleRate), -3.0f);
        tsf_channel_sounds_off_all (softPianoSynth, 0);
    }

    playbackActiveOnAudioThread = false;
    playbackActiveForUi.store (false, std::memory_order_release);
    sustainPlayback = false;
    playbackEventIndex = 0;
    playbackFrame = 0;
    currentPlaybackSequence.reset();
    for (auto& active : activeNotes)
        active.store (0, std::memory_order_relaxed);

    currentGain = 0.0f;
    gainTarget = 0.0f;
    gainStep = 0.0f;
    gainRampRemaining = 0;
    samplesUntilMetronomeClick = 0;
    metronomeClickSamplesRemaining = 0;
    metronomeWasEnabled = false;
    lastMetronomeBpm = 0;
    applySustainState();
}

void PianoEngine::releaseResources() noexcept
{
    playbackActiveOnAudioThread = false;
    playbackActiveForUi.store (false, std::memory_order_release);
    currentPlaybackSequence.reset();
    clearSoundFontChannel (generalMidiSynth, true);
    clearSoundFontChannel (softPianoSynth, true);
    for (auto& active : activeNotes)
        active.store (0, std::memory_order_relaxed);
    publishedVoiceCount.store (0, std::memory_order_relaxed);
}

void PianoEngine::render (float* const* outputChannels, int numOutputChannels, int numSamples) noexcept
{
    if (outputChannels == nullptr || numOutputChannels <= 0 || numSamples <= 0)
        return;

    for (int channel = 0; channel < numOutputChannels; ++channel)
        if (outputChannels[channel] != nullptr)
            std::fill_n (outputChannels[channel], numSamples, 0.0f);

    if (interleavedScratch.size() < static_cast<std::size_t> (2 * numSamples))
    {
        commandOverflow.store (true, std::memory_order_release);
        return;
    }

    Command command;
    while (commands.tryDequeue (command))
        processCommand (command);

    if (commandOverflow.exchange (false, std::memory_order_acq_rel))
        releaseAllVoices (true);

    const auto enabled = requestedMetronome.load (std::memory_order_relaxed);
    const auto bpm = std::clamp (requestedBpm.load (std::memory_order_relaxed), 40, 240);
    if (enabled != metronomeWasEnabled || bpm != lastMetronomeBpm)
    {
        if (enabled)
            samplesUntilMetronomeClick = 0;
        else
            metronomeClickSamplesRemaining = 0;
        metronomeWasEnabled = enabled;
        lastMetronomeBpm = bpm;
    }
    const auto metroVolume = std::clamp (requestedMetronomeVolume.load (std::memory_order_relaxed), 0.0f, 1.0f);
    const auto targetGain = requestedMute.load (std::memory_order_relaxed)
                          ? 0.0f
                          : std::clamp (requestedVolume.load (std::memory_order_relaxed), 0.0f, 1.0f);
    if (targetGain != gainTarget)
    {
        gainTarget = targetGain;
        gainRampRemaining = std::max (1, static_cast<int> (sampleRate * 0.012));
        gainStep = (gainTarget - currentGain) / static_cast<float> (gainRampRemaining);
    }

    int outputOffset = 0;
    while (outputOffset < numSamples)
    {
        if (playbackActiveOnAudioThread && currentPlaybackSequence != nullptr)
        {
            while (playbackEventIndex < currentPlaybackSequence->size())
            {
                const auto& nextEvent = (*currentPlaybackSequence)[playbackEventIndex];
                const auto eventFrame = static_cast<std::uint64_t> (std::llround (
                    std::max (0.0, nextEvent.timeSeconds) * sampleRate));
                if (eventFrame > playbackFrame)
                    break;
                applyPlaybackEvent (nextEvent);
                ++playbackEventIndex;
            }

            if (playbackEventIndex >= currentPlaybackSequence->size())
            {
                sustainPlayback = false;
                applySustainState();
                releaseAllVoices (false);
                playbackActiveOnAudioThread = false;
                playbackActiveForUi.store (false, std::memory_order_release);
            }
        }

        int framesToRender = numSamples - outputOffset;
        if (playbackActiveOnAudioThread && currentPlaybackSequence != nullptr
            && playbackEventIndex < currentPlaybackSequence->size())
        {
            const auto eventFrame = static_cast<std::uint64_t> (std::llround (
                std::max (0.0, (*currentPlaybackSequence)[playbackEventIndex].timeSeconds) * sampleRate));
            if (eventFrame > playbackFrame)
            {
                const auto untilEvent = eventFrame - playbackFrame;
                if (untilEvent < static_cast<std::uint64_t> (framesToRender))
                    framesToRender = static_cast<int> (untilEvent);
            }
            else
                continue;
        }

        if (framesToRender <= 0)
            continue;

        renderSegment (outputChannels, numOutputChannels, outputOffset, framesToRender, 0, metroVolume);
        outputOffset += framesToRender;
        if (playbackActiveOnAudioThread)
            playbackFrame += static_cast<std::uint64_t> (framesToRender);
    }

    if (activeSynth != nullptr)
        publishedVoiceCount.store (tsf_active_voice_count (activeSynth), std::memory_order_relaxed);
    else
        publishedVoiceCount.store (0, std::memory_order_relaxed);
}

void PianoEngine::noteOn (int midiNote, int velocity) noexcept
{
    if (midiNote < 0 || midiNote > 127 || velocity <= 0)
        return;

    Command command;
    command.type = CommandType::noteOn;
    command.first = static_cast<std::uint8_t> (midiNote);
    command.second = static_cast<std::uint8_t> (std::clamp (velocity, 1, 127));
    enqueue (command);
}

void PianoEngine::noteOff (int midiNote) noexcept
{
    if (midiNote < 0 || midiNote > 127)
        return;

    Command command;
    command.type = CommandType::noteOff;
    command.first = static_cast<std::uint8_t> (midiNote);
    enqueue (command);
}

void PianoEngine::allNotesOff (bool immediate) noexcept
{
    Command command;
    command.type = CommandType::allNotesOff;
    command.flag = immediate;
    enqueue (command);
}

void PianoEngine::setInstrument (Instrument instrument) noexcept
{
    setProgram (bankForInstrument (instrument), programForInstrument (instrument));
}

void PianoEngine::setProgram (std::uint16_t bank, int program) noexcept
{
    Command command;
    command.type = CommandType::setProgram;
    command.bank = std::min<std::uint16_t> (bank, 16383);
    command.first = static_cast<std::uint8_t> (std::clamp (program, 0, 127));
    enqueue (command);
}

void PianoEngine::setSustain (SustainSource source, bool enabled) noexcept
{
    Command command;
    command.type = CommandType::setSustain;
    command.first = static_cast<std::uint8_t> (source);
    command.flag = enabled;
    enqueue (command);
}

void PianoEngine::setMasterVolume (float normalizedVolume) noexcept
{
    requestedVolume.store (std::clamp (normalizedVolume, 0.0f, 1.0f), std::memory_order_relaxed);
}

void PianoEngine::setMuted (bool shouldMute) noexcept
{
    requestedMute.store (shouldMute, std::memory_order_relaxed);
}

void PianoEngine::setMetronome (bool enabled, int bpm, float normalizedVolume) noexcept
{
    requestedBpm.store (std::clamp (bpm, 40, 240), std::memory_order_relaxed);
    requestedMetronomeVolume.store (std::clamp (normalizedVolume, 0.0f, 1.0f), std::memory_order_relaxed);
    requestedMetronome.store (enabled, std::memory_order_relaxed);
}

bool PianoEngine::startPlayback (std::shared_ptr<const std::vector<MidiEvent>> sequence) noexcept
{
    if (sequence == nullptr || sequence->empty())
        return false;

    std::atomic_store_explicit (&requestedPlaybackSequence, std::move (sequence), std::memory_order_release);
    Command command;
    command.type = CommandType::startPlayback;
    if (! enqueue (command))
        return false;
    return true;
}

void PianoEngine::stopPlayback() noexcept
{
    Command command;
    command.type = CommandType::stopPlayback;
    enqueue (command);
}

bool PianoEngine::isPlaybackRunning() const noexcept
{
    return playbackActiveForUi.load (std::memory_order_acquire);
}

bool PianoEngine::isNoteActive (int midiNote) const noexcept
{
    return midiNote >= 0 && midiNote <= 127
        && activeNotes[static_cast<std::size_t> (midiNote)].load (std::memory_order_relaxed) > 0;
}

int PianoEngine::mostRecentlyPlayedNote() const noexcept
{
    return mostRecentNote.load (std::memory_order_relaxed);
}

std::uint64_t PianoEngine::noteEventCounter() const noexcept
{
    return noteEvents.load (std::memory_order_relaxed);
}

std::uint16_t PianoEngine::activeBank() const noexcept
{
    return publishedBank.load (std::memory_order_relaxed);
}

int PianoEngine::activeProgram() const noexcept
{
    return publishedProgram.load (std::memory_order_relaxed);
}

Instrument PianoEngine::activeInstrument() const noexcept
{
    return static_cast<Instrument> (publishedInstrument.load (std::memory_order_relaxed));
}

int PianoEngine::activeVoiceCount() const noexcept
{
    return publishedVoiceCount.load (std::memory_order_relaxed);
}

double PianoEngine::currentSampleRate() const noexcept
{
    return publishedSampleRate.load (std::memory_order_relaxed);
}

std::uint16_t PianoEngine::bankForInstrument (Instrument instrument) noexcept
{
    return instrument == Instrument::softPiano ? 1 : 0;
}

std::uint8_t PianoEngine::programForInstrument (Instrument instrument) noexcept
{
    switch (instrument)
    {
        case Instrument::grandPiano: return 0;
        case Instrument::electricPiano: return 4;
        case Instrument::organ: return 16;
        case Instrument::softPiano: return 0;
    }
    return 0;
}

bool PianoEngine::enqueue (const Command& command) noexcept
{
    if (commands.tryEnqueue (command))
        return true;

    commandOverflow.store (true, std::memory_order_release);
    return false;
}

void PianoEngine::processCommand (const Command& command) noexcept
{
    switch (command.type)
    {
        case CommandType::noteOn:
        {
            const int note = command.first;
            if (activeSynth == nullptr || note < kMinimumPianoNote || note > kMaximumPianoNote)
                break;

            float velocity = static_cast<float> (command.second) / 127.0f;
            if (activeBank() == 1)
                velocity *= 0.78f; // A deliberately mellow velocity layer for the soft piano.
            if (activeProgram() == 16)
                velocity = 0.7f + velocity * 0.3f; // Organ drawbars are less velocity-sensitive.

            if (tsf_channel_note_on (activeSynth, 0, note, std::clamp (velocity, 0.01f, 1.0f)) != 0)
            {
                updateVisualNoteOn (note);
                mostRecentNote.store (note, std::memory_order_relaxed);
                noteEvents.fetch_add (1, std::memory_order_relaxed);
            }
            break;
        }
        case CommandType::noteOff:
        {
            const int note = command.first;
            if (activeSynth != nullptr)
                tsf_channel_note_off (activeSynth, 0, note);
            updateVisualNoteOff (note);
            break;
        }
        case CommandType::allNotesOff:
            releaseAllVoices (command.flag);
            break;
        case CommandType::setProgram:
            applyProgram (command.bank, command.first);
            break;
        case CommandType::setSustain:
            switch (static_cast<SustainSource> (command.first))
            {
                case SustainSource::userInterface: sustainUi = command.flag; break;
                case SustainSource::midiPedal: sustainMidi = command.flag; break;
                case SustainSource::playback: sustainPlayback = command.flag; break;
            }
            applySustainState();
            break;
        case CommandType::startPlayback:
            currentPlaybackSequence = std::atomic_load_explicit (&requestedPlaybackSequence, std::memory_order_acquire);
            playbackEventIndex = 0;
            playbackFrame = 0;
            playbackActiveOnAudioThread = currentPlaybackSequence != nullptr && ! currentPlaybackSequence->empty();
            playbackActiveForUi.store (playbackActiveOnAudioThread, std::memory_order_release);
            if (playbackActiveOnAudioThread)
                releaseAllVoices (true);
            break;
        case CommandType::stopPlayback:
            playbackActiveOnAudioThread = false;
            currentPlaybackSequence.reset();
            sustainPlayback = false;
            applySustainState();
            releaseAllVoices (false);
            playbackActiveForUi.store (false, std::memory_order_release);
            break;
    }
}

void PianoEngine::applyProgram (std::uint16_t bank, int program) noexcept
{
    auto* previousSynth = activeSynth;
    if (previousSynth != nullptr)
        tsf_channel_sounds_off_all (previousSynth, 0);

    // Channel 0 is allocated during SoundFont loading, never from the real-time callback.
    if (bank == 1 && softPianoLoaded)
    {
        activeSynth = softPianoSynth;
        tsf_channel_set_bank_preset (activeSynth, 0, 0, 0);
        publishedBank.store (1, std::memory_order_relaxed);
        publishedProgram.store (0, std::memory_order_relaxed);
        publishedInstrument.store (static_cast<int> (Instrument::softPiano), std::memory_order_relaxed);
    }
    else if (generalMidiLoaded)
    {
        activeSynth = generalMidiSynth;
        auto actualProgram = std::clamp (program, 0, 127);
        if (tsf_channel_set_bank_preset (activeSynth, 0, 0, actualProgram) == 0)
        {
            actualProgram = 0;
            tsf_channel_set_bank_preset (activeSynth, 0, 0, actualProgram);
        }
        publishedBank.store (0, std::memory_order_relaxed);
        publishedProgram.store (actualProgram, std::memory_order_relaxed);
        const auto chosen = actualProgram == 4 ? Instrument::electricPiano
                          : actualProgram == 16 ? Instrument::organ
                          : Instrument::grandPiano;
        publishedInstrument.store (static_cast<int> (chosen), std::memory_order_relaxed);
    }
    else if (softPianoLoaded)
    {
        activeSynth = softPianoSynth;
        tsf_channel_set_bank_preset (activeSynth, 0, 0, 0);
        publishedBank.store (1, std::memory_order_relaxed);
        publishedProgram.store (0, std::memory_order_relaxed);
        publishedInstrument.store (static_cast<int> (Instrument::softPiano), std::memory_order_relaxed);
    }
    else
    {
        activeSynth = nullptr;
        publishedBank.store (0, std::memory_order_relaxed);
        publishedProgram.store (0, std::memory_order_relaxed);
        publishedInstrument.store (static_cast<int> (Instrument::grandPiano), std::memory_order_relaxed);
    }

    if (activeSynth != nullptr)
        tsf_channel_set_sustain (activeSynth, 0, effectiveSustain ? 1 : 0);

    for (auto& active : activeNotes)
        active.store (0, std::memory_order_relaxed);
}

void PianoEngine::applySustainState() noexcept
{
    const auto shouldSustain = sustainUi || sustainMidi || sustainPlayback;
    if (shouldSustain == effectiveSustain)
        return;

    effectiveSustain = shouldSustain;
    if (generalMidiSynth != nullptr)
        tsf_channel_set_sustain (generalMidiSynth, 0, effectiveSustain ? 1 : 0);
    if (softPianoSynth != nullptr)
        tsf_channel_set_sustain (softPianoSynth, 0, effectiveSustain ? 1 : 0);
}

void PianoEngine::releaseAllVoices (bool immediate) noexcept
{
    clearSoundFontChannel (generalMidiSynth, immediate);
    clearSoundFontChannel (softPianoSynth, immediate);
    for (auto& active : activeNotes)
        active.store (0, std::memory_order_relaxed);
}

void PianoEngine::applyPlaybackEvent (const MidiEvent& event) noexcept
{
    switch (event.type)
    {
        case MidiEventType::noteOn:
            if (activeSynth != nullptr && event.note >= kMinimumPianoNote && event.note <= kMaximumPianoNote
                && event.value > 0
                && tsf_channel_note_on (activeSynth, 0, event.note,
                                        std::clamp (static_cast<float> (event.value) / 127.0f, 0.01f, 1.0f)) != 0)
            {
                updateVisualNoteOn (event.note);
                mostRecentNote.store (event.note, std::memory_order_relaxed);
                noteEvents.fetch_add (1, std::memory_order_relaxed);
            }
            break;
        case MidiEventType::noteOff:
            if (activeSynth != nullptr)
                tsf_channel_note_off (activeSynth, 0, event.note);
            updateVisualNoteOff (event.note);
            break;
        case MidiEventType::sustain:
            sustainPlayback = event.value >= 64;
            applySustainState();
            break;
        case MidiEventType::programChange:
            applyProgram (event.bank, event.value);
            break;
    }
}

void PianoEngine::renderSynth (float* interleaved, int samples) noexcept
{
    if (activeSynth != nullptr)
        tsf_render_float (activeSynth, interleaved, samples, 0);
    else
        std::fill_n (interleaved, static_cast<std::size_t> (2 * samples), 0.0f);
}

void PianoEngine::renderSegment (float* const* outputs, int outputCount, int outputOffset,
                                 int frameCount, int scratchOffset, float metronomeVolume) noexcept
{
    auto* scratch = interleavedScratch.data() + static_cast<std::size_t> (2 * scratchOffset);
    renderSynth (scratch, frameCount);

    const auto bpm = std::max (40, lastMetronomeBpm);
    const auto clickInterval = std::max (1, static_cast<int> (sampleRate * 60.0 / static_cast<double> (bpm)));
    const auto clickLength = std::max (1, static_cast<int> (sampleRate * 0.055));

    for (int frame = 0; frame < frameCount; ++frame)
    {
        const auto metroSample = nextMetronomeSample (clickInterval, clickLength, metronomeVolume);
        const auto index = static_cast<std::size_t> (frame * 2);
        const auto left = scratch[index] + metroSample;
        const auto right = scratch[index + 1] + metroSample;

        if (gainRampRemaining > 0)
        {
            currentGain += gainStep;
            --gainRampRemaining;
            if (gainRampRemaining == 0)
                currentGain = gainTarget;
        }

        const auto outLeft = softLimit (left * currentGain);
        const auto outRight = softLimit (right * currentGain);
        if (outputCount == 1)
        {
            if (outputs[0] != nullptr)
                outputs[0][outputOffset + frame] = 0.5f * (outLeft + outRight);
        }
        else
        {
            if (outputs[0] != nullptr)
                outputs[0][outputOffset + frame] = outLeft;
            if (outputs[1] != nullptr)
                outputs[1][outputOffset + frame] = outRight;
            for (int channel = 2; channel < outputCount; ++channel)
                if (outputs[channel] != nullptr)
                    outputs[channel][outputOffset + frame] = 0.5f * (outLeft + outRight);
        }
    }
}

float PianoEngine::nextMetronomeSample (int clickInterval, int clickLength, float normalizedVolume) noexcept
{
    if (! metronomeWasEnabled)
        return 0.0f;

    if (samplesUntilMetronomeClick <= 0)
    {
        samplesUntilMetronomeClick = clickInterval;
        metronomeClickSamplesRemaining = clickLength;
        metronomePhase = 0.0f;
        const bool downbeat = (metronomeBeatIndex % 4) == 0;
        const auto frequency = downbeat ? 1760.0f : 1320.0f;
        metronomePhaseIncrement = 2.0f * kPi * frequency / static_cast<float> (sampleRate);
        metronomeClickAmplitude = (downbeat ? 0.31f : 0.23f) * normalizedVolume;
        ++metronomeBeatIndex;
    }

    float output = 0.0f;
    if (metronomeClickSamplesRemaining > 0)
    {
        const auto elapsed = static_cast<float> (clickLength - metronomeClickSamplesRemaining)
                           / static_cast<float> (sampleRate);
        const auto envelope = std::exp (-elapsed * 58.0f);
        output = metronomeClickAmplitude * envelope * std::sin (metronomePhase);
        metronomePhase += metronomePhaseIncrement;
        if (metronomePhase > 2.0f * kPi)
            metronomePhase -= 2.0f * kPi;
        --metronomeClickSamplesRemaining;
    }

    --samplesUntilMetronomeClick;
    return output;
}

void PianoEngine::updateVisualNoteOn (int note) noexcept
{
    if (note < 0 || note > 127)
        return;
    activeNotes[static_cast<std::size_t> (note)].fetch_add (1, std::memory_order_relaxed);
}

void PianoEngine::updateVisualNoteOff (int note) noexcept
{
    if (note < 0 || note > 127)
        return;

    auto& count = activeNotes[static_cast<std::size_t> (note)];
    auto previous = count.load (std::memory_order_relaxed);
    while (previous > 0 && ! count.compare_exchange_weak (previous, previous - 1,
                                                           std::memory_order_relaxed,
                                                           std::memory_order_relaxed))
    {
    }
}

bool PianoEngine::readSoundFont (const std::filesystem::path& path,
                                 std::vector<std::uint8_t>& bytes,
                                 std::string& error)
{
    std::ifstream input (path, std::ios::binary | std::ios::ate);
    if (! input)
    {
        error = "Missing SoundFont: " + path.filename().string() + ".";
        return false;
    }

    const auto size = input.tellg();
    if (size < 12 || static_cast<std::uint64_t> (size) > 512ULL * 1024ULL * 1024ULL
        || static_cast<std::uint64_t> (size) > static_cast<std::uint64_t> (std::numeric_limits<int>::max()))
    {
        error = "SoundFont file has an invalid size: " + path.filename().string() + ".";
        return false;
    }

    bytes.resize (static_cast<std::size_t> (size));
    input.seekg (0, std::ios::beg);
    input.read (reinterpret_cast<char*> (bytes.data()), static_cast<std::streamsize> (bytes.size()));
    if (! input)
    {
        bytes.clear();
        error = "SoundFont file could not be read completely: " + path.filename().string() + ".";
        return false;
    }

    error.clear();
    return true;
}

} // namespace piano
